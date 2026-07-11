import { useEffect, useRef } from 'react'
import { useVoiceSession, type VoiceSessionState } from './useVoiceSession'
import { buildDriftVoiceInstructions } from '../ai/driftPrompts'
import { getLanguageCode } from '../i18n'

export interface DriftVoiceOptions {
  enabled: boolean
  cueKey: string
  cueText: string | null
  userPartNames: string[]
}

export interface DriftVoiceState {
  voiceState: VoiceSessionState
  assistantSpeaking: boolean
  error: string | null
  speak: (text: string) => void
}

// Drift guidance is deliberately one-way. The practice is tap-first and has no
// need to listen to the writer, so passive mode avoids getUserMedia entirely.
// This is also a useful product truth: "spoken guidance" means guidance, not a
// second conversational pipeline competing with the text companion.
export function useDriftVoice({ enabled, cueKey, cueText, userPartNames }: DriftVoiceOptions): DriftVoiceState {
  const voice = useVoiceSession()
  const voiceRef = useRef(voice)
  useEffect(() => { voiceRef.current = voice })

  useEffect(() => {
    if (!enabled) return
    void voiceRef.current.start({
      instructions: buildDriftVoiceInstructions({ language: getLanguageCode(), userPartNames }),
      passive: true,
    })
    return () => { voiceRef.current.stop() }
  }, [enabled, userPartNames])

  // A cue is identified by the wave/phase, not just the phase. Repeated set and
  // notice phases therefore speak each new instruction once. Connecting cues
  // are not marked delivered, so they retry as soon as the data channel opens.
  const lastCueKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || voice.state !== 'connected' || !cueText || lastCueKeyRef.current === cueKey) return
    lastCueKeyRef.current = cueKey
    voiceRef.current.speak(cueText)
  }, [enabled, cueKey, cueText, voice.state])

  return {
    voiceState: voice.state,
    assistantSpeaking: voice.assistantSpeaking,
    error: voice.error,
    speak: voice.speak,
  }
}
