import { useCallback, useEffect, useRef, useState } from 'react'
import { useVoiceSession, type VoiceSessionState } from './useVoiceSession'
import { buildDriftVoiceInstructions } from '../ai/driftPrompts'
import { getLanguageCode } from '../i18n'

export interface DriftVoiceOptions {
  enabled: boolean
  cueKey: string
  cueText: string | null
  userPartNames: string[]
  onCueRequested?: () => void
}

export interface DriftVoiceState {
  voiceState: VoiceSessionState
  assistantSpeaking: boolean
  cueState: 'idle' | 'waiting' | 'speaking' | 'complete' | 'failed'
  usingDeviceVoice: boolean
  error: string | null
  speak: (text: string) => void
  primeCue: (key: string, text: string) => boolean
}

const CUE_START_TIMEOUT_MS = 8_000
const CUE_FINISH_TIMEOUT_MS = 32_000

// Drift guidance is deliberately one-way. The practice is tap-first and has no
// need to listen to the writer, so passive mode avoids getUserMedia entirely.
// This is also a useful product truth: "spoken guidance" means guidance, not a
// second conversational pipeline competing with the text companion.
export function useDriftVoice({ enabled, cueKey, cueText, userPartNames, onCueRequested }: DriftVoiceOptions): DriftVoiceState {
  const voice = useVoiceSession()
  const voiceRef = useRef(voice)
  const requestedCueRef = useRef<string | null>(null)
  const startedCueRef = useRef<string | null>(null)
  const guidanceFailedRef = useRef(false)
  const fallbackModeRef = useRef(false)
  const remoteFailedRef = useRef(false)
  const localCueRef = useRef<string | null>(null)
  const localTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cueState, setCueState] = useState<DriftVoiceState['cueState']>(() => enabled && cueText ? 'waiting' : 'idle')
  const [usingDeviceVoice, setUsingDeviceVoice] = useState(false)
  const deferCueState = useCallback((next: DriftVoiceState['cueState']) => {
    queueMicrotask(() => setCueState(next))
  }, [])
  const deferDeviceVoice = useCallback((next: boolean) => {
    queueMicrotask(() => setUsingDeviceVoice(next))
  }, [])
  const speakLocally = useCallback((key: string, text: string): boolean => {
    if (typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return false
    try {
      if (localTimeoutRef.current) window.clearTimeout(localTimeoutRef.current)
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = getLanguageCode()
      utterance.rate = 0.82
      utterance.pitch = 0.96
      utterance.volume = 0.9
      localCueRef.current = key
      deferCueState('speaking')
      utterance.onend = () => {
        if (localCueRef.current !== key) return
        if (localTimeoutRef.current) window.clearTimeout(localTimeoutRef.current)
        deferCueState('complete')
      }
      utterance.onerror = () => {
        if (localCueRef.current !== key) return
        localCueRef.current = null
        fallbackModeRef.current = false
        startedCueRef.current = null
        setUsingDeviceVoice(false)
        if (remoteFailedRef.current) {
          guidanceFailedRef.current = true
          deferCueState('failed')
        } else {
          deferCueState('waiting')
        }
      }
      window.speechSynthesis.speak(utterance)
      onCueRequested?.()
      localTimeoutRef.current = window.setTimeout(() => {
        if (localCueRef.current !== key) return
        window.speechSynthesis.cancel()
        localCueRef.current = null
        fallbackModeRef.current = false
        startedCueRef.current = null
        setUsingDeviceVoice(false)
        if (remoteFailedRef.current) {
          guidanceFailedRef.current = true
          deferCueState('failed')
        } else {
          deferCueState('waiting')
        }
      }, CUE_FINISH_TIMEOUT_MS)
      return true
    } catch {
      return false
    }
  }, [deferCueState, onCueRequested])

  // Called directly from the Begin tap. On iOS this user-gesture timing is the
  // most reliable way to unlock spoken output. When device speech is available
  // it becomes Drift's low-latency primary guide; Realtime remains a fallback.
  const primeCue = useCallback((key: string, text: string): boolean => {
    if (!speakLocally(key, text)) return false
    fallbackModeRef.current = true
    requestedCueRef.current = key
    startedCueRef.current = null
    setUsingDeviceVoice(true)
    return true
  }, [speakLocally])
  useEffect(() => { voiceRef.current = voice })

  useEffect(() => {
    if (!enabled || fallbackModeRef.current || remoteFailedRef.current) return
    void voiceRef.current.start({
      instructions: buildDriftVoiceInstructions({ language: getLanguageCode(), userPartNames }),
      passive: true,
    })
    return () => { voiceRef.current.stop() }
  }, [enabled, userPartNames, usingDeviceVoice])

  useEffect(() => {
    if (!enabled && localCueRef.current == null) {
      guidanceFailedRef.current = false
      fallbackModeRef.current = false
      remoteFailedRef.current = false
      localCueRef.current = null
      if (localTimeoutRef.current) window.clearTimeout(localTimeoutRef.current)
      if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel()
    }
    if (guidanceFailedRef.current) {
      requestedCueRef.current = null
      startedCueRef.current = null
      deferCueState('failed')
      return
    }
    if (fallbackModeRef.current && localCueRef.current === cueKey) {
      requestedCueRef.current = cueKey
      return
    }
    // Claim the cue immediately, including while Realtime is connecting, so
    // the start timeout can release the round instead of waiting forever for
    // a connection that never opens.
    requestedCueRef.current = enabled && cueText ? cueKey : null
    startedCueRef.current = null
    deferCueState(enabled && cueText ? 'waiting' : 'idle')
  }, [enabled, cueKey, cueText, deferCueState])

  // A cue is identified by the wave/phase, not just the phase. Repeated set and
  // notice phases therefore speak each new instruction once. Connecting cues
  // are not marked delivered, so they retry as soon as the data channel opens.
  const lastCueKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || fallbackModeRef.current || guidanceFailedRef.current || voice.state !== 'connected' || !cueText || lastCueKeyRef.current === cueKey) return
    lastCueKeyRef.current = cueKey
    requestedCueRef.current = cueKey
    startedCueRef.current = null
    deferCueState('waiting')
    voiceRef.current.speak(cueText)
    onCueRequested?.()
  }, [enabled, cueKey, cueText, voice.state, onCueRequested, deferCueState])

  // Once Realtime has failed, use the device's built-in speech voice for the
  // rest of this practice. Subsequent cues start immediately in fallback mode
  // instead of paying another connection timeout before every round.
  useEffect(() => {
    if (!enabled || !fallbackModeRef.current || guidanceFailedRef.current || !cueText || localCueRef.current === cueKey) return
    if (!speakLocally(cueKey, cueText)) {
      guidanceFailedRef.current = true
      deferCueState('failed')
    }
  }, [enabled, cueKey, cueText, speakLocally, deferCueState])

  // The visual/audio round does not begin until the spoken line has actually
  // finished. Realtime's response.create call is asynchronous, so treating the
  // request itself as delivery let the rhythm start underneath late speech.
  useEffect(() => {
    if (!enabled || fallbackModeRef.current || requestedCueRef.current !== cueKey) return
    if (voice.assistantSpeaking) {
      startedCueRef.current = cueKey
      deferCueState('speaking')
      return
    }
    if (startedCueRef.current === cueKey) {
      deferCueState('complete')
    }
  }, [enabled, cueKey, voice.assistantSpeaking, deferCueState])

  // A failed/late Realtime response must not freeze the practice or arrive in
  // the middle of a later round. Stop the one-way session before releasing the
  // visual timeline, preventing a delayed cue from overlapping the rhythm.
  useEffect(() => {
    if (!enabled || fallbackModeRef.current || requestedCueRef.current !== cueKey || cueState === 'complete' || cueState === 'failed') return
    const timeoutMs = cueState === 'speaking' ? CUE_FINISH_TIMEOUT_MS : CUE_START_TIMEOUT_MS
    const id = window.setTimeout(() => {
      if (requestedCueRef.current !== cueKey) return
      voiceRef.current.stop()
      remoteFailedRef.current = true
      fallbackModeRef.current = true
      setUsingDeviceVoice(true)
      if (!cueText || !speakLocally(cueKey, cueText)) {
        guidanceFailedRef.current = true
        setCueState('failed')
      }
    }, timeoutMs)
    return () => window.clearTimeout(id)
  }, [enabled, cueKey, cueText, cueState, speakLocally])

  useEffect(() => {
    if (!enabled || voice.state !== 'error') return
    voiceRef.current.stop()
    remoteFailedRef.current = true
    fallbackModeRef.current = true
    deferDeviceVoice(true)
    if (!cueText || !speakLocally(cueKey, cueText)) {
      guidanceFailedRef.current = true
      deferCueState('failed')
    }
  }, [enabled, voice.state, cueKey, cueText, deferCueState, deferDeviceVoice, speakLocally])

  useEffect(() => () => {
    if (localTimeoutRef.current) window.clearTimeout(localTimeoutRef.current)
    if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel()
  }, [])

  return {
    voiceState: voice.state,
    assistantSpeaking: voice.assistantSpeaking,
    cueState,
    usingDeviceVoice,
    error: voice.error,
    speak: voice.speak,
    primeCue,
  }
}
