import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { LINES, collarToNeck, relaxHands, shapeAthleteBuild, smoothGarment } from '../lib/athlete'
import { applySprintPose } from '../lib/sprintPose'

/**
 * A generic elite sprinter frozen in the drive phase, standing on a circular
 * slab that turns a full 360°. The figure (the Ready Player Me avatar from the
 * three.js examples, reshaped into a muscular sprinter) is drawn as glowing
 * low-poly glass: faceted skin, a fine wire mesh, and bright nodes on its surface.
 */

const MODEL_URL = '/models/human.glb'
const TURN_SECONDS = 24 // one full revolution
const NODES = 520
const SLAB_RADIUS = 0.95
const SLAB_HEIGHT = 0.09

function glowTexture(kind: 'dot' | 'star') {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.75)'); g.addColorStop(0.45, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
  if (kind === 'star') {
    ctx.globalCompositeOperation = 'lighter'
    for (const [w, h] of [[128, 3], [3, 128]]) {
      const ray = ctx.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2)
      ray.addColorStop(0, 'rgba(255,255,255,0)'); ray.addColorStop(0.5, 'rgba(255,255,255,0.9)'); ray.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = ray; ctx.fillRect(64 - w / 2, 64 - h / 2, w, h)
    }
  }
  return new THREE.CanvasTexture(canvas)
}

/** Dark metal disc with a glowing rim, a gold inlay ring and tick marks that show the turn. */
function buildSlab() {
  const slab = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(SLAB_RADIUS, SLAB_RADIUS * 1.03, SLAB_HEIGHT, 96),
    new THREE.MeshStandardMaterial({ color: 0x0a1428, metalness: 0.85, roughness: 0.28, emissive: 0x050c1c }),
  )
  body.position.y = SLAB_HEIGHT / 2
  slab.add(body)
  const glow = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
  const rim = new THREE.Mesh(new THREE.TorusGeometry(SLAB_RADIUS * 1.015, 0.008, 8, 160), glow(0x4fb8ff, 0.95))
  rim.rotation.x = Math.PI / 2; rim.position.y = SLAB_HEIGHT
  const base = new THREE.Mesh(new THREE.TorusGeometry(SLAB_RADIUS * 1.03, 0.006, 8, 160), glow(0x2a7cff, 0.6))
  base.rotation.x = Math.PI / 2; base.position.y = 0.004
  const inlay = new THREE.Mesh(new THREE.RingGeometry(SLAB_RADIUS * 0.8, SLAB_RADIUS * 0.81, 128), glow(0xe2b85e, 0.85))
  inlay.rotation.x = -Math.PI / 2; inlay.position.y = SLAB_HEIGHT + 0.001
  slab.add(rim, base, inlay)
  // Tick marks around the top edge, longer every 45°, so the rotation reads clearly.
  const ticks: number[] = []
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2
    const inner = SLAB_RADIUS * (i % 9 === 0 ? 0.84 : 0.88)
    const outer = SLAB_RADIUS * 0.95
    ticks.push(Math.cos(a) * inner, SLAB_HEIGHT + 0.002, Math.sin(a) * inner, Math.cos(a) * outer, SLAB_HEIGHT + 0.002, Math.sin(a) * outer)
  }
  const tickGeometry = new THREE.BufferGeometry(); tickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3))
  slab.add(new THREE.LineSegments(tickGeometry, new THREE.LineBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })))
  return slab
}

