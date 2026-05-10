import { useCallback, useEffect, useRef, useState } from 'react'
import { generateSoundscape, SoundscapeError, type SoundscapeErrorKind as ApiErrorKind, type SoundscapeResult } from '../api/soundscape'

// User-triggered soundscape generation. The user types a prompt, then
// clicks Generate to fetch. Editing the prompt after a successful
// generation invalidates the result (status returns to idle) so the
// user must explicitly regenerate.
//
// Pre-warms a hidden <audio preload="auto"> element with the resulting
// URL once `ready` so the gesture chain on the Begin button has a buffered
// element to play() — critical for iOS Safari, which rejects play() if
// the gesture window has closed before the first audio packet arrives.

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
  // True when a generation can be triggered from the current state
  // (prompt non-empty, not currently loading, and result is stale or absent).
  canGenerate: boolean
  generate: () => void
}

export function useSoundscapePrefetch(prompt: string, enabled: boolean): SoundscapePrefetchState {
  const [status, setStatus] = useState<SoundscapeStatus>('idle')
  const [audio, setAudio] = useState<ResolvedAudio | null>(null)
  const [errorKind, setErrorKind] = useState<SoundscapeErrorKind | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const trimmed = prompt.trim()

  // Reset to idle when:
  // - the feature is disabled (panel switched away from 'custom')
  // - the prompt is cleared
  // - the prompt has been edited since the last successful generation
  // - we're in error state (editing the prompt clears the error)
  useEffect(() => {
    if (!enabled || trimmed.length === 0) {
      abortRef.current?.abort()
      queueMicrotask(() => {
        setStatus(prev => prev === 'idle' ? prev : 'idle')
        setAudio(prev => prev === null ? prev : null)
        setErrorKind(prev => prev === null ? prev : null)
      })
      return
    }
    const stale = status === 'ready' && audio !== null && audio.prompt !== trimmed
    const editingClearsError = status === 'error'
    if (stale || editingClearsError) {
      queueMicrotask(() => {
        setStatus('idle')
        setAudio(null)
        setErrorKind(null)
      })
    }
  }, [trimmed, enabled, status, audio])

  const generate = useCallback(async () => {
    if (!enabled || !trimmed) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus('loading')
    setErrorKind(null)
    try {
      const r: SoundscapeResult = await generateSoundscape(trimmed, ctrl.signal)
      if (ctrl.signal.aborted) return
      setAudio({ url: r.url, cached: r.cached, prompt: trimmed })
      setStatus('ready')
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return
      const kind = err instanceof SoundscapeError ? err.kind : 'unknown'
      setErrorKind(kind)
      setStatus('error')
    }
  }, [trimmed, enabled])

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
  }, [])

  const canGenerate = enabled && trimmed.length > 0 && status !== 'loading'

  return { status, audio, errorKind, canGenerate, generate }
}
