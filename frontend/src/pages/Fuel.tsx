import { Fragment, useState } from 'react'
import { Droplets, Eye, EyeOff, MessageCircle, ShieldAlert, Sunrise, Utensils, Zap } from 'lucide-react'
import type { AthleteProfile, Session, SessionKind, Weather } from '../types'
import type { FuelPlan, FuelStep } from '../lib/fuel'
import { SESSION_LABEL } from '../lib/week'

type Props = { profile: AthleteProfile; session: Session; plan: FuelPlan; onChange: (session: Session) => void; onAsk: (question: string) => void }

const KINDS: SessionKind[] = ['easy', 'long', 'hard', 'race', 'strength', 'rest']
const WEATHER: { id: Weather; label: string }[] = [{ id: 'cool', label: 'Cool' }, { id: 'normal', label: 'Normal' }, { id: 'hot', label: 'Hot / humid' }]

function Steps({ steps }: { steps: FuelStep[] }) {
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
      {step.note && <p className="step-note">{step.note}</p>}
    </div>
  ))}</>
}

export function Fuel({ profile, session, plan, onChange, onAsk }: Props) {
  const [showNumbers, setShowNumbers] = useState(false)
  const set = (patch: Partial<Session>) => onChange({ ...session, ...patch })
  const rest = session.kind === 'rest'

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Food &amp; water</span>
          <h1 className="display">What to eat,<br /><em>how much, and when.</em></h1>
          <p className="lead">Made for {profile.weightKg} kg · {profile.diet === 'veg' ? 'vegetarian' : profile.diet === 'egg' ? 'eggetarian' : profile.diet === 'vegan' ? 'vegan' : 'non-vegetarian'}{profile.avoid.trim() ? ` · avoiding ${profile.avoid.trim()}` : ''}. Change the session below and the plan updates.</p>
        </div>
      </header>

      <section className="card">
        <div className="controls">
          <div className="control">
            <span>Session</span>
            <div className="seg">{KINDS.map(kind => <button key={kind} className={session.kind === kind ? 'on' : ''} onClick={() => set({ kind, minutes: kind === 'rest' ? 0 : session.minutes || 45 })}>{SESSION_LABEL[kind]}</button>)}</div>
          </div>
          <div className="control">
            <span>Weather</span>
            <div className="seg">{WEATHER.map(item => <button key={item.id} className={session.weather === item.id ? 'on' : ''} onClick={() => set({ weather: item.id })}>{item.label}</button>)}</div>
          </div>
          <div className="control">
            <span>How long</span>
            <div className="minutes">
              <input type="range" min={15} max={240} step={5} value={rest ? 15 : session.minutes} disabled={rest} onChange={event => set({ minutes: Number(event.target.value) })} aria-label="Session length in minutes" />
              <output className="num">{rest ? '—' : `${session.minutes}m`}</output>
            </div>
          </div>
          <div className="control">
            <span>Start time</span>
            <input className="time-input" type="time" value={session.startTime} disabled={rest} onChange={event => set({ startTime: event.target.value || '06:00' })} aria-label="Start time" />
          </div>
        </div>
      </section>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 32 }}>
        <div><h2 className="title" style={{ margin: 0 }}>{plan.label}</h2><p className="muted" style={{ margin: '6px 0 0' }}>{plan.summary}</p></div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowNumbers(value => !value)}>{showNumbers ? <EyeOff size={15} /> : <Eye size={15} />}{showNumbers ? 'Hide the numbers' : 'Show the numbers'}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onAsk(`I have a ${plan.label.toLowerCase()} starting at ${session.startTime}. What exactly should I eat and drink?`)}><MessageCircle size={15} /> Ask coach</button>
        </div>
      </div>

      {showNumbers && <div className="numbers">{plan.numbers.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>}

      <section className="timeline">
        {[
          { title: 'Before', icon: Sunrise, steps: plan.before },
          { title: 'During', icon: Zap, steps: plan.during },
          { title: 'After', icon: Utensils, steps: plan.after },
        ].map(({ title, icon: Icon, steps }) => (
          <div className="card phase" key={title}>
            <div className="phase-head"><span className="phase-icon"><Icon size={19} /></span><h3 className="subtitle">{title}</h3></div>
            <Steps steps={steps} />
          </div>
        ))}
      </section>

      <section className="card water">
        <div className="phase-head" style={{ marginBottom: 22 }}><span className="phase-icon"><Droplets size={19} /></span><h3 className="subtitle">Water</h3></div>
        <div className="water-grid"><Steps steps={plan.water} /></div>
      </section>

      <div className="notice" style={{ marginTop: 24 }}>
        <ShieldAlert size={17} />
        <span>Amounts are a starting point for healthy athletes. Try new foods in training, never on race day. If you have diabetes, a medical condition, or feel dizzy or unwell, talk to a doctor or sports dietitian.</span>
      </div>
    </div>
  )
}
