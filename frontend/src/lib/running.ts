import type { Landmark, Metric, PoseSample, RunningAnalysis, SportModule } from '../types'

const L = { nose: 0, leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28, leftHeel: 29, rightHeel: 30, leftToe: 31, rightToe: 32 }
type Contact = { type: 'rearfoot' | 'midfoot' | 'forefoot'; advance: number; visibility: number; timestamp: number }

const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value))
const meanPoint = (a: Landmark, b: Landmark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)
const visibility = (points: Landmark[]) => avg(points.map((point) => point.visibility ?? 1))
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return 0
  const at = (sorted.length - 1) * p; const low = Math.floor(at); const high = Math.ceil(at)
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low)
}
const angle = (a: Landmark, b: Landmark, c: Landmark) => {
  const ba = { x: a.x - b.x, y: a.y - b.y }; const bc = { x: c.x - b.x, y: c.y - b.y }
  const denominator = Math.max(Math.hypot(ba.x, ba.y) * Math.hypot(bc.x, bc.y), 0.00001)
  return Math.acos(clamp((ba.x * bc.x + ba.y * bc.y) / denominator, -1, 1)) * 180 / Math.PI
}

function metric(id: Metric['id'], label: string, score: number, value: string, description: string, cue: string): Metric {
  const status = score >= 80 ? 'good' : score >= 62 ? 'watch' : 'focus'
  return { id, label, score: Math.round(score), status, value, description, cue }
}

function forwardDirection(samples: PoseSample[]) {
  const travel = samples.slice(1).map((sample, index) => {
    const previous = samples[index].landmarks; const current = sample.landmarks
    return meanPoint(current[L.leftHip], current[L.rightHip]).x - meanPoint(previous[L.leftHip], previous[L.rightHip]).x
  })
  const movement = percentile(travel, 0.5)
  if (Math.abs(movement) > 0.00035) return Math.sign(movement)
  const lean = avg(samples.map(({ landmarks }) => meanPoint(landmarks[L.leftShoulder], landmarks[L.rightShoulder]).x - meanPoint(landmarks[L.leftHip], landmarks[L.rightHip]).x))
  return Math.abs(lean) > 0.008 ? Math.sign(lean) : 0
}

function findContacts(samples: PoseSample[], direction: number): Contact[] {
  const contacts: Contact[] = []
  const sides = [{ ankle: L.leftAnkle, heel: L.leftHeel, toe: L.leftToe }, { ankle: L.rightAnkle, heel: L.rightHeel, toe: L.rightToe }]
  sides.forEach(({ ankle, heel, toe }) => {
    let lastContact = -Infinity
    for (let index = 2; index < samples.length - 2; index += 1) {
      const current = samples[index].landmarks; const previous = samples[index - 1].landmarks; const next = samples[index + 1].landmarks
      if (![current[ankle], current[heel], current[toe], previous[ankle], next[ankle]].every(Boolean)) continue
      const visible = avg([current[ankle].visibility ?? 0, current[heel].visibility ?? 0, current[toe].visibility ?? 0])
      // In image coordinates a planted foot is at a local maximum y before it begins to rise again.
      const planted = current[ankle].y >= previous[ankle].y && current[ankle].y >= next[ankle].y
      if (!planted || visible < 0.67 || samples[index].timestamp - lastContact < 180) continue
      const footLength = Math.max(distance(current[toe], current[heel]), 0.018)
      const pitch = (current[toe].y - current[heel].y) / footLength
      const type = pitch > 0.17 ? 'forefoot' : pitch < -0.17 ? 'rearfoot' : 'midfoot'
      const hip = meanPoint(current[L.leftHip], current[L.rightHip]); const torso = Math.max(distance(meanPoint(current[L.leftShoulder], current[L.rightShoulder]), hip), 0.001)
      contacts.push({ type, advance: direction ? ((current[ankle].x - hip.x) * direction) / torso : Number.NaN, visibility: visible, timestamp: samples[index].timestamp })
      lastContact = samples[index].timestamp
    }
  })
  return contacts
}

