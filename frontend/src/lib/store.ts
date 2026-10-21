import { useCallback, useState } from 'react'
import type { AthleteProfile, RunningAnalysis } from '../types'

// Everything about the athlete lives in this browser. No account, no cloud.
const PROFILE_KEY = 'sportsai.profile.v2'
const HISTORY_KEY = 'sportsai.history.v2'

export const defaultProfile: AthleteProfile = {
  name: '',
  age: 21,
  gender: 'male',
  weightKg: 60,
  heightCm: 170,
  event: '10K',
  weeklyKm: 30,
  diet: 'veg',
  region: 'south',
  avoid: '',
  trainingTime: '06:00',
  saved: false,
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch { return fallback }
}

function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full or blocked: keep in memory */ }
}

/** Saved checks drop the per-frame pose samples; the summary is all the history needs. */
export type SavedCheck = Omit<RunningAnalysis, 'samples'>

export function useAthlete() {
  const [profile, setProfileState] = useState<AthleteProfile>(() => read(PROFILE_KEY, defaultProfile))
  const [history, setHistory] = useState<SavedCheck[]>(() => readList<SavedCheck>(HISTORY_KEY))

  const saveProfile = useCallback((next: AthleteProfile) => {
    const saved = { ...next, saved: true }
    setProfileState(saved); write(PROFILE_KEY, saved)
  }, [])

  const addCheck = useCallback((analysis: RunningAnalysis) => {
    const { samples: _samples, ...summary } = analysis
    setHistory(current => {
      const next = [summary, ...current.filter(item => item.id !== summary.id)].slice(0, 40)
      write(HISTORY_KEY, next)
      return next
    })
  }, [])

  const clearHistory = useCallback(() => { setHistory([]); write(HISTORY_KEY, []) }, [])

  return { profile, saveProfile, history, addCheck, clearHistory }
}

export function firstName(profile: AthleteProfile) {
  return profile.name.trim().split(/\s+/)[0] || 'Athlete'
}
