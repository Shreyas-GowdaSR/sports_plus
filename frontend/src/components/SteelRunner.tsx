import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/**
 * A procedurally animated runner sculpted from hundreds of steel strands.
 * Every body segment is a bundle of crossing helical wires wrapped around a
 * bone; the bones follow a hand-tuned running cycle, and the wires are lit
 * per vertex (key light, specular glint, gold rim) so plain lines read as metal.
 */

type V = THREE.Vector3
type Profile = [number, number][]
type Segment = { a: string; b: string; strands: number; width: Profile; depth?: Profile; twist: number; taper?: boolean }

const SEGMENTS: Segment[] = [
  { a: 'pelvis', b: 'neck', strands: 100, width: [[0, 0.15], [0.3, 0.125], [0.68, 0.185], [0.88, 0.19], [1, 0.075]], depth: [[0, 0.105], [0.3, 0.085], [0.68, 0.115], [0.9, 0.09], [1, 0.05]], twist: 0.6, taper: false },
  { a: 'shL', b: 'shR', strands: 18, width: [[0, 0.05], [0.5, 0.06], [1, 0.05]], twist: 1.4 },
  { a: 'neck', b: 'chin', strands: 16, width: [[0, 0.05], [1, 0.042]], twist: 0.8, taper: false },
  { a: 'chin', b: 'crown', strands: 54, width: [[0, 0.06], [0.2, 0.1], [0.5, 0.118], [0.8, 0.1], [1, 0.035]], depth: [[0, 0.07], [0.2, 0.11], [0.5, 0.125], [0.8, 0.105], [1, 0.035]], twist: 1.1, taper: false },
  ...(['L', 'R'] as const).flatMap(side => [
    { a: `hip${side}`, b: `knee${side}`, strands: 50, width: [[0, 0.085], [0.3, 0.08], [1, 0.052]] as Profile, twist: 0.9 },
    { a: `knee${side}`, b: `ankle${side}`, strands: 40, width: [[0, 0.052], [0.28, 0.06], [1, 0.03]] as Profile, twist: 0.9 },
    { a: `ankle${side}`, b: `toe${side}`, strands: 14, width: [[0, 0.036], [0.6, 0.032], [1, 0.02]] as Profile, twist: 0.6 },
    { a: `sh${side}`, b: `elbow${side}`, strands: 30, width: [[0, 0.052], [0.4, 0.046], [1, 0.034]] as Profile, twist: 0.9 },
    { a: `elbow${side}`, b: `wrist${side}`, strands: 24, width: [[0, 0.038], [0.35, 0.036], [1, 0.024]] as Profile, twist: 0.9 },
    { a: `wrist${side}`, b: `hand${side}`, strands: 10, width: [[0, 0.024], [0.5, 0.03], [1, 0.014]] as Profile, twist: 0.5 },
  ]),
]

const POINTS = 22
const S0 = -0.05
const S1 = 1.05

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

