import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useVoiceSession } from './useVoiceSession'
import { isGroundingActive, useGroundingMode } from './useGroundingMode'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { buildVoiceCompanionInstructions, consumeVoiceRepair } from '../ai/voiceInstructions'
import { loadInSessionRelaxBreaks } from '../engine/sessionContextLoader'
import type { TherapistContext } from '../engine/sessionContextLoader'
import type { SessionOrchestrator } from '../engine/sessionOrchestrator'
import { trackEvent } from '../services/analytics'
import type { Session, SessionMessage } from '../types'
import type { BiometricSource } from './useSessionStream'
import type { EnqueueAppend } from '../engine/sessionRuntime'

export interface SessionVoiceWiring {
  sessionRef: RefObject<Session | null>
  messagesRef: RefObject<SessionMessage[]>
  contextRef: RefObject<TherapistContext | null>
  orchestratorRef: RefObject<SessionOrchestrator>
  setSession: (updater: (prev: Session | null) => Session | null) => void
  setMessages: (next: SessionMessage[]) => void
  appendUserMessage: (content: string, inputMethod?: 'text' | 'voice', surface?: SessionMessage['surface']) => Promise<unknown>
  hrv: BiometricSource
  enqueueAppend: EnqueueAppend
}

// Bundles all voice-session concerns: starting/stopping the realtime channel,
// persisting both sides of the transcript, and forwarding HRV events. The
// chat-side text path lives in SessionView; this hook is only the spoken loop.
// User-side voice turns delegate to `appendUserMessage` (shared with text), so
// crisis/emotion/HRV side effects fire once regardless of input modality.
export function useSessionVoice({
  sessionRef,
  messagesRef,
  contextRef,
  orchestratorRef,
  setSession,
  setMessages,
  appendUserMessage,
  hrv,
  enqueueAppend,
}: SessionVoiceWiring) {
  const voice = useVoiceSession()

  // Therapist-side voice turns are persisted directly — no crisis/emotion/HRV
  // hooks since the realtime model produced the response.
  const persistVoiceTherapistMessage = useCallback(async (content: string) => {
    const currentSession = sessionRef.current
    if (!currentSession || currentSession.status === 'closed') return
    const trimmed = content.trim()
    if (!trimmed) return

    // Serialized: the realtime API can deliver a user transcript and this
    // assistant transcript near-simultaneously — unserialized, both would read
    // the same base array and one message would be lost. Read fresh in-queue.
    await enqueueAppend(async () => {
      const currentMessages = messagesRef.current
      const phase = orchestratorRef.current.detectPhase(currentMessages)
      const message: SessionMessage = {
        id: generateId(),
        speaker: 'therapist',
        partId: null,
        partName: null,
        content: trimmed,
        timestamp: Date.now(),
        phase,
        isEmergence: false,
        inputMethod: 'voice',
        surface: 'speak',
      }

      await sessionMessagesDb.add(currentSession.id, message)

      const updatedMessages = [...currentMessages, message]
      const firstLine = currentSession.firstLine || trimmed.slice(0, 100)

      await db.sessions.update(currentSession.id, {
        messageCount: updatedMessages.length,
        firstLine,
        phase,
      })

      setSession(prev => prev ? { ...prev, messageCount: updatedMessages.length, firstLine, phase } : prev)
      setMessages(updatedMessages)
      messagesRef.current = updatedMessages
    })
  }, [sessionRef, messagesRef, orchestratorRef, setSession, setMessages, enqueueAppend])

  // Single source of truth for the voice system prompt (shared with Room via
  // buildVoiceCompanionInstructions), reused by handleStart and the
  // mid-session grounding push so the two can never drift.
  const buildInstructions = useCallback(async (grounded: boolean): Promise<string | null> => {
    const context = contextRef.current
    if (!context) return null
    const sessionId = sessionRef.current?.id
    const inSessionRelaxBreaks = sessionId ? await loadInSessionRelaxBreaks(sessionId) : []
    const { instructions, usedRepair } = buildVoiceCompanionInstructions({
      context,
      session: sessionRef.current,
      messages: messagesRef.current ?? [],
      grounded,
      hrvContext: hrv.buildPromptContext(),
      features: getGlobalConfig()?.features,
      inSessionRelaxBreaks,
    })
    if (usedRepair) consumeVoiceRepair(context)
    return instructions
  }, [contextRef, sessionRef, messagesRef, hrv])

  // The load-bearing invariant "distress disables Real Talk, no exceptions"
  // was previously enforced only per-prompt on the text path. Voice built its
  // instructions once at start with isGrounding frozen, so a Real Talk voice
  // session kept its confrontational persona through a detected crisis. When
  // grounding activates while a session is live, rebuild grounded instructions
  // (which flip Real Talk → THERAPIST_CORE) and push them into the running
  // realtime session. One push per grounding episode.
  const isGrounding = useGroundingMode()
  const groundedPushedRef = useRef(false)
  useEffect(() => {
    if (!isGrounding) {
      groundedPushedRef.current = false
      return
    }
    if (voice.state !== 'connected' || groundedPushedRef.current) return
    groundedPushedRef.current = true
    void buildInstructions(true).then(instructions => {
      if (instructions) voice.sendSessionUpdate({ instructions })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGrounding, voice.state])

  // A Speak start awaits its instructions before voice.start() runs. Report
  // that window as 'connecting' so callers never see 'idle' mid-start (the
  // Speak surface used to snap back to Talk during it — TECH_ISSUES #33),
  // and let stop() cancel a start that has not reached voice.start() yet.
  const [starting, setStarting] = useState(false)
  const startSeqRef = useRef(0)
  const voiceStart = voice.start
  const voiceStop = voice.stop

  const handleStart = useCallback(async () => {
    const seq = ++startSeqRef.current
    setStarting(true)
    try {
      const instructions = await buildInstructions(isGroundingActive())
      if (!instructions || seq !== startSeqRef.current) return

      const preferredVoice = getGlobalConfig()?.voice?.defaultVoice ?? 'marin'

      trackEvent('voice_session_started', { session_id: sessionRef.current?.id ?? '' })

      await voiceStart({
        instructions,
        voice: preferredVoice,
        onUserTranscript: (text) => {
          void appendUserMessage(text, 'voice')
        },
        onAssistantTranscript: (text) => {
          void persistVoiceTherapistMessage(text)
        },
        onAssistantSpeakingChange: (speaking) => {
          if (hrv.enabled) {
            hrv.addConversationEvent(
              speaking ? 'ai_response_start' : 'ai_response_complete',
              messagesRef.current.length,
            )
          }
        },
      })
    } finally {
      if (seq === startSeqRef.current) setStarting(false)
    }
  }, [voiceStart, hrv, appendUserMessage, persistVoiceTherapistMessage, buildInstructions, sessionRef, messagesRef])

  // Stopping also cancels a start still awaiting its instructions.
  const stop = useCallback(() => {
    startSeqRef.current++
    setStarting(false)
    voiceStop()
  }, [voiceStop])

  const handleEnd = useCallback(() => {
    stop()
    trackEvent('voice_session_ended', { session_id: sessionRef.current?.id ?? '' })
  }, [stop, sessionRef])

  return {
    state: starting && voice.state === 'idle' ? 'connecting' as const : voice.state,
    error: voice.error,
    muted: voice.muted,
    assistantSpeaking: voice.assistantSpeaking,
    userSpeaking: voice.userSpeaking,
    remoteStream: voice.remoteStream,
    toggleMute: voice.toggleMute,
    stop,
    handleStart,
    handleEnd,
  }
}
