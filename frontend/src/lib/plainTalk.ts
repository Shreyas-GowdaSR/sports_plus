import type { Metric, MetricId, RunningAnalysis } from '../types'

/**
 * The analysis engine speaks in angles and ratios. Athletes need one simple
 * sentence about what we saw, and one thing to do about it.
 */

type Talk = { name: string; good: string; issue: string; fix: string }

const SIDE: Record<MetricId, Talk> = {
  posture:       { name: 'Body lean',        good: 'You run tall with a small forward lean. Good.', issue: 'Your upper body bends at the waist or leans back.', fix: 'Run tall, like a string is pulling your head up. Lean the whole body slightly forward from the ankles, not from the waist.' },
  pelvis:        { name: 'Hip bounce',       good: 'Your hips move forward smoothly without much bouncing.', issue: 'Your hips go up and down too much. That wastes energy.', fix: 'Think "forward, not up". Imagine your belt is being pulled forward by a rope.' },
  footPlacement: { name: 'Foot landing',     good: 'Your foot lands close under your body. Good.', issue: 'Your foot lands too far in front of your body. This acts like a brake and stresses the shins and knees.', fix: 'Land with the foot closer under your hips. Take slightly quicker, lighter steps. Do not force short steps.' },
  head:          { name: 'Head position',    good: 'Your head stays steady above your shoulders.', issue: 'Your head pushes forward or drops down.', fix: 'Look straight ahead, about 20 metres in front. Keep the jaw loose and the neck long.' },
  armSwing:      { name: 'Arm swing',        good: 'Your arms swing in a relaxed, compact way.', issue: 'Your arms are stiff, too straight, or swing across your body.', fix: 'Keep the elbows bent at about 90°. Swing the hands from hip to chest, front to back, not across your body.' },
  symmetry:      { name: 'Left–right balance', good: 'Both legs move in a similar way.', issue: 'One leg moves differently from the other.', fix: 'Keep easy runs easy and do the balance drills below. If one side hurts, see a physio.' },
}

const FRONT: Partial<Record<MetricId, Partial<Talk>>> = {
  posture:       { name: 'Body centre', issue: 'Your upper body sways from side to side.', fix: 'Keep the chest facing forward and the shoulders level. Tighten your stomach slightly.' },
  pelvis:        { name: 'Hip level', issue: 'One hip drops lower than the other when you land.', fix: 'Strengthen the hip muscles with the bridge and single-leg drills below.' },
  footPlacement: { name: 'Knee line', good: 'Your knees track straight over your feet.', issue: 'Your knees move inwards or outwards when you land.', fix: 'Keep each knee pointing in the same direction as your toes.' },
  armSwing:      { name: 'Arm balance', issue: 'One arm swings more than the other.', fix: 'Relax both shoulders. Swing both arms equally, front to back.' },
}

export function talkFor(metric: Metric, view: RunningAnalysis['view']): Talk {
  const base = SIDE[metric.id]
  return view === 'front' || view === 'oblique' ? { ...base, ...FRONT[metric.id] } : base
}

export function statusWord(status: Metric['status']) {
  return status === 'good' ? 'Good' : status === 'watch' ? 'Can improve' : 'Fix this'
}

export function verdict(score: number) {
  if (score >= 80) return { word: 'Strong form', line: 'Your running form looks good. Keep it this way as your distance goes up.' }
  if (score >= 62) return { word: 'Good, with work to do', line: 'Your form is decent. Fixing one or two things will make running easier and safer.' }
  return { word: 'Needs attention', line: 'A few things need fixing. Work on them before you increase speed or distance.' }
}

export type Drill = { name: string; dose: string; how: string; search: string }

