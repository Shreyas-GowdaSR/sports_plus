import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Footprints, MessageCircle, TriangleAlert, User, Utensils, X } from 'lucide-react'
import type { RunningAnalysis, Session } from './types'
import { useAthlete, type SavedCheck } from './lib/store'
import { buildFuelPlan, defaultSession } from './lib/fuel'
import { askCoach, coachStatus, offlineAnswer, offlineNotice, type ChatMessage } from './lib/coach'
import { sampleVideo } from './lib/pose'
import { longDistanceRunning } from './lib/running'
import { createRunningReportPdf } from './lib/reportPdf'
import { Landing } from './pages/Landing'
import { Nutrition } from './pages/Nutrition'
import { Coach } from './pages/Coach'
import { FormUpload, Report, SAMPLE } from './pages/FormCheck'
import { Profile } from './pages/Profile'

type Screen = 'landing' | 'form' | 'nutrition' | 'coach' | 'profile'

const TABS: { id: Screen; label: string; icon: typeof Footprints }[] = [
  { id: 'form', label: 'Form check', icon: Footprints },
  { id: 'nutrition', label: 'Nutrition', icon: Utensils },
  { id: 'coach', label: 'AI Coach', icon: MessageCircle },
]

export default function App() {
  const { profile, saveProfile, history, addCheck, clearHistory } = useAthlete()
  const [screen, setScreen] = useState<Screen>('landing')
  const [session, setSession] = useState<Session>(() => defaultSession(profile))
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

  const go = (next: Screen) => { if (next === 'form') setReport(null); setScreen(next) }

  async function analyse(file: File) {
    setError(null); setBusy(true); setProgress(0)
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl(URL.createObjectURL(file))
    try {
      const { samples, duration, aspect } = await sampleVideo(file, setProgress)
      const result = longDistanceRunning.analyse(samples, file.name, duration, aspect)
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
    const context = { profile, plan, latest: history[0] ?? null }
    const controller = new AbortController(); abortRef.current = controller
    try {
      let started = false
      const result = await askCoach(thread, context, reply => {
        if (!started) { started = true; setMessages(current => [...current, { role: 'assistant', text: reply }]) }
        else setMessages(current => [...current.slice(0, -1), { role: 'assistant', text: reply }])
      }, controller.signal)
      if (!result.ok) {
        setLive(false)
        const answer = offlineAnswer(text, context)
        setMessages(current => [...(started ? current.slice(0, -1) : current), { role: 'assistant', text: answer, offline: true, notice: offlineNotice(result) }])
      } else setLive(true)
    } catch {
      /* aborted by "new chat" */
    } finally { setThinking(false); abortRef.current = null }
  }

  function clearChat() { abortRef.current?.abort(); setMessages([]); setThinking(false) }

  const landing = screen === 'landing'

  return (
    <div className={`shell${landing ? ' on-landing' : ''}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => go('landing')} aria-label="SportsAI+ home">
            <span className="brand-mark"><Activity size={16} /></span>
            <span className="brand-name">SportsAI<b>+</b></span>
          </button>
          <nav className="tabs" aria-label="Main">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} className={screen === id ? 'active' : ''} onClick={() => go(id)} aria-current={screen === id ? 'page' : undefined}>
                <Icon size={16} /><span>{label}</span>
              </button>
            ))}
          </nav>
          <button className={`avatar${screen === 'profile' ? ' active' : ''}`} onClick={() => go('profile')} aria-label="Profile" title="Profile"><User size={16} /></button>
        </div>
      </header>

      {error && <div className="toast" role="alert"><TriangleAlert size={18} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss"><X size={16} /></button></div>}

      {busy && (
        <div className="overlay">
          <div className="dialog">
            <div className="spinner" />
            <h2 className="subtitle" style={{ marginTop: 22 }}>Reading your run</h2>
            <div className="progress"><i style={{ width: `${progress}%` }} /></div>
            <span className="faint num">{progress}%</span>
          </div>
        </div>
      )}

      <main>
        {landing && <Landing onFormCheck={() => go('form')} onNutrition={() => go('nutrition')} onCoach={() => go('coach')} />}
        {screen === 'form' && (report
          ? <Report analysis={report} videoUrl={report.id === 'sample' ? null : videoUrl} onBack={() => setReport(null)} onDownload={downloadReport} onAsk={send} />
          : <FormUpload busy={busy} history={history} onFile={analyse} onError={setError} onSample={() => setReport(SAMPLE)} onOpen={check => { setVideoUrl(null); setReport(check) }} />)}
        {screen === 'nutrition' && <Nutrition profile={profile} session={session} plan={plan} onChange={setSession} onAsk={send} onProfile={() => go('profile')} />}
        {screen === 'coach' && <Coach messages={messages} busy={thinking} live={live} onSend={send} onClear={clearChat} />}
        {screen === 'profile' && <Profile profile={profile} checks={history.length} onSave={next => { saveProfile(next); setSession(current => ({ ...current, startTime: next.trainingTime })) }} onClearHistory={clearHistory} />}
      </main>
    </div>
  )
}
