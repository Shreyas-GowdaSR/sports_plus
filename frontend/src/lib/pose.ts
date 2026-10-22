import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Landmark, PoseSample } from '../types'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
// The heavy model is slower, but preserves hands, feet, and occluded limbs more reliably
// than the full model in side-on running footage.
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'

let landmarker: PoseLandmarker | null = null

async function getLandmarker() {
  if (landmarker) return landmarker
  // Keep the sizeable vision runtime out of the initial dashboard bundle.
  const { FilesetResolver, PoseLandmarker: PoseLandmarkerRuntime } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(WASM_URL)
  landmarker = await PoseLandmarkerRuntime.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.62, minPosePresenceConfidence: 0.62, minTrackingConfidence: 0.62,
  })
  return landmarker
}

const waitFor = (target: EventTarget, event: string) => new Promise<void>((resolve, reject) => {
  target.addEventListener(event, () => resolve(), { once: true })
  target.addEventListener('error', () => reject(new Error('The selected video could not be decoded.')), { once: true })
})

export async function sampleVideo(file: File, onProgress: (percentage: number) => void): Promise<{ samples: PoseSample[]; duration: number; aspect: number }> {
  const video = document.createElement('video')
  video.muted = true; video.playsInline = true; video.preload = 'auto'
  const objectUrl = URL.createObjectURL(file)
  try {
    video.src = objectUrl
    await waitFor(video, 'loadedmetadata')
    const duration = video.duration
    if (!Number.isFinite(duration) || duration < 2) throw new Error('Choose a video that is at least two seconds long.')
    const detector = await getLandmarker()
    // Sample at 60 Hz so the contact detector can distinguish a planted foot from
    // a swing-frame. A 60+ fps source is still recommended: sampling cannot invent
    // frames that are absent from the original clip.
    const interval = 1000 / 60
    const samples: PoseSample[] = []
    for (let timestamp = 0; timestamp < duration * 1000; timestamp += interval) {
      video.currentTime = timestamp / 1000
      await waitFor(video, 'seeked')
      const result = detector.detectForVideo(video, timestamp)
      const landmarks = (result.landmarks?.[0] ?? []) as Landmark[]
      if (landmarks.length) {
        const confidence = landmarks.reduce((sum, point) => sum + (point.visibility ?? 1), 0) / landmarks.length
        samples.push({ timestamp, landmarks, confidence })
      }
      onProgress(Math.round((timestamp / (duration * 1000)) * 100))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    onProgress(100)
    return { samples, duration, aspect: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1 }
  } finally { URL.revokeObjectURL(objectUrl); video.remove() }
}
