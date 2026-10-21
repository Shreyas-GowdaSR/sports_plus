import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/**
 * A low-poly "plexus" athlete: every body segment is a faceted shell drawn
 * three ways — translucent glass facets, glowing wire edges and bright vertex
 * nodes — driven by a running cycle shaped on real gait timing (hip, knee and
 * ankle curves, opposite arm drive, and feet that actually meet the ground).
 */

type Profile = [number, number][]
type SegmentDef = { a: string; b: string; width: Profile; depth?: Profile; radial: number; rings: number; s0?: number; s1?: number }

const SEGMENTS: SegmentDef[] = [
  { a: 'pelvis', b: 'neck', radial: 12, rings: 8, s0: -0.08, s1: 1.04, width: [[0, 0.155], [0.25, 0.13], [0.55, 0.15], [0.78, 0.19], [0.92, 0.17], [1, 0.08]], depth: [[0, 0.11], [0.25, 0.085], [0.55, 0.1], [0.78, 0.115], [0.92, 0.09], [1, 0.05]] },
  { a: 'neck', b: 'chin', radial: 7, rings: 2, s0: -0.2, s1: 1.1, width: [[0, 0.05], [1, 0.045]] },
  { a: 'chin', b: 'crown', radial: 10, rings: 6, s0: -0.05, s1: 1.03, width: [[0, 0.05], [0.2, 0.085], [0.5, 0.098], [0.8, 0.085], [1, 0.02]], depth: [[0, 0.06], [0.2, 0.1], [0.5, 0.115], [0.8, 0.1], [1, 0.02]] },
  ...(['L', 'R'] as const).flatMap(side => [
    { a: `hip${side}`, b: `knee${side}`, radial: 9, rings: 5, s0: -0.14, s1: 1.06, width: [[0, 0.085], [0.25, 0.08], [0.7, 0.062], [1, 0.048]] as Profile },
    { a: `knee${side}`, b: `ankle${side}`, radial: 8, rings: 5, s0: -0.06, s1: 1.04, width: [[0, 0.05], [0.25, 0.058], [0.6, 0.042], [1, 0.03]] as Profile },
    { a: `heel${side}`, b: `toe${side}`, radial: 7, rings: 4, s0: -0.05, s1: 1.04, width: [[0, 0.035], [0.4, 0.042], [1, 0.03]] as Profile, depth: [[0, 0.04], [0.3, 0.04], [1, 0.016]] as Profile },
    { a: `sh${side}`, b: `elbow${side}`, radial: 8, rings: 4, s0: -0.16, s1: 1.06, width: [[0, 0.058], [0.3, 0.048], [1, 0.034]] as Profile },
    { a: `elbow${side}`, b: `wrist${side}`, radial: 7, rings: 4, s0: -0.05, s1: 1.04, width: [[0, 0.036], [0.35, 0.036], [1, 0.024]] as Profile },
    { a: `wrist${side}`, b: `hand${side}`, radial: 6, rings: 3, s0: -0.05, s1: 1.08, width: [[0, 0.03], [0.5, 0.036], [1, 0.016]] as Profile, depth: [[0, 0.016], [0.5, 0.018], [1, 0.01]] as Profile },
  ]),
]

function sample(profile: Profile, s: number) {
  const x = Math.min(1, Math.max(0, s))
  for (let i = 1; i < profile.length; i++) {
    const [s1, v1] = profile[i]
    if (x <= s1) {
      const [s0, v0] = profile[i - 1]
      const t = (x - s0) / Math.max(s1 - s0, 1e-6)
      return v0 + (v1 - v0) * (t * t * (3 - 2 * t))
    }
  }
  return profile[profile.length - 1][1]
}