function contactScreen(samples: PoseSample[]) {
  const direction = forwardDirection(samples); const contacts = findContacts(samples, direction)
  if (contacts.length < 8) return { contacts, assessment: { classification: 'inconclusive' as const, confidence: 0, contacts: contacts.length, message: 'Foot contact was not labelled because there were too few clear contact frames. Use a stable side view with both shoes visible; 60 fps or higher is recommended.', landing: 'inconclusive' as const, landingConfidence: 0 } }
  const counts = { rearfoot: 0, midfoot: 0, forefoot: 0 }
  contacts.forEach((contact) => { counts[contact.type] += 1 })
  const classification = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as 'rearfoot' | 'midfoot' | 'forefoot'
  const confidence = Math.round((counts[classification] / contacts.length) * avg(contacts.map((contact) => contact.visibility)) * 100)
  const label = { rearfoot: 'rearfoot (heel-first)', midfoot: 'midfoot', forefoot: 'forefoot (toe/ball-first)' }[classification]
  if (confidence < 60) return { contacts, assessment: { classification: 'inconclusive' as const, confidence, contacts: contacts.length, message: 'Contact frames were mixed or unclear, so the app will not guess a foot-strike pattern.', landing: 'inconclusive' as const, landingConfidence: 0 } }
  const advances = contacts.map((contact) => contact.advance).filter(Number.isFinite)
  if (advances.length < 6) return { contacts, assessment: { classification, confidence, contacts: contacts.length, message: `Most clear contact frames look ${label}. This is descriptive, not an injury-risk verdict.`, landing: 'inconclusive' as const, landingConfidence: 0 } }
  const aheadFraction = advances.filter((value) => value > 0.38).length / advances.length
  const landing = aheadFraction >= 0.38 ? 'ahead-of-body' as const : 'under-body' as const
  const landingConfidence = Math.round(Math.max(aheadFraction, 1 - aheadFraction) * avg(contacts.map((contact) => contact.visibility)) * 100)
  const correction = landing === 'ahead-of-body' ? 'On the next easy strides, let the foot meet the ground closer beneath your hips. Keep your stride relaxed; do not force short, choppy steps.' : 'Your screened contacts land reasonably close to your body in this view. Keep the landing quiet and relaxed.'
  return { contacts, assessment: { classification, confidence, contacts: contacts.length, message: `Most clear contact frames look ${label}. This is descriptive, not an injury-risk verdict.`, landing, landingConfidence, correction } }
}

function classifyView(samples: PoseSample[]) {
  const spread = avg(samples.map(({ landmarks }) => {
    const torso = Math.max(distance(meanPoint(landmarks[L.leftShoulder], landmarks[L.rightShoulder]), meanPoint(landmarks[L.leftHip], landmarks[L.rightHip])), 0.001)
    return (Math.abs(landmarks[L.leftShoulder].x - landmarks[L.rightShoulder].x) + Math.abs(landmarks[L.leftHip].x - landmarks[L.rightHip].x)) / (2 * torso)
  }))
  if (spread < 0.62) return { view: 'side' as const, confidence: Math.round(clamp((0.62 - spread) * 120 + 68, 55, 96)) }
  if (spread > 1.02) return { view: 'front' as const, confidence: Math.round(clamp((spread - 1.02) * 100 + 68, 55, 96)) }
  return { view: 'oblique' as const, confidence: Math.round(clamp(88 - Math.abs(spread - 0.82) * 35, 55, 88)) }
}

