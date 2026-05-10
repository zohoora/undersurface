import { useCallback, useEffect, useRef, useState } from 'react'
import { db, generateId } from '../store/db'
import { acquireWakeLock, reacquireWakeLockIfVisible, releaseWakeLock } from '../native/keepAwake'
import { nextNarrationCue } from '../engine/relaxEngine'
import { buildRelaxInstructions } from '../ai/relaxPrompts'
import { updateSettings } from '../store/settings'
import { getGlobalConfig } from '../store/globalConfig'
import { useVoiceSession } from './useVoiceSession'
import type { HrvMeasurement, RelaxAudioTrack, RelaxSession, RelaxSessionType, RelaxVisualMode } from '../types'

export type RelaxState = 'idle' | 'settings' | 'calibrating' | 'guiding' | 'ending'

// Hard ceiling on calibration — if the signal is still poor after 60s, we
// proceed to guiding with no biofeedback rather than blocking the experience.
// In practice the HRV engine clears its own ~30s calibration well before this.
const CALIBRATION_HARD_MS = 60_000

// Coherence smoothing alpha. 0.35 gives ~3-measurement convergence (~15s).
const COHERENCE_ALPHA = 0.35
// Re-render threshold — skip setState when the new smoothed value is within
// this distance of the previous one. Keeps the breath circle props stable
// at steady state.
const COHERENCE_RERENDER_EPSILON = 0.01

const ENDING_DISPLAY_MS = 5_000

export interface RelaxHrvInput {
  enabled: boolean
  calibrating: boolean
  latest: HrvMeasurement | null
  // Optional fields used by RelaxField's top biometrics bar. Defaults below
  // make HRV feedback feature-detection cheap for callers that don't wire
  // these (e.g. tests, headless renders).
  error?: string | null
  measurementCount?: number
  toggle?: () => void
  // True when the admin feature flag is on (regardless of whether the user
  // has consented or started the engine yet). When false, the biometrics
  // bar / enable button is suppressed entirely.
  available?: boolean
}

export interface RelaxSettings {
  duration: 5 | 10 | 20  // minutes
  sessionType: RelaxSessionType
  audioTrack: RelaxAudioTrack
  audioVolume: number  // 0..1
  voiceEnabled: boolean
  visualMode: RelaxVisualMode
  // Populated when audioTrack === 'custom'. Both come from the panel's
  // soundscape prefetch (which has already resolved a signed Storage URL
  // and pre-warmed the audio buffer in a hidden element).
  customAudioUrl?: string
  customAudioPrompt?: string
}

export interface UseRelaxSessionResult {
  state: RelaxState
  settings: RelaxSettings | null
  elapsedMs: number
  durationMs: number
  audioMuted: boolean
  voiceMuted: boolean
  smoothedCoherence: number | null

  open: () => void
  cancel: () => void
  begin: (settings: RelaxSettings) => Promise<void>
  end: () => void
  toggleAudio: () => void
  toggleVoice: () => void
  cycleVisual: () => void
}

const STATIC_AUDIO_PATHS: Partial<Record<RelaxAudioTrack, string>> = {
  ocean: '/audio/ocean.mp3',
  forest: '/audio/forest.mp3',
  drone: '/audio/drone.mp3',
  binaural: '/audio/binaural.mp3',
}

// Resolve the audio URL for a given settings snapshot. Static tracks point
// to the bundled MP3s in /public/audio/; the 'custom' track returns the
// signed URL pre-fetched by the settings panel. Returns null when there's
// no audio to play (silence or missing custom URL).
function resolveAudioSrc(s: RelaxSettings): string | null {
  if (s.audioTrack === 'none') return null
  if (s.audioTrack === 'custom') return s.customAudioUrl ?? null
  return STATIC_AUDIO_PATHS[s.audioTrack] ?? null
}

// Voice ducking — when the realtime narration speaks, the soundscape gain
// drops to this floor for clarity, then ramps back to 1.0.
const DUCKING_GAIN = 0.3
const DUCK_ATTACK_S = 0.15
const DUCK_RELEASE_S = 0.6

interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext
}

