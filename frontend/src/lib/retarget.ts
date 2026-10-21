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
 */

const SIDES = ['Left', 'Right'] as const
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

function facingAngle(find: (name: string) => THREE.Object3D | undefined) {
  const left = find('LeftUpLeg')!.getWorldPosition(new THREE.Vector3())
  const right = find('RightUpLeg')!.getWorldPosition(new THREE.Vector3())
  const across = left.sub(right).setY(0).normalize()
  const forward = new THREE.Vector3().crossVectors(across, UP)
  return Math.atan2(forward.x, forward.z)
}

export function retargetMixamoClip(source: THREE.Object3D, clip: THREE.AnimationClip, target: THREE.Object3D, fps = 60): THREE.AnimationClip {
  const fromSource = (name: string) => source.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`mixamorig:${name}`))
  const fromTarget = (name: string) => target.getObjectByName(name)
  source.updateMatrixWorld(true)
  target.updateMatrixWorld(true)

  const pairs = BONES.flatMap(name => {
    const s = fromSource(name); const t = fromTarget(name)
    return s && t ? [{ name, s, t }] : []
  })
  const turn = new THREE.Quaternion().setFromAxisAngle(UP, facingAngle(fromTarget) - facingAngle(fromSource))
  const turnInverse = turn.clone().invert()

  const rest = new Map(pairs.map(({ name, s, t }) => {
    const sourceWorld = s.getWorldQuaternion(new THREE.Quaternion())
    const targetWorld = t.getWorldQuaternion(new THREE.Quaternion())
    const align = new THREE.Quaternion()
    const child = CHILD[name]
    const sc = child && fromSource(child); const tc = child && fromTarget(child)
    if (sc && tc) {
      const sourceDir = sc.getWorldPosition(new THREE.Vector3()).sub(s.getWorldPosition(new THREE.Vector3())).applyQuaternion(turn).normalize()
      const targetDir = tc.getWorldPosition(new THREE.Vector3()).sub(t.getWorldPosition(new THREE.Vector3())).normalize()
      align.setFromUnitVectors(targetDir, sourceDir)
    }
    return [name, { sourceInverse: sourceWorld.invert(), aligned: align.multiply(targetWorld), parentWorld: t.parent!.getWorldQuaternion(new THREE.Quaternion()) }]
  }))

  // Hips height drives the bounce, scaled to the target's leg length.
  const sourceHips = fromSource('Hips')!; const targetHips = fromTarget('Hips')!
  const sourceHipsRest = sourceHips.getWorldPosition(new THREE.Vector3())
  const targetHipsRest = targetHips.getWorldPosition(new THREE.Vector3())
  const scale = targetHipsRest.y / Math.max(sourceHipsRest.y, 1e-6)

  const mixer = new THREE.AnimationMixer(source)
  mixer.clipAction(clip).play()
  const frames = Math.max(2, Math.round(clip.duration * fps))
  const times: number[] = []
  const rotations = new Map(pairs.map(({ name }) => [name, [] as number[]]))
  const hipsPositions: number[] = []
  const world = new Map<THREE.Object3D, THREE.Quaternion>()
  const q = new THREE.Quaternion(); const delta = new THREE.Quaternion(); const local = new THREE.Quaternion()
  const position = new THREE.Vector3()

  for (let frame = 0; frame <= frames; frame++) {
    const time = (frame / frames) * clip.duration
    times.push(time)
    mixer.setTime(time)
    source.updateMatrixWorld(true)
    world.clear()
    for (const { name, s, t } of pairs) {
      const r = rest.get(name)!
      delta.copy(s.getWorldQuaternion(q)).multiply(r.sourceInverse)
      delta.premultiply(turn).multiply(turnInverse)
      const solved = delta.clone().multiply(r.aligned)
      world.set(t, solved)
      const parent = world.get(t.parent!) ?? r.parentWorld
      local.copy(parent).invert().multiply(solved)
      rotations.get(name)!.push(local.x, local.y, local.z, local.w)
    }
    const lift = sourceHips.getWorldPosition(position).y - sourceHipsRest.y
    const hipsWorld = targetHipsRest.clone().setY(targetHipsRest.y + lift * scale)
    const hipsLocal = targetHips.parent!.worldToLocal(hipsWorld)
    hipsPositions.push(hipsLocal.x, hipsLocal.y, hipsLocal.z)
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(source)

  const tracks: THREE.KeyframeTrack[] = pairs.map(({ name, t }) => new THREE.QuaternionKeyframeTrack(`${t.name}.quaternion`, times, rotations.get(name)!))
  tracks.push(new THREE.VectorKeyframeTrack(`${targetHips.name}.position`, times, hipsPositions))
  return new THREE.AnimationClip(`${clip.name}-retargeted`, clip.duration, tracks)
}
