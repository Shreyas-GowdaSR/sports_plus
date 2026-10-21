import * as THREE from 'three'

/**
 * Turns the everyday Ready Player Me avatar into a generic elite sprinter:
 * a muscular V-shaped build, a matte technical singlet, half-length sprint
 * tights, unbranded low-profile spikes and a race bib. The avatar has no skin under its clothes, so the
 * clothes themselves are reshaped into body, neck and kit.
 *
 * All heights are metres in the avatar's rest pose.
 */

export const LINES = {
  coatHem: 0.96,    // the jacket is cut here; the singlet tucks into the shorts
  neckline: 1.44,   // singlet neckline; everything above becomes neck
  vestEdge: 0.2,    // sideways distance where the shoulder ends and the arm begins
  shortsHem: 0.68,  // half tights finish just above the knee
  sole: 0.035,      // shoe sole height
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

/** 0 = main kit colour, 1 = bare skin, 2 = trim / accent. */
export type Zone = 0 | 1 | 2

/** Re-orders triangles into material groups so one garment can carry kit, skin and trim. */
export function splitZones(mesh: THREE.Mesh, classify: (centre: THREE.Vector3) => Zone) {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!index) return
  const zones: number[][] = [[], [], []]
  const centre = new THREE.Vector3(); const p = new THREE.Vector3()
  for (let t = 0; t < index.count; t += 3) {
    centre.set(0, 0, 0)
    for (let k = 0; k < 3; k++) centre.add(p.fromBufferAttribute(position, index.getX(t + k)))
    zones[classify(centre.divideScalar(3))].push(index.getX(t), index.getX(t + 1), index.getX(t + 2))
  }
  geometry.setIndex(zones.flat())
  geometry.clearGroups()
  let start = 0
  zones.forEach((zone, material) => { geometry.addGroup(start, zone.length, material); start += zone.length })
}

/** Singlet: scoop neck and armholes cut to skin, with a thin gold binding on every edge. */
export function singletZone(c: THREE.Vector3): Zone {
  const ax = Math.abs(c.x)
  const scoop = c.z > 0.02 ? 0.07 * Math.max(0, 1 - ax / 0.11) : 0
  const neck = LINES.neckline - scoop
  if (c.y > neck || ax > LINES.vestEdge) return 1
  if (c.y > neck - 0.022 || ax > LINES.vestEdge - 0.022) return 2
  return 0
}

/** Half tights: a single gold stripe down the outside of each leg. */
export function shortsZone(c: THREE.Vector3): Zone {
  if (c.y < LINES.shortsHem) return 1
  const side = Math.abs(c.x)
  return side > 0.15 && Math.abs(c.z) < 0.03 ? 2 : 0
}

/** Spike: light upper, gold plate. */
export function shoeZone(c: THREE.Vector3): Zone {
  return c.y < LINES.sole ? 2 : 0
}

/** Sprinter's hands: fingers drawn in so the hand reads as a firm, compact blade. */
export function relaxHands(model: THREE.Object3D) {
  for (const side of ['Left', 'Right']) {
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) model.getObjectByName(`${side}Hand${finger}1`)?.scale.setScalar(0.55)
    model.getObjectByName(`${side}HandThumb1`)?.scale.setScalar(0.75)
  }
}

/** A race bib that rides on the chest bone. */
export function raceBib(chest: THREE.Bone, front: THREE.Vector3) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f2d48a'
  ctx.beginPath(); ctx.roundRect(6, 6, 244, 180, 14); ctx.fill()
  ctx.fillStyle = '#10131a'
  ctx.font = '700 20px Manrope, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('SPORTSAI+  100 M', 128, 42)
  ctx.font = '800 104px Manrope, sans-serif'
  ctx.fillText('01', 128, 154)
  ctx.fillRect(40, 166, 176, 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }))
  // Drawn after the see-through body so the glass never hides it.
  bib.renderOrder = 10
  chest.updateMatrixWorld(true)
  bib.position.copy(chest.worldToLocal(front.clone()))
  bib.quaternion.copy(chest.getWorldQuaternion(new THREE.Quaternion()).invert())
  chest.add(bib)
  return bib
}
