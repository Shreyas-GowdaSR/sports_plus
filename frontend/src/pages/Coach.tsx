import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Send, Sparkles } from 'lucide-react'
import type { AthleteProfile } from '../types'
import type { ChatMessage } from '../lib/coach'
import type { FuelPlan } from '../lib/fuel'
import type { SavedCheck } from '../lib/store'
import { Markdown } from '../components/ui'

type Props = {
  profile: AthleteProfile
  plan: FuelPlan
  latest: SavedCheck | null
  messages: ChatMessage[]
  busy: boolean
  live: boolean
  onSend: (text: string) => void
  onClear: () => void
  onProfile: () => void
}

const STARTERS = [
  'What should I eat 2 hours before my run?',
  'How much water should I drink during a 90 minute run?',
  'What to eat after a hard workout?',
  'What is the one thing I should fix in my running form?',
  'Can I run on an empty stomach in the morning?',
  'I get cramps in long runs. What should I do?',
]

const DIET = { veg: 'Vegetarian', egg: 'Eggetarian', nonveg: 'Non-vegetarian', vegan: 'Vegan' }

export function Coach({ profile, plan, latest, messages, busy, live, onSend, onClear, onProfile }: Props) {
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const last = messages[messages.length - 1]

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy])

  const submit = () => { const value = text.trim(); if (!value || busy) return; setText(''); onSend(value) }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Coach</span>
          <h1 className="display">Your coach,<br /><em>any time.</em></h1>
        </div>
        <span className={`chip${live ? ' gold' : ''}`}><span className={`dot${live ? ' live' : ''}`} />{live ? 'Live AI coach' : 'Offline · answers from your plan'}</span>
      </header>

      <div className="coach">
        <aside className="card knows">
          <span className="eyebrow">Coach knows</span>
          <dl>
            <div><dt>You</dt><dd>{profile.name || 'Name not set'} · {profile.weightKg} kg · {profile.age} yrs</dd></div>
            <div><dt>Food</dt><dd>{DIET[profile.diet]}{profile.avoid.trim() ? ` · no ${profile.avoid.trim()}` : ''}</dd></div>
            <div><dt>Training</dt><dd>{profile.event} · {profile.weeklyKm} km/week</dd></div>
            <div><dt>Today</dt><dd>{plan.label}</dd></div>
            <div><dt>Last form check</dt><dd>{latest ? `${latest.score}/100 on ${new Date(latest.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'None yet'}</dd></div>
          </dl>
          <button className="btn-link" onClick={onProfile}>Update my details</button>
        </aside>

        <section className="card chat">
          <div className="chat-log" ref={logRef} aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-empty">
                <Sparkles size={26} color="var(--gold)" />
                <h2 className="title">How can I help today?</h2>
                <p className="muted">Ask about food, water, training or your running form. I will give you clear amounts and timing.</p>
                <div className="prompts">{STARTERS.map(item => <button key={item} onClick={() => onSend(item)}>{item}</button>)}</div>
              </div>
            ) : messages.map((message, index) => message.role === 'user'
              ? <div className="msg user" key={index}>{message.text}</div>
              : (
                <div className="msg assistant" key={index}>
                  <span className="coach-mark"><Sparkles size={15} /></span>
                  <div>
                    {message.text ? <Markdown text={message.text} /> : <span className="typing"><i /><i /><i /></span>}
                    {message.offline && <div className="msg-meta">Live coach is offline. This answer comes from your saved plan.</div>}
                  </div>
                </div>
              ))}
            {busy && last?.role === 'user' && (
              <div className="msg assistant"><span className="coach-mark"><Sparkles size={15} /></span><span className="typing"><i /><i /><i /></span></div>
            )}
          </div>
          <form className="chat-input" onSubmit={event => { event.preventDefault(); submit() }}>
            {messages.length > 0 && <button type="button" className="icon-btn" onClick={onClear} aria-label="Start a new chat" title="New chat"><RotateCcw size={16} /></button>}
            <textarea rows={1} value={text} placeholder="Type your question…" aria-label="Your question"
              onChange={event => setText(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} />
            <button className="btn btn-gold" disabled={!text.trim() || busy} aria-label="Send"><Send size={16} /></button>
          </form>
        </section>
      </div>
    </div>
  )
}
