import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, Footprints, Info, MessageCircle, Pause, Play, PlayCircle, TriangleAlert } from 'lucide-react'
import type { RunningAnalysis } from '../types'
import { Capture } from '../components/Capture'
import { PosePlayback } from '../components/PosePlayback'
import { ScoreRing } from '../components/ui'
import { drillsFor, footStrikeTalk, statusWord, talkFor, verdict } from '../lib/plainTalk'
import type { SavedCheck } from '../lib/store'

const TIPS = [
  'Film from the side, with the phone still (use a wall or a friend).',
  'Run past at your normal easy pace for 10–20 seconds.',
  'Your whole body, head to shoes, should be in the video.',
  'Good daylight, one runner only, plain background if possible.',
]

export const SAMPLE: SavedCheck = {
  id: 'sample', createdAt: new Date().toISOString(), sourceName: 'Sample easy run', duration: 14, confidence: 91, score: 76, readiness: 'ready', view: 'side', viewConfidence: 89,
  metrics: [
    { id: 'posture', label: 'Trunk position', score: 86, status: 'good', value: '7.2° from vertical', description: '', cue: '' },
    { id: 'pelvis', label: 'Pelvic stability', score: 71, status: 'watch', value: '27.7% vertical oscillation', description: '', cue: '' },
    { id: 'footPlacement', label: 'Contact placement', score: 58, status: 'focus', value: '0.92× torso length ahead', description: '', cue: '' },
    { id: 'head', label: 'Head & neck', score: 82, status: 'good', value: '0.25× torso offset', description: '', cue: '' },
    { id: 'armSwing', label: 'Arm swing', score: 79, status: 'watch', value: '101° elbow · 0.24× travel', description: '', cue: '' },
    { id: 'symmetry', label: 'Stride symmetry', score: 83, status: 'good', value: '0.63 relative gap', description: '', cue: '' },
  ],
  footStrike: { classification: 'midfoot', confidence: 78, contacts: 14, message: '', landing: 'ahead-of-body', landingConfidence: 74 },
  notes: [],
}

type UploadProps = { busy: boolean; onFile: (file: File) => void; onError: (message: string) => void; onSample: () => void }

export function FormUpload({ busy, onFile, onError, onSample }: UploadProps) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Form check</span>
          <h1 className="display">See how you run.<br /><em>Fix one thing at a time.</em></h1>
          <p className="lead">Upload a short side-view video. The check runs on your device; your video is never uploaded.</p>
        </div>
      </header>
      <div className="split">
        <Capture busy={busy} onFile={onFile} onError={onError} />
        <div className="card">
          <span className="eyebrow">For a good result</span>
          <ul className="tips" style={{ marginTop: 14 }}>{TIPS.map((tip, index) => <li key={tip}><span>{index + 1}</span>{tip}</li>)}</ul>
          <hr className="rule" />
          <button className="btn-link" onClick={onSample}><PlayCircle size={16} /> See a sample report first</button>
        </div>
      </div>
    </div>
  )
}

type ReportProps = { analysis: SavedCheck | RunningAnalysis; videoUrl: string | null; athlete: string; onBack: () => void; onDownload: () => void; onAsk: (question: string) => void }

