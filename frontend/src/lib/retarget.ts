import * as THREE from 'three'

/**
 * Copies a Mixamo animation (bones named "mixamorig:Hips", T-pose rest) onto a
 * Mixamo-compatible avatar (bones named "Hips", A-pose rest, possibly facing the
 * other way). Works in world space so differing rest poses and bone axes do not
 * twist the limbs:
 *
 *   world_target(t) = F · (world_source(t) · rest_source⁻¹) · F⁻¹ · C · rest_target
 *
 * F turns the source's facing into the target's; C swings each target bone so its
 * rest direction matches the source's (A-pose arms up to the T-pose). The result is
 * baked into local quaternion tracks the target can play directly.
 *
 * `form` rebuilds the limbs to a running style while keeping the source's timing
 * (each leg's thigh swing gives its phase; each arm follows the opposite leg):
 * - "distance": elbow near 90°, hands from hip to chest, legs as recorded.
 * - "sprint": forward lean, near-horizontal knee drive, heel tucked under the hip,
 *   hands from hip to face height, and the stance foot planted on the ground.
 */

export type RunningForm = 'recorded' | 'distance' | 'sprint'

const SIDES = ['Left', 'Right'] as const
type Side = typeof SIDES[number]
// Root-first order, so a parent is always solved before its children.
const BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  ...SIDES.flatMap(s => [`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`]),
  ...SIDES.flatMap(s => [`${s}UpLeg`, `${s}Leg`, `${s}Foot`, `${s}ToeBase`]),
]
const CHILD: Record<string, string> = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head',
  ...Object.fromEntries(SIDES.flatMap(s => [
    [`${s}Shoulder`, `${s}Arm`], [`${s}Arm`, `${s}ForeArm`], [`${s}ForeArm`, `${s}Hand`],
    [`${s}UpLeg`, `${s}Leg`], [`${s}Leg`, `${s}Foot`], [`${s}Foot`, `${s}ToeBase`],
  ])),
}

const UP = new THREE.Vector3(0, 1, 0)
const ARM = /^(Left|Right)(Arm|ForeArm|Hand)$/
const LEG = /^(Left|Right)(UpLeg|Leg|Foot|ToeBase)$/
const TORSO = /^(Spine|Spine1|Spine2|Neck|LeftShoulder|RightShoulder)$/

// Shoulder angle = a + b·s; elbow bend = a + b·s + c·s² (s: opposite thigh swing, -1 back … 1 forward).
const ARMS = {
  distance: { shoulder: [0.1, 0.5], elbow: [1.45, 0.25, 0], inward: [0.1, -0.2] },
  // Sprint: hand to chin height in front; the elbow opens as the arm drives back,
  // and the hands pass low by the hips where the arms cross.
  sprint: { shoulder: [-0.12, 1.02], elbow: [1.0, 0.55, 0.25], inward: [0.08, -0.12] },
} as const
const SPRINT_LEAN = 0.16

const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d))
const bump = (phase: number, centre: number, width: number) => Math.exp(-(wrap(phase - centre) ** 2) / (2 * width * width))

function facingAngle(find: (name: string) => THREE.Object3D | undefined) {
  const left = find('LeftUpLeg')!.getWorldPosition(new THREE.Vector3())
  const right = find('RightUpLeg')!.getWorldPosition(new THREE.Vector3())
  const across = left.sub(right).setY(0).normalize()
  const forward = new THREE.Vector3().crossVectors(across, UP)
  return Math.atan2(forward.x, forward.z)
}