export const DRILLS: Record<MetricId, Drill[]> = {
  posture:       [{ name: 'Wall lean march', dose: '2 × 20 sec', how: 'Lean on a wall with a straight body. March on the spot, knees up.', search: 'wall lean march running drill' }, { name: 'Tall strides', dose: '4 × 15 sec', how: 'After an easy run, run fast but relaxed, staying tall.', search: 'running strides tall posture drill' }],
  pelvis:        [{ name: 'Bridge march', dose: '2 × 8 each leg', how: 'Lie on your back, lift the hips, then lift one foot at a time. Keep the hips level.', search: 'glute bridge march exercise' }, { name: 'Single-leg stand', dose: '2 × 30 sec each leg', how: 'Stand on one leg, hips level. Hold a wall if needed.', search: 'single leg balance exercise runners' }],
  footPlacement: [{ name: 'Quick-feet strides', dose: '6 × 20 sec', how: 'Run with light, quick steps. Feet land under you. Walk 1 min between.', search: 'quick feet running drill' }, { name: 'Ankle march', dose: '2 × 15 m', how: 'March forward on your toes, placing each foot under your hips.', search: 'ankling running drill' }],
  head:          [{ name: 'Wall posture reset', dose: '3 × 3 slow breaths', how: 'Stand with your back on a wall. Gently tuck the chin and make the neck long.', search: 'wall chin tuck posture exercise' }, { name: 'Look-ahead run', dose: '3 × 30 sec', how: 'During an easy run, fix your eyes on a point far ahead.', search: 'running head position gaze tips' }],
  armSwing:      [{ name: 'Seated arm swing', dose: '3 × 30 sec', how: 'Sit on the floor, elbows at 90°, swing arms front to back fast but relaxed.', search: 'seated arm swing running drill' }, { name: 'Arm-swing walk', dose: '2 × 30 sec', how: 'Walk briskly with relaxed arms swinging beside your body.', search: 'running arm swing drill' }],
  symmetry:      [{ name: 'Step-down', dose: '2 × 6 each leg', how: 'Stand on a step, slowly lower the other heel to the floor. Knee over middle toe.', search: 'lateral step down exercise knee control' }, { name: 'Single-leg balance', dose: '2 × 30 sec each leg', how: 'Stand tall on one leg. Try with eyes closed when it gets easy.', search: 'single leg balance exercise eyes closed' }],
}

/** YouTube search for a drill: always resolves and shows several demonstrations. */
export function videoLink(drill: Drill) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(drill.search)}`
}

/** The two weakest checks decide the drills: never more than four. */
export function drillsFor(metrics: Metric[]): (Drill & { for: string })[] {
  const weak = [...metrics].filter(m => m.status !== 'good').sort((a, b) => a.score - b.score).slice(0, 2)
  const picks = weak.length ? weak : [...metrics].sort((a, b) => a.score - b.score).slice(0, 1)
  return picks.flatMap(metric => DRILLS[metric.id].map(drill => ({ ...drill, for: SIDE[metric.id].name })))
}

export function footStrikeTalk(analysis: Pick<RunningAnalysis, 'footStrike'>) {
  const strike = analysis.footStrike
  const type = strike.classification === 'rearfoot' ? 'Heel first' : strike.classification === 'midfoot' ? 'Middle of the foot' : strike.classification === 'forefoot' ? 'Toes first' : 'Not clear'
  const landing = strike.landing === 'ahead-of-body' ? 'Your foot lands ahead of your body. Try to land closer under your hips.'
    : strike.landing === 'under-body' ? 'Your foot lands close under your body. Good.'
    : 'We could not see clearly where the foot lands. Try a clearer side-view video.'
  return { type, landing, note: 'Heel, middle or toe landing is not right or wrong by itself. Where the foot lands matters more.' }
}

/** A short summary the coach can read. */
export function analysisAsText(analysis: Pick<RunningAnalysis, 'score' | 'metrics' | 'view' | 'footStrike' | 'createdAt'>) {
  const lines = analysis.metrics.map(m => {
    const t = talkFor(m, analysis.view)
    return `- ${t.name}: ${m.score}/100 (${statusWord(m.status)}). ${m.status === 'good' ? t.good : `${t.issue} Fix: ${t.fix}`}`
  })
  const strike = footStrikeTalk(analysis)
  return [`Form score ${analysis.score}/100 on ${new Date(analysis.createdAt).toDateString()}`, ...lines, `- Foot strike: ${strike.type}. ${strike.landing}`].join('\n')
}