// ── Running cycle ────────────────────────────────────────────
function pose(phase: number, joints: Record<string, V>) {
  const set = (key: string, x: number, y: number, z: number) => { (joints[key] ??= new THREE.Vector3()).set(x, y, z) }
  const bounce = 0.032 * Math.cos(2 * phase)
  const lean = 0.13
  const px = 0; const py = 0.99 + bounce
  set('pelvis', px, py, 0)
  set('neck', px + Math.sin(lean) * 0.6, py + Math.cos(lean) * 0.6, 0)
  const neck = joints.neck
  set('chin', neck.x + 0.03, neck.y + 0.07, 0)
  set('crown', neck.x + 0.06, neck.y + 0.33, 0)

  // Shoulders counter-rotate against the hips.
  const twist = Math.sin(phase)
  set('shL', neck.x - 0.03 + 0.05 * twist, neck.y - 0.07, 0.19)
  set('shR', neck.x - 0.03 - 0.05 * twist, neck.y - 0.07, -0.19)

  for (const [side, offset, z] of [['L', 0, 0.095], ['R', Math.PI, -0.095]] as const) {
    const ph = phase + offset
    // Leg: thigh swings, knee folds most in mid-swing and straightens at push-off.
    const hipAngle = 0.62 * Math.sin(ph) + 0.1
    const knee = 0.2 + 1.6 * Math.pow(0.5 + 0.5 * Math.cos(ph - 0.35), 2)
    const hx = px - 0.03 * twist * (side === 'L' ? 1 : -1)
    set(`hip${side}`, hx, py - 0.04, z)
    const k = joints[`hip${side}`]
    set(`knee${side}`, k.x + Math.sin(hipAngle) * 0.46, k.y - Math.cos(hipAngle) * 0.46, z * 0.95)
    const kn = joints[`knee${side}`]
    const shin = hipAngle - knee
    set(`ankle${side}`, kn.x + Math.sin(shin) * 0.45, kn.y - Math.cos(shin) * 0.45, z * 0.9)
    const an = joints[`ankle${side}`]
    const foot = shin + Math.PI / 2 - 0.15 * Math.sin(ph)
    set(`toe${side}`, an.x + Math.sin(foot) * 0.18, an.y - Math.cos(foot) * 0.18, z * 0.9)

    // Arm swings with the opposite leg; elbow stays bent around 80–100°.
    const arm = phase + offset + Math.PI
    const upper = 0.72 * Math.sin(arm) - 0.1
    const elbow = 1.45 + 0.22 * Math.sin(arm)
    const sh = joints[`sh${side}`]
    set(`elbow${side}`, sh.x + Math.sin(upper) * 0.3, sh.y - Math.cos(upper) * 0.3, sh.z * 1.02)
    const el = joints[`elbow${side}`]
    const fore = upper + elbow
    set(`wrist${side}`, el.x + Math.sin(fore) * 0.27, el.y - Math.cos(fore) * 0.27, sh.z * 0.72)
    const wr = joints[`wrist${side}`]
    set(`hand${side}`, wr.x + Math.sin(fore) * 0.09, wr.y - Math.cos(fore) * 0.09, sh.z * 0.66)
  }
}