function frontalAnalysis(samples: PoseSample[], sourceName: string, duration: number, confidence: number, view: 'front' | 'oblique', viewConfidence: number): RunningAnalysis {
  const headOffsets: number[] = []; const trunkOffsets: number[] = []; const hipLevels: number[] = []; const kneeTracking: number[] = []; const armBalance: number[] = []; const ankleLeft: number[] = []; const ankleRight: number[] = []
  samples.forEach(({ landmarks }) => {
    const shoulder = meanPoint(landmarks[L.leftShoulder], landmarks[L.rightShoulder]); const hip = meanPoint(landmarks[L.leftHip], landmarks[L.rightHip]); const torso = Math.max(distance(shoulder, hip), 0.001); const shoulderWidth = Math.max(Math.abs(landmarks[L.leftShoulder].x - landmarks[L.rightShoulder].x), torso * 0.4)
    headOffsets.push(Math.abs(landmarks[L.nose].x - shoulder.x) / torso); trunkOffsets.push(Math.abs(shoulder.x - hip.x) / torso); hipLevels.push(Math.abs(landmarks[L.leftHip].y - landmarks[L.rightHip].y) / torso)
    kneeTracking.push(Math.abs(landmarks[L.leftKnee].x - (landmarks[L.leftHip].x + landmarks[L.leftAnkle].x) / 2) / shoulderWidth, Math.abs(landmarks[L.rightKnee].x - (landmarks[L.rightHip].x + landmarks[L.rightAnkle].x) / 2) / shoulderWidth)
    armBalance.push(Math.abs(Math.abs(landmarks[L.leftWrist].x - shoulder.x) - Math.abs(landmarks[L.rightWrist].x - shoulder.x)) / shoulderWidth)
    ankleLeft.push(landmarks[L.leftAnkle].y / torso); ankleRight.push(landmarks[L.rightAnkle].y / torso)
  })
  const head = percentile(headOffsets, 0.75); const trunk = percentile(trunkOffsets, 0.75); const pelvis = percentile(hipLevels, 0.75); const knees = percentile(kneeTracking, 0.75); const arms = percentile(armBalance, 0.75)
  const strideDifference = Math.abs((percentile(ankleLeft, 0.9) - percentile(ankleLeft, 0.1)) - (percentile(ankleRight, 0.9) - percentile(ankleRight, 0.1)))
  const headScore = clamp(100 - Math.max(0, head - 0.18) * 170); const trunkScore = clamp(100 - Math.max(0, trunk - 0.14) * 185); const pelvisScore = pelvis <= 0.16 ? 96 : clamp(96 - (pelvis - 0.16) * 120); const kneeScore = knees <= 0.20 ? 96 : clamp(96 - (knees - 0.20) * 150); const armScore = arms <= 0.24 ? 96 : clamp(96 - (arms - 0.24) * 130); const symmetryScore = clamp(100 - Math.max(0, strideDifference - 0.15) * 155)
  const metrics = [
    metric('posture', 'Trunk midline', trunkScore, `${trunk.toFixed(2)}× torso offset`, `${view === 'front' ? 'Front' : 'Oblique'}-view screen: compares shoulder and hip midpoints. It does not estimate forward lean.`, 'Let the ribs stay centred over the pelvis and allow the arms to swing without pulling the torso to one side.'),
    metric('pelvis', 'Pelvic level', pelvisScore, `${(pelvis * 100).toFixed(1)}% relative tilt`, `${view === 'front' ? 'Front' : 'Oblique'}-view screen: compares the vertical level of the two hip landmarks. Camera tilt and loose clothing can reduce confidence.`, pelvis > 0.30 ? 'Run tall and let the pelvis stay quietly level as each leg supports you. Do not force it down; reduce effort and recheck if the pattern persists.' : 'The pelvis appears level in this view. Keep a relaxed, even rhythm rather than bracing through the hips.'),
    metric('footPlacement', 'Knee & foot tracking', kneeScore, `${knees.toFixed(2)} relative deviation`, `${view === 'front' ? 'Front' : 'Oblique'}-view screen: checks whether each knee broadly tracks between its hip and ankle. It cannot diagnose pronation or injury.`, knees > 0.34 ? 'Let each knee travel in the same direction as the foot as you load the leg. Use a relaxed easy pace; do not force the knee inward or outward.' : 'The knees broadly track over the feet in this view. Keep the landing quiet and the legs moving in their natural line.'),
    metric('head', 'Side-to-side head control', headScore, `${head.toFixed(2)}× torso offset`, 'This repeats the front-view midline screen so a visible head shift receives a clear cue.', 'Keep your jaw and shoulders relaxed; let the head ride quietly above the centre of the torso.'),
    metric('armSwing', 'Arm balance', armScore, `${arms.toFixed(2)} relative difference`, `${view === 'front' ? 'Front' : 'Oblique'}-view screen: compares left and right wrist travel. It cannot measure the front-to-back arm action visible in a side view.`, arms > 0.36 ? 'Let both elbows drive gently backward with similar rhythm. Keep the shoulders low and the hands relaxed rather than forcing symmetry.' : 'The arms appear broadly balanced in this view. Keep the shoulders relaxed and allow a natural rhythm.'),
    metric('symmetry', 'Side-to-side rhythm', symmetryScore, `${strideDifference.toFixed(2)} relative gap`, 'This compares the visible rise and fall of each ankle; it is a screening signal, not a medical gait assessment.', 'Compare another easy clip after rest. If uneven movement accompanies pain or persists, consult a qualified clinician.'),
  ]
  const points = samples.flatMap((sample) => sample.landmarks); const poseConfidence = Math.round(visibility(points) * 100)
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceName, duration, confidence: Math.min(confidence, poseConfidence), score: Math.round(avg(metrics.map((item) => item.score))), readiness: 'ready', view, viewConfidence, samples, metrics, footStrike: { classification: 'inconclusive', confidence: 0, contacts: 0, message: 'Foot-strike and landing-position labels need a clear side view, so they are withheld for this camera angle.', landing: 'inconclusive', landingConfidence: 0 }, notes: [`${view === 'front' ? 'Front' : 'Oblique'} view detected. The report selected measures that are meaningful for this angle and withheld side-view-only contact claims.`, 'This is a 2D movement screen, not a clinical gait assessment.'] }
}