export function RunnerScene({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let disposed = false

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x020714)
    scene.fog = new THREE.FogExp2(0x020714, 0.08)
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60)

    scene.add(new THREE.HemisphereLight(0x8fdcff, 0x020714, 0.9))
    const key = new THREE.DirectionalLight(0xcdeeff, 2.4); key.position.set(2, 3, 3); scene.add(key)
    const rim = new THREE.DirectionalLight(0x2f7bff, 3); rim.position.set(-3, 1.5, -2); scene.add(rim)

    const dot = glowTexture('dot'); const star = glowTexture('star')

    // Pool of light under the slab, a halo behind it and slow dust.
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: dot, color: 0x1f6fe0, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }))
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.002; scene.add(pool)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0x0d3b8a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.scale.set(6, 6, 1); halo.position.set(-0.3, 1.3, -2.6); scene.add(halo)
    const DUST = 500
    const dustPositions = new Float32Array(DUST * 3)
    for (let i = 0; i < DUST; i++) dustPositions.set([Math.random() * 14 - 7, Math.random() * 4, Math.random() * 10 - 6], i * 3)
    const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
    scene.add(new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x5fa8ff, size: 0.03, map: dot, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })))

    // Everything on the turntable rotates together.
    const turntable = new THREE.Group()
    turntable.add(buildSlab())
    scene.add(turntable)

    const glass = new THREE.MeshStandardMaterial({ color: 0x3a8ee6, emissive: 0x0e3f86, emissiveIntensity: 0.75, metalness: 0.3, roughness: 0.28, flatShading: true, transparent: true, opacity: 0.6, depthWrite: true, side: THREE.DoubleSide })
    const wire = new THREE.MeshBasicMaterial({ color: 0x8fdcff, wireframe: true, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending })
    const nodeMaterial = new THREE.PointsMaterial({ color: 0xdff6ff, size: 0.024, map: dot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    const glints: { sprite: THREE.Sprite; seed: number }[] = []

    new GLTFLoader().loadAsync(MODEL_URL).then(human => {
      if (disposed) return
      const model = human.scene
      const skinned: THREE.SkinnedMesh[] = []
      model.traverse(object => {
        // Hat, eyes and teeth are not part of the athlete's silhouette.
        if (/^(EyeLeft|EyeRight|Wolf3D_Teeth|Wolf3D_Headwear)$/.test(object.name)) { object.visible = false; return }
        // Cut the long coat at the waist; its tails follow the pelvis instead of the thighs.
        if (object.name === 'Wolf3D_Outfit_Top') {
          const mesh = object as THREE.SkinnedMesh
          const positions = mesh.geometry.getAttribute('position')
          const skinIndex = mesh.geometry.getAttribute('skinIndex'); const skinWeight = mesh.geometry.getAttribute('skinWeight')
          const hips = mesh.skeleton.bones.findIndex(bone => bone.name === 'Hips')
          for (let i = 0; i < positions.count; i++) {
            if (positions.getY(i) >= LINES.coatHem) continue
            positions.setXYZ(i, positions.getX(i) * 0.8, LINES.coatHem, positions.getZ(i) * 0.75)
            skinIndex.setXYZW(i, hips, 0, 0, 0); skinWeight.setXYZW(i, 1, 0, 0, 0)
          }
          positions.needsUpdate = true; skinIndex.needsUpdate = true; skinWeight.needsUpdate = true
        }
        if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(object as THREE.SkinnedMesh)
      })
      const byName = (name: string) => skinned.find(mesh => mesh.name === name)
      shapeAthleteBuild(skinned)
      const neck = model.getObjectByName('Neck') as THREE.Bone | undefined
      const top = byName('Wolf3D_Outfit_Top'); const bottom = byName('Wolf3D_Outfit_Bottom')
      if (top && neck) collarToNeck(top, neck)
      // Iron the clothing details (lapels, pockets, belt loops) into smooth anatomy.
      if (top) smoothGarment(top, p => p.y > LINES.coatHem + 0.01 && p.y < LINES.neckline - 0.03 && Math.abs(p.x) < 0.19)
      if (bottom) smoothGarment(bottom, p => p.y > 0.3)
      for (const mesh of skinned) mesh.geometry.computeVertexNormals()
      relaxHands(model)
      applySprintPose(model)

      for (const mesh of skinned) {
        mesh.material = glass
        mesh.frustumCulled = false
        const overlay = new THREE.SkinnedMesh(mesh.geometry, wire)
        overlay.bind(mesh.skeleton, mesh.bindMatrix)
        overlay.morphTargetInfluences = mesh.morphTargetInfluences
        overlay.position.copy(mesh.position); overlay.quaternion.copy(mesh.quaternion); overlay.scale.copy(mesh.scale)
        overlay.frustumCulled = false
        mesh.parent?.add(overlay)
      }

      // Stand the posed figure on the slab: lowest point on the top surface, body centred over the disc.
      model.updateMatrixWorld(true)
      const bounds = new THREE.Box3(); const v = new THREE.Vector3()
      for (const mesh of skinned) {
        const count = mesh.geometry.getAttribute('position').count
        for (let i = 0; i < count; i += 3) bounds.expandByPoint(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld))
      }
      const centre = bounds.getCenter(new THREE.Vector3())
      model.position.set(-centre.x, SLAB_HEIGHT - bounds.min.y, -centre.z)
      model.updateMatrixWorld(true)
      turntable.add(model)

      // The figure is static, so its glowing nodes are placed once, in turntable space.
      const total = skinned.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count, 0)
      const nodePositions = new Float32Array(NODES * 3)
      turntable.updateMatrixWorld(true)
      const toTurntable = turntable.matrixWorld.clone().invert()
      for (let n = 0; n < NODES; n++) {
        let pick = Math.floor(Math.random() * total)
        let mesh = skinned[0]
        for (const candidate of skinned) {
          const count = candidate.geometry.getAttribute('position').count
          if (pick < count) { mesh = candidate; break }
          pick -= count
        }
        mesh.getVertexPosition(pick, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(toTurntable)
        nodePositions.set([v.x, v.y, v.z], n * 3)
      }
      const nodeGeometry = new THREE.BufferGeometry(); nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3))
      const nodes = new THREE.Points(nodeGeometry, nodeMaterial); nodes.frustumCulled = false
      turntable.add(nodes)
      for (let g = 0; g < 14; g++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, color: 0xc4ecff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
        sprite.position.fromArray(nodePositions, Math.floor(Math.random() * NODES) * 3)
        sprite.scale.set(0, 0, 1)
        turntable.add(sprite)
        glints.push({ sprite, seed: Math.random() * 10 })
      }
    }).catch(error => console.error('Athlete model failed to load', error))

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 0.55)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    const resize = () => {
      const width = host.clientWidth; const height = host.clientHeight
      renderer.setSize(width, height, false); composer.setSize(width, height); bloom.resolution.set(width, height)
      camera.aspect = width / height
      // Wide: athlete sits right of the headline. Narrow: athlete rises above it.
      if (width > 900) camera.setViewOffset(width, height, -width * 0.2, 0, width, height)
      else camera.setViewOffset(width, height, 0, height * 0.2, width, height)
      camera.fov = width > 900 ? 30 : 38
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize); observer.observe(host); resize()

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    const onPointer = (event: PointerEvent) => { pointer.tx = event.clientX / window.innerWidth - 0.5; pointer.ty = event.clientY / window.innerHeight - 0.5 }
    window.addEventListener('pointermove', onPointer)

    const target = new THREE.Vector3(0, 0.95, 0)
    const clock = new THREE.Clock()
    let time = 0
    let frame = 0

    const animate = () => {
      frame = requestAnimationFrame(animate)
      if (document.hidden) return
      const dt = Math.min(clock.getDelta(), 0.05)
      time += dt
      turntable.rotation.y += (Math.PI * 2 / TURN_SECONDS) * dt * (reduced ? 0.3 : 1)
      for (const glint of glints) {
        const s = 0.04 + 0.14 * Math.max(0, Math.sin(time * 1.2 + glint.seed)) ** 3
        glint.sprite.scale.set(s, s, 1)
      }

      pointer.x += (pointer.tx - pointer.x) * 0.04
      pointer.y += (pointer.ty - pointer.y) * 0.04
      const orbit = 0.35 + pointer.x * 0.3
      const radius = host.clientWidth > 900 ? 5.2 : 7.2
      camera.position.set(target.x + Math.sin(orbit) * radius, 1.35 - pointer.y * 0.4, Math.cos(orbit) * radius)
      camera.lookAt(target)

      for (let i = 0; i < DUST; i++) {
        dustPositions[i * 3 + 1] += dt * (0.02 + (i % 5) * 0.01)
        if (dustPositions[i * 3 + 1] > 4) dustPositions[i * 3 + 1] = 0
      }
      dustGeometry.attributes.position.needsUpdate = true
      composer.render()
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('pointermove', onPointer)
      scene.traverse(object => {
        const item = object as THREE.Mesh
        item.geometry?.dispose()
        const material = item.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach(m => m.dispose()); else material?.dispose()
      })
      dot.dispose(); star.dispose()
      composer.dispose(); renderer.dispose(); renderer.domElement.remove()
    }
  }, [])

  return <div ref={hostRef} className={className} aria-hidden="true" />
}
