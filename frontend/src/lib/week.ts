import type { AthleteProfile, PlannedDay, Session, SessionKind } from '../types'

export const SESSION_LABEL: Record<SessionKind, string> = {
  easy: 'Easy run', long: 'Long run', hard: 'Hard workout', race: 'Race day', strength: 'Strength', rest: 'Rest day',
}

// Share of the weekly distance for each day. Quality is buffered by easy and rest days.
const TEMPLATE: { day: string; kind: SessionKind; share: number; title: string; detail: string; pace: number }[] = [
  { day: 'Mon', kind: 'easy',     share: 0.18, title: 'Easy run',         detail: 'Slow enough that you can talk in full sentences.', pace: 6.5 },
  { day: 'Tue', kind: 'strength', share: 0,    title: 'Strength & drills', detail: 'Squats, bridges, calf raises, planks. 30 minutes at home.', pace: 0 },
  { day: 'Wed', kind: 'hard',     share: 0.20, title: 'Speed session',    detail: 'Warm up 15 min, then 5 × 3 min fast with 2 min slow jog between.', pace: 6.0 },
  { day: 'Thu', kind: 'rest',     share: 0,    title: 'Rest',             detail: 'No running. Sleep well and eat normal meals.', pace: 0 },
  { day: 'Fri', kind: 'easy',     share: 0.17, title: 'Easy + strides',   detail: 'Easy run, then 4 × 15 sec relaxed fast strides.', pace: 6.5 },
  { day: 'Sat', kind: 'long',     share: 0.30, title: 'Long run',         detail: 'Slow and steady. Practise your drink and food plan.', pace: 6.8 },
  { day: 'Sun', kind: 'easy',     share: 0.15, title: 'Recovery jog',     detail: 'Very slow jog or brisk walk, then stretching.', pace: 7.0 },
]

const roundTo = (value: number, step: number) => Math.round(value / step) * step

export function weekPlan(profile: AthleteProfile): PlannedDay[] {
  return TEMPLATE.map(item => {
    const km = item.share ? Math.max(3, Math.round(profile.weeklyKm * item.share)) : 0
    const minutes = item.kind === 'strength' ? 30 : item.kind === 'rest' ? 0 : Math.max(20, roundTo(km * item.pace, 5))
    return { day: item.day, title: item.title, detail: item.detail, kind: item.kind, km, minutes }
  })
}

/** Monday-first index for today's date. */
export function todayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7
}

export function sessionFor(day: PlannedDay, profile: AthleteProfile): Session {
  return { kind: day.kind, minutes: day.minutes, weather: 'normal', startTime: profile.trainingTime || '06:00' }
}
