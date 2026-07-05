import { useCallback, useEffect, useRef } from 'react'
import { useVoiceSession, type VoiceSessionState } from './useVoiceSession'
import { buildDriftVoiceInstructions } from '../ai/driftPrompts'
import { detectCrisisKeywords } from '../engine/sessionOrchestrator'
import { activateGrounding } from '../store/groundingState'
import { classifyCrisisRisk } from '../ai/openrouter'
import { getLanguageCode } from '../i18n'
import type { DriftPhase } from '../engine/driftEngine'

export interface DriftVoiceOptions {
  enabled: boolean
  phase: DriftPhase
  cueText: string | null // scripted line for the current phase, already localized; null = no cue
  userPartNames: string[]
  onUtterance: (text: string) => void // DriftField routes: choose/baseline/notice submission
  onCrisis: () => void
}

// Realtime adapter for Drift voice mode. The engine still owns all flow; this
// hook only drives the Realtime session: it mutes the mic during BLS sets,
// speaks one scripted cue per phase entry, and applies the same two-layer crisis
// floor as the text path to user transcripts. Direction is NOT parsed from voice
// (spec: conversational) — utterances route through submitNotice(text,'skipped').
export function useDriftVoice(opts: DriftVoiceOptions): { voiceState: VoiceSessionState; assistantSpeaking: boolean } {
  const { enabled, phase, cueText } = opts
  const voice = useVoiceSession()

  // Fresh mirrors for use inside the stable transcript handler / start effect.
  const optsRef = useRef(opts)
  const voiceRef = useRef(voice)
  useEffect(() => { optsRef.current = opts })
  useEffect(() => { voiceRef.current = voice })

  // Stable — captured once by voice.start(); reads fresh opts + voice from refs.
  const onUserTranscript = useCallback((text: string) => {
    const o = optsRef.current
    // L1 deterministic floor.
    if (detectCrisisKeywords(text)) {
      activateGrounding()
      voiceRef.current.cancelResponse()
      o.onCrisis()
      return
    }
    // L2 backstop — risk=2 aborts the spoken response and hands off.
    void classifyCrisisRisk(text, getLanguageCode()).then((r) => {
      if (r.risk === 2) {
        activateGrounding()
        voiceRef.current.cancelResponse()
        o.onCrisis()
      }
    }).catch(() => { /* fails open */ })
    o.onUtterance(text)
  }, [])

  // Start when enabled; stop on disable or unmount.
  useEffect(() => {
    if (!enabled) return
    void voiceRef.current.start({
      instructions: buildDriftVoiceInstructions({ language: getLanguageCode(), userPartNames: optsRef.current.userPartNames }),
      onUserTranscript,
    })
    return () => { voiceRef.current.stop() }
  }, [enabled, onUserTranscript])

  // Mic gating (open except during BLS sets) + one scripted cue per phase entry.
  const lastCuePhaseRef = useRef<DriftPhase | null>(null)
  useEffect(() => {
    if (!enabled) return
    voiceRef.current.setMicEnabled(phase !== 'set')
    if (cueText && lastCuePhaseRef.current !== phase) {
      lastCuePhaseRef.current = phase
      voiceRef.current.speak(cueText)
    }
  }, [enabled, phase, cueText])

  return { voiceState: voice.state, assistantSpeaking: voice.assistantSpeaking }
}
