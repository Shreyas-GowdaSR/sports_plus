import { Fragment, useState } from 'react'
import { Droplets, Eye, EyeOff, MessageCircle, Pencil, Sunrise, Utensils, Zap } from 'lucide-react'
import type { AthleteProfile, Session, SessionKind, Weather } from '../types'
import { SESSION_LABEL, type FuelPlan, type FuelStep } from '../lib/fuel'

type Props = { profile: AthleteProfile; session: Session; plan: FuelPlan; onChange: (session: Session) => void; onAsk: (question: string) => void; onProfile: () => void }

const KINDS: SessionKind[] = ['easy', 'long', 'hard', 'race', 'strength', 'rest']
const WEATHER: { id: Weather; label: string }[] = [{ id: 'cool', label: 'Cool' }, { id: 'normal', label: 'Normal' }, { id: 'hot', label: 'Hot' }]
const DIET = { veg: 'Veg', egg: 'Egg', nonveg: 'Non-veg', vegan: 'Vegan' }

function Steps({ steps, notes = false }: { steps: FuelStep[]; notes?: boolean }) {
  return <>{steps.map(step => (
    <div className="step" key={step.when}>
      <div className="step-when">{step.when}</div>
      <ul>
        {step.lines.map((line, index) => (
          <Fragment key={line}>
            {step.choice && index > 0 && <li className="or">or</li>}
            <li>{line}</li>
          </Fragment>
        ))}
      </ul>
      {notes && step.note && <p className="step-note">{step.note}</p>}
    </div>
  ))}</>
}

export function Nutrition({ profile, session, plan, onChange, onAsk, onProfile }: Props) {
  const [showNumbers, setShowNumbers] = useState(false)
  const set = (patch: Partial<Session>) => onChange({ ...session, ...patch })
  const rest = session.kind === 'rest'

  return (
    <div className="page">
      <div className="page-bar">
        <h1 className="page-title">Nutrition</h1>
        <button className="chip" onClick={onProfile}>{profile.weightKg} kg · {profile.heightCm} cm · BMI {plan.body.bmi} · {DIET[profile.diet]}{profile.avoid.trim() ? ` · no ${profile.avoid.trim()}` : ''} <Pencil size={12} /></button>
      </div>
      {plan.body.note && <p className="body-note">{plan.body.note}</p>}

      <section className="card controls">
        <div className="seg">{KINDS.map(kind => <button key={kind} className={session.kind === kind ? 'on' : ''} onClick={() => set({ kind, minutes: kind === 'rest' ? 0 : session.minutes || 45 })}>{SESSION_LABEL[kind]}</button>)}</div>
        {!rest && <>
          <div className="minutes">
            <input type="range" min={15} max={240} step={5} value={session.minutes} onChange={event => set({ minutes: Number(event.target.value) })} aria-label="Session length in minutes" />
            <output className="num">{session.minutes}<small>min</small></output>
          </div>
          <div className="seg">{WEATHER.map(item => <button key={item.id} className={session.weather === item.id ? 'on' : ''} onClick={() => set({ weather: item.id })}>{item.label}</button>)}</div>
          <input className="time-input" type="time" value={session.startTime} onChange={event => set({ startTime: event.target.value || '06:00' })} aria-label="Start time" />
        </>}
        <div className="controls-end">
          <button className="icon-btn" onClick={() => setShowNumbers(value => !value)} title={showNumbers ? 'Hide numbers' : 'Show numbers'} aria-label={showNumbers ? 'Hide numbers' : 'Show numbers'}>{showNumbers ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          <button className="icon-btn" onClick={() => onAsk(`I have a ${plan.label.toLowerCase()} starting at ${session.startTime}. What exactly should I eat and drink?`)} title="Ask coach" aria-label="Ask coach"><MessageCircle size={16} /></button>
        </div>
      </section>

      {showNumbers && <div className="numbers">{plan.numbers.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>}

      <section className="timeline">
        {[
          { title: 'Before', icon: Sunrise, steps: plan.before },
          { title: 'During', icon: Zap, steps: plan.during },
          { title: 'After', icon: Utensils, steps: plan.after },
        ].map(({ title, icon: Icon, steps }) => (
          <div className="card phase" key={title}>
            <div className="phase-head"><span className="phase-icon"><Icon size={18} /></span><h3 className="subtitle">{title}</h3></div>
            <Steps steps={steps} />
          </div>
        ))}
      </section>

      <section className="card water">
        <div className="phase-head"><span className="phase-icon"><Droplets size={18} /></span><h3 className="subtitle">Water</h3></div>
        <div className="water-grid"><Steps steps={plan.water} notes /></div>
      </section>
    </div>
  )
}
