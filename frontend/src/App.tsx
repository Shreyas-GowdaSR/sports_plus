import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Footprints, House, MessageCircle, TriangleAlert, Utensils, X } from 'lucide-react'
import type { PlannedDay, RunningAnalysis, Session } from './types'
import { useAthlete, firstName, type SavedCheck } from './lib/store'
import { sessionFor, todayIndex, weekPlan } from './lib/week'
import { buildFuelPlan } from './lib/fuel'
import { askCoach, coachStatus, offlineAnswer, type ChatMessage } from './lib/coach'
import { sampleVideo } from './lib/pose'
import { longDistanceRunning } from './lib/running'
import { createRunningReportPdf } from './lib/reportPdf'
import { Home } from './pages/Home'
import { Fuel } from './pages/Fuel'
import { Coach } from './pages/Coach'
import { FormUpload, Report, SAMPLE } from './pages/FormCheck'
import { Profile } from './pages/Profile'

type Screen = 'home' | 'form' | 'fuel' | 'coach' | 'profile'

const NAV: { id: Screen; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Today', icon: House },
  { id: 'fuel', label: 'Food & water', icon: Utensils },
  { id: 'form', label: 'Form check', icon: Footprints },
  { id: 'coach', label: 'Coach', icon: MessageCircle },
]

export default function App() {
  const { profile, saveProfile, history, addCheck, clearHistory } = useAthlete()
  const [screen, setScreen] = useState<Screen>(() => (profile.saved ? 'home' : 'profile'))
  const week = useMemo(() => weekPlan(profile), [profile])
  const today = todayIndex()
  const [session, setSession] = useState<Session>(() => sessionFor(weekPlan(profile)[todayIndex()], profile))
  const plan = useMemo(() => buildFuelPlan(profile, session), [profile, session])

  // Form check
  const [report, setReport] = useState<SavedCheck | RunningAnalysis | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Coach
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [thinking, setThinking] = useState(false)
  const [live, setLive] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { void coachStatus().then(status => setLive(status.live)) }, [])
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [screen, report])
  // A new profile changes today's planned session (e.g. weekly distance); keep the Fuel page in step.
  useEffect(() => { setSession(current => ({ ...sessionFor(week[today], profile), weather: current.weather })) }, [week, today, profile])

  const go = (next: Screen) => { if (next === 'form') setReport(null); setScreen(next) }

  async function analyse(file: File) {
    setError(null); setBusy(true); setProgress(0)
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl(URL.createObjectURL(file))
    try {
      const { samples, duration } = await sampleVideo(file, setProgress)
      const result = longDistanceRunning.analyse(samples, file.name, duration)
      result.sourceName = `Run on ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
      if (result.readiness === 'ready') addCheck(result)
      setReport(result); setScreen('form')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this video. Please try another one.')
    } finally { setBusy(false) }
  }

  function downloadReport() {
    if (!report) return
    const url = URL.createObjectURL(createRunningReportPdf(report, profile.name))
    const link = document.createElement('a'); link.href = url; link.download = `sportsai-form-report-${report.id}.pdf`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function send(text: string) {
    if (thinking) return
    const thread = [...messages, { role: 'user' as const, text }]
    setMessages(thread); setThinking(true); setScreen('coach')
    const context = { profile, plan, week, latest: history[0] ?? null }
    const controller = new AbortController(); abortRef.current = controller
    try {
      let started = false
      const ok = await askCoach(thread, context, reply => {
        if (!started) { started = true; setMessages(current => [...current, { role: 'assistant', text: reply }]) }
        else setMessages(current => [...current.slice(0, -1), { role: 'assistant', text: reply }])
      }, controller.signal)
      if (!ok) {
        setLive(false)
        const answer = offlineAnswer(text, context)
        setMessages(current => [...(started ? current.slice(0, -1) : current), { role: 'assistant', text: answer, offline: true }])
      } else setLive(true)
    } catch {
      /* aborted by "new chat" */
    } finally { setThinking(false); abortRef.current = null }
  }
  function clearChat() { abortRef.current?.abort(); setMessages([]); setThinking(false) }

  function fuelFor(day?: PlannedDay) {
    if (day) setSession(current => ({ ...sessionFor(day, profile), weather: current.weather }))
    setScreen('fuel')
  }

  const initials = (profile.name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2) || 'Me').toUpperCase()

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => go('home')} aria-label="SportsAI+ home">
            <span className="brand-mark"><Activity size={17} /></span>
            <span className="brand-name">SportsAI<b>+</b></span>
          </button>
          <nav className="nav" aria-label="Main">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button key={id} className={screen === id ? 'active' : ''} onClick={() => go(id)} aria-current={screen === id ? 'page' : undefined}>
                <Icon size={16} />{label}
              </button>
            ))}
          </nav>
          <button className={`avatar${screen === 'profile' ? ' active' : ''}`} onClick={() => go('profile')} aria-label={`Profile of ${firstName(profile)}`} title="Profile">{initials}</button>
        </div>
      </header>

      {error && <div className="toast" role="alert"><TriangleAlert size={18} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss"><X size={16} /></button></div>}

      {busy && (
        <div className="overlay">
          <div className="card dialog">
            <div className="spinner" />
            <span className="eyebrow" style={{ marginTop: 22 }}>Checking your form</span>
            <h2 className="title">Reading your running…</h2>
            <p className="muted">This happens on your device. Your video is not uploaded.</p>
            <div className="progress"><i style={{ width: `${progress}%` }} /></div>
            <span className="faint num">{progress}%</span>
          </div>
        </div>
      )}

      <main style={{ flex: 1 }}>
        {screen === 'home' && <Home profile={profile} week={week} today={today} plan={buildFuelPlan(profile, sessionFor(week[today], profile))} history={history}
          onFuel={fuelFor} onFormCheck={() => go('form')} onOpenCheck={check => { setVideoUrl(null); setReport(check); setScreen('form') }} onAsk={send} onProfile={() => go('profile')} />}
        {screen === 'fuel' && <Fuel profile={profile} session={session} plan={plan} onChange={setSession} onAsk={send} />}
        {screen === 'form' && (report
          ? <Report analysis={report} videoUrl={report.id === 'sample' ? null : videoUrl} athlete={profile.name} onBack={() => setReport(null)} onDownload={downloadReport} onAsk={send} />
          : <FormUpload busy={busy} onFile={analyse} onError={setError} onSample={() => setReport(SAMPLE)} />)}
        {screen === 'coach' && <Coach profile={profile} plan={plan} latest={history[0] ?? null} messages={messages} busy={thinking} live={live} onSend={send} onClear={clearChat} onProfile={() => go('profile')} />}
        {screen === 'profile' && <Profile profile={profile} checks={history.length} onSave={next => { saveProfile(next); if (!profile.saved) setScreen('home') }} onClearHistory={clearHistory} />}
      </main>

      <footer className="footer">SportsAI+ is a coaching aid. It does not diagnose injury or replace a doctor, physio or dietitian.</footer>
    </div>
  )
}