// ── Scene ────────────────────────────────────────────────────
export function SteelRunner({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x030406)
    scene.fog = new THREE.FogExp2(0x030406, 0.12)
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60)

    // Body strands
    const strands = SEGMENTS.flatMap((segment, index) => Array.from({ length: segment.strands }, (_, i) => ({
      segment: index,
      angle: (i / segment.strands) * Math.PI * 2,
      dir: i % 2 ? 1 : -1,
      seed: Math.random() * Math.PI * 2,
      jitter: 0.9 + Math.random() * 0.22,
    })))
    const vertexCount = strands.length * (POINTS - 1) * 2
    const positions = new Float32Array(vertexCount * 3)
    const colors = new Float32Array(vertexCount * 3)
    const bodyGeometry = new THREE.BufferGeometry()
    bodyGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
    bodyGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage))
    const bodyMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 })
    const body = new THREE.LineSegments(bodyGeometry, bodyMaterial)
    body.frustumCulled = false
    scene.add(body)

    // Speed trails streaming past the runner
    const TRAILS = 70
    const trailData = Array.from({ length: TRAILS }, () => ({ x: Math.random() * 14 - 7, y: 0.1 + Math.random() * 1.9, z: (Math.random() - 0.5) * 3.2, len: 0.4 + Math.random() * 1.6, speed: 2 + Math.random() * 4 }))
    const trailPositions = new Float32Array(TRAILS * 6)
    const trailColors = new Float32Array(TRAILS * 6)
    const trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage))
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3))
    for (let i = 0; i < TRAILS; i++) {
      const gold = Math.random() < 0.35
      const head = gold ? [0.9, 0.7, 0.38] : [0.5, 0.62, 0.78]
      trailColors.set([...head.map(c => c * 0.55), 0, 0, 0], i * 6)
    }
    const trails = new THREE.LineSegments(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    trails.frustumCulled = false
    scene.add(trails)

    // Floor grid that scrolls under the runner
    const gridLines: number[] = []
    for (let i = -24; i <= 24; i++) { gridLines.push(i * 0.5, 0, -12, i * 0.5, 0, 12); gridLines.push(-12, 0, i * 0.5, 12, 0, i * 0.5) }
    const gridGeometry = new THREE.BufferGeometry()
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridLines, 3))
    const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x2a3140, transparent: true, opacity: 0.55 }))
    grid.position.y = 0.02
    scene.add(grid)

    // Glow pool under the runner and halo behind it
    const glowTexture = (() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
      const ctx = canvas.getContext('2d')!
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
      gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gradient.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 256)
      return new THREE.CanvasTexture(canvas)
    })()
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xc9a25c, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }))
    pool.rotation.x = -Math.PI / 2; pool.position.set(0.15, 0.025, 0)
    scene.add(pool)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x26364f, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.scale.set(5.5, 5.5, 1); halo.position.set(-0.6, 1.2, -2.2)
    scene.add(halo)

    // Dust
    const DUST = 900
    const dustPositions = new Float32Array(DUST * 3)
    for (let i = 0; i < DUST; i++) dustPositions.set([Math.random() * 16 - 8, Math.random() * 4, Math.random() * 10 - 6], i * 3)
    const dustGeometry = new THREE.BufferGeometry()
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3).setUsage(THREE.DynamicDrawUsage))
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x8a95a8, size: 0.014, transparent: true, opacity: 0.6, depthWrite: false }))
    scene.add(dust)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.5, 0.55)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    // Resize: on wide screens the runner sits right of the headline.
    const resize = () => {
      const width = host.clientWidth; const height = host.clientHeight
      renderer.setSize(width, height, false)
      composer.setSize(width, height)
      bloom.resolution.set(width, height)
      camera.aspect = width / height
      const wide = width > 900
      // Wide: runner sits right of the headline. Narrow: runner rises above it.
      if (wide) camera.setViewOffset(width, height, -width * 0.2, 0, width, height)
      else camera.setViewOffset(width, height, 0, height * 0.2, width, height)
      camera.fov = wide ? 30 : 38
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    const onPointer = (event: PointerEvent) => { pointer.tx = event.clientX / window.innerWidth - 0.5; pointer.ty = event.clientY / window.innerHeight - 0.5 }
    window.addEventListener('pointermove', onPointer)

    // Per-frame scratch objects
    const joints: Record<string, V> = {}
    const u = new THREE.Vector3(); const v = new THREE.Vector3(); const w = new THREE.Vector3()
    const n = new THREE.Vector3(); const p = new THREE.Vector3(); const view = new THREE.Vector3()
    const ref = new THREE.Vector3()
    const key = new THREE.Vector3(0.8, 1.1, 0.9).normalize()
    const rim = new THREE.Vector3(-1, 0.35, -0.5).normalize()
    const half = new THREE.Vector3()
    const target = new THREE.Vector3(0.1, 0.98, 0)
    const clock = new THREE.Clock()
    const speed = reduced ? 0.25 : 1
    let time = 0
    let frame = 0

    const shade = (out: Float32Array, offset: number) => {
      const diff = Math.max(0, n.dot(key))
      const spec = Math.pow(Math.max(0, n.dot(half)), 28)
      const facing = Math.abs(n.dot(view))
      const fres = Math.pow(1 - facing, 2.2)
      const back = Math.max(0, n.dot(rim)) * fres
      out[offset] = 0.1 + 0.62 * diff + 1.7 * spec + 1.1 * back + 0.12 * fres
      out[offset + 1] = 0.11 + 0.66 * diff + 1.65 * spec + 0.82 * back + 0.14 * fres
      out[offset + 2] = 0.13 + 0.74 * diff + 1.55 * spec + 0.42 * back + 0.2 * fres
    }

    const animate = () => {
      frame = requestAnimationFrame(animate)
      if (document.hidden) return
      const dt = Math.min(clock.getDelta(), 0.05) * speed
      time += dt
      const phase = time * Math.PI * 2 * 1.35

      pointer.x += (pointer.tx - pointer.x) * 0.04
      pointer.y += (pointer.ty - pointer.y) * 0.04
      const orbit = 0.48 + (reduced ? 0 : 0.2 * Math.sin(time * 0.12)) + pointer.x * 0.4
      const radius = host.clientWidth > 900 ? 5.3 : 7.4
      camera.position.set(target.x + Math.sin(orbit) * radius, 1.05 - pointer.y * 0.5, Math.cos(orbit) * radius)
      camera.lookAt(target)
      view.copy(camera.position).sub(target).normalize()
      half.copy(key).add(view).normalize()

      pose(phase, joints)

      let cursor = 0
      for (const strand of strands) {
        const segment = SEGMENTS[strand.segment]
        const a = joints[segment.a]; const b = joints[segment.b]
        u.copy(b).sub(a)
        const length = u.length(); u.divideScalar(length)
        ref.set(Math.abs(u.z) > 0.9 ? 1 : 0, 0, Math.abs(u.z) > 0.9 ? 0 : 1)
        v.crossVectors(u, ref).normalize()
        w.crossVectors(v, u).normalize()
        let prevX = 0, prevY = 0, prevZ = 0, pr = 0, pg = 0, pb = 0
        for (let k = 0; k < POINTS; k++) {
          const s = S0 + (S1 - S0) * (k / (POINTS - 1))
          const taper = segment.taper === false ? 1 : 0.4 + 0.6 * Math.min(1, Math.min(s - S0, S1 - s) / 0.16)
          const angle = strand.angle + strand.dir * segment.twist * s + 0.12 * Math.sin(5 * s + strand.seed + time * 0.6)
          const cos = Math.cos(angle); const sin = Math.sin(angle)
          const rw = sample(segment.width, s) * strand.jitter * taper
          const rd = sample(segment.depth ?? segment.width, s) * strand.jitter * taper
          n.set(0, 0, 0).addScaledVector(v, cos).addScaledVector(w, sin).normalize()
          p.copy(a).addScaledVector(u, s * length).addScaledVector(v, cos * rd).addScaledVector(w, sin * rw)
          shade(colors, cursor * 3)
          const r = colors[cursor * 3]; const g = colors[cursor * 3 + 1]; const bl = colors[cursor * 3 + 2]
          if (k > 0) {
            positions.set([prevX, prevY, prevZ, p.x, p.y, p.z], cursor * 3)
            colors.set([pr, pg, pb, r, g, bl], cursor * 3)
            cursor += 2
          }
          prevX = p.x; prevY = p.y; prevZ = p.z; pr = r; pg = g; pb = bl
        }
      }
      bodyGeometry.attributes.position.needsUpdate = true
      bodyGeometry.attributes.color.needsUpdate = true

      // The world flows backwards past a runner who stays in place.
      const run = 3.4 * dt
      grid.position.x = ((grid.position.x - run) % 0.5 + 0.5) % 0.5 - 0.5
      for (let i = 0; i < TRAILS; i++) {
        const trail = trailData[i]
        trail.x -= trail.speed * dt
        if (trail.x + trail.len < -7) { trail.x = 7; trail.y = 0.1 + Math.random() * 1.9; trail.z = (Math.random() - 0.5) * 3.2 }
        trailPositions.set([trail.x, trail.y, trail.z, trail.x + trail.len, trail.y, trail.z], i * 6)
      }
      trailGeometry.attributes.position.needsUpdate = true
      for (let i = 0; i < DUST; i++) {
        dustPositions[i * 3] -= dt * (0.3 + (i % 7) * 0.05)
        dustPositions[i * 3 + 1] += Math.sin(time + i) * 0.0006
        if (dustPositions[i * 3] < -8) dustPositions[i * 3] = 8
      }
      dustGeometry.attributes.position.needsUpdate = true
      pool.material.opacity = 0.26 + 0.06 * Math.cos(2 * phase)

      composer.render()
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('pointermove', onPointer)
      scene.traverse(object => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach(item => item.dispose()); else material?.dispose()
      })
      glowTexture.dispose()
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={hostRef} className={className} aria-hidden="true" />
}
