import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useSettings } from '../store/settings'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../store/db'
import { buildTherapistMessages } from '../ai/therapistPrompts'
import { streamChatCompletion, reasoningForSpeed } from '../ai/openrouter'
import { loadInSessionRelaxBreaks } from '../engine/sessionContextLoader'
import type { TherapistContext } from '../engine/sessionContextLoader'
import { isGroundingActive } from './useGroundingMode'
import { getWeatherEngine } from '../store/weatherStore'
import { useTranslation, getLanguageCode } from '../i18n'
import type { useTypewriter } from './useTypewriter'
import type { useHrvSession } from './useHrvSession'
import type { SessionOrchestrator } from '../engine/sessionOrchestrator'
import type { Session, SessionMessage, SessionPhase, EmotionalTone } from '../types'

function isFirstTherapistTurn(messages: SessionMessage[]): boolean {
  return messages.every(m => m.speaker !== 'therapist')
}

export interface SessionStreamWiring {
  sessionRef: RefObject<Session | null>
  messagesRef: RefObject<SessionMessage[]>
  contextRef: RefObject<TherapistContext | null>
  orchestratorRef: RefObject<SessionOrchestrator>
  setSession: Dispatch<SetStateAction<Session | null>>
  setMessages: Dispatch<SetStateAction<SessionMessage[]>>
  setIsStreaming: Dispatch<SetStateAction<boolean>>
  setOpenerError: Dispatch<SetStateAction<string | null>>
  hrv: ReturnType<typeof useHrvSession>
  typewriter: ReturnType<typeof useTypewriter>
}

export interface AppendUserMessageResult {
  updatedMessages: SessionMessage[]
  firstLine: string
  phase: SessionPhase
}

