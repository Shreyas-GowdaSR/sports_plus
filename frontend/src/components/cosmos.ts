import * as THREE from 'three'

/**
 * Atmosphere around the landing runner: a twinkling starfield, drifting nebula
 * clouds, comets streaking across the sky, light ripples on the floor at every
 * footstrike, and speed lines flowing past.
 * Everything sky-side ignores fog so it stays visible far behind the runner.
 */

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false } as const
const rand = (min: number, max: number) => min + Math.random() * (max - min)

function canvasTexture(size: [number, number], paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement('canvas'); canvas.width = size[0]; canvas.height = size[1]
  paint(canvas.getContext('2d')!, size[0], size[1])
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Soft, lumpy cloud made of many faint blobs. */
const cloudTexture = () => canvasTexture([256, 256], (ctx, w, h) => {
  for (let i = 0; i < 40; i++) {
    const x = w / 2 + rand(-60, 60); const y = h / 2 + rand(-60, 60); const r = rand(30, 90)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.09)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  }
})

/** A comet tail: transparent at the left, bright at the right, tapering top and bottom. */
const streakTexture = () => canvasTexture([256, 32], (ctx, w, h) => {
  const along = ctx.createLinearGradient(0, 0, w, 0)
  along.addColorStop(0, 'rgba(255,255,255,0)'); along.addColorStop(0.75, 'rgba(255,255,255,0.45)'); along.addColorStop(1, 'rgba(255,255,255,1)')
  ctx.fillStyle = along; ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-in'
  const across = ctx.createLinearGradient(0, 0, 0, h)
  across.addColorStop(0, 'rgba(0,0,0,0)'); across.addColorStop(0.5, 'rgba(0,0,0,1)'); across.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = across; ctx.fillRect(0, 0, w, h)
})

const STAR_VERTEX = `
  attribute float phase;
  attribute float size;
  attribute vec3 tint;
  uniform float time;
  uniform float pixelRatio;
  varying float vTwinkle;
  varying vec3 vTint;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vTwinkle = 0.55 + 0.45 * sin(time * (0.5 + fract(phase * 7.31) * 1.8) + phase * 6.2831);
    vTint = tint;
    gl_PointSize = size * pixelRatio * (0.75 + 0.25 * vTwinkle);
  }`
const STAR_FRAGMENT = `
  varying float vTwinkle;
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vTint, a * a * vTwinkle);
  }`

