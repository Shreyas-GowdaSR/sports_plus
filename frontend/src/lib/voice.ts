import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Speech-to-text with the browser's own Web Speech API (Chrome, Edge, Safari).
 * Chrome sends the audio to Google's speech service to transcribe it; nothing
 * is recorded or stored by this app.
 */

type Alternative = { transcript: string }
type Result = { isFinal: boolean; 0: Alternative; length: number }
type ResultEvent = { resultIndex: number; results: { length: number; [index: number]: Result } }
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((event: ResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
type RecognitionClass = new () => Recognition

const Recognizer: RecognitionClass | undefined = typeof window === 'undefined'
  ? undefined
  : (window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: RecognitionClass }).webkitSpeechRecognition

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone permission was blocked. Allow it in the browser address bar and try again.',
  'service-not-allowed': 'Microphone permission was blocked. Allow it in the browser address bar and try again.',
  'no-speech': 'I did not hear anything. Tap the mic and speak again.',
  'audio-capture': 'No microphone was found.',
  network: 'Voice needs an internet connection.',
}

/**
 * `onText` receives the full text so far (what was in the box before + what was spoken),
 * updating live while the person talks.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const base = useRef('')

  useEffect(() => () => recognition.current?.abort(), [])

  const stop = useCallback(() => recognition.current?.stop(), [])

  const start = useCallback((existing: string) => {
    if (!Recognizer) return
    recognition.current?.abort()
    const engine = new Recognizer()
    engine.lang = 'en-IN'
    engine.continuous = false
    engine.interimResults = true
    base.current = existing.trim() ? `${existing.trim()} ` : ''
    engine.onresult = event => {
      let spoken = ''
      for (let i = 0; i < event.results.length; i++) spoken += event.results[i][0].transcript
      onText(base.current + spoken.trimStart())
    }
    engine.onerror = event => { if (event.error !== 'aborted') setError(ERRORS[event.error] ?? 'Voice input stopped. Please try again.') }
    engine.onend = () => setListening(false)
    recognition.current = engine
    setError(null)
    setListening(true)
    try { engine.start() } catch { setListening(false) }
  }, [onText])

  return { supported: Boolean(Recognizer), listening, error, start, stop, clearError: () => setError(null) }
}