function makeAnalysis(samples: PoseSample[], sourceName: string, duration: number): RunningAnalysis {
  const valid = samples.filter((sample) => sample.landmarks.length >= 33 && sample.confidence >= 0.55)
  const confidence = Math.round(avg(valid.map((sample) => sample.confidence)) * 100)
  if (valid.length < 36) return limitedAnalysis(samples, sourceName, duration, confidence)
  const camera = classifyView(valid)
  if (camera.view !== 'side') return frontalAnalysis(valid, sourceName, duration, confidence, camera.view, camera.confidence)

  const torsoAngles: number[] = []; const headOffsets: number[] = []; const hipYs: number[] = []
  const elbowAngles: number[] = []; const handTravelLeft: number[] = []; const handTravelRight: number[] = []; const wristHeights: number[] = []
  const ankleYLeft: number[] = []; const ankleYRight: number[] = []
  valid.forEach(({ landmarks }) => {
    const shoulder = meanPoint(landmarks[L.leftShoulder], landmarks[L.rightShoulder]); const hip = meanPoint(landmarks[L.leftHip], landmarks[L.rightHip])
    const torso = Math.max(distance(shoulder, hip), 0.001)
    torsoAngles.push(Math.abs(Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * 180 / Math.PI))
    headOffsets.push(Math.abs(landmarks[L.nose].x - shoulder.x) / torso); hipYs.push(hip.y / torso)
    elbowAngles.push(angle(landmarks[L.leftShoulder], landmarks[L.leftElbow], landmarks[L.leftWrist]), angle(landmarks[L.rightShoulder], landmarks[L.rightElbow], landmarks[L.rightWrist]))
    handTravelLeft.push((landmarks[L.leftWrist].x - landmarks[L.leftShoulder].x) / torso); handTravelRight.push((landmarks[L.rightWrist].x - landmarks[L.rightShoulder].x) / torso)
    wristHeights.push((landmarks[L.leftWrist].y - landmarks[L.leftShoulder].y) / torso, (landmarks[L.rightWrist].y - landmarks[L.rightShoulder].y) / torso)
    ankleYLeft.push(landmarks[L.leftAnkle].y / torso); ankleYRight.push(landmarks[L.rightAnkle].y / torso)
  })
  const contact = contactScreen(valid)
  // A side view cannot measure frontal-plane hip drop. Here "pelvic" means repeated
  // vertical motion of the pelvis. Remove the local camera/perspective trend first and
  // keep thresholds deliberately generous: a small bounce is normal in distance running.
  const localTrend = hipYs.map((_, index) => avg(hipYs.slice(Math.max(0, index - 12), Math.min(hipYs.length, index + 13))))
  const pelvisOscillation = percentile(hipYs.map((value, index) => value - localTrend[index]), 0.9) - percentile(hipYs.map((value, index) => value - localTrend[index]), 0.1)
  const lean = percentile(torsoAngles, 0.5); const leanScore = lean < 3 ? 65 + lean * 5 : lean <= 12 ? 96 - Math.abs(lean - 7) * 1.2 : clamp(88 - (lean - 12) * 3)
  const head = percentile(headOffsets, 0.5); const headScore = clamp(100 - Math.max(0, head - 0.23) * 170)
  const pelvisScore = pelvisOscillation <= 0.26 ? 96 : clamp(96 - (pelvisOscillation - 0.26) * 120)
  const averageElbow = percentile(elbowAngles, 0.5); const handTravel = avg([percentile(handTravelLeft, 0.9) - percentile(handTravelLeft, 0.1), percentile(handTravelRight, 0.9) - percentile(handTravelRight, 0.1)])
  const highestWrist = percentile(wristHeights, 0.1)
  const elbowScore = clamp(100 - Math.max(0, Math.abs(averageElbow - 95) - 28) * 1.25)
  const handScore = handTravel < 0.30 ? clamp(72 + handTravel * 80) : handTravel > 1.25 ? clamp(96 - (handTravel - 1.25) * 55) : 96
  const handHeightScore = highestWrist < -0.05 ? clamp(100 - Math.abs(highestWrist + 0.05) * 90) : 96
  const armScore = avg([elbowScore, handScore, handHeightScore])
  const strideAsymmetry = Math.abs((percentile(ankleYLeft, 0.9) - percentile(ankleYLeft, 0.1)) - (percentile(ankleYRight, 0.9) - percentile(ankleYRight, 0.1)))
  const symmetryScore = clamp(100 - Math.max(0, strideAsymmetry - 0.14) * 160)
  const advances = contact.contacts.map((item) => item.advance).filter(Number.isFinite)
  const forwardPlacement = percentile(advances, 0.75); const footScore = advances.length >= 6 ? clamp(100 - Math.max(0, forwardPlacement - 0.30) * 155) : 70

  const metrics = [
    metric('posture', 'Trunk position', leanScore, `${lean.toFixed(1)}° from vertical`, 'This compares the shoulder-to-hip line across clear side-view frames.', lean < 3 ? 'Run tall, then let your whole body tip forward slightly from the ankles.' : lean > 12 ? 'Reduce the bend at the waist. Keep ribs stacked over your hips.' : 'Keep this relaxed whole-body lean; avoid folding forward at the waist.'),
    metric('pelvis', 'Pelvic stability', pelvisScore, `${(pelvisOscillation * 100).toFixed(1)}% vertical oscillation`, 'In this side view, this is a conservative screen for repeated vertical pelvic motion—not a diagnosis of hip drop. Normal small movement is not penalized.', pelvisOscillation > 0.40 ? 'Think forward, not upward: keep your belt line travelling smoothly forward while your legs cycle underneath. Stay relaxed rather than bracing.' : 'Your vertical pelvic rhythm looks controlled in this view. Keep the hips travelling forward with relaxed legs underneath.'),
    metric('footPlacement', 'Contact placement', footScore, advances.length >= 6 ? `${forwardPlacement.toFixed(2)}× torso length ahead` : 'Contact direction unclear', 'This is measured only at detected foot-contact frames and is scaled to your own torso length.', advances.length < 6 ? 'Keep both shoes visible in a stable side view so contact placement can be checked.' : contact.assessment.landing === 'ahead-of-body' ? 'Let the foot meet the ground closer beneath your hips. Keep the stride relaxed; do not force tiny steps.' : 'Keep allowing the foot to meet the ground close to your body with a quiet, relaxed landing.'),
    metric('head', 'Head & neck', headScore, `${head.toFixed(2)}× torso offset`, 'Head position is compared with your shoulder midpoint in this side-view video.', 'Soften your gaze ahead and lengthen the back of your neck; avoid reaching your chin forward.'),
    metric('armSwing', 'Arm swing & hand path', armScore, `${averageElbow.toFixed(0)}° elbow · ${handTravel.toFixed(2)}× travel`, 'An efficiency screen based on compact back-and-forward arm action: a natural elbow bend, a controlled hand path, and hands staying below shoulder height. A side view cannot assess cross-body motion reliably.', highestWrist < -0.05 ? 'Lower the hand path. Keep the hands relaxed around the lower-rib to hip area, driving the elbow back instead of lifting the hands toward the face.' : handTravel < 0.30 ? 'Free the arms from your sides: keep a natural 70–120° elbow bend and drive the elbows lightly back so the hands travel back and forward beside the body.' : averageElbow > 123 ? 'Avoid straight, reaching arms. Keep a natural 70–120° elbow bend and drive the elbow back, letting the hand return forward without lifting it.' : handTravel > 1.25 ? 'Make the arm action quieter. Keep the hands near the lower ribs to hip line and drive backward-forward rather than throwing the arm far in front or behind.' : 'Keep this compact, relaxed arm action: soft elbows, quiet shoulders, and a smooth backward-forward swing beside the body.'),
    metric('symmetry', 'Stride symmetry', symmetryScore, `${strideAsymmetry.toFixed(2)} relative gap`, 'This compares the visible vertical excursion of each ankle, not a medical gait diagnosis.', 'Keep effort easy and compare another clip after rest. Persistent pain or asymmetry deserves a qualified clinician.'),
  ]
  const score = Math.round(avg(metrics.map((item) => item.score))); const points = valid.flatMap((sample) => sample.landmarks); const poseConfidence = Math.round(visibility(points) * 100)
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceName, duration, confidence: Math.min(confidence, poseConfidence), score, readiness: 'ready', view: camera.view, viewConfidence: camera.confidence, samples: valid, metrics, footStrike: contact.assessment, notes: ['Side view detected. Measurements are normalized to the runner’s own body landmarks, so the screen does not assume an adult body size, gender, or a single running style.', 'This report screens 2D video landmarks; it is coaching support, not a medical assessment.'] }
}

function limitedAnalysis(samples: PoseSample[], sourceName: string, duration: number, confidence: number, captureIssue?: string): RunningAnalysis {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceName, duration, confidence, score: 0, readiness: 'limited', samples, metrics: [], footStrike: { classification: 'inconclusive', confidence: 0, contacts: 0, message: 'Foot strike is unavailable because the clip did not meet the full-body tracking threshold.', landing: 'inconclusive', landingConfidence: 0 }, notes: [captureIssue ?? 'We could not confidently track enough full-body frames to give a form score.', 'Try a 10–20 second side-view clip, with your whole body and both shoes visible in good contrast.'] }
}

export const longDistanceRunning: SportModule = { id: 'long-distance-running', label: 'Long-distance running', captureGuide: ['Record 10–20 seconds at an easy, natural pace.', 'Use a stable side view; keep your whole body and both shoes visible throughout.', 'Use 60 fps or higher when possible (120 fps is ideal); slow motion makes initial contact easier to screen.', 'Film one runner only, in daylight or even lighting.', 'This screen is for running form correction, not injury diagnosis.'], analyse: makeAnalysis }
export const sportRegistry: Record<string, SportModule> = { [longDistanceRunning.id]: longDistanceRunning }