export function createCosmos(scene: THREE.Scene, star: THREE.Texture, reduced: boolean) {
  const textures = [cloudTexture(), streakTexture()]
  const [cloud, streak] = textures

  // ── Starfield ──────────────────────────────────────────────
  const STARS = 1400
  const positions = new Float32Array(STARS * 3); const phases = new Float32Array(STARS); const sizes = new Float32Array(STARS); const tints = new Float32Array(STARS * 3)
  for (let i = 0; i < STARS; i++) {
    positions.set([rand(-22, 22), rand(-6, 12), rand(-16, -8)], i * 3)
    phases[i] = Math.random()
    const bright = Math.random() < 0.06
    sizes[i] = bright ? rand(3.5, 5.5) : rand(1.2, 2.6)
    const warm = Math.random() < 0.12
    tints.set(warm ? [1, 0.86, 0.62] : [0.75, 0.88, 1], i * 3)
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  starGeometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1))
  starGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  starGeometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3))
  const starMaterial = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT,
    uniforms: { time: { value: 0 }, pixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    ...additive,
  })
  const stars = new THREE.Points(starGeometry, starMaterial)
  stars.frustumCulled = false
  scene.add(stars)

  // ── Nebula clouds ──────────────────────────────────────────
  const nebulae = [
    { color: 0x1d3fbf, pos: [-3, 4, -11], scale: 13, opacity: 0.32 },
    { color: 0x5a2bb8, pos: [5, 5.5, -12], scale: 11, opacity: 0.22 },
    { color: 0x0b7d96, pos: [1.5, 0.5, -10], scale: 10, opacity: 0.2 },
  ].map(({ color, pos, scale, opacity }) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloud, color, opacity, ...additive }))
    sprite.position.set(pos[0], pos[1], pos[2]); sprite.scale.set(scale, scale, 1)
    scene.add(sprite)
    return { sprite, spin: rand(-0.02, 0.02), home: sprite.position.clone(), seed: rand(0, 10) }
  })

  // ── Comets ─────────────────────────────────────────────────
  type Comet = { tail: THREE.Sprite; head: THREE.Sprite; velocity: THREE.Vector3; length: number; age: number; life: number; active: boolean }
  const comets: Comet[] = Array.from({ length: 4 }, () => {
    const tail = new THREE.Sprite(new THREE.SpriteMaterial({ map: streak, color: 0xbfe6ff, opacity: 0, ...additive }))
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, color: 0xffffff, opacity: 0, ...additive }))
    scene.add(tail, head)
    return { tail, head, velocity: new THREE.Vector3(), length: 3, age: 0, life: 1, active: false }
  })
  let nextComet = 0.8
  const launch = (comet: Comet) => {
    const angle = Math.PI + rand(0.3, 0.6) // heading left and down
    const speed = rand(7, 11)
    comet.velocity.set(Math.cos(angle) * speed, Math.sin(angle) * speed, 0)
    comet.head.position.set(rand(3, 15), rand(3.2, 6.2), rand(-10, -7))
    comet.length = rand(3.2, 5.5)
    comet.age = 0; comet.life = rand(1.6, 2.4); comet.active = true
    comet.tail.material.rotation = Math.atan2(comet.velocity.y, comet.velocity.x)
    comet.tail.scale.set(comet.length, 0.16, 1)
    const size = rand(0.4, 0.6); comet.head.scale.set(size, size, 1)
  }

  // ── Footstrike ripples ─────────────────────────────────────
  const ripples = Array.from({ length: 6 }, () => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, opacity: 0, side: THREE.DoubleSide, ...additive }))
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.008
    scene.add(ring)
    return { ring, age: 0, active: false }
  })
  let feet: { bone: THREE.Object3D; down: boolean; cooldown: number }[] = []
  let floor = Infinity
  const footPosition = new THREE.Vector3()
  const ripple = (x: number, z: number) => {
    const free = ripples.find(item => !item.active) ?? ripples.reduce((a, b) => (a.age > b.age ? a : b))
    free.active = true; free.age = 0; free.ring.position.set(x, 0.008, z)
  }

  // ── Speed lines ────────────────────────────────────────────
  const lines = Array.from({ length: 16 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: streak, color: 0x8fc8ff, opacity: rand(0.06, 0.16), ...additive }))
    sprite.material.rotation = Math.PI // bright end leads as the line flows left
    const length = rand(0.8, 2.2); sprite.scale.set(length, length * 0.02, 1)
    sprite.position.set(rand(-7, 7), rand(0.1, 1.5), rand(-4, -1.5))
    scene.add(sprite)
    return { sprite, speed: rand(1.5, 3.5) }
  })

  return {
    /** Watch the runner's toes so each footstrike can send a ripple across the floor. */
    trackFeet(model: THREE.Object3D) {
      feet = []
      model.traverse(object => { if (/(Left|Right)ToeBase$/.test(object.name)) feet.push({ bone: object, down: false, cooldown: 0 }) })
    },
    update(dt: number, time: number) {
      starMaterial.uniforms.time.value = time
      const pace = reduced ? 0.3 : 1

      for (const nebula of nebulae) {
        nebula.sprite.material.rotation += nebula.spin * dt * pace
        nebula.sprite.position.x = nebula.home.x + Math.sin(time * 0.05 + nebula.seed) * 0.6
      }

      if (!reduced) {
        nextComet -= dt
        if (nextComet <= 0) {
          const idle = comets.find(comet => !comet.active)
          if (idle) launch(idle)
          nextComet = rand(1.5, 3.5)
        }
      }
      for (const comet of comets) {
        if (!comet.active) continue
        comet.age += dt
        comet.head.position.addScaledVector(comet.velocity, dt)
        const direction = comet.velocity.clone().normalize()
        comet.tail.position.copy(comet.head.position).addScaledVector(direction, -comet.length / 2)
        const fade = Math.min(1, comet.age / 0.25) * Math.min(1, (comet.life - comet.age) / 0.5)
        comet.tail.material.opacity = 0.85 * Math.max(0, fade)
        comet.head.material.opacity = Math.max(0, fade)
        if (comet.age >= comet.life) { comet.active = false; comet.tail.material.opacity = 0; comet.head.material.opacity = 0 }
      }

      for (const foot of feet) {
        foot.bone.getWorldPosition(footPosition)
        floor = Math.min(floor, footPosition.y)
        foot.cooldown -= dt
        const near = footPosition.y < floor + 0.035
        if (near && !foot.down && foot.cooldown <= 0) { ripple(footPosition.x, footPosition.z); foot.cooldown = 0.4 }
        foot.down = near
      }
      for (const item of ripples) {
        if (!item.active) continue
        item.age += dt
        const t = item.age / 1.8
        const scale = 0.05 + t * 1.3
        item.ring.scale.set(scale, scale, scale)
        item.ring.material.opacity = 0.75 * Math.max(0, 1 - t)
        if (t >= 1) { item.active = false; item.ring.material.opacity = 0 }
      }

      for (const line of lines) {
        line.sprite.position.x -= line.speed * dt * pace
        if (line.sprite.position.x < -8) { line.sprite.position.x = 8; line.sprite.position.y = rand(0.1, 1.5) }
      }
    },
    dispose() { textures.forEach(texture => texture.dispose()) },
  }
}
