import * as THREE from 'three'

/**
 * Freezes a Mixamo-compatible avatar (bones named "Hips", "LeftUpLeg", …) in a
 * sprinter's drive phase: strong forward lean, lead knee driven above the hip,
 * rear leg fully extended pushing off the toes, front hand rising to the face,
 * rear arm reaching back.
 *
 * Each listed bone is swung from its rest direction to a target direction in
 * world space, root first, so the avatar's own rest pose and bone axes never matter.
 * Angles are radians measured from straight down, forward positive.
 */

const UP = new THREE.Vector3(0, 1, 0)

// Bone → the child that defines its direction.
const CHILD: Record<string, string> = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
  LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', RightArm: 'RightForeArm', RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase',
}

type Aim = { lean?: number; limb?: number; out?: number }

// Lead leg is the left; the right arm drives forward with it.
const POSE: Record<string, Aim> = {
  Hips: { lean: 0.45 }, Spine: { lean: 0.55 }, Spine1: { lean: 0.6 }, Spine2: { lean: 0.62 },
  Neck: { lean: 0.45 }, Head: { lean: 0.28 },
  LeftUpLeg: { limb: 1.5, out: 0.04 },   LeftLeg: { limb: -0.25, out: 0.02 },  LeftFoot: { limb: 1.6 },
  RightUpLeg: { limb: -0.62, out: 0.04 }, RightLeg: { limb: -0.85, out: 0.02 }, RightFoot: { limb: -0.3 },
  RightArm: { limb: 1.25, out: 0.12 },   RightForeArm: { limb: 2.75, out: -0.1 },
  LeftArm: { limb: -1.75, out: 0.14 },   LeftForeArm: { limb: -1.3, out: 0.05 },
}
// Root first, so each parent is posed before its children.
const ORDER = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']

export function applySprintPose(target: THREE.Object3D) {
  const find = (name: string) => target.getObjectByName(name)
  target.updateMatrixWorld(true)

  // The avatar's forward: perpendicular to the hip line, horizontal.
  const across = find('LeftUpLeg')!.getWorldPosition(new THREE.Vector3()).sub(find('RightUpLeg')!.getWorldPosition(new THREE.Vector3())).setY(0).normalize()
  const forward = new THREE.Vector3().crossVectors(across, UP).normalize()
  const left = new THREE.Vector3().crossVectors(UP, forward)

  const rest = new Map(ORDER.flatMap(name => {
    const bone = find(name); const child = find(CHILD[name])
    if (!bone || !child) return []
    const direction = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize()
    return [[name, { bone, direction, world: bone.getWorldQuaternion(new THREE.Quaternion()) }]]
  }))

  const parentWorld = new THREE.Quaternion()
  for (const name of ORDER) {
    const entry = rest.get(name)
    if (!entry) continue
    const aim = POSE[name]
    const side = name.startsWith('Left') ? 1 : -1
    const want = aim.lean !== undefined
      ? new THREE.Vector3().addScaledVector(UP, Math.cos(aim.lean)).addScaledVector(forward, Math.sin(aim.lean))
      : new THREE.Vector3().addScaledVector(UP, -Math.cos(aim.limb!)).addScaledVector(forward, Math.sin(aim.limb!)).addScaledVector(left, side * (aim.out ?? 0))
    const world = new THREE.Quaternion().setFromUnitVectors(entry.direction, want.normalize()).multiply(entry.world)
    entry.bone.parent!.updateWorldMatrix(true, false)
    entry.bone.parent!.getWorldQuaternion(parentWorld)
    entry.bone.quaternion.copy(parentWorld.invert().multiply(world))
    entry.bone.updateMatrixWorld(true)
  }
  target.updateMatrixWorld(true)
}
