export type Landmark = { x: number; y: number; z?: number; visibility?: number }

export type PoseSample = {
  timestamp: number
  landmarks: Landmark[]
  confidence: number
}

export type MetricId = 'posture' | 'pelvis' | 'footPlacement' | 'head' | 'armSwing' | 'symmetry'

export type Metric = {
  id: MetricId
  label: string
  score: number
  status: 'good' | 'watch' | 'focus'
  value: string
  description: string
  cue: string
}

export type RunningAnalysis = {
  id: string
  createdAt: string
  sourceName: string
  duration: number
  confidence: number
  score: number
  readiness: 'ready' | 'limited'
  view?: 'side' | 'front' | 'oblique'
  viewConfidence?: number
  samples: PoseSample[]
  metrics: Metric[]
  footStrike: FootStrikeAssessment
  notes: string[]
}

export type FootStrikeAssessment = {
  classification: 'rearfoot' | 'midfoot' | 'forefoot' | 'inconclusive'
  confidence: number
  contacts: number
  message: string
  landing: 'under-body' | 'ahead-of-body' | 'inconclusive'
  landingConfidence: number
  correction?: string
}

/** A sport module owns its capture rules and scoring model. Only running ships today. */
export type SportModule = {
  id: string
  label: string
  captureGuide: string[]
  analyse: (samples: PoseSample[], sourceName: string, duration: number) => RunningAnalysis
}

// ── Athlete ──────────────────────────────────────────────────
export type Diet = 'veg' | 'egg' | 'nonveg' | 'vegan'
export type FoodRegion = 'south' | 'north' | 'any'
export type Gender = 'male' | 'female' | 'other'

export type AthleteProfile = {
  name: string
  age: number
  gender: Gender
  weightKg: number
  heightCm: number
  event: string
  weeklyKm: number
  diet: Diet
  region: FoodRegion
  avoid: string
  trainingTime: string
  saved: boolean
}

// ── Training sessions ────────────────────────────────────────
export type SessionKind = 'easy' | 'long' | 'hard' | 'race' | 'strength' | 'rest'
export type Weather = 'cool' | 'normal' | 'hot'

export type Session = {
  kind: SessionKind
  minutes: number
  weather: Weather
  startTime: string
}