/** Faceted shell in local space: y runs 0→1 along the bone; x is depth, z is width. */
function segmentGeometry(def: SegmentDef) {
  const s0 = def.s0 ?? 0; const s1 = def.s1 ?? 1
  const positions: number[] = []
  const index: number[] = []
  const jitter = () => 0.86 + Math.random() * 0.28
  positions.push(0, s0 - 0.02, 0)
  for (let j = 0; j <= def.rings; j++) {
    const s = s0 + (s1 - s0) * (j / def.rings)
    const end = Math.min(1, Math.min(s - s0, s1 - s) / 0.12 + 0.35)
    for (let k = 0; k < def.radial; k++) {
      // Offsetting alternate rings by half a step gives the triangulated low-poly look.
      const angle = (k + (j % 2) * 0.5) / def.radial * Math.PI * 2
      const r = jitter() * end
      positions.push(Math.cos(angle) * sample(def.depth ?? def.width, s) * r, s + (Math.random() - 0.5) * 0.02, Math.sin(angle) * sample(def.width, s) * r)
    }
  }
  positions.push(0, s1 + 0.02, 0)
  const ring = (j: number, k: number) => 1 + j * def.radial + ((k + def.radial) % def.radial)
  for (let k = 0; k < def.radial; k++) index.push(0, ring(0, k + 1), ring(0, k))
  for (let j = 0; j < def.rings; j++) {
    for (let k = 0; k < def.radial; k++) {
      const shift = j % 2
      const a = ring(j, k); const b = ring(j, k + 1); const c = ring(j + 1, k - 1 + shift); const d = ring(j + 1, k + shift)
      index.push(a, b, d, a, d, c)
    }
  }
  const top = positions.length / 3 - 1
  for (let k = 0; k < def.radial; k++) index.push(top, ring(def.rings, k), ring(def.rings, k + 1))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  return geometry
}

// ── Running cycle ────────────────────────────────────────────
const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d))
const bump = (ph: number, centre: number, width: number) => Math.exp(-(wrap(ph - centre) ** 2) / (2 * width * width))

