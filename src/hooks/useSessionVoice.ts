import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useVoiceSession } from './useVoiceSession'
import { isGroundingActive, useGroundingMode } from './useGroundingMode'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { buildTherapistSystemPrompt } from '../ai/therapistPrompts'
import { loadInSessionRelaxBreaks } from '../engine/sessionContextLoader'
import type { TherapistContext } from '../engine/sessionContextLoader'
import type { SessionOrchestrator } from '../engine/sessionOrchestrator'
import { trackEvent } from '../services/analytics'
import type { Session, SessionMessage } from '../types'
import type { BiometricSource } from './useSessionStream'
import type { EnqueueAppend } from './useAppendQueue'

export interface SessionVoiceWiring {
  sessionRef: RefObject<Session | null>
  messagesRef: RefObject<SessionMessage[]>
  contextRef: RefObject<TherapistContext | null>
  orchestratorRef: RefObject<SessionOrchestrator>
  setSession: (updater: (prev: Session | null) => Session | null) => void
  setMessages: (next: SessionMessage[]) => void
  appendUserMessage: (content: string, inputMethod?: 'text' | 'voice') => Promise<unknown>
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

  // Single source of truth for the voice system prompt, reused by handleStart
  // and the mid-session grounding push so the two can never drift.
  const buildInstructions = useCallback(async (grounded: boolean): Promise<string | null> => {
    const context = contextRef.current
    if (!context) return null

    const isFirstTurn = (messagesRef.current ?? []).every(m => m.speaker !== 'therapist')
    const sessionId = sessionRef.current?.id
    const inSessionRelaxBreaks = sessionId ? await loadInSessionRelaxBreaks(sessionId) : []
    const repairContext = getGlobalConfig()?.features?.ruptureRepair === true && isFirstTurn && !grounded
      ? context.repairContext ?? undefined
      : undefined
    // Consume-once, mirroring the text stream: a repair delivered by voice
    // instructions must not repeat in the next session. Best-effort clear.
    if (repairContext) {
      context.repairContext = null
      void db.companionSignals
        .update('current', { pendingRepair: null, updatedAt: Date.now() })
        .catch(() => { /* best-effort */ })
    }
    return buildTherapistSystemPrompt({
      phase: sessionRef.current?.phase ?? 'opening',
      recentSessionNotes: context.recentSessionNotes,
      relevantMemories: context.relevantMemories,
      profile: context.userProfile,
      personalFacts: context.personalFacts,
      isGrounding: grounded,
      hrvContext: hrv.buildPromptContext(),
      mode: sessionRef.current?.mode ?? 'standard',
      allowRecommendations: true,
      isFirstTurn,
      inSessionRelaxBreaks,
      recentRelaxBreaks: context.recentRelaxBreaks,
      // No streaming parser on the voice path — never instruct the realtime
      // model to emit the <<RISK:N>> marker (it could be spoken aloud or
      // persisted into transcripts). Crisis safety on voice rests on
      // SAFETY_RULES plus the L1 regex over user transcripts.
      includeRiskPreamble: false,
      // Rupture repair applies at voice-session start too (instructions are
      // built once; the prompt layer gates it to isFirstTurn + !grounded).
      // Live per-turn signals (pivot/soften) are text-surface-only in v1.
      repairContext,
    })
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

  const handleStart = useCallback(async () => {
    const instructions = await buildInstructions(isGroundingActive())
    if (!instructions) return

    const preferredVoice = getGlobalConfig()?.voice?.defaultVoice ?? 'marin'

    trackEvent('voice_session_started', { session_id: sessionRef.current?.id ?? '' })

    await voice.start({
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
  }, [voice, hrv, appendUserMessage, persistVoiceTherapistMessage, buildInstructions, sessionRef, messagesRef])

  const handleEnd = useCallback(() => {
    voice.stop()
    trackEvent('voice_session_ended', { session_id: sessionRef.current?.id ?? '' })
  }, [voice, sessionRef])

  return {
    state: voice.state,
    error: voice.error,
    muted: voice.muted,
    assistantSpeaking: voice.assistantSpeaking,
    userSpeaking: voice.userSpeaking,
    remoteStream: voice.remoteStream,
    toggleMute: voice.toggleMute,
    stop: voice.stop,
    handleStart,
    handleEnd,
  }
}
