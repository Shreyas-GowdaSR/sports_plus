import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { retargetMixamoClip } from '../lib/retarget'
import { LINES, collarToNeck, raceBib, relaxHands, shapeAthleteBuild, shoeZone, shortsZone, singletZone, smoothGarment, splitZones } from '../lib/athlete'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/**
 * A generic elite sprinter (the Ready Player Me avatar from the three.js examples,
 * reshaped into a tall, muscular athlete in a technical singlet, half tights,
 * spikes and a race bib) sprinting at quarter speed, drawn as a glowing low-poly figure: faceted glass skin, a fine
 * wire mesh on top, and bright nodes that ride the skinned vertices. The timing
 * comes from the Mixamo "Soldier" run cycle; the limbs are rebuilt to sprint form.
 */

const MODEL_URL = '/models/human.glb'
const MOTION_URL = '/models/Soldier.glb'
const PLAYBACK = 0.25
const SPRINT_CYCLE = 0.46 // seconds per stride cycle at full speed (about 4.3 steps a second)
const TALL = 1.05
const NODES = 520

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

    // Floor light streak, back halo and drifting dust
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.8), new THREE.MeshBasicMaterial({ map: dot, color: 0x2a8cff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }))
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.005, 0); scene.add(pool)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0x0d3b8a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.scale.set(6, 6, 1); halo.position.set(-0.4, 1.3, -2.5); scene.add(halo)
    const DUST = 600
    const dustPositions = new Float32Array(DUST * 3)
    for (let i = 0; i < DUST; i++) dustPositions.set([Math.random() * 16 - 8, Math.random() * 4, Math.random() * 10 - 6], i * 3)
    const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
    scene.add(new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x5fa8ff, size: 0.03, map: dot, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })))

    // Glowing nodes that follow the skinned surface
    const nodePositions = new Float32Array(NODES * 3)
    const nodeGeometry = new THREE.BufferGeometry(); nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3).setUsage(THREE.DynamicDrawUsage))
    const nodes = new THREE.Points(nodeGeometry, new THREE.PointsMaterial({ color: 0xdff6ff, size: 0.022, map: dot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    nodes.frustumCulled = false
    scene.add(nodes)
    const glints = Array.from({ length: 14 }, () => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, color: 0xc4ecff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      sprite.scale.set(0, 0, 1); scene.add(sprite)
      return { sprite, node: Math.floor(Math.random() * NODES), seed: Math.random() * 10 }
    })
    let samples: { mesh: THREE.SkinnedMesh; index: number }[] = []

    // Front faces only and normal blending: additive double-sided skin piles up into a white blob.
    const glass = new THREE.MeshStandardMaterial({ color: 0x3a8ee6, emissive: 0x0e3f86, emissiveIntensity: 0.75, metalness: 0.3, roughness: 0.28, flatShading: true, transparent: true, opacity: 0.55, depthWrite: true })
    // Kit: matte technical fabric (no metal sheen), white singlet and shoes, deep navy shorts, gold binding.
    const fabric = (color: number, emissive: number) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.35, metalness: 0, roughness: 0.92, transparent: true, opacity: 0.94, depthWrite: true, side: THREE.DoubleSide })
    const singlet = fabric(0xdfe7f0, 0x1c2a3c)
    const shorts = fabric(0x1a2c55, 0x0a1430)
    const shoe = fabric(0xeef2f6, 0x1c2a3c)
    const trim = new THREE.MeshStandardMaterial({ color: 0xe2b85e, emissive: 0x6a4a14, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.96, depthWrite: true })
    const wire = new THREE.MeshBasicMaterial({ color: 0x8fdcff, wireframe: true, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending })

    let mixer: THREE.AnimationMixer | null = null
    const loader = new GLTFLoader()
    Promise.all([loader.loadAsync(MODEL_URL), loader.loadAsync(MOTION_URL)]).then(([human, motion]) => {
      if (disposed) return
      const model = human.scene
      const skinned: THREE.SkinnedMesh[] = []
      model.traverse(object => {
        // Eyes and teeth sit inside the head and only add clutter through the glass;
        // the headwear is a hat, which does not belong on a runner.
        if (/^(EyeLeft|EyeRight|Wolf3D_Teeth|Wolf3D_Headwear)$/.test(object.name)) { object.visible = false; return }
        // Cut the long coat at the hips; the singlet tucks into the shorts.
        if (object.name === 'Wolf3D_Outfit_Top') {
          const mesh = object as THREE.SkinnedMesh
          const positions = mesh.geometry.getAttribute('position')
          const skinIndex = mesh.geometry.getAttribute('skinIndex'); const skinWeight = mesh.geometry.getAttribute('skinWeight')
          const hips = mesh.skeleton.bones.findIndex(bone => bone.name === 'Hips')
          for (let i = 0; i < positions.count; i++) {
            if (positions.getY(i) >= LINES.coatHem) continue
            // Tuck the flared coat skirt in to the waist.
            positions.setXYZ(i, positions.getX(i) * 0.8, LINES.coatHem, positions.getZ(i) * 0.75)
            // Coat tails were skinned to the thighs; at the hem they must follow the pelvis, not flap with the legs.
            skinIndex.setXYZW(i, hips, 0, 0, 0); skinWeight.setXYZW(i, 1, 0, 0, 0)
          }
          positions.needsUpdate = true; skinIndex.needsUpdate = true; skinWeight.needsUpdate = true
        }
        if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(object as THREE.SkinnedMesh)
      })
      const byName = (name: string) => skinned.find(mesh => mesh.name === name)
      shapeAthleteBuild(skinned)
      const neck = model.getObjectByName('Neck') as THREE.Bone | undefined
      const topMesh = byName('Wolf3D_Outfit_Top'); const bottomMesh = byName('Wolf3D_Outfit_Bottom'); const shoeMesh = byName('Wolf3D_Outfit_Footwear')
      if (topMesh && neck) collarToNeck(topMesh, neck)
      // Iron out lapels, pockets and belt loops so the old clothes read as smooth racing kit.
      if (topMesh) smoothGarment(topMesh, p => p.y > LINES.coatHem + 0.01 && p.y < LINES.neckline - 0.03 && Math.abs(p.x) < LINES.vestEdge - 0.01)
      if (bottomMesh) smoothGarment(bottomMesh, p => p.y > LINES.shortsHem + 0.03)
      if (topMesh) splitZones(topMesh, singletZone)
      if (bottomMesh) splitZones(bottomMesh, shortsZone)
      if (shoeMesh) splitZones(shoeMesh, shoeZone)
      for (const mesh of skinned) mesh.geometry.computeVertexNormals()
      relaxHands(model)
      const top = topMesh
      const chest = model.getObjectByName('Spine2') as THREE.Bone | undefined
      if (top && chest) {
        // Bib sits on the front of the vest, just below the chest line.
        const position = top.geometry.getAttribute('position')
        const front = new THREE.Vector3(0, 1.3, 0); const p = new THREE.Vector3()
        for (let i = 0; i < position.count; i++) {
          p.fromBufferAttribute(position, i)
          if (Math.abs(p.x) < 0.06 && p.y > 1.24 && p.y < 1.36 && p.z > front.z) front.z = p.z
        }
        raceBib(chest, front.applyMatrix4(top.bindMatrix).add(new THREE.Vector3(0, 0, 0.012)))
      }
      const sourceRun = motion.animations.find(clip => /^run$/i.test(clip.name)) ?? motion.animations[0]
      const run = retargetMixamoClip(motion.scene, sourceRun, model, { form: 'sprint', cycle: SPRINT_CYCLE })
      model.rotation.y = Math.PI / 2 // face +x so he runs toward the right of the screen
      model.scale.setScalar(TALL)
      for (const mesh of skinned) {
        mesh.material = mesh === topMesh ? [singlet, glass, trim] : mesh === bottomMesh ? [shorts, glass, trim] : mesh === shoeMesh ? [shoe, glass, trim] : glass
        mesh.frustumCulled = false
        // A second skin over the same skeleton draws the wire mesh.
        const overlay = new THREE.SkinnedMesh(mesh.geometry, wire)
        overlay.bind(mesh.skeleton, mesh.bindMatrix)
        overlay.morphTargetInfluences = mesh.morphTargetInfluences
        overlay.position.copy(mesh.position); overlay.quaternion.copy(mesh.quaternion); overlay.scale.copy(mesh.scale)
        overlay.frustumCulled = false
        mesh.parent?.add(overlay)
      }
      // Spread the nodes across the meshes in proportion to their vertex counts.
      const total = skinned.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count, 0)
      samples = Array.from({ length: NODES }, () => {
        let pick = Math.floor(Math.random() * total)
        for (const mesh of skinned) {
          const count = mesh.geometry.getAttribute('position').count
          if (pick < count) return { mesh, index: pick }
          pick -= count
        }
        return { mesh: skinned[0], index: 0 }
      })
      scene.add(model)
      mixer = new THREE.AnimationMixer(model)
      mixer.clipAction(run).play()
      mixer.timeScale = reduced ? PLAYBACK * 0.5 : PLAYBACK
    }).catch(error => console.error('Runner model failed to load', error))

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 0.55)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    const resize = () => {
      const width = host.clientWidth; const height = host.clientHeight
      renderer.setSize(width, height, false); composer.setSize(width, height); bloom.resolution.set(width, height)
      camera.aspect = width / height
      // Wide: runner sits right of the headline. Narrow: runner rises above it.
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
    const vertex = new THREE.Vector3()
    const clock = new THREE.Clock()
    let time = 0
    let frame = 0

    const animate = () => {
      frame = requestAnimationFrame(animate)
      if (document.hidden) return
      const dt = Math.min(clock.getDelta(), 0.05)
      time += dt
      mixer?.update(dt)

      if (samples.length) {
        samples[0].mesh.updateMatrixWorld(true)
        for (let i = 0; i < samples.length; i++) {
          const { mesh, index } = samples[i]
          mesh.getVertexPosition(index, vertex)
          vertex.applyMatrix4(mesh.matrixWorld)
          nodePositions[i * 3] = vertex.x; nodePositions[i * 3 + 1] = vertex.y; nodePositions[i * 3 + 2] = vertex.z
        }
        nodeGeometry.attributes.position.needsUpdate = true
        for (const glint of glints) {
          glint.sprite.position.fromArray(nodePositions, glint.node * 3)
          const s = 0.04 + 0.14 * Math.max(0, Math.sin(time * 1.2 + glint.seed)) ** 3
          glint.sprite.scale.set(s, s, 1)
        }
      }

      pointer.x += (pointer.tx - pointer.x) * 0.04
      pointer.y += (pointer.ty - pointer.y) * 0.04
      const orbit = 0.55 + (reduced ? 0 : 0.15 * Math.sin(time * 0.1)) + pointer.x * 0.4
      const radius = host.clientWidth > 900 ? 4.9 : 7
      camera.position.set(target.x + Math.sin(orbit) * radius, 1.05 - pointer.y * 0.5, Math.cos(orbit) * radius)
      camera.lookAt(target)

      for (let i = 0; i < DUST; i++) {
        dustPositions[i * 3] -= dt * (0.1 + (i % 7) * 0.02)
        if (dustPositions[i * 3] < -8) dustPositions[i * 3] = 8
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
      mixer?.stopAllAction()
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