export function useRelaxSession(
  parentSessionId: string | null,
  hrv: RelaxHrvInput = { enabled: false, calibrating: false, latest: null },
): UseRelaxSessionResult {
  const [state, setState] = useState<RelaxState>('idle')
  const [settings, setSettings] = useState<RelaxSettings | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [audioMuted, setAudioMuted] = useState(false)
  const [voiceMuted, setVoiceMuted] = useState(false)
  const [smoothedCoherence, setSmoothedCoherence] = useState<number | null>(null)

  const voice = useVoiceSession()

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioGainRef = useRef<GainNode | null>(null)
  const startedAtRef = useRef<number>(0)
  const pausedTotalRef = useRef<number>(0)
  const lastHiddenAtRef = useRef<number | null>(null)
  const lastCueAtRef = useRef<number>(-1)
  const recordIdRef = useRef<string | null>(null)
  const stateRef = useRef<RelaxState>('idle')
  const calibrationStartedAtRef = useRef<number | null>(null)
  const startSnapshotRef = useRef<{ coherence: number | null; hr: number | null } | null>(null)
  const hrvSamplesCountRef = useRef(0)
  const lastAssistantSpeakingRef = useRef(false)

  useEffect(() => { stateRef.current = state }, [state])

  const durationMs = settings ? settings.duration * 60_000 : 0

  const open = useCallback(() => setState('settings'), [])
  const cancel = useCallback(() => {
    setState('idle')
    setSettings(null)
  }, [])

  const stopAudio = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.src = ''
      audioRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => { /* noop */ })
      audioCtxRef.current = null
    }
    audioGainRef.current = null
  }, [])

  // Drop soundscape gain when narration starts; ramp back when it ends.
  // Web Audio scheduling beats CSS/setTimeout because the AudioContext clock
  // is sample-accurate and immune to JS event-loop jitter.
  const duckAudio = useCallback(() => {
    const ctx = audioCtxRef.current
    const gain = audioGainRef.current
    if (!ctx || !gain) return
    const now = ctx.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(DUCKING_GAIN, now + DUCK_ATTACK_S)
  }, [])

  const unduckAudio = useCallback(() => {
    const ctx = audioCtxRef.current
    const gain = audioGainRef.current
    if (!ctx || !gain) return
    const now = ctx.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(1.0, now + DUCK_RELEASE_S)
  }, [])

  const end = useCallback(() => {
    if (stateRef.current !== 'guiding' && stateRef.current !== 'calibrating') return
    setState('ending')
    stopAudio()
    voice.stop()
    void releaseWakeLock()

    const id = recordIdRef.current
    if (id) {
      const reachedPlanned = elapsedMs >= durationMs
      const start = startSnapshotRef.current
      const endLatest = hrv.latest
      const hrvSummary = (start && hrv.enabled) ? {
        startCoherence: start.coherence,
        endCoherence: endLatest?.derived?.coherence ?? null,
        startHr: start.hr,
        endHr: endLatest?.hr ?? null,
        samplesCount: hrvSamplesCountRef.current,
      } : null
      void db.relaxSessions.update(id, {
        endedAt: Date.now(),
        completed: reachedPlanned,
        hrvSummary,
      })
    }

    setTimeout(() => {
      if (stateRef.current === 'ending') {
        setState('idle')
        setSettings(null)
      }
    }, ENDING_DISPLAY_MS)
  }, [elapsedMs, durationMs, stopAudio, voice, hrv.enabled, hrv.latest])

  const enterGuiding = useCallback(() => {
    startedAtRef.current = Date.now()
    pausedTotalRef.current = 0
    lastHiddenAtRef.current = null
    setElapsedMs(0)
    if (hrv.enabled && hrv.latest) {
      startSnapshotRef.current = {
        coherence: hrv.latest.derived?.coherence ?? null,
        hr: hrv.latest.hr,
      }
    } else {
      startSnapshotRef.current = null
    }
    setState('guiding')
  }, [hrv.enabled, hrv.latest])

  // begin() must be called inside a user gesture — audio.play() and wake
  // lock both require a direct gesture chain. Audio + voice start are
  // fire-and-forget; the breath circle should appear immediately rather
  // than waiting for the realtime handshake (which can take 500-2000ms).
  const begin = useCallback(async (s: RelaxSettings) => {
    // Defensive: if an earlier begin() left an audio element hanging (e.g.
    // play() rejected on retry), pause it before allocating a new one.
    stopAudio()

    setSettings(s)
    setAudioMuted(false)
    setVoiceMuted(!s.voiceEnabled)
    setElapsedMs(0)
    setSmoothedCoherence(null)
    hrvSamplesCountRef.current = 0
    pausedTotalRef.current = 0
    lastHiddenAtRef.current = null
    lastCueAtRef.current = -1

    updateSettings({
      lastRelaxDuration: s.duration,
      lastRelaxType: s.sessionType,
      lastRelaxAudio: s.audioTrack,
      lastRelaxAudioVolume: s.audioVolume,
      lastRelaxVoiceEnabled: s.voiceEnabled,
      lastRelaxVisualMode: s.visualMode,
      ...(s.audioTrack === 'custom' && s.customAudioPrompt ? { lastRelaxCustomPrompt: s.customAudioPrompt } : {}),
    })

    const audioPath = resolveAudioSrc(s)
    if (audioPath) {
      const el = new Audio(audioPath)
      el.loop = true
      el.volume = s.audioVolume
      // CORS attribute is required for Web Audio routing of cross-origin
      // audio (the signed Storage URL is a different origin from our app).
      // Without this, the AudioContext source becomes silent for security.
      el.crossOrigin = 'anonymous'
      audioRef.current = el

      // If voice is on, we want to duck — route the element through a gain
      // node so we can ramp it during narration. If voice is off, skip the
      // Web Audio overhead and let the element play directly.
      if (s.voiceEnabled) {
        const w = window as WindowWithWebkit
        const Ctx = window.AudioContext ?? w.webkitAudioContext
        if (Ctx) {
          try {
            const ctx = new Ctx()
            const source = ctx.createMediaElementSource(el)
            const gain = ctx.createGain()
            gain.gain.value = 1.0
            source.connect(gain).connect(ctx.destination)
            audioCtxRef.current = ctx
            audioGainRef.current = gain
            // Some browsers start the context suspended until a gesture
            // resolves — begin() runs inside the gesture, so resuming here
            // is safe.
            if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* noop */ })
          } catch (err) {
            console.warn('[relax] Web Audio routing failed; falling back to direct playback', err)
          }
        }
      }

      el.play().catch(err => console.warn('[relax] audio play failed', err))
    }

    if (s.voiceEnabled) {
      const instructions = buildRelaxInstructions({
        sessionType: s.sessionType,
        durationMinutes: s.duration,
      })
      const preferredVoice = getGlobalConfig()?.voice?.defaultVoice ?? 'marin'
      void voice.start({ instructions, voice: preferredVoice, passive: true })
        .catch(err => console.warn('[relax] voice.start failed', err))
    }

    void acquireWakeLock()

    const id = generateId()
    recordIdRef.current = id
    const record: RelaxSession = {
      id,
      parentSessionId,
      startedAt: Date.now(),
      endedAt: null,
      sessionType: s.sessionType,
      duration: s.duration,
      audioTrack: s.audioTrack,
      voiceEnabled: s.voiceEnabled,
      visualMode: s.visualMode,
      customAudioPrompt: s.audioTrack === 'custom' ? s.customAudioPrompt ?? null : null,
      // The signed URL expires; we don't persist it. The hash isn't known
      // here yet (we only have the URL); the panel could pass it through if
      // we want it on the Firestore record — wired in a follow-up if needed.
      customAudioHash: null,
      completed: false,
      hrvSummary: null,
    }
    void db.relaxSessions.add(record)

    if (hrv.enabled && hrv.calibrating) {
      calibrationStartedAtRef.current = Date.now()
      setState('calibrating')
    } else {
      enterGuiding()
    }
  }, [parentSessionId, voice, hrv.enabled, hrv.calibrating, enterGuiding, stopAudio])

  // Calibrating → guiding transition. Two paths: (a) the HRV engine reports
  // calibrating=false (got a baseline), or (b) the hard ceiling is hit.
  // Deferred via microtask to avoid set-state-in-effect.
  useEffect(() => {
    if (state !== 'calibrating') return
    const startedAt = calibrationStartedAtRef.current ?? Date.now()
    const elapsed = Date.now() - startedAt
    const transition = () => {
      if (stateRef.current === 'calibrating') enterGuiding()
    }

    if (!hrv.calibrating || !hrv.enabled) {
      queueMicrotask(transition)
      return
    }
    const remainingHard = CALIBRATION_HARD_MS - elapsed
    if (remainingHard <= 0) {
      queueMicrotask(transition)
      return
    }
    const id = setTimeout(transition, remainingHard)
    return () => clearTimeout(id)
  }, [state, hrv.calibrating, hrv.enabled, enterGuiding])

  // Coherence smoothing. The same-value bailout (returning prev unchanged)
  // skips React re-renders at steady state — important when the breath
  // circle would otherwise re-render every 5s for ε movement.
  useEffect(() => {
    if (state !== 'guiding') return
    const c = hrv.latest?.derived?.coherence ?? null
    if (c === null) return
    hrvSamplesCountRef.current += 1
    queueMicrotask(() => {
      setSmoothedCoherence(prev => {
        if (prev === null) return c
        const next = prev * (1 - COHERENCE_ALPHA) + c * COHERENCE_ALPHA
        return Math.abs(next - prev) < COHERENCE_RERENDER_EPSILON ? prev : next
      })
    })
  }, [hrv.latest, state])

  useEffect(() => {
    if (state !== 'guiding') return
    const tick = () => {
      if (lastHiddenAtRef.current !== null) return
      const now = Date.now()
      const elapsed = now - startedAtRef.current - pausedTotalRef.current
      setElapsedMs(elapsed)
      if (elapsed >= durationMs) {
        end()
        return
      }
      // Cue dispatch — directly call voice.speak() when the engine schedules
      // a new cue. lastCueAtRef debounces so each cue fires once. If voice
      // isn't connected yet at cue time, we drop the cue rather than queue
      // (cues are time-anchored to the script).
      if (settings?.voiceEnabled) {
        const cue = nextNarrationCue(settings.sessionType, elapsed, lastCueAtRef.current)
        if (cue) {
          lastCueAtRef.current = cue.atMs
          if (!voiceMuted && voice.state === 'connected') {
            voice.speak(cue.text)
          }
        }
      }
    }
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [state, settings, voiceMuted, voice, durationMs, end])

  // Duck the soundscape while the voice narration is speaking. Watches
  // the realtime API's assistantSpeaking flag (true while audio frames are
  // arriving), not the cue dispatch — gives sample-accurate timing.
  useEffect(() => {
    if (state !== 'guiding') return
    const speaking = voice.assistantSpeaking
    if (speaking && !lastAssistantSpeakingRef.current) {
      duckAudio()
    } else if (!speaking && lastAssistantSpeakingRef.current) {
      unduckAudio()
    }
    lastAssistantSpeakingRef.current = speaking
  }, [voice.assistantSpeaking, state, duckAudio, unduckAudio])

  useEffect(() => {
    if (state !== 'guiding') return
    const onVisibility = () => {
      if (document.hidden) {
        if (lastHiddenAtRef.current === null) {
          lastHiddenAtRef.current = Date.now()
        }
      } else if (lastHiddenAtRef.current !== null) {
        pausedTotalRef.current += Date.now() - lastHiddenAtRef.current
        lastHiddenAtRef.current = null
        void reacquireWakeLockIfVisible()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [state])

  useEffect(() => {
    const el = audioRef.current
    if (el) el.muted = audioMuted
  }, [audioMuted])

  // Cleanup on unmount. If the user navigates away mid-guidance, persist an
  // early-end so the record has a definite endedAt rather than dangling.
  // useVoiceSession has its own teardown so we don't call voice.stop() here.
  useEffect(() => () => {
    if (stateRef.current === 'guiding' && recordIdRef.current) {
      void db.relaxSessions.update(recordIdRef.current, {
        endedAt: Date.now(),
        completed: false,
      })
    }
    stopAudio()
    void releaseWakeLock()
  }, [stopAudio])

  const toggleAudio = useCallback(() => setAudioMuted(prev => !prev), [])
  const toggleVoice = useCallback(() => setVoiceMuted(prev => !prev), [])
  const cycleVisual = useCallback(() => {
    setSettings(prev => {
      if (!prev) return prev
      const next: RelaxVisualMode = prev.visualMode === 'full' ? 'minimal'
        : prev.visualMode === 'minimal' ? 'off'
        : 'full'
      return { ...prev, visualMode: next }
    })
  }, [])

  return {
    state,
    settings,
    elapsedMs,
    durationMs,
    audioMuted,
    voiceMuted,
    smoothedCoherence,
    open,
    cancel,
    begin,
    end,
    toggleAudio,
    toggleVoice,
    cycleVisual,
  }
}
