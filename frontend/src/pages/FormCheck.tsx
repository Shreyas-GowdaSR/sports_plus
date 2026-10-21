import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Camera, Clock, Download, Footprints, MessageCircle, Pause, Play, PlayCircle, ScanLine, TriangleAlert, Youtube } from 'lucide-react'
import type { RunningAnalysis } from '../types'
import { Capture } from '../components/Capture'
import { PosePlayback } from '../components/PosePlayback'
import { ScoreRing } from '../components/ui'
import { drillsFor, footStrikeTalk, statusWord, talkFor, verdict, videoLink } from '../lib/plainTalk'
import type { SavedCheck } from '../lib/store'

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

type UploadProps = { busy: boolean; history: SavedCheck[]; onFile: (file: File) => void; onError: (message: string) => void; onSample: () => void; onOpen: (check: SavedCheck) => void }

export function FormUpload({ busy, history, onFile, onError, onSample, onOpen }: UploadProps) {
  return (
    <div className="page narrow">
      <h1 className="page-title">Form check</h1>
      <Capture busy={busy} onFile={onFile} onError={onError} />
      <div className="tip-chips">
        <span><Camera size={15} /> Side view</span>
        <span><Clock size={15} /> 10–20 sec</span>
        <span><ScanLine size={15} /> Head to shoes in frame</span>
      </div>
      <div className="row" style={{ justifyContent: 'center', marginTop: 28 }}>
        <button className="btn-link" onClick={onSample}><PlayCircle size={16} /> View a sample report</button>
      </div>
      {history.length > 0 && (
        <div className="past">
          <span className="label">Past checks</span>
          <div className="past-row">
            {history.slice(0, 6).map(item => (
              <button key={item.id} onClick={() => onOpen(item)}>
                <strong className="num">{item.score}</strong>
                <small>{new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type ReportProps = { analysis: SavedCheck | RunningAnalysis; videoUrl: string | null; onBack: () => void; onDownload: () => void; onAsk: (question: string) => void }

export function Report({ analysis, videoUrl, onBack, onDownload, onAsk }: ReportProps) {
  const ordered = useMemo(() => [...analysis.metrics].sort((a, b) => a.score - b.score), [analysis.metrics])
  const drills = useMemo(() => drillsFor(analysis.metrics), [analysis.metrics])
  const [open, setOpen] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const voice = typeof window !== 'undefined' && 'speechSynthesis' in window
  useEffect(() => () => { if (voice) window.speechSynthesis.cancel() }, [voice])

  if (analysis.readiness === 'limited') return (
    <div className="page narrow center">
      <TriangleAlert size={36} color="var(--watch)" />
      <h1 className="page-title">We couldn't see you clearly</h1>
      <p className="muted">Try a steady side-view video with your whole body in the frame.</p>
      <button className="btn btn-gold" onClick={onBack}>Try again</button>
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
    const utterance = new SpeechSynthesisUtterance(`Your form score is ${analysis.score}. Fix first: ${topTalk.name}. ${topTalk.fix}`)
    utterance.rate = 0.92; utterance.lang = 'en-IN'
    utterance.onend = () => setSpeaking(false); utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); setSpeaking(true)
  }

  return (
    <div className="page">
      <div className="report-top">
        <button className="btn-link" onClick={onBack}><ArrowLeft size={16} /> New check</button>
        <div className="row">
          {voice && <button className="icon-btn" onClick={speak} title={speaking ? 'Stop' : 'Listen'} aria-label={speaking ? 'Stop' : 'Listen'}>{speaking ? <Pause size={16} /> : <Play size={16} />}</button>}
          <button className="icon-btn" onClick={onDownload} title="Download PDF" aria-label="Download PDF"><Download size={16} /></button>
          <button className="btn btn-gold btn-sm" onClick={() => onAsk(`My form check says I should fix my ${topTalk.name.toLowerCase()}. Give me a simple 2-week plan.`)}><MessageCircle size={15} /> Ask coach</button>
        </div>
      </div>

      <section className="report-grid">
        <div className="card score-card">
          <ScoreRing score={analysis.score} size={168} />
          <div className="verdict-word">{v.word}</div>
          {analysis.id === 'sample' && <span className="chip">Sample</span>}
        </div>
        <div className="card player">
          {videoUrl && samples.length ? <PosePlayback videoUrl={videoUrl} samples={samples} /> : (
            <div className="no-video"><Footprints size={30} color="var(--gold)" /></div>
          )}
        </div>
        <div className="card gilded fix-first">
          <span className="eyebrow">Fix first</span>
          <h3>{topTalk.name}</h3>
          <p className="muted">{top.status === 'good' ? topTalk.good : topTalk.issue}</p>
          <p className="fix-do">{topTalk.fix}</p>
        </div>
      </section>

      <section className="checks">
        {ordered.map(metric => {
          const talk = talkFor(metric, analysis.view)
          const expanded = open === metric.id
          return (
            <button className={`check${expanded ? ' open' : ''}`} key={metric.id} onClick={() => setOpen(expanded ? null : metric.id)} aria-expanded={expanded}>
              <div className="check-top"><span>{talk.name}</span><b className="num">{metric.score}</b></div>
              <div className="bar"><i className={metric.status} style={{ width: `${metric.score}%` }} /></div>
              <span className={`status ${metric.status}`}>{statusWord(metric.status)}</span>
              {expanded && <p>{metric.status === 'good' ? talk.good : talk.fix}</p>}
            </button>
          )
        })}
        <div className="check static">
          <div className="check-top"><span>Foot strike</span></div>
          <strong className="strike">{strike.type}</strong>
          <span className={`status ${analysis.footStrike.landing === 'ahead-of-body' ? 'watch' : 'good'}`}>{analysis.footStrike.landing === 'ahead-of-body' ? 'Lands ahead of body' : analysis.footStrike.landing === 'under-body' ? 'Lands under body' : 'Unclear'}</span>
        </div>
      </section>

      <section className="card drills">
        <span className="eyebrow">Drills</span>
        <div className="drill-row">
          {drills.map((drill, index) => (
            <div className="drill" key={drill.name}>
              <span className="drill-num">{String(index + 1).padStart(2, '0')}</span>
              <h4>{drill.name}</h4>
              <span className="chip gold">{drill.dose}</span>
              <p>{drill.how}</p>
              <a className="watch-link" href={videoLink(drill)} target="_blank" rel="noreferrer"><Youtube size={15} /> Watch how</a>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
