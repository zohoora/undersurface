import { useCallback, useEffect, useRef, useState } from 'react'
import { generateSoundscape, SoundscapeError, type SoundscapeErrorKind as ApiErrorKind, type SoundscapeResult } from '../api/soundscape'

// Debounced soundscape generation. The state machine:
//   idle → loading → ready | error
// During `loading`, in-flight fetches are aborted on every prompt change so
// we don't waste budget on stale prompts or pile up requests if the user is
// still typing.
//
// Pre-warms a hidden <audio preload="auto"> element with the resulting URL
// once `ready` so the gesture chain on the Begin button has a buffered
// element to play() — critical for iOS Safari, which rejects play() if the
// gesture window has closed before the first audio packet arrives.

export type SoundscapeStatus = 'idle' | 'loading' | 'ready' | 'error'
export type SoundscapeErrorKind = ApiErrorKind

interface ResolvedAudio {
  url: string
  cached: boolean
  prompt: string
}

export interface SoundscapePrefetchState {
  status: SoundscapeStatus
  audio: ResolvedAudio | null
  errorKind: SoundscapeErrorKind | null
  retry: () => void
}

const DEBOUNCE_MS = 800

export function useSoundscapePrefetch(prompt: string, enabled: boolean): SoundscapePrefetchState {
  const [status, setStatus] = useState<SoundscapeStatus>('idle')
  const [audio, setAudio] = useState<ResolvedAudio | null>(null)
  const [errorKind, setErrorKind] = useState<SoundscapeErrorKind | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fire = useCallback(async (text: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus('loading')
    setErrorKind(null)
    try {
      const r: SoundscapeResult = await generateSoundscape(text, ctrl.signal)
      if (ctrl.signal.aborted) return
      setAudio({ url: r.url, cached: r.cached, prompt: text })
      setStatus('ready')
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return
      const kind = err instanceof SoundscapeError ? err.kind : 'unknown'
      setErrorKind(kind)
      setStatus('error')
    }
  }, [])

  // Debounce on prompt change. Reset the panel when prompt is empty or the
  // feature is disabled (e.g. user switched off the 'custom' track).
  useEffect(() => {
    const trimmed = prompt.trim()
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!enabled || trimmed.length === 0) {
      abortRef.current?.abort()
      // Defer state resets to a microtask so setState calls don't cascade
      // renders inside the effect body (set-state-in-effect rule). Also
      // guards against re-firing renders when already idle.
      queueMicrotask(() => {
        setStatus(prev => prev === 'idle' ? prev : 'idle')
        setAudio(prev => prev === null ? prev : null)
        setErrorKind(prev => prev === null ? prev : null)
      })
      return
    }

    timerRef.current = setTimeout(() => {
      void fire(trimmed)
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [prompt, enabled, fire])

  // Pre-warm a hidden <audio> element so iOS Safari has buffered audio
  // ready when the Begin button fires play() in its gesture handler.
  useEffect(() => {
    if (status !== 'ready' || !audio) return
    const el = document.createElement('audio')
    el.preload = 'auto'
    el.src = audio.url
    el.load()
    return () => {
      el.src = ''
    }
  }, [status, audio])

  useEffect(() => () => {
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const retry = useCallback(() => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    void fire(trimmed)
  }, [prompt, fire])

  return { status, audio, errorKind, retry }
}
