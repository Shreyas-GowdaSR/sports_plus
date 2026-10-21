import { useRef, useState } from 'react'
import { Camera, Upload, X } from 'lucide-react'

type Props = { onFile: (file: File) => void; onError: (message: string) => void; busy: boolean }

export function Capture({ onFile, onError, busy }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [drag, setDrag] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream; setCameraOpen(true)
      requestAnimationFrame(() => { if (previewRef.current) previewRef.current.srcObject = stream })
    } catch { onError('Camera permission was not given. You can upload a saved video instead.') }
  }
  const closeCamera = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setRecording(false); setCameraOpen(false)
  }
  const toggleRecording = () => {
    if (!streamRef.current) return
    if (recording) { recorderRef.current?.stop(); return }
    chunksRef.current = []
    const recorder = new MediaRecorder(streamRef.current, { mimeType: MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : undefined })
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
    recorder.onstop = () => { recorderRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setRecording(false); setCameraOpen(false); const file = new File([new Blob(chunksRef.current, { type: recorder.mimeType })], `running-clip-${Date.now()}.webm`, { type: recorder.mimeType }); onFile(file) }
    recorder.start(); recorderRef.current = recorder; setRecording(true)
  }
  const drop = (event: React.DragEvent) => {
    event.preventDefault(); setDrag(false)
    const file = event.dataTransfer.files?.[0]
    if (file && file.type.startsWith('video/')) onFile(file)
    else if (file) onError('Please drop a video file (MP4, MOV or WebM).')
  }

  return <>
    <div className={`upload${drag ? ' drag' : ''}`} onDragOver={event => { event.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={drop}>
      <div className="upload-icon"><Upload size={26} /></div>
      <div>
        <h3 className="subtitle">Drop your running video here</h3>
        <p className="muted" style={{ margin: '8px 0 0' }}>10–20 seconds, filmed from the side. It stays on your phone or laptop.</p>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-gold" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={17} /> Choose video</button>
        <button className="btn btn-ghost" disabled={busy} onClick={openCamera}><Camera size={17} /> Record now</button>
      </div>
      <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file) }} />
    </div>
    {cameraOpen && <div className="overlay" role="dialog" aria-modal="true" aria-label="Record running video">
      <div className="card camera">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div><strong>Keep the phone side-on and still.</strong><div className="faint">Head to feet should stay in the frame as you run past.</div></div>
          <button className="icon-btn" onClick={closeCamera} aria-label="Close camera"><X size={18} /></button>
        </div>
        <video ref={previewRef} autoPlay muted playsInline />
        <button className="btn btn-gold" style={{ width: '100%', marginTop: 14 }} onClick={toggleRecording}>{recording ? 'Stop and check my form' : 'Start recording'}</button>
      </div>
    </div>}
  </>
}
