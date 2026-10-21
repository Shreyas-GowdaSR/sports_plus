import { useEffect, useRef } from 'react'

/**
 * The landing visual: a slow-motion runner drawn as an AI pose skeleton inside a
 * rotating lens. A scan beam sweeps the lens, faded "ghost" strides trail behind
 * like chronophotography, and live readouts (trunk lean, knee angle, foot strike,
 * cadence) are measured from the pose as it moves.
 */

type P = { x: number; y: number }
type Pose = Record<string, P>

const GOLD = '214,180,110'
const SOFT = '236,215,164'
const STEEL = '183,192,204'
const CYCLES_PER_SECOND = 0.32 // slow motion: a real stride cycle is ~1.4 per second
const CADENCE = 178

const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d))
const bump = (phase: number, centre: number, width: number) => Math.exp(-(wrap(phase - centre) ** 2) / (2 * width * width))
const dir = (angle: number, length: number): P => ({ x: Math.sin(angle) * length, y: -Math.cos(angle) * length })
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y })

/** Side-view running pose in metres (x forward, y up), feet on the ground. */
function runningPose(phase: number): Pose & { kneeFlexNear: number; leanDeg: number; stanceNear: boolean } {
  const lean = 0.19 + 0.025 * Math.sin(2 * phase)
  const pose: Pose = {}
  pose.pelvis = { x: 0, y: 0 }
  pose.neck = add(pose.pelvis, { x: Math.sin(lean) * 0.55, y: Math.cos(lean) * 0.55 })
  pose.head = add(pose.neck, { x: 0.05, y: 0.14 })
  pose.shoulder = add(pose.neck, { x: -0.02, y: -0.05 })
  let kneeFlexNear = 0
  for (const [side, offset] of [['n', 0], ['f', Math.PI]] as const) {
    const ph = phase + offset
    const hip = 0.34 + 0.68 * Math.sin(ph)
    const knee = 0.22 + 1.85 * bump(ph, -0.75, 0.75) + 0.36 * bump(ph, 3.0, 0.5)
    const shin = hip - knee
    const foot = shin + Math.PI / 2 - 0.08 - 0.6 * bump(ph, -1.9, 0.55)
    pose[`hip_${side}`] = add(pose.pelvis, { x: 0, y: -0.04 })
    pose[`knee_${side}`] = add(pose[`hip_${side}`], dir(hip, 0.46))
    pose[`ankle_${side}`] = add(pose[`knee_${side}`], dir(shin, 0.45))
    pose[`toe_${side}`] = add(pose[`ankle_${side}`], dir(foot, 0.17))
    pose[`heel_${side}`] = add(pose[`ankle_${side}`], dir(foot, -0.06))
    if (side === 'n') kneeFlexNear = knee
    // Arms drive with the opposite leg.
    const arm = ph + Math.PI
    // Elbow most bent in front, opening behind; hands pass low by the hips where the arms cross.
    const upper = -0.08 + 0.8 * Math.sin(arm)
    const elbow = 1.0 + 0.5 * Math.sin(arm) + 0.25 * Math.sin(arm) ** 2
    pose[`elbow_${side}`] = add(pose.shoulder, dir(upper, 0.29))
    pose[`wrist_${side}`] = add(pose[`elbow_${side}`], dir(upper + elbow, 0.27))
  }
  const lowest = Math.min(pose.toe_n.y, pose.heel_n.y, pose.toe_f.y, pose.heel_f.y)
  const flight = 0.03 * Math.max(0, Math.sin(2 * phase - 0.4))
  for (const key in pose) pose[key].y += -lowest + flight
  const stanceNear = Math.min(pose.toe_n.y, pose.heel_n.y) < 0.012
  return Object.assign(pose, { kneeFlexNear, leanDeg: (lean * 180) / Math.PI, stanceNear })
}

const BONES: [string, string][] = [['pelvis', 'neck'], ['neck', 'head'], ['shoulder', 'elbow'], ['elbow', 'wrist'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'toe'], ['ankle', 'heel'], ['heel', 'toe']]
const JOINTS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'toe']

