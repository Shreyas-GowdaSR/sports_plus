import { useState } from 'react'
import { ArrowRight, Clock, Droplets, Footprints, MessageCircle, Route, Send, Sunrise, Utensils, Zap } from 'lucide-react'
import type { AthleteProfile, PlannedDay } from '../types'
import type { FuelPlan } from '../lib/fuel'
import type { SavedCheck } from '../lib/store'
import { firstName } from '../lib/store'
import { talkFor, verdict } from '../lib/plainTalk'
import { ScoreRing, greeting } from '../components/ui'

type Props = {
  profile: AthleteProfile
  week: PlannedDay[]
  today: number
  plan: FuelPlan
  history: SavedCheck[]
  onFuel: (day?: PlannedDay) => void
  onFormCheck: () => void
  onOpenCheck: (check: SavedCheck) => void
  onAsk: (question: string) => void
  onProfile: () => void
}

const QUICK = ['What should I eat before tomorrow morning\'s run?', 'How much water on a hot day?', 'What should I eat after a long run?']

export function Home({ profile, week, today, plan, history, onFuel, onFormCheck, onOpenCheck, onAsk, onProfile }: Props) {
  const [question, setQuestion] = useState('')
  const day = week[today]
  const latest = history[0]
  const trend = history.slice(0, 8).reverse()
  const first = (steps: FuelPlan['before']) => steps[steps.length > 1 && steps[0].when === 'Night before' ? 1 : 0]

  const beforeStep = first(plan.before)
  const tiles = [
    { icon: Sunrise, title: 'Before', step: beforeStep },
    { icon: Zap, title: 'During', step: plan.during[0] },
    { icon: Utensils, title: 'After', step: plan.after[plan.after.length - 1] },
    { icon: Droplets, title: 'Water', step: plan.water.find(step => step.when === 'During') ?? plan.water[plan.water.length - 1] },
  ]

  return (
    <div className="page">
      {!profile.saved && (
        <div className="banner">
          <p><strong>Set up your profile first.</strong> <span className="muted">Your weight, diet and training time decide every food and water amount in this app.</span></p>
          <button className="btn btn-gold btn-sm" onClick={onProfile}>Set up profile <ArrowRight size={15} /></button>
        </div>
      )}

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1 className="display">{greeting()},<br /><em>{firstName(profile)}.</em></h1>
          <p className="lead">Here is your training for today, and exactly what to eat and drink around it.</p>
        </div>

        <div className="card gilded today-card">
          <div className="today-top">
            <div>
              <span className="eyebrow">Today</span>
              <div className="today-session">{day.title}</div>
              <div className="today-meta">
                {day.minutes > 0 && <span><Clock size={14} /> {day.minutes} min</span>}
                {day.km > 0 && <span><Route size={14} /> {day.km} km</span>}
                <span>{day.detail}</span>
              </div>
            </div>
          </div>
          <div className="fuel-mini">
            {tiles.map(({ icon: Icon, title, step }) => (
              <div key={title}>
                <span><Icon size={13} /> {title}</span>
                <p>{step?.lines[0] ?? '—'}</p>
                {step && step.when !== title && <small>{step.when}</small>}
              </div>
            ))}
          </div>
          <button className="btn btn-gold" onClick={() => onFuel(day)}>See full food &amp; water plan <ArrowRight size={16} /></button>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 28 }}>
        <div className="card-head">
          <div><span className="eyebrow">This week</span><h2 className="title">Your training week</h2></div>
          <span className="faint">{profile.weeklyKm} km planned · tap a day for its food plan</span>
        </div>
        <div className="week">
          {week.map((item, index) => (
            <button key={item.day} className={`day${index === today ? ' today' : ''}`} onClick={() => onFuel(item)}>
              <b>{index === today ? 'Today' : item.day}</b>
              <i className={`kind-bar ${item.kind}`} />
              <strong>{item.title}</strong>
              <small>{item.km ? `${item.km} km · ${item.minutes} min` : item.minutes ? `${item.minutes} min` : 'Rest'}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="split">
        <div className="card">
          <div className="card-head">
            <div><span className="eyebrow">Running form</span><h2 className="title">{latest ? verdict(latest.score).word : 'No form check yet'}</h2></div>
            <button className="btn btn-ghost btn-sm" onClick={onFormCheck}><Footprints size={15} /> New check</button>
          </div>
          {latest ? (
            <>
              <div className="form-summary">
                <ScoreRing score={latest.score} size={120} />
                <div>
                  {(() => {
                    const weakest = [...latest.metrics].sort((a, b) => a.score - b.score)[0]
                    const talk = weakest && talkFor(weakest, latest.view)
                    return talk ? <><span className="label">Fix first</span><p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{talk.name}</p><p className="muted" style={{ margin: '6px 0 0' }}>{talk.fix}</p></> : null
                  })()}
                </div>
              </div>
              {trend.length > 1 && <div className="trend" aria-label="Form score trend">{trend.map(item => <i key={item.id} style={{ height: `${Math.max(10, item.score)}%` }} title={`${item.score}`} />)}</div>}
              <div className="history">
                {history.slice(0, 3).map(item => (
                  <button key={item.id} onClick={() => onOpenCheck(item)}>
                    <span className="score-pill">{item.score}</span>
                    <span>{item.sourceName}<small>{new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></span>
                    <ArrowRight size={15} className="muted" />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div>
              <p className="muted" style={{ marginTop: 0 }}>Record 10–20 seconds of yourself running, from the side. We will show you what to fix, in simple words, with drills.</p>
              <button className="btn btn-gold" onClick={onFormCheck}>Check my form <ArrowRight size={16} /></button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><div><span className="eyebrow">Coach</span><h2 className="title">Ask anything</h2></div><MessageCircle size={20} className="muted" /></div>
          <p className="muted" style={{ marginTop: 0 }}>Food, water, training or form. Coach knows your profile, your week and your last form check.</p>
          <form className="ask-bar" onSubmit={event => { event.preventDefault(); if (question.trim()) onAsk(question.trim()) }}>
            <input value={question} onChange={event => setQuestion(event.target.value)} placeholder="e.g. Can I eat dosa before my run?" aria-label="Ask the coach" />
            <button className="btn btn-gold btn-sm" disabled={!question.trim()} aria-label="Ask"><Send size={15} /></button>
          </form>
          <div className="prompts">{QUICK.map(item => <button key={item} onClick={() => onAsk(item)}>{item}</button>)}</div>
        </div>
      </section>
    </div>
  )
}