// Owns the message-lifecycle side of a session: writing therapist + user
// turns to Firestore, streaming the model's tokens through the typewriter,
// and the load-bearing crisis-detection race (L2 classifier fires in
// parallel with token streaming; risk=2 returning before first token aborts
// the stream and retries with grounding flipped on).
export function useSessionStream(wiring: SessionStreamWiring) {
  const {
    sessionRef, messagesRef, contextRef, orchestratorRef,
    setSession, setMessages, setIsStreaming, setOpenerError,
    hrv, typewriter,
  } = wiring
  const settings = useSettings()
  const tr = useTranslation()
  const weatherEngine = getWeatherEngine()

  // Returns the updated messages array after the therapist message is finalized.
  //
  // Crisis-detection race: on the first attempt, fires the L2 classifier in
  // parallel with therapist generation. If risk=2 returns before the
  // therapist's first token arrives, the in-flight stream is aborted and a
  // single retry runs with the now-flipped grounding state — so the user
  // sees a grounded response rather than a Real Talk callout or whatever
  // the original prompt would have produced. After first token has arrived,
  // the response finishes (already constrained by SAFETY_RULES) and grounding
  // takes effect on the next turn.
  const generateTherapistMessage = useCallback(async (
    currentMessages: SessionMessage[],
    currentSession: Session,
  ): Promise<SessionMessage[]> => {
    setIsStreaming(true)
    setOpenerError(null)

    const orchestrator = orchestratorRef.current
    const lastUserMessage = [...currentMessages].reverse().find(m => m.speaker === 'user')

    // Up to 3 total attempts to get non-empty content. The therapist sometimes
    // emits zero content tokens — model exhausts its budget on internal reasoning,
    // refusal returns blank, transient OpenAI hiccup. Retrying papers over most
    // cases without the user ever seeing a blank bubble.
    const MAX_EMPTY_ATTEMPTS = 3

    for (let emptyAttempt = 0; emptyAttempt < MAX_EMPTY_ATTEMPTS; emptyAttempt++) {
      let crisisLoopResult: SessionMessage[] | null = null

      // Inner loop: original + one crisis-grounded retry.
      for (let attempt = 0; attempt < 2; attempt++) {
        const phase = orchestrator.detectPhase(currentMessages)
        const maxTokens = orchestrator.getMaxTokens(phase)

        const context = contextRef.current
        const hrvContext = hrv.buildPromptContext()
        // Per-turn refresh of in-session relax breaks (cheap query). Lets the
        // therapist see breaks that happened mid-conversation without
        // reloading the entire context.
        const inSessionRelaxBreaks = currentSession.id
          ? await loadInSessionRelaxBreaks(currentSession.id)
          : []
        const promptMessages = buildTherapistMessages(currentMessages, {
          phase,
          recentSessionNotes: context?.recentSessionNotes,
          relevantMemories: context?.relevantMemories,
          profile: context?.userProfile,
          personalFacts: context?.personalFacts,
          isGrounding: isGroundingActive(),
          hrvContext,
          mode: currentSession.mode ?? 'standard',
          allowRecommendations: true,
          isFirstTurn: isFirstTherapistTurn(currentMessages),
          inSessionRelaxBreaks,
          recentRelaxBreaks: context?.recentRelaxBreaks,
        })

        typewriter.reset()

        let resolveMessages: (messages: SessionMessage[]) => void
        const messagesPromise = new Promise<SessionMessage[]>(resolve => {
          resolveMessages = resolve
        })

        const finalizeMessage = async (fullText: string) => {
          // Empty content — don't commit a blank bubble. Outer loop decides
          // whether to retry or surface as an error.
          if (!fullText.trim()) {
            console.warn('[chat] empty completion received, will retry if budget allows')
            typewriter.reset()
            resolveMessages(currentMessages)
            return
          }

          const msgId = generateId()
          const newMessage: SessionMessage = {
            id: msgId,
            speaker: 'therapist',
            partId: null,
            partName: null,
            content: fullText.trim(),
            timestamp: Date.now(),
            phase,
            isEmergence: false,
          }

          await sessionMessagesDb.add(currentSession.id, newMessage)

          const updatedMessages = [...currentMessages, newMessage]
          const newMessageCount = updatedMessages.length
          const firstLine = currentSession.firstLine || fullText.trim().slice(0, 100)

          await db.sessions.update(currentSession.id, {
            messageCount: newMessageCount,
            firstLine,
            phase,
          })

          setSession(prev => prev ? {
            ...prev,
            messageCount: newMessageCount,
            firstLine,
            phase,
          } : prev)
          setMessages(updatedMessages)
          messagesRef.current = updatedMessages
          setIsStreaming(false)
          typewriter.reset()
          resolveMessages(updatedMessages)
        }

        hrv.resetResponseStarted()

        const crisisAbortController = new AbortController()
        let firstTokenArrived = false
        let crisisAborted = false

        // Fire L2 only on the first crisis attempt of the first empty-attempt.
        // Re-running it on subsequent retries would waste calls; if it already
        // returned risk=2, grounding is already active for the retry prompt.
        if (emptyAttempt === 0 && attempt === 0 && lastUserMessage) {
          orchestrator.checkCrisisRisk(lastUserMessage.content, getLanguageCode())
            .then(result => {
              if (result.risk === 2 && !firstTokenArrived && !crisisAborted) {
                crisisAborted = true
                crisisAbortController.abort()
              }
            })
            .catch(() => { /* fail-open inside checkCrisisRisk */ })
        }

        await streamChatCompletion(
          promptMessages,
          {
            onToken: (token) => {
              firstTokenArrived = true
              typewriter.appendToken(token)
              if (hrv.enabled && hrv.markResponseStarted()) {
                hrv.addConversationEvent('ai_response_start', currentMessages.length)
              }
            },
            onComplete: () => {
              typewriter.setOnComplete(finalizeMessage)
              if (hrv.enabled) {
                hrv.addConversationEvent('ai_response_complete', currentMessages.length)
              }
            },
            onError: (error) => {
              if (crisisAborted) return
              console.error('Session stream error:', error)
              typewriter.reset()
              resolveMessages(currentMessages)
            },
          },
          maxTokens,
          reasoningForSpeed(settings.responseSpeed),
          crisisAbortController.signal,
        )

        if (crisisAborted) continue

        crisisLoopResult = await messagesPromise
        break
      }

      if (!crisisLoopResult) {
        setIsStreaming(false)
        return currentMessages
      }

      // A new message landed — non-empty path, return.
      if (crisisLoopResult.length > currentMessages.length) {
        return crisisLoopResult
      }

      // Empty completion. Brief backoff before next attempt.
      if (emptyAttempt < MAX_EMPTY_ATTEMPTS - 1) {
        console.warn(`[chat] empty completion, retry ${emptyAttempt + 1}/${MAX_EMPTY_ATTEMPTS - 1}`)
        await new Promise(resolve => setTimeout(resolve, 500 + emptyAttempt * 300))
      }
    }

    console.error('[chat] all empty-completion retries exhausted')
    setOpenerError(tr['session.error.therapistUnreachable'])
    setIsStreaming(false)
    return currentMessages
  }, [
    contextRef, messagesRef, orchestratorRef,
    setSession, setMessages, setIsStreaming, setOpenerError,
    hrv, typewriter, settings.responseSpeed, tr,
  ])

  // Persist a user-authored message (text or voice) and run the synchronous
  // side effects: HRV event, crisis-keyword check, async emotion/weather update.
  // Returns the updated message list + computed firstLine so callers can chain
  // (text path immediately calls generateTherapistMessage; voice path doesn't).
  const appendUserMessage = useCallback(async (
    content: string,
    inputMethod?: 'text' | 'voice',
  ): Promise<AppendUserMessageResult | null> => {
    const currentSession = sessionRef.current
    if (!currentSession || currentSession.status === 'closed') return null
    const trimmed = content.trim()
    if (!trimmed) return null

    const currentMessages = messagesRef.current
    const phase = orchestratorRef.current.detectPhase(currentMessages)
    const userMessage: SessionMessage = {
      id: generateId(),
      speaker: 'user',
      partId: null,
      partName: null,
      content: trimmed,
      timestamp: Date.now(),
      phase,
      isEmergence: false,
      ...(inputMethod === 'voice' && { inputMethod }),
    }

    await sessionMessagesDb.add(currentSession.id, userMessage)

    if (hrv.enabled) {
      hrv.addConversationEvent('user_message', currentMessages.length)
    }

    const updatedMessages = [...currentMessages, userMessage]
    const firstLine = currentSession.firstLine || trimmed.slice(0, 100)

    await db.sessions.update(currentSession.id, {
      messageCount: updatedMessages.length,
      firstLine,
    })

    setSession(prev => prev ? { ...prev, messageCount: updatedMessages.length, firstLine } : prev)
    setMessages(updatedMessages)
    messagesRef.current = updatedMessages

    // Synchronous crisis keyword check — runs BEFORE any AI response.
    // Activates grounding mode so isGrounding=true flows into the prompt.
    orchestratorRef.current.checkCrisisKeywords(trimmed)

    // Non-blocking: LLM-based emotion check and weather update.
    orchestratorRef.current.checkEmotionAfterMessage(trimmed)
      .then(result => {
        if (result) {
          weatherEngine.recordEmotion(result.emotion as EmotionalTone)
          if (weatherEngine.shouldPersist()) {
            weatherEngine.persist().catch(console.error)
          }
        }
      })
      .catch(console.error)

    return { updatedMessages, firstLine, phase }
  }, [
    sessionRef, messagesRef, orchestratorRef,
    setSession, setMessages,
    hrv, weatherEngine,
  ])

  return { generateTherapistMessage, appendUserMessage }
}
