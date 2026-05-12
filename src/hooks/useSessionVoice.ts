import { useCallback, type RefObject } from 'react'
import { useVoiceSession } from './useVoiceSession'
import { useHrvSession } from './useHrvSession'
import { isGroundingActive } from './useGroundingMode'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { buildTherapistSystemPrompt } from '../ai/therapistPrompts'
import { loadInSessionRelaxBreaks } from '../engine/sessionContextLoader'
import type { TherapistContext } from '../engine/sessionContextLoader'
import type { SessionOrchestrator } from '../engine/sessionOrchestrator'
import { trackEvent } from '../services/analytics'
import type { Session, SessionMessage } from '../types'

export interface SessionVoiceWiring {
  sessionRef: RefObject<Session | null>
  messagesRef: RefObject<SessionMessage[]>
  contextRef: RefObject<TherapistContext | null>
  orchestratorRef: RefObject<SessionOrchestrator>
  setSession: (updater: (prev: Session | null) => Session | null) => void
  setMessages: (next: SessionMessage[]) => void
  appendUserMessage: (content: string, inputMethod?: 'text' | 'voice') => Promise<unknown>
  hrv: ReturnType<typeof useHrvSession>
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
}: SessionVoiceWiring) {
  const voice = useVoiceSession()

  // Therapist-side voice turns are persisted directly — no crisis/emotion/HRV
  // hooks since the realtime model produced the response.
  const persistVoiceTherapistMessage = useCallback(async (content: string) => {
    const currentSession = sessionRef.current
    if (!currentSession || currentSession.status === 'closed') return
    const trimmed = content.trim()
    if (!trimmed) return

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
  }, [sessionRef, messagesRef, orchestratorRef, setSession, setMessages])

  const handleStart = useCallback(async () => {
    const context = contextRef.current
    if (!context) return

    const isFirstTurn = (messagesRef.current ?? []).every(m => m.speaker !== 'therapist')

    const sessionId = sessionRef.current?.id
    const inSessionRelaxBreaks = sessionId ? await loadInSessionRelaxBreaks(sessionId) : []
    const instructions = buildTherapistSystemPrompt({
      phase: sessionRef.current?.phase ?? 'opening',
      recentSessionNotes: context.recentSessionNotes,
      relevantMemories: context.relevantMemories,
      profile: context.userProfile,
      personalFacts: context.personalFacts,
      isGrounding: isGroundingActive(),
      hrvContext: hrv.buildPromptContext(),
      mode: sessionRef.current?.mode ?? 'standard',
      allowRecommendations: true,
      isFirstTurn,
      inSessionRelaxBreaks,
      recentRelaxBreaks: context.recentRelaxBreaks,
    })

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
  }, [voice, hrv, appendUserMessage, persistVoiceTherapistMessage, contextRef, sessionRef, messagesRef])

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
