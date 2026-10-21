import { useEffect, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import type { AthleteProfile, Diet, FoodRegion, Gender } from '../types'

type Props = { profile: AthleteProfile; checks: number; onSave: (profile: AthleteProfile) => void; onClearHistory: () => void }

const DIETS: { id: Diet; label: string }[] = [{ id: 'veg', label: 'Vegetarian' }, { id: 'egg', label: 'Eggetarian' }, { id: 'nonveg', label: 'Non-veg' }, { id: 'vegan', label: 'Vegan' }]
const REGIONS: { id: FoodRegion; label: string }[] = [{ id: 'south', label: 'South Indian' }, { id: 'north', label: 'North Indian' }, { id: 'any', label: 'Mix of both' }]
const GENDERS: { id: Gender; label: string }[] = [{ id: 'male', label: 'Male' }, { id: 'female', label: 'Female' }, { id: 'other', label: 'Other' }]
const EVENTS = ['5K', '10K', 'Half marathon', 'Marathon', 'Track (800m–5000m)', 'Fitness running']

export function Profile({ profile, checks, onSave, onClearHistory }: Props) {
  const [draft, setDraft] = useState(profile)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setDraft(profile) }, [profile])
  const set = <K extends keyof AthleteProfile>(key: K, value: AthleteProfile[K]) => { setDraft(current => ({ ...current, [key]: value })); setSaved(false) }
  // Limits are applied on save so typing "6" on the way to "62" is not snapped to the minimum.
  const LIMITS = { age: [10, 80], weightKg: [30, 150], heightCm: [120, 220], weeklyKm: [0, 200] } as const
  const num = (key: keyof typeof LIMITS) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value)
    if (Number.isFinite(value)) set(key, value)
  }
  const save = () => {
    const next = { ...draft }
    for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) next[key] = Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], Math.round(next[key])))
    setDraft(next); onSave(next); setSaved(true)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Profile</span>
          <h1 className="display">About <em>you.</em></h1>
          <p className="lead">Fill this once. Every food amount, water amount and coach answer is worked out from it. Saved only on this device.</p>
        </div>
      </header>

      <form className="card" onSubmit={event => { event.preventDefault(); save() }}>
        <div className="profile-grid">
          <label className="field wide">Name<input value={draft.name} placeholder="Your name" onChange={event => set('name', event.target.value.slice(0, 40))} /></label>
          <label className="field">Age<div className="unit"><input type="number" min={10} max={80} value={draft.age} onChange={num('age')} /><span>yrs</span></div></label>

          <div className="field full">Gender<div className="seg">{GENDERS.map(item => <button type="button" key={item.id} className={draft.gender === item.id ? 'on' : ''} onClick={() => set('gender', item.id)}>{item.label}</button>)}</div></div>

          <label className="field">Weight<div className="unit"><input type="number" min={30} max={150} value={draft.weightKg} onChange={num('weightKg')} /><span>kg</span></div><small>Most important. Food and water amounts depend on it.</small></label>
          <label className="field">Height<div className="unit"><input type="number" min={120} max={220} value={draft.heightCm} onChange={num('heightCm')} /><span>cm</span></div></label>
          <label className="field">Usual training time<input type="time" value={draft.trainingTime} onChange={event => set('trainingTime', event.target.value || '06:00')} style={{ colorScheme: 'dark' }} /></label>

          <label className="field">Main event<select value={draft.event} onChange={event => set('event', event.target.value)}>{EVENTS.map(item => <option key={item}>{item}</option>)}</select></label>
          <label className="field">Running per week<div className="unit"><input type="number" min={0} max={200} value={draft.weeklyKm} onChange={num('weeklyKm')} /><span>km</span></div></label>
          <span />

          <div className="field full">Diet<div className="seg">{DIETS.map(item => <button type="button" key={item.id} className={draft.diet === item.id ? 'on' : ''} onClick={() => set('diet', item.id)}>{item.label}</button>)}</div></div>
          <div className="field full">Food you usually eat<div className="seg">{REGIONS.map(item => <button type="button" key={item.id} className={draft.region === item.id ? 'on' : ''} onClick={() => set('region', item.id)}>{item.label}</button>)}</div></div>

          <label className="field full">Foods to avoid or allergies<input value={draft.avoid} placeholder="e.g. peanuts, milk, gluten" onChange={event => set('avoid', event.target.value.slice(0, 120))} /><small>We will never suggest these foods.</small></label>
        </div>
        <hr className="rule" />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="faint">{saved ? 'Saved. All plans are updated.' : 'Changes apply after you save.'}</span>
          <button className="btn btn-gold">{saved ? <Check size={16} /> : null}Save profile</button>
        </div>
      </form>

      {checks > 0 && (
        <div className="notice" style={{ marginTop: 24, alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{checks} saved form {checks === 1 ? 'check' : 'checks'} on this device.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm('Delete all saved form checks from this device?')) onClearHistory() }}><Trash2 size={14} /> Clear history</button>
        </div>
      )}
    </div>
  )
}