export function FormScan({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0, height = 0, frame = 0
    const start = performance.now()

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio, 2)
      width = rect.width; height = rect.height
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize()

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (document.hidden || !width) return
      const t = (now - start) / 1000
      const phase = reduced ? 2.2 : t * Math.PI * 2 * CYCLES_PER_SECOND
      ctx.clearRect(0, 0, width, height)

      const cx = width / 2; const cy = height / 2
      const R = Math.min(width, height) * 0.44
      const scale = (R * 1.62) / 1.9
      const ground = cy + R * 0.68
      const toScreen = (p: P, shift = 0): P => ({ x: cx - 0.12 * scale + (p.x + shift) * scale, y: ground - p.y * scale })

      // Lens: soft core glow, rotating dial ticks, inner ring.
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.15)
      glow.addColorStop(0, `rgba(${GOLD},0.12)`); glow.addColorStop(0.6, `rgba(${GOLD},0.04)`); glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2); ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = `rgba(${GOLD},0.35)`; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = `rgba(${STEEL},0.12)`; ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, 0, Math.PI * 2); ctx.stroke()
      const spin = reduced ? 0 : t * 0.05
      for (let i = 0; i < 120; i++) {
        const a = spin + (i / 120) * Math.PI * 2
        const long = i % 10 === 0
        const r1 = R * 1.02; const r2 = R * (long ? 1.07 : 1.04)
        ctx.strokeStyle = `rgba(${GOLD},${long ? 0.6 : 0.22})`
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke()
      }

      ctx.save()
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.995, 0, Math.PI * 2); ctx.clip()

      // Ground line and fine grid.
      ctx.strokeStyle = `rgba(${STEEL},0.08)`
      for (let gx = -6; gx <= 6; gx++) { ctx.beginPath(); ctx.moveTo(cx + gx * R * 0.18, cy - R); ctx.lineTo(cx + gx * R * 0.18, cy + R); ctx.stroke() }
      const groundGrad = ctx.createLinearGradient(cx - R, 0, cx + R, 0)
      groundGrad.addColorStop(0, `rgba(${GOLD},0)`); groundGrad.addColorStop(0.5, `rgba(${GOLD},0.55)`); groundGrad.addColorStop(1, `rgba(${GOLD},0)`)
      ctx.strokeStyle = groundGrad; ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.moveTo(cx - R, ground); ctx.lineTo(cx + R, ground); ctx.stroke()

      // Ghost strides trailing behind.
      for (let k = 4; k >= 1; k--) {
        const ghost = runningPose(phase - k * 0.5)
        drawSkeleton(ctx, ghost, p => toScreen(p, -k * 0.26), 0.15 * (1 - k / 5), 1)
      }

      const pose = runningPose(phase)
      const screen = (key: string) => toScreen(pose[key])

      // Plumb line from the hip: shows where the foot lands relative to the body.
      const hip = screen('hip_n')
      ctx.setLineDash([3, 5]); ctx.strokeStyle = `rgba(${SOFT},0.35)`; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(hip.x, ground); ctx.stroke(); ctx.setLineDash([])

      drawSkeleton(ctx, pose, p => toScreen(p), 1, 1)

      // Scan beam.
      if (!reduced) {
        const beamY = cy - R + ((t * 0.22) % 1) * R * 2
        const beam = ctx.createLinearGradient(0, beamY - 40, 0, beamY + 2)
        beam.addColorStop(0, `rgba(${GOLD},0)`); beam.addColorStop(1, `rgba(${GOLD},0.16)`)
        ctx.fillStyle = beam; ctx.fillRect(cx - R, beamY - 40, R * 2, 42)
        ctx.strokeStyle = `rgba(${SOFT},0.55)`; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(cx - R, beamY); ctx.lineTo(cx + R, beamY); ctx.stroke()
      }

      // Measurement arcs: trunk lean at the pelvis, knee angle at the near knee.
      const pelvis = screen('pelvis'); const neck = screen('neck')
      arc(ctx, pelvis, R * 0.16, -Math.PI / 2, Math.atan2(neck.y - pelvis.y, neck.x - pelvis.x))
      const knee = screen('knee_n'); const hipN = screen('hip_n'); const ankle = screen('ankle_n')
      arc(ctx, knee, R * 0.1, Math.atan2(hipN.y - knee.y, hipN.x - knee.x), Math.atan2(ankle.y - knee.y, ankle.x - knee.x))
      ctx.restore()

      // Readouts with leader lines, outside the figure.
      const fontSize = Math.max(10, Math.min(13, R * 0.055))
      const readout = (anchor: P, side: 1 | -1, dy: number, label: string, value: string) => {
        const x = side > 0 ? cx + R * 0.66 : cx - R * 0.66
        const y = anchor.y + dy
        ctx.strokeStyle = `rgba(${GOLD},0.45)`; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(x - side * 14, y); ctx.lineTo(x, y); ctx.stroke()
        ctx.fillStyle = `rgba(${GOLD},1)`; ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 2.2, 0, Math.PI * 2); ctx.fill()
        ctx.textAlign = side > 0 ? 'left' : 'right'
        ctx.font = `600 ${fontSize * 0.78}px Manrope, sans-serif`
        ctx.fillStyle = `rgba(${STEEL},0.75)`
        ctx.fillText(label.toUpperCase().split('').join(String.fromCharCode(8202)), x + side * 6, y - fontSize * 0.55)
        ctx.font = `600 ${fontSize * 1.35}px 'Cormorant Garamond', serif`
        ctx.fillStyle = `rgba(${SOFT},1)`
        ctx.fillText(value, x + side * 6, y + fontSize * 0.95)
      }
      readout(screen('neck'), -1, -R * 0.12, 'Trunk lean', `${pose.leanDeg.toFixed(0)}°`)
      readout(knee, 1, -R * 0.05, 'Knee angle', `${(180 - (pose.kneeFlexNear * 180) / Math.PI).toFixed(0)}°`)
      readout(screen('ankle_n'), -1, R * 0.02, 'Foot strike', 'Midfoot')
      // The contact light pulses while the near foot is on the ground.
      if (pose.stanceNear) {
        const contact = screen('heel_n')
        const pulse = ctx.createRadialGradient(contact.x, ground, 0, contact.x, ground, R * 0.12)
        pulse.addColorStop(0, `rgba(${SOFT},0.55)`); pulse.addColorStop(1, `rgba(${SOFT},0)`)
        ctx.fillStyle = pulse; ctx.beginPath(); ctx.ellipse(contact.x, ground, R * 0.12, R * 0.03, 0, 0, Math.PI * 2); ctx.fill()
      }
      readout(screen('wrist_n'), 1, -R * 0.2, 'Cadence', `${CADENCE} spm`)
    }

    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-label="Animated running form scan: a runner's body points with live trunk lean, knee angle, foot strike and cadence readouts" role="img" />
}

