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

export interface SoundscapePrefetchState {
  status: SoundscapeStatus
  url: string | null
  cached: boolean
  errorKind: SoundscapeErrorKind | null
  // The prompt that produced this URL — useful to commit to the relax record
  // alongside the URL when the user clicks Begin.
  resolvedPrompt: string | null
  retry: () => void
}

const DEBOUNCE_MS = 800

export function useSoundscapePrefetch(prompt: string, enabled: boolean): SoundscapePrefetchState {
  const [status, setStatus] = useState<SoundscapeStatus>('idle')
  const [result, setResult] = useState<SoundscapeResult | null>(null)
  const [errorKind, setErrorKind] = useState<SoundscapeErrorKind | null>(null)
  const [resolvedPrompt, setResolvedPrompt] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  const fire = useCallback(async (text: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus('loading')
    setErrorKind(null)
    try {
      const r = await generateSoundscape(text, ctrl.signal)
      if (ctrl.signal.aborted) return
      setResult(r)
      setResolvedPrompt(text)
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
      // Defer the state resets to a microtask so the setState calls don't
      // cascade renders inside the effect body (set-state-in-effect rule).
      queueMicrotask(() => {
        setStatus('idle')
        setResult(null)
        setErrorKind(null)
        setResolvedPrompt(null)
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
    if (status !== 'ready' || !result) return
    const el = document.createElement('audio')
    el.preload = 'auto'
    el.src = result.url
    el.load()
    return () => {
      el.src = ''
    }
  }, [status, result])

  // Abort + clear timers on unmount.
  useEffect(() => () => {
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const retry = useCallback(() => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    void fire(trimmed)
  }, [prompt, fire])

  return {
    status,
    url: result?.url ?? null,
    cached: result?.cached ?? false,
    errorKind,
    resolvedPrompt,
    retry,
  }
}
