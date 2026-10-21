import * as THREE from 'three'

/**
 * Turns the everyday Ready Player Me avatar into an elite distance runner:
 * a lean build, a sleeveless vest, short shorts and a race bib. The avatar has
 * no skin under its clothes, so the clothes are reshaped rather than removed.
 */

// How far each bone's flesh is pulled toward the bone line (1 = unchanged).
const SLIM: Record<string, number> = {
  Hips: 0.88, Spine: 0.84, Spine1: 0.82, Spine2: 0.82,
  LeftArm: 0.72, RightArm: 0.72, LeftForeArm: 0.78, RightForeArm: 0.78,
  LeftUpLeg: 0.74, RightUpLeg: 0.74, LeftLeg: 0.8, RightLeg: 0.8,
}

/**
 * Pulls each vertex toward its bones' axes, blended by skin weight so seams
 * between limbs stay closed. Must run while the model is still in its rest pose.
 */
export function slimToRunnerBuild(meshes: THREE.SkinnedMesh[]) {
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const v = new THREE.Vector3()
  const closest = new THREE.Vector3(); const moved = new THREE.Vector3(); const line = new THREE.Line3()
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true)
    const toMesh = mesh.bindMatrixInverse
    const bones = mesh.skeleton.bones
    const segments = bones.map(bone => {
      const factor = SLIM[bone.name]
      const child = bone.children.find(item => (item as THREE.Bone).isBone)
      if (!factor || !child) return null
      return { factor, start: bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(toMesh), end: child.getWorldPosition(new THREE.Vector3()).applyMatrix4(toMesh) }
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
        const segment = segments[skinIndex.getComponent(i, k)]
        if (segment) {
          line.set(a.copy(segment.start), b.copy(segment.end)).closestPointToPoint(v, true, closest)
          moved.addScaledVector(closest.clone().lerp(v, segment.factor), weight)
        } else moved.addScaledVector(v, weight)
        total += weight
      }
      if (total > 0) position.setXYZ(i, moved.x / total, moved.y / total, moved.z / total)
    }
    position.needsUpdate = true
    mesh.geometry.computeVertexNormals()
  }
}

/**
 * Splits a garment into kit (group 0) and bare skin (group 1) by triangle, so
 * a sleeved top reads as a vest and trousers read as shorts.
 */
export function splitKit(mesh: THREE.Mesh, isSkin: (centre: THREE.Vector3) => boolean) {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!index) return
  const kit: number[] = []; const skin: number[] = []
  const centre = new THREE.Vector3(); const p = new THREE.Vector3()
  for (let t = 0; t < index.count; t += 3) {
    centre.set(0, 0, 0)
    for (let k = 0; k < 3; k++) centre.add(p.fromBufferAttribute(position, index.getX(t + k)))
    centre.divideScalar(3)
    ;(isSkin(centre) ? skin : kit).push(index.getX(t), index.getX(t + 1), index.getX(t + 2))
  }
  geometry.setIndex([...kit, ...skin])
  geometry.clearGroups()
  geometry.addGroup(0, kit.length, 0)
  geometry.addGroup(kit.length, skin.length, 1)
}

/** A race bib that rides on the chest bone. */
export function raceBib(chest: THREE.Bone, front: THREE.Vector3) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(225,240,255,0.92)'
  ctx.beginPath(); ctx.roundRect(6, 6, 244, 180, 18); ctx.fill()
  ctx.fillStyle = '#0b2a5a'
  ctx.font = '600 22px Manrope, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('SPORTSAI+  MARATHON', 128, 44)
  ctx.font = '800 104px Manrope, sans-serif'
  ctx.fillText('01', 128, 156)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.128), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }))
  // Place it in the chest bone's space so it follows the torso as he runs.
  chest.updateMatrixWorld(true)
  const inverse = chest.getWorldQuaternion(new THREE.Quaternion()).invert()
  // Drawn after the see-through body so the glass never hides it.
  bib.renderOrder = 10
  bib.position.copy(chest.worldToLocal(front.clone()))
  bib.quaternion.copy(inverse)
  chest.add(bib)
  return bib
}