export function retargetMixamoClip(
  source: THREE.Object3D, clip: THREE.AnimationClip, target: THREE.Object3D,
  { fps = 60, form = 'recorded' as RunningForm, cycle }: { fps?: number; form?: RunningForm; cycle?: number } = {},
): THREE.AnimationClip {
  const fromSource = (name: string) => source.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`mixamorig:${name}`))
  const fromTarget = (name: string) => target.getObjectByName(name)
  source.updateMatrixWorld(true)
  target.updateMatrixWorld(true)

  const pairs = BONES.flatMap(name => {
    const s = fromSource(name); const t = fromTarget(name)
    return s && t ? [{ name, s, t }] : []
  })
  const targetFacing = facingAngle(fromTarget)
  const turn = new THREE.Quaternion().setFromAxisAngle(UP, targetFacing - facingAngle(fromSource))
  const turnInverse = turn.clone().invert()
  const forward = new THREE.Vector3(Math.sin(targetFacing), 0, Math.cos(targetFacing))
  const leftward = new THREE.Vector3().crossVectors(UP, forward)
  const sprint = form === 'sprint'
  const lean = new THREE.Quaternion().setFromAxisAngle(leftward, sprint ? SPRINT_LEAN : 0)

  const worldPos = (object: THREE.Object3D) => object.getWorldPosition(new THREE.Vector3())
  const rest = new Map(pairs.map(({ name, s, t }) => {
    const sourceWorld = s.getWorldQuaternion(new THREE.Quaternion())
    const targetWorld = t.getWorldQuaternion(new THREE.Quaternion())
    const targetRest = targetWorld.clone()
    let restDir: THREE.Vector3 | null = null
    const align = new THREE.Quaternion()
    const child = CHILD[name]
    const sc = child && fromSource(child); const tc = child && fromTarget(child)
    if (sc && tc) {
      const sourceDir = worldPos(sc).sub(worldPos(s)).applyQuaternion(turn).normalize()
      const targetDir = worldPos(tc).sub(worldPos(t)).normalize()
      align.setFromUnitVectors(targetDir, sourceDir)
      restDir = targetDir
    }
    return [name, { sourceInverse: sourceWorld.invert(), aligned: align.multiply(targetWorld), targetRest, restDir, parentWorld: t.parent!.getWorldQuaternion(new THREE.Quaternion()) }]
  }))

  const sourceHips = fromSource('Hips')!; const targetHips = fromTarget('Hips')!
  const sourceHipsRest = worldPos(sourceHips)
  const targetHipsRest = worldPos(targetHips)
  const scale = targetHipsRest.y / Math.max(sourceHipsRest.y, 1e-6)

  // Leg geometry of the target, for planting the stance foot on the ground.
  const legs = Object.fromEntries(SIDES.map(side => {
    const hip = worldPos(fromTarget(`${side}UpLeg`)!); const knee = worldPos(fromTarget(`${side}Leg`)!)
    const ankle = worldPos(fromTarget(`${side}Foot`)!); const toe = worldPos(fromTarget(`${side}ToeBase`)!)
    return [side, { thigh: hip.distanceTo(knee), shin: knee.distanceTo(ankle), foot: ankle.distanceTo(toe), hipDrop: hip.y - targetHipsRest.y, ankleY: ankle.y, toeY: toe.y }]
  })) as Record<Side, { thigh: number; shin: number; foot: number; hipDrop: number; ankleY: number; toeY: number }>

  const mixer = new THREE.AnimationMixer(source)
  mixer.clipAction(clip).play()
  const frames = Math.max(2, Math.round(clip.duration * fps))

  // Each thigh's swing (forward positive) normalised to -1…1, and its phase θ with swing ≈ sin θ.
  const swing: Record<Side, number[]> = { Left: [], Right: [] }
  const phase: Record<Side, number[]> = { Left: [], Right: [] }
  if (form !== 'recorded') {
    const hip = new THREE.Vector3(); const knee = new THREE.Vector3()
    for (let frame = 0; frame <= frames; frame++) {
      mixer.setTime((frame / frames) * clip.duration)
      source.updateMatrixWorld(true)
      for (const side of SIDES) {
        fromSource(`${side}UpLeg`)!.getWorldPosition(hip); fromSource(`${side}Leg`)!.getWorldPosition(knee)
        const thigh = knee.sub(hip).applyQuaternion(turn)
        swing[side].push(Math.atan2(thigh.dot(forward), -thigh.y))
      }
    }
    for (const side of SIDES) {
      const values = swing[side]
      const mid = (Math.max(...values) + Math.min(...values)) / 2
      const half = Math.max(1e-6, (Math.max(...values) - Math.min(...values)) / 2)
      const s = values.map(value => (value - mid) / half)
      // The clip loops, so the slope wraps around its ends.
      const slope = s.map((_, i) => s[(i + 1) % frames] - s[(i - 1 + frames) % frames])
      const peak = Math.max(1e-6, ...slope.map(Math.abs))
      swing[side] = s
      phase[side] = s.map((value, i) => Math.atan2(value, slope[i] / peak))
    }
  }

  const sagittal = (angle: number) => new THREE.Vector3().addScaledVector(UP, -Math.cos(angle)).addScaledVector(forward, Math.sin(angle))
  const armDir = (angle: number, side: Side, inward: number) => sagittal(angle).addScaledVector(leftward, (side === 'Left' ? 1 : -1) * inward).normalize()

  /** Sprint leg angles from the phase: hip flexion, shin and foot directions (radians from straight down, forward positive). */
  const sprintLeg = (theta: number) => {
    const hip = 0.42 + 0.95 * Math.sin(theta)
    // Knee folds hard during recovery (heel under the hip), stays bent while the thigh
    // rises to horizontal, then opens as the thigh comes down to strike under the body.
    const knee = 0.3 + 1.9 * bump(theta, -0.3, 0.7) + 1.2 * bump(theta, 1.3, 0.45) + 0.3 * bump(theta, 3.0, 0.4)
    const shin = hip - knee
    const foot = shin + Math.PI / 2 - 0.1 - 0.6 * bump(theta, -1.9, 0.5) + 0.25 * bump(theta, 1.0, 0.6)
    return { hip, shin, foot }
  }

  const times: number[] = []
  const rotations = new Map(pairs.map(({ name }) => [name, [] as number[]]))
  const hipsPositions: number[] = []
  const world = new Map<THREE.Object3D, THREE.Quaternion>()
  const q = new THREE.Quaternion(); const delta = new THREE.Quaternion(); const local = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const swingTo = (from: THREE.Vector3, to: THREE.Vector3, restWorld: THREE.Quaternion) => new THREE.Quaternion().setFromUnitVectors(from, to).multiply(restWorld)

  for (let frame = 0; frame <= frames; frame++) {
    const time = (frame / frames) * clip.duration
    times.push(cycle ? (frame / frames) * cycle : time)
    mixer.setTime(time)
    source.updateMatrixWorld(true)
    world.clear()
    const legPose = sprint ? { Left: sprintLeg(phase.Left[frame]), Right: sprintLeg(phase.Right[frame]) } : null

    for (const { name, s, t } of pairs) {
      const r = rest.get(name)!
      delta.copy(s.getWorldQuaternion(q)).multiply(r.sourceInverse)
      delta.premultiply(turn).multiply(turnInverse)
      let solved = delta.clone().multiply(r.aligned)
      if (sprint && TORSO.test(name)) solved.premultiply(lean)

      const arm = form !== 'recorded' ? name.match(ARM) : null
      const leg = legPose ? name.match(LEG) : null
      if (arm) {
        const side = arm[1] as Side
        const style = ARMS[form === 'sprint' ? 'sprint' : 'distance']
        const s = swing[side === 'Left' ? 'Right' : 'Left'][frame]
        const shoulder = style.shoulder[0] + style.shoulder[1] * s + (sprint ? SPRINT_LEAN * 0.6 : 0)
        const elbow = style.elbow[0] + style.elbow[1] * s + style.elbow[2] * s * s
        if (arm[2] === 'Hand') {
          const fore = rest.get(`${side}ForeArm`)!
          solved = world.get(fromTarget(`${side}ForeArm`)!)!.clone().multiply(fore.targetRest.clone().invert()).multiply(r.targetRest)
        } else {
          const want = arm[2] === 'Arm' ? armDir(shoulder, side, style.inward[0]) : armDir(shoulder + elbow, side, style.inward[1])
          solved = swingTo(r.restDir!, want, r.targetRest)
        }
      } else if (leg) {
        const side = leg[1] as Side
        const pose = legPose![side]
        if (leg[2] === 'ToeBase') {
          const foot = rest.get(`${side}Foot`)!
          solved = world.get(fromTarget(`${side}Foot`)!)!.clone().multiply(foot.targetRest.clone().invert()).multiply(r.targetRest)
        } else {
          const angle = leg[2] === 'UpLeg' ? pose.hip : leg[2] === 'Leg' ? pose.shin : pose.foot
          solved = swingTo(r.restDir!, sagittal(angle), r.targetRest)
        }
      }
      world.set(t, solved)
      const parent = world.get(t.parent!) ?? r.parentWorld
      local.copy(parent).invert().multiply(solved)
      rotations.get(name)!.push(local.x, local.y, local.z, local.w)
    }

    let hipsY: number
    if (legPose) {
      // Lowest point of either foot touches the ground; hips ride at that height.
      hipsY = -Infinity
      for (const side of SIDES) {
        const g = legs[side]; const pose = legPose[side]
        const ankle = g.hipDrop + sagittal(pose.hip).y * g.thigh + sagittal(pose.shin).y * g.shin
        const toe = ankle + sagittal(pose.foot).y * g.foot
        hipsY = Math.max(hipsY, g.ankleY - ankle, g.toeY - toe)
      }
    } else {
      hipsY = targetHipsRest.y + (sourceHips.getWorldPosition(position).y - sourceHipsRest.y) * scale
    }
    const hipsLocal = targetHips.parent!.worldToLocal(targetHipsRest.clone().setY(hipsY))
    hipsPositions.push(hipsLocal.x, hipsLocal.y, hipsLocal.z)
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(source)

  const tracks: THREE.KeyframeTrack[] = pairs.map(({ name, t }) => new THREE.QuaternionKeyframeTrack(`${t.name}.quaternion`, times, rotations.get(name)!))
  tracks.push(new THREE.VectorKeyframeTrack(`${targetHips.name}.position`, times, hipsPositions))
  return new THREE.AnimationClip(`${clip.name}-${form}`, cycle ?? clip.duration, tracks)
}
