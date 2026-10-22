// Runs the app's real TypeScript form check on exported benchmark clips.
//
//   node research/phone_benchmark/run_app_ts.mjs <clips.jsonl> <running.ts> <label> <out.jsonl>
//
// Node 22.6+ strips TypeScript types natively, so running.ts is imported as-is from a temporary
// copy with one extra export that exposes the foot contacts behind the report, for scoring.
// Samples are rebuilt as pose.ts produces them: 33 landmarks every 1/60 s, so a 30 fps clip
// repeats frames. 30 fps clips are run twice: with exact repeats, and with a 0.1-pixel wobble
// on repeats, because MediaPipe's video-mode smoothing may not return identical points.
import { appendFileSync, copyFileSync, createReadStream, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const [clipsPath, sourcePath, label, outPath] = process.argv.slice(2)
const copy = join(mkdtempSync(join(tmpdir(), 'running-ts-')), 'running.ts')
copyFileSync(sourcePath, copy)
// The improved file has prepareTrack/findContacts; the original keeps contactScreen private.
appendFileSync(copy, `
export const __contacts = (samples: any[], aspect: number): any[] => {
  const valid = samples.filter((s: any) => s.landmarks.length >= 33 && s.confidence >= 0.55)
  if (typeof prepareTrack === 'function') {
    const track = (prepareTrack as any)(valid, aspect)
    return (findContacts as any)(track, (forwardDirection as any)(track))
  }
  return (contactScreen as any)(valid).contacts
}
`)
const engine = await import(pathToFileURL(copy).href)

let seed = 1
const gaussian = () => { // deterministic Box-Muller
  seed = (seed * 16807) % 2147483647; const u = seed / 2147483647
  seed = (seed * 16807) % 2147483647; const v = seed / 2147483647
  return Math.sqrt(-2 * Math.log(u || 1e-12)) * Math.cos(2 * Math.PI * v)
}

function appSamples(clip, wobble) {
  const samples = []
  const last = clip.times[clip.times.length - 1]
  let frame = 0
  let previous = -1
  for (let t = 0; t < last; t += 1 / 60) {
    while (frame + 1 < clip.times.length && clip.times[frame + 1] <= t + 1e-9) frame += 1
    const flat = clip.xy[frame]
    const modelled = new Map(clip.modelled.map((k, i) => [k, { x: flat[2 * i], y: flat[2 * i + 1], visibility: clip.visibility[frame][i] }]))
    const repeat = frame === previous
    const landmarks = Array.from({ length: 33 }, (_, k) => {
      const point = modelled.get(k) ?? { ...modelled.get(0), visibility: 0.95 }
      return repeat && wobble ? { ...point, x: point.x + gaussian() * 0.1 / clip.imageHeight, y: point.y + gaussian() * 0.1 / clip.imageHeight } : { ...point }
    })
    samples.push({ timestamp: t * 1000, landmarks, confidence: landmarks.reduce((s, p) => s + p.visibility, 0) / 33 })
    previous = frame
  }
  return samples
}

writeFileSync(outPath, '')
let n = 0
for await (const line of createInterface({ input: createReadStream(clipsPath) })) {
  if (!line.trim()) continue
  const clip = JSON.parse(line)
  for (const wobble of clip.fps === 30 ? [false, true] : [false]) {
    const samples = appSamples(clip, wobble)
    const analysis = engine.longDistanceRunning.analyse(samples, 'clip', 12, clip.aspect)
    const contacts = analysis.view === 'side' && analysis.readiness === 'ready' ? engine.__contacts(samples, clip.aspect) : []
    const valueOf = (id) => analysis.metrics.find((m) => m.id === id)?.value ?? ''
    const { times, xy, visibility, modelled, ...meta } = clip
    appendFileSync(outPath, JSON.stringify({
      ...meta, wobble, label, readiness: analysis.readiness, detectedView: analysis.view ?? null, score: analysis.score,
      strike: analysis.footStrike.classification, landing: analysis.footStrike.landing,
      pelvisValue: valueOf('pelvis'), placementValue: valueOf('footPlacement'),
      metricScores: Object.fromEntries(analysis.metrics.map((m) => [m.id, m.score])),
      contacts: contacts.map((c) => ({ side: c.side ?? null, t: c.timestamp / 1000, type: c.type, advance: c.advance })),
    }) + '\n')
    n += 1
  }
}
console.log(`${label}: ${n} clip runs analysed -> ${outPath}`)
