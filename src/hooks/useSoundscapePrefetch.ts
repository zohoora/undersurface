import { useCallback, useEffect, useRef, useState } from 'react'
import { generateSoundscape, SoundscapeError, type SoundscapeErrorKind as ApiErrorKind, type SoundscapeResult } from '../api/soundscape'

// User-triggered soundscape generation. The user types a prompt, then
// clicks Generate to fetch. Editing the prompt after a successful
// generation invalidates the result (status returns to idle) so the
// user must explicitly regenerate.
//
// Two-step fetch: (1) POST /api/soundscape returns a signed Storage URL;
// (2) we fetch the URL ourselves and wrap the bytes in a Blob URL.
// The <audio> element then plays from the Blob (same-origin, no CSP/CORS
// surprises). Direct signed-URL playback fails Chrome's "URL safety
// check" on cross-origin audio elements — fetch + Blob avoids it
// entirely. The bytes are already needed in the browser anyway, so the
// extra hop is fine.

export type SoundscapeStatus = 'idle' | 'loading' | 'ready' | 'error'
export type SoundscapeErrorKind = ApiErrorKind

interface ResolvedAudio {
  url: string
  cached: boolean
  prompt: string
}

function revokeBlobRef(prev: ResolvedAudio | null) {
  if (prev?.url.startsWith('blob:')) {
    try { URL.revokeObjectURL(prev.url) } catch { /* noop */ }
  }
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
        setAudio(prev => {
          revokeBlobRef(prev)
          return prev === null ? prev : null
        })
        setErrorKind(prev => prev === null ? prev : null)
      })
      return
    }
    const stale = status === 'ready' && audio !== null && audio.prompt !== trimmed
    const editingClearsError = status === 'error'
    if (stale || editingClearsError) {
      queueMicrotask(() => {
        setStatus('idle')
        setAudio(prev => {
          revokeBlobRef(prev)
          return null
        })
        setErrorKind(null)
      })
    }
  }, [trimmed, enabled, status, audio])

  const generate = useCallback(async () => {
    if (!enabled || !trimmed) return
    abortRef.current?.abort()
    revokeBlobRef(audio)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus('loading')
    setErrorKind(null)
    try {
      const r: SoundscapeResult = await generateSoundscape(trimmed, ctrl.signal)
      if (ctrl.signal.aborted) return
      // Fetch the audio bytes and wrap in a Blob URL — direct <audio src=
      // signedUrl> trips Chrome's URL safety check; same-origin Blob
      // URLs play cleanly.
      const audioRes = await fetch(r.url, { signal: ctrl.signal })
      if (!audioRes.ok) throw new SoundscapeError('provider', `audio fetch ${audioRes.status}`)
      const blob = await audioRes.blob()
      if (ctrl.signal.aborted) return
      const blobUrl = URL.createObjectURL(blob)
      setAudio({ url: blobUrl, cached: r.cached, prompt: trimmed })
      setStatus('ready')
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return
      const kind = err instanceof SoundscapeError ? err.kind : 'unknown'
      setErrorKind(kind)
      setStatus('error')
    }
  }, [trimmed, enabled, audio])

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
    revokeBlobRef(audio)
  // Intentionally only run on unmount; the audio dep would otherwise revoke
  // a still-active Blob URL on every state update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canGenerate = enabled && trimmed.length > 0 && status !== 'loading'

  return { status, audio, errorKind, canGenerate, generate }
}