function arc(ctx: CanvasRenderingContext2D, centre: P, radius: number, from: number, to: number) {
  let delta = to - from
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  ctx.strokeStyle = `rgba(${SOFT},0.75)`; ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.arc(centre.x, centre.y, radius, from, from + delta, delta < 0); ctx.stroke()
  ctx.fillStyle = `rgba(${GOLD},0.1)`
  ctx.beginPath(); ctx.moveTo(centre.x, centre.y); ctx.arc(centre.x, centre.y, radius, from, from + delta, delta < 0); ctx.closePath(); ctx.fill()
}

/** Bones as gold lines, joints as glowing points; far-side limbs are fainter for depth. */
function drawSkeleton(ctx: CanvasRenderingContext2D, pose: Pose, project: (p: P) => P, alpha: number, weight: number) {
  const line = (a: P, b: P, opacity: number, w: number) => {
    const pa = project(a); const pb = project(b)
    ctx.strokeStyle = `rgba(${GOLD},${opacity * alpha})`; ctx.lineWidth = w * weight; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke()
  }
  for (const side of ['f', 'n'] as const) {
    const near = side === 'n'
    for (const [a, b] of BONES) {
      if (a === 'pelvis' || a === 'neck') continue
      const from = a === 'shoulder' ? pose.shoulder : pose[`${a}_${side}`]
      line(from, pose[`${b}_${side}`], near ? 0.95 : 0.4, near ? 2.6 : 1.8)
    }
    for (const joint of JOINTS) {
      const p = project(joint === 'shoulder' ? pose.shoulder : pose[`${joint}_${side}`])
      const r = near ? 3.4 : 2.4
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4)
      halo.addColorStop(0, `rgba(${SOFT},${0.5 * alpha * (near ? 1 : 0.5)})`); halo.addColorStop(1, `rgba(${SOFT},0)`)
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = `rgba(255,248,232,${alpha * (near ? 1 : 0.55)})`; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill()
    }
  }
  line(pose.pelvis, pose.neck, 1, 3)
  line(pose.neck, pose.head, 0.9, 2.2)
  const head = project(pose.head)
  const scale = Math.abs(project({ x: 0, y: 0.1 }).y - project({ x: 0, y: 0 }).y)
  ctx.strokeStyle = `rgba(${GOLD},${0.95 * alpha})`; ctx.lineWidth = 2 * weight
  ctx.beginPath(); ctx.arc(head.x, head.y, scale * 0.95, 0, Math.PI * 2); ctx.stroke()
}