export function Report({ analysis, videoUrl, athlete, onBack, onDownload, onAsk }: ReportProps) {
  const ordered = useMemo(() => [...analysis.metrics].sort((a, b) => a.score - b.score), [analysis.metrics])
  const drills = useMemo(() => drillsFor(analysis.metrics), [analysis.metrics])
  const [speaking, setSpeaking] = useState(false)
  const voice = typeof window !== 'undefined' && 'speechSynthesis' in window
  useEffect(() => () => { if (voice) window.speechSynthesis.cancel() }, [voice])

  if (analysis.readiness === 'limited') return (
    <div className="page" style={{ maxWidth: 720, textAlign: 'center' }}>
      <TriangleAlert size={40} color="var(--watch)" />
      <h1 className="display" style={{ fontSize: 48 }}>We couldn't see you clearly.</h1>
      {analysis.notes.map(note => <p className="muted" key={note}>{note}</p>)}
      <button className="btn btn-gold" style={{ marginTop: 16 }} onClick={onBack}>Try another video</button>
    </div>
  )

  const v = verdict(analysis.score)
  const top = ordered[0]
  const topTalk = talkFor(top, analysis.view)
  const strike = footStrikeTalk(analysis)
  const samples = 'samples' in analysis ? analysis.samples : []

  const speak = () => {
    if (!voice) return
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return }
    const script = [`Your form score is ${analysis.score}. ${v.line}`, `Fix first: ${topTalk.name}. ${topTalk.issue} ${topTalk.fix}`, 'Work on one thing at a time, and stop if you feel pain.'].join(' ')
    const utterance = new SpeechSynthesisUtterance(script); utterance.rate = 0.92; utterance.lang = 'en-IN'
    utterance.onend = () => setSpeaking(false); utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); setSpeaking(true)
  }

  return (
    <div className="page">
      <button className="btn-link" onClick={onBack} style={{ marginBottom: 24 }}><ArrowLeft size={16} /> New form check</button>

      <section className="card gilded report-hero">
        <ScoreRing score={analysis.score} size={150} />
        <div>
          <span className="eyebrow">{analysis.id === 'sample' ? 'Sample report' : `${athlete ? `${athlete} · ` : ''}${new Date(analysis.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`}</span>
          <div className="verdict-word">{v.word}</div>
          <p className="muted" style={{ margin: 0, maxWidth: 520 }}>{v.line}</p>
        </div>
        <div className="report-actions">
          {voice && <button className="btn btn-ghost btn-sm" onClick={speak}>{speaking ? <Pause size={15} /> : <Play size={15} />}{speaking ? 'Stop' : 'Listen'}</button>}
          <button className="btn btn-ghost btn-sm" onClick={onDownload}><Download size={15} /> PDF report</button>
          <button className="btn btn-gold btn-sm" onClick={() => onAsk(`My form check says I should fix my ${topTalk.name.toLowerCase()}. Explain it simply and give me a 2-week practice plan.`)}><MessageCircle size={15} /> Ask coach</button>
        </div>
      </section>

      <section className="split" style={{ marginTop: 20 }}>
        <div className="card player">
          {videoUrl && samples.length ? <PosePlayback videoUrl={videoUrl} samples={samples} /> : (
            <div className="no-video">
              <div><Footprints size={30} color="var(--gold)" /><p className="subtitle" style={{ marginTop: 12 }}>{analysis.id === 'sample' ? 'Upload your own video to see your body points here.' : 'Video is not saved, only the results.'}</p></div>
            </div>
          )}
        </div>
        <div className="card fix-first">
          <span className="eyebrow">Fix this first</span>
          <h3>{topTalk.name}</h3>
          <div><span className="label">What we saw</span><p style={{ margin: 0 }}>{top.status === 'good' ? topTalk.good : topTalk.issue}</p></div>
          <div><span className="label">What to do</span><p style={{ margin: 0 }}>{topTalk.fix}</p></div>
          <div className="notice"><Info size={16} /><span>Practise this cue during 2–3 easy runs a week. Check your form again after 2 weeks.</span></div>
        </div>
      </section>

      <div className="row" style={{ justifyContent: 'space-between', margin: '48px 0 20px' }}>
        <div><span className="eyebrow">All checks</span><h2 className="title">What the video showed</h2></div>
      </div>
      <section className="grid g3">
        {ordered.map(metric => {
          const talk = talkFor(metric, analysis.view)
          return (
            <article className="card check" key={metric.id}>
              <div className="check-top"><strong>{talk.name}</strong><b className="num">{metric.score}</b></div>
              <div className="bar"><i className={metric.status} style={{ width: `${metric.score}%` }} /></div>
              <span className={`status ${metric.status}`}>{statusWord(metric.status)}</span>
              <p>{metric.status === 'good' ? talk.good : talk.issue}</p>
              <details><summary>Measured: {metric.value}</summary></details>
            </article>
          )
        })}
      </section>

      <section className="grid g2" style={{ marginTop: 20 }}>
        <div className="card">
          <span className="eyebrow">Foot landing</span>
          <h3 className="title">{strike.type}</h3>
          <p>{strike.landing}</p>
          <p className="faint" style={{ margin: 0 }}>{strike.note}</p>
        </div>
        <div className="card">
          <span className="eyebrow">Drills · next 2 weeks</span>
          <div style={{ marginTop: 18 }}>
            {drills.map((drill, index) => (
              <div className="drill" key={drill.name}>
                <span className="drill-num">{String(index + 1).padStart(2, '0')}</span>
                <div><h4>{drill.name} <span className="faint">· {drill.dose}</span></h4><p>{drill.how}</p></div>
              </div>
            ))}
          </div>
          <p className="faint" style={{ marginBottom: 0 }}>Do these 2–3 days a week, before an easy run. Stop if anything hurts.</p>
        </div>
      </section>

      <div className="notice" style={{ marginTop: 24 }}><Info size={16} /><span>This is a video-based check from body points, not a medical test. If you have pain, see a doctor or physio.</span></div>
    </div>
  )
}