function pose(phase: number, joints: Record<string, THREE.Vector3>) {
  const set = (key: string, x: number, y: number, z: number) => (joints[key] ??= new THREE.Vector3()).set(x, y, z)
  const lean = 0.3
  set('pelvis', 0, 0, 0)
  set('neck', Math.sin(lean) * 0.56, Math.cos(lean) * 0.56, 0)
  const neck = joints.neck
  set('chin', neck.x + 0.035, neck.y + 0.065, 0)
  set('crown', neck.x + 0.15, neck.y + 0.3, 0)
  const twist = Math.sin(phase)
  set('shL', neck.x - 0.035 + 0.045 * twist, neck.y - 0.075, 0.2)
  set('shR', neck.x - 0.035 - 0.045 * twist, neck.y - 0.075, -0.2)

  for (const [side, offset, z] of [['L', 0, 0.09], ['R', Math.PI, -0.09]] as const) {
    const ph = phase + offset
    // Hip: extension at toe-off, deep flexion in late swing.
    const hip = 0.36 + 0.78 * Math.sin(ph)
    // Knee: big fold in mid-swing, small flex through stance.
    const knee = 0.2 + 2.05 * bump(ph, -0.75, 0.75) + 0.36 * bump(ph, 3.0, 0.5)
    const shin = hip - knee
    // Ankle: toes point down after push-off, foot level for landing.
    const foot = shin + Math.PI / 2 - 0.08 - 0.6 * bump(ph, -1.9, 0.55)
    set(`hip${side}`, -0.025 * twist * (side === 'L' ? 1 : -1), -0.03, z)
    const h = joints[`hip${side}`]
    set(`knee${side}`, h.x + Math.sin(hip) * 0.46, h.y - Math.cos(hip) * 0.46, z * 0.96)
    const k = joints[`knee${side}`]
    set(`ankle${side}`, k.x + Math.sin(shin) * 0.45, k.y - Math.cos(shin) * 0.45, z * 0.92)
    const an = joints[`ankle${side}`]
    const fx = Math.sin(foot); const fy = -Math.cos(foot)
    set(`heel${side}`, an.x - fx * 0.07 - Math.sin(shin) * 0.05, an.y - fy * 0.07 - 0.03, z * 0.92)
    set(`toe${side}`, an.x + fx * 0.17, an.y + fy * 0.17 - 0.02, z * 0.92)

    // Arm drives with the opposite leg: hand rises to chin height in front, passes the hip behind.
    const arm = ph + Math.PI
    const upper = 0.05 + 1.0 * Math.sin(arm)
    const elbow = 1.15 + 0.65 * Math.sin(arm)
    const fore = upper + elbow
    const sh = joints[`sh${side}`]
    set(`elbow${side}`, sh.x + Math.sin(upper) * 0.29, sh.y - Math.cos(upper) * 0.29, sh.z * 1.03)
    const el = joints[`elbow${side}`]
    set(`wrist${side}`, el.x + Math.sin(fore) * 0.26, el.y - Math.cos(fore) * 0.26, sh.z * 0.62)
    const wr = joints[`wrist${side}`]
    set(`hand${side}`, wr.x + Math.sin(fore) * 0.09, wr.y - Math.cos(fore) * 0.09, sh.z * 0.56)
  }

  // Put the lowest foot point on the ground, with a short flight phase between steps.
  let lowest = Infinity
  for (const key of ['heelL', 'toeL', 'heelR', 'toeR']) lowest = Math.min(lowest, joints[key].y)
  const flight = 0.035 * Math.max(0, Math.sin(2 * phase - 0.4))
  const lift = -lowest + 0.035 + flight
  for (const key in joints) joints[key].y += lift
}

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

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.95
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x020714)
    scene.fog = new THREE.FogExp2(0x020714, 0.09)
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60)

    scene.add(new THREE.HemisphereLight(0x7fd4ff, 0x020714, 0.7))
    const key = new THREE.DirectionalLight(0xbfe9ff, 2.2); key.position.set(2, 3, 3); scene.add(key)
    const rim = new THREE.DirectionalLight(0x2f7bff, 2.6); rim.position.set(-3, 1.5, -2); scene.add(rim)

    const dot = glowTexture('dot'); const star = glowTexture('star')
    const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x1b5fb0, emissive: 0x0a2c66, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.35, flatShading: true, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x6cc8ff, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false })
    const nodeMaterial = new THREE.PointsMaterial({ color: 0xd9f4ff, size: 0.026, map: dot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })

    const segments = SEGMENTS.map(def => {
      const geometry = segmentGeometry(def)
      const group = new THREE.Group(); group.matrixAutoUpdate = false
      const wire = new THREE.WireframeGeometry(geometry)
      group.add(new THREE.Mesh(geometry, faceMaterial), new THREE.LineSegments(wire, edgeMaterial), new THREE.Points(geometry, nodeMaterial))
      group.children.forEach(child => { child.frustumCulled = false })
      scene.add(group)
      return { def, group, geometry, wire }
    })

    // Star glints sitting on a handful of nodes
    const glints = Array.from({ length: 16 }, (_, i) => {
      const segment = segments[(i * 5 + 3) % segments.length]
      const attr = segment.geometry.getAttribute('position')
      const v = Math.floor(Math.random() * attr.count)
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, color: 0xbfeaff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      scene.add(sprite)
      return { segment, local: new THREE.Vector3().fromBufferAttribute(attr, v), sprite, seed: Math.random() * 10 }
    })

    // Floor: a soft light streak and a faint grid flowing backwards
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.9), new THREE.MeshBasicMaterial({ map: dot, color: 0x2a8cff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }))
    pool.rotation.x = -Math.PI / 2; pool.position.set(0.1, 0.01, 0); scene.add(pool)
    const gridLines: number[] = []
    for (let i = -24; i <= 24; i++) { gridLines.push(i * 0.5, 0, -12, i * 0.5, 0, 12, -12, 0, i * 0.5, 12, 0, i * 0.5) }
    const gridGeometry = new THREE.BufferGeometry(); gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridLines, 3))
    const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x0f2a52, transparent: true, opacity: 0.5 }))
    scene.add(grid)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0x0d3b8a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.scale.set(6, 6, 1); halo.position.set(-0.4, 1.3, -2.5); scene.add(halo)

    // Bokeh dust
    const DUST = 700
    const dustPositions = new Float32Array(DUST * 3)
    for (let i = 0; i < DUST; i++) dustPositions.set([Math.random() * 16 - 8, Math.random() * 4, Math.random() * 10 - 6], i * 3)
    const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x5fa8ff, size: 0.03, map: dot, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }))
    scene.add(dust)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.42)
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

    const joints: Record<string, THREE.Vector3> = {}
    const u = new THREE.Vector3(); const x = new THREE.Vector3(); const z = new THREE.Vector3(); const ref = new THREE.Vector3()
    const target = new THREE.Vector3(0.1, 0.95, 0)
    const world = new THREE.Vector3()
    const clock = new THREE.Clock()
    const speed = reduced ? 0.25 : 1
    let time = 0
    let frame = 0

    const animate = () => {
      frame = requestAnimationFrame(animate)
      if (document.hidden) return
      const dt = Math.min(clock.getDelta(), 0.05) * speed
      time += dt
      pose(time * Math.PI * 2 * 1.25, joints)

      for (const { def, group } of segments) {
        const a = joints[def.a]; const b = joints[def.b]
        u.copy(b).sub(a)
        const length = u.length(); u.divideScalar(length)
        ref.set(Math.abs(u.z) > 0.9 ? 1 : 0, 0, Math.abs(u.z) > 0.9 ? 0 : 1)
        x.crossVectors(u, ref).normalize()
        z.crossVectors(x, u).normalize()
        group.matrix.makeBasis(x, u.multiplyScalar(length), z).setPosition(a)
        group.matrixWorldNeedsUpdate = true
      }
      for (const glint of glints) {
        world.copy(glint.local).applyMatrix4(glint.segment.group.matrix)
        glint.sprite.position.copy(world)
        const s = 0.05 + 0.13 * Math.max(0, Math.sin(time * 1.6 + glint.seed)) ** 3
        glint.sprite.scale.set(s, s, 1)
      }

      pointer.x += (pointer.tx - pointer.x) * 0.04
      pointer.y += (pointer.ty - pointer.y) * 0.04
      const orbit = 0.32 + (reduced ? 0 : 0.18 * Math.sin(time * 0.12)) + pointer.x * 0.4
      const radius = host.clientWidth > 900 ? 5.2 : 7.2
      camera.position.set(target.x + Math.sin(orbit) * radius, 1.0 - pointer.y * 0.5, Math.cos(orbit) * radius)
      camera.lookAt(target)

      grid.position.x = ((grid.position.x - 3.2 * dt) % 0.5 + 0.5) % 0.5 - 0.5
      for (let i = 0; i < DUST; i++) {
        dustPositions[i * 3] -= dt * (0.25 + (i % 7) * 0.05)
        if (dustPositions[i * 3] < -8) dustPositions[i * 3] = 8
      }
      dustGeometry.attributes.position.needsUpdate = true
      composer.render()
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('pointermove', onPointer)
      segments.forEach(segment => { segment.geometry.dispose(); segment.wire.dispose() })
      scene.traverse(object => {
        const item = object as THREE.Mesh
        if (item.geometry && !segments.some(segment => segment.geometry === item.geometry || segment.wire === item.geometry)) item.geometry.dispose()
        const material = item.material as THREE.Material | undefined
        material?.dispose()
      })
      dot.dispose(); star.dispose()
      composer.dispose(); renderer.dispose(); renderer.domElement.remove()
    }
  }, [])

  return <div ref={hostRef} className={className} aria-hidden="true" />
}
