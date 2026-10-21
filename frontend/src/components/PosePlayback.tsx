import { Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Landmark, PoseSample } from '../types'

const connections = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]]
const leftLimb = new Set([11, 13, 15, 23, 25, 27, 31]); const rightLimb = new Set([12, 14, 16, 24, 26, 28, 32])
const LEFT = '#e5765e'; const RIGHT = '#ecd7a4'; const BODY = '#f4efe6'

function colour(from: number, to: number) { if (leftLimb.has(from) && leftLimb.has(to)) return LEFT; if (rightLimb.has(from) && rightLimb.has(to)) return RIGHT; return BODY }

// Pose coordinates are normalized to the source video. Project them into the exact
// letterboxed bounds of the displayed frame so the skeleton remains on the runner.
function drawSkeleton(context: CanvasRenderingContext2D, points: Landmark[], width: number, height: number, video: HTMLVideoElement) {
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight); const offsetX = (width - video.videoWidth * scale) / 2; const offsetY = (height - video.videoHeight * scale) / 2
  const project = (point: Landmark) => ({ x: offsetX + point.x * video.videoWidth * scale, y: offsetY + point.y * video.videoHeight * scale })
  context.save(); context.lineWidth = 3; context.lineCap = 'round'
  connections.forEach(([from, to]) => { if (!points[from] || !points[to]) return; const a = project(points[from]); const b = project(points[to]); context.strokeStyle = colour(from, to); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke() })
  points.forEach((point, index) => { if ((point.visibility ?? 1) < 0.5) return; const p = project(point); context.fillStyle = leftLimb.has(index) ? LEFT : rightLimb.has(index) ? RIGHT : BODY; context.beginPath(); context.arc(p.x, p.y, 3.4, 0, Math.PI * 2); context.fill() })
  context.restore()
}

export function PosePlayback({ videoUrl, samples }: { videoUrl: string; samples: PoseSample[] }) {
  const videoRef = useRef<HTMLVideoElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null)
  const [speed, setSpeed] = useState(0.5); const [playing, setPlaying] = useState(false); const [currentTime, setCurrentTime] = useState(0); const [duration, setDuration] = useState(0)

  useEffect(() => {
    const video = videoRef.current; const canvas = canvasRef.current
    if (!video || !canvas || !samples.length) return
    const render = () => {
      if (!video.videoWidth) return
      const time = video.currentTime * 1000; const sample = samples.reduce((closest, item) => Math.abs(item.timestamp - time) < Math.abs(closest.timestamp - time) ? item : closest, samples[0])
      const context = canvas.getContext('2d'); const width = canvas.clientWidth; const height = canvas.clientHeight
      if (!context || !width || !height) return
      const scale = Math.min(width / video.videoWidth, height / video.videoHeight); const drawWidth = video.videoWidth * scale; const drawHeight = video.videoHeight * scale; const offsetX = (width - drawWidth) / 2; const offsetY = (height - drawHeight) / 2
      canvas.width = width * devicePixelRatio; canvas.height = height * devicePixelRatio; context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      context.fillStyle = '#030305'; context.fillRect(0, 0, width, height)
      // Draw the decoded frame and the landmarks into one canvas so the runner is never left black.
      context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight)
      drawSkeleton(context, sample.landmarks, width, height, video)
    }
    let animationFrame = 0; const drawLoop = () => { render(); animationFrame = requestAnimationFrame(drawLoop) }
    const sync = () => setCurrentTime(video.currentTime); const ready = () => { setDuration(video.duration || 0); video.playbackRate = speed; render() }; const finish = () => setPlaying(false)
    video.addEventListener('timeupdate', sync); video.addEventListener('loadeddata', ready); video.addEventListener('ended', finish); window.addEventListener('resize', render); animationFrame = requestAnimationFrame(drawLoop)
    return () => { cancelAnimationFrame(animationFrame); video.removeEventListener('timeupdate', sync); video.removeEventListener('loadeddata', ready); video.removeEventListener('ended', finish); window.removeEventListener('resize', render) }
  }, [samples, speed])

  const togglePlayback = async () => { const video = videoRef.current; if (!video) return; if (playing) { video.pause(); setPlaying(false) } else { await video.play(); setPlaying(true) } }
  const seek = (value: number) => { if (videoRef.current) videoRef.current.currentTime = value; setCurrentTime(value) }
  const changeSpeed = (value: number) => { if (videoRef.current) videoRef.current.playbackRate = value; setSpeed(value) }
  const restart = () => { seek(0); videoRef.current?.pause(); setPlaying(false) }

  return <div>
    <div className="legend"><span><i style={{ background: LEFT }} />Left side</span><span><i style={{ background: RIGHT }} />Right side</span><span><i style={{ background: BODY }} />Body</span></div>
    <video className="analysis-video-source" ref={videoRef} src={videoUrl} muted playsInline />
    <canvas ref={canvasRef} aria-label="Your running video with the detected body points" style={{ marginTop: 14 }} />
    <div className="player-bar">
      <button className="btn btn-gold btn-sm" onClick={togglePlayback}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}{playing ? 'Pause' : 'Play'}</button>
      <button className="icon-btn" onClick={restart} aria-label="Restart video"><RotateCcw size={15} /></button>
      <input aria-label="Video position" type="range" min="0" max={duration || 0} step="0.01" value={currentTime} onChange={(event) => seek(Number(event.target.value))} />
      <span className="faint num">{currentTime.toFixed(1)}s</span>
      <div className="seg">{[0.25, 0.5, 1].map((value) => <button className={speed === value ? 'on' : ''} onClick={() => changeSpeed(value)} key={value}>{value}×</button>)}</div>
    </div>
  </div>
}
