import * as THREE from 'three'

/**
 * Turns the everyday Ready Player Me avatar into a generic elite sprinter's
 * body: a muscular V-shaped build with smooth, seamless surfaces. The avatar has
 * no skin under its clothes, so the clothes themselves are reshaped into body and neck.
 *
 * All heights are metres in the avatar's rest pose.
 */

export const LINES = {
  coatHem: 0.96,    // the jacket is cut here, at the waist
  neckline: 1.44,   // collar line; everything above becomes neck
}

// How far each bone's flesh is pulled toward (<1) or pushed from (>1) the bone line.
// A sprinter's V: broad chest and shoulders, narrow waist, strong thighs and arms,
// trim lower legs and narrow spikes.
const SLIM: Record<string, number> = {
  Hips: 0.9, Spine: 0.8, Spine1: 0.88, Spine2: 0.96,
  LeftArm: 0.95, RightArm: 0.95, LeftForeArm: 0.86, RightForeArm: 0.86,
  LeftUpLeg: 0.95, RightUpLeg: 0.95, LeftLeg: 0.84, RightLeg: 0.84,
  LeftFoot: 0.8, RightFoot: 0.8,
}

const v = new THREE.Vector3(); const closest = new THREE.Vector3(); const line = new THREE.Line3()

function boneLine(bone: THREE.Object3D, toMesh: THREE.Matrix4) {
  const child = bone.children.find(item => (item as THREE.Bone).isBone)
  if (!child) return null
  return new THREE.Line3(bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(toMesh), child.getWorldPosition(new THREE.Vector3()).applyMatrix4(toMesh))
}

/**
 * Pulls each vertex toward its bones' axes, blended by skin weight so seams
 * between limbs stay closed. Must run while the model is still in its rest pose.
 */
export function shapeAthleteBuild(meshes: THREE.SkinnedMesh[]) {
  const moved = new THREE.Vector3()
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true)
    const segments = mesh.skeleton.bones.map(bone => {
      const factor = SLIM[bone.name]
      const segment = factor ? boneLine(bone, mesh.bindMatrixInverse) : null
      return segment ? { factor, segment } : null
    })
    const position = mesh.geometry.getAttribute('position')
    const skinIndex = mesh.geometry.getAttribute('skinIndex')
    const skinWeight = mesh.geometry.getAttribute('skinWeight')
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i)
      moved.set(0, 0, 0)
      let total = 0
      for (let k = 0; k < 4; k++) {
        const weight = skinWeight.getComponent(i, k)
        if (!weight) continue
        const entry = segments[skinIndex.getComponent(i, k)]
        if (entry) {
          line.copy(entry.segment).closestPointToPoint(v, true, closest)
          moved.addScaledVector(closest.lerp(v, entry.factor), weight)
        } else moved.addScaledVector(v, weight)
        total += weight
      }
      if (total > 0) position.setXYZ(i, moved.x / total, moved.y / total, moved.z / total)
    }
    position.needsUpdate = true
  }
}

/**
 * The avatar has no neck skin under the jacket collar. Instead of cutting the
 * collar away (which leaves the head floating), squeeze it into a neck that
 * joins the head, and give it the skin material later.
 */
export function collarToNeck(top: THREE.SkinnedMesh, neck: THREE.Bone) {
  top.updateMatrixWorld(true)
  const axis = boneLine(neck, top.bindMatrixInverse)
  if (!axis) return
  const position = top.geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
    if (v.y < LINES.neckline - 0.02 || Math.abs(v.x) > 0.16) continue
    axis.closestPointToPoint(v, false, closest)
    // A slim, slightly oval neck: narrower side to side than front to back.
    const offset = v.clone().sub(closest)
    offset.x *= 0.45; offset.z *= 0.6
    position.setXYZ(i, closest.x + offset.x, v.y, closest.z + offset.z)
  }
  position.needsUpdate = true
}

/**
 * Laplacian smoothing over the welded surface. Irons lapels, pockets, belt
 * loops and seams out of the old clothes so they read as smooth technical fabric.
 */
export function smoothGarment(mesh: THREE.Mesh, select: (p: THREE.Vector3) => boolean, iterations = 10, amount = 0.55) {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!index) return
  // Weld UV-seam duplicates so smoothing never tears the surface apart.
  const keyOf = (i: number) => `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`
  const groupOf = new Int32Array(position.count)
  const groups: number[][] = []
  const seen = new Map<string, number>()
  for (let i = 0; i < position.count; i++) {
    const key = keyOf(i)
    let g = seen.get(key)
    if (g === undefined) { g = groups.length; seen.set(key, g); groups.push([]) }
    groups[g].push(i); groupOf[i] = g
  }
  const neighbours = groups.map(() => new Set<number>())
  const edgeUses = new Map<string, number>()
  const edge = (a: number, b: number) => { const key = a < b ? `${a}_${b}` : `${b}_${a}`; edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1) }
  for (let t = 0; t < index.count; t += 3) {
    const a = groupOf[index.getX(t)], b = groupOf[index.getX(t + 1)], c = groupOf[index.getX(t + 2)]
    neighbours[a].add(b).add(c); neighbours[b].add(a).add(c); neighbours[c].add(a).add(b)
    edge(a, b); edge(b, c); edge(c, a)
  }
  // Open edges (the jacket's front opening, hems, cuffs) must stay put, or smoothing pulls them apart into holes.
  const boundary = new Set<number>()
  edgeUses.forEach((uses, key) => { if (uses === 1) key.split('_').forEach(id => boundary.add(Number(id))) })
  const points = groups.map(members => new THREE.Vector3().fromBufferAttribute(position, members[0]))
  const active = points.map((point, g) => !boundary.has(g) && select(point))
  for (let pass = 0; pass < iterations; pass++) {
    const next = points.map((point, g) => {
      if (!active[g] || !neighbours[g].size) return point.clone()
      const average = new THREE.Vector3()
      neighbours[g].forEach(n => average.add(points[n]))
      return point.clone().lerp(average.divideScalar(neighbours[g].size), amount)
    })
    next.forEach((point, g) => points[g].copy(point))
  }
  groups.forEach((members, g) => members.forEach(i => position.setXYZ(i, points[g].x, points[g].y, points[g].z)))
  position.needsUpdate = true
}

/** Sprinter's hands: fingers drawn in so the hand reads as a firm, compact blade. */
export function relaxHands(model: THREE.Object3D) {
  for (const side of ['Left', 'Right']) {
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) model.getObjectByName(`${side}Hand${finger}1`)?.scale.setScalar(0.55)
    model.getObjectByName(`${side}HandThumb1`)?.scale.setScalar(0.75)
  }
}
