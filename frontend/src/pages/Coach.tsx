import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Mic, RotateCcw, Sparkles, Square } from 'lucide-react'
import type { ChatMessage } from '../lib/coach'
import { Markdown } from '../components/ui'
import { useVoiceInput } from '../lib/voice'

type Props = { messages: ChatMessage[]; busy: boolean; live: boolean; onSend: (text: string) => void; onClear: () => void }

const STARTERS = [
  'What should I eat before my run?',
  'How much water in a 90 min run?',
  'What to eat after a hard workout?',
  'What should I fix in my form?',
]

export function Coach({ messages, busy, live, onSend, onClear }: Props) {
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const last = messages[messages.length - 1]

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy])

  const voice = useVoiceInput(setText)

  const submit = () => { const value = text.trim(); if (!value || busy) return; voice.stop(); setText(''); onSend(value) }

  return (
    <div className="page narrow coach-page">
      <div className="page-bar">
        <h1 className="page-title">AI Coach</h1>
        <div className="row">
          <span className={`chip${live ? ' gold' : ''}`}><span className={`dot${live ? ' live' : ''}`} />{live ? 'Live' : 'Offline'}</span>
          {messages.length > 0 && <button className="icon-btn" onClick={onClear} aria-label="New chat" title="New chat"><RotateCcw size={15} /></button>}
        </div>
      </div>

      <section className="chat">
        <div className="chat-log" ref={logRef} aria-live="polite">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <span className="coach-orb"><Sparkles size={22} /></span>
              <div className="prompts">{STARTERS.map(item => <button key={item} onClick={() => onSend(item)}>{item}</button>)}</div>
            </div>
          ) : messages.map((message, index) => message.role === 'user'
            ? <div className="msg user" key={index}>{message.text}</div>
            : (
              <div className="msg assistant" key={index}>
                {message.offline && <div className="msg-meta offline-notice">{message.notice ?? 'Offline answer from your plan'}</div>}
                {message.text ? <Markdown text={message.text} /> : <span className="typing"><i /><i /><i /></span>}
              </div>
            ))}
          {busy && last?.role === 'user' && <div className="msg assistant"><span className="typing"><i /><i /><i /></span></div>}
        </div>
        {voice.error && <p className="voice-error" role="alert">{voice.error}</p>}
        <form className={`chat-input${voice.listening ? ' listening' : ''}`} onSubmit={event => { event.preventDefault(); submit() }}>
          <textarea rows={1} value={text} placeholder={voice.listening ? 'Listening… speak now' : 'Ask about food, water, training or form…'} aria-label="Your question"
            onChange={event => { setText(event.target.value); if (voice.error) voice.clearError() }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} />
          {voice.supported && (
            <button type="button" className={`mic${voice.listening ? ' on' : ''}`} disabled={busy}
              onClick={() => (voice.listening ? voice.stop() : voice.start(text))}
              aria-label={voice.listening ? 'Stop listening' : 'Speak your question'} aria-pressed={voice.listening}
              title={voice.listening ? 'Stop listening' : 'Speak your question (uses your browser speech service)'}>
              {voice.listening ? <Square size={14} fill="currentColor" /> : <Mic size={18} />}
            </button>
          )}
          <button className="send" disabled={!text.trim() || busy} aria-label="Send"><ArrowUp size={18} /></button>
        </form>
      </section>
    </div>
  )
}
