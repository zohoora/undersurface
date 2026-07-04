import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useSettings } from '../store/settings'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { buildTherapistMessages } from '../ai/therapistPrompts'
import { streamChatCompletion, reasoningForSpeed, classifyCrisisRisk, classifySessionSignals } from '../ai/openrouter'
import { containsPartProposal } from '../ai/partProposalParser'
import { loadInSessionRelaxBreaks } from '../engine/sessionContextLoader'
import { SignalTracker } from '../engine/signalTracker'
import type { TherapistContext } from '../engine/sessionContextLoader'
import { isGroundingActive, activateGrounding } from './useGroundingMode'
import { getWeatherEngine } from '../store/weatherStore'
import { useTranslation, getLanguageCode } from '../i18n'
import type { useTypewriter } from './useTypewriter'
import type { EnqueueAppend } from './useAppendQueue'
import type { SessionOrchestrator } from '../engine/sessionOrchestrator'
import type { Session, SessionMessage, SessionPhase, EmotionalTone, HrvConversationEventType } from '../types'

/**
 * Minimal interface the stream needs from a biometric session — either the
 * webcam HRV hook or the Polar H10 hook satisfies it structurally. Keeps the
 * stream agnostic to which device is active.
 *
 * `enabled` exists as a perf gate for the per-token `markResponseStarted`
 * idempotent path; when no source is streaming it skips the work entirely.
 */
export interface BiometricSource {
  readonly enabled: boolean
  buildPromptContext(): string | undefined
  addConversationEvent(type: HrvConversationEventType, messageIndex: number): void
  resetResponseStarted(): void
  /** First call after `resetResponseStarted` returns true; subsequent calls return false. */
  markResponseStarted(): boolean
}

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
  hrv: BiometricSource
  typewriter: ReturnType<typeof useTypewriter>
  enqueueAppend: EnqueueAppend
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
    setSession, setMessages, setIsStreaming, setOpenerError, enqueueAppend,
    hrv, typewriter,
  } = wiring
  const settings = useSettings()
  const tr = useTranslation()
  const weatherEngine = getWeatherEngine()

  // Live rupture/rumination signal state. All transient and session-scoped —
  // reset when the session id changes; nothing here persists.
  // Spec: docs/superpowers/specs/2026-07-03-rupture-rumination-design.md
  const signalTrackerRef = useRef(new SignalTracker())
  const signalSessionIdRef = useRef<string | null>(null)
  // One-shot pivot armed by the live tracker; consumed by the next build.
  const pendingPivotRef = useRef<{ theme?: string } | null>(null)
  // Held softening state (tracker arms/releases it).
  const softenRef = useRef(false)
  // The cross-session ruminationWatch triggers at most ONE pivot per session.
  const watchPivotUsedRef = useRef(false)
  // Set when a build actually included repairContext; cleared (with the
  // persistent pendingRepair) once that opener finalizes non-empty.
  const repairIncludedRef = useRef(false)
  // Set once a finalized message actually carried the part-proposal marker —
  // the offer happened; stop including the block this session.
  const proposalOfferedRef = useRef(false)

  const resetSignalsForSession = (sessionId: string) => {
    if (signalSessionIdRef.current === sessionId) return
    signalSessionIdRef.current = sessionId
    signalTrackerRef.current.reset()
    pendingPivotRef.current = null
    softenRef.current = false
    watchPivotUsedRef.current = false
    repairIncludedRef.current = false
    proposalOfferedRef.current = false
  }

  // Returns the updated messages array after the therapist message is finalized.
  //
  // Crisis detection (L2) is folded into this same call: the therapist emits
  // `<<RISK:N>>\n\n` as the first content of the stream, parsed and stripped by
  // streamChatCompletion before any token reaches the typewriter. On risk=2,
  // activateGrounding fires immediately; on the first attempt the in-flight
  // stream is also aborted so the retry rebuilds the prompt with
  // isGrounding=true (which flips Real Talk → standard core via the
  // load-bearing useRealTalk guard). On retries, we trust the model's response
  // (already constrained by SAFETY_RULES) and let it stream.
  const generateTherapistMessage = useCallback(async (
    currentMessages: SessionMessage[],
    currentSession: Session,
  ): Promise<SessionMessage[]> => {
    setIsStreaming(true)
    setOpenerError(null)

    const orchestrator = orchestratorRef.current

    // Standalone L2 crisis backstop. The in-band <<RISK:N>> preamble is the
    // primary session-mode signal, but it fails open to 0 on any malformation
    // or absence — with no independent check, a missed crisis went unnoticed.
    // Fire an independent classifier ONCE per user turn (not per retry),
    // parallel to streaming. On risk=2 it activates grounding, which shows the
    // crisis-resources UI immediately and grounds every subsequent turn (Real
    // Talk → THERAPIST_CORE). It deliberately does NOT abort the in-flight
    // stream: that clean pre-first-token abort/retry belongs to the in-band
    // preamble (synchronous with generation); an out-of-band classifier
    // aborting mid-stream would make responses vanish and regenerate at
    // unpredictable moments. Fail-open (returns 0 on error) so it never bricks
    // a send.
    const latestUserMessage = [...currentMessages].reverse().find(m => m.speaker === 'user')
    if (latestUserMessage && !isGroundingActive()) {
      void classifyCrisisRisk(latestUserMessage.content, getLanguageCode())
        .then(result => { if (result.risk === 2) activateGrounding('auto') })
        .catch(() => { /* classifyCrisisRisk already fails open to 0 */ })
    }

    // Per-turn withdrawal/rumination signal classification (flag-gated).
    // Fire-and-forget alongside the crisis backstop — the result lands during
    // streaming and shapes the NEXT turn's prompt via the tracker refs. Only
    // from user turn 3 (trends need history) and never during grounding.
    resetSignalsForSession(currentSession.id)
    const signalFeatures = getGlobalConfig()?.features
    const repairFlagOn = signalFeatures?.ruptureRepair === true
    const pivotFlagOn = signalFeatures?.ruminationPivot === true
    const userMessages = currentMessages.filter(m => m.speaker === 'user')
    if ((repairFlagOn || pivotFlagOn) && userMessages.length >= 3 && !isGroundingActive()) {
      void classifySessionSignals(userMessages.slice(-6).map(m => m.content))
        .then(result => {
          const state = signalTrackerRef.current.record({
            withdrawal: result.withdrawal,
            rumination: result.rumination,
          })
          if (pivotFlagOn && state.pivotActive) {
            pendingPivotRef.current = { theme: result.theme }
          }
          if (repairFlagOn) {
            softenRef.current = state.softenActive
          }
        })
        .catch(() => { /* classifySessionSignals already fails open to zeros */ })
    }

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
        const isFirstTurn = isFirstTherapistTurn(currentMessages)

        // Rupture repair: opener-only, consume-once (cleared after the opener
        // that used it finalizes). Pivot: a live tracker arm wins; otherwise
        // the cross-session watch triggers at most one pivot per session.
        // The prompt layer additionally suppresses all of these under
        // grounding, so no isGrounding checks are duplicated here.
        const repairContext = repairFlagOn && isFirstTurn && context?.repairContext
          ? context.repairContext
          : undefined
        if (repairContext) repairIncludedRef.current = true

        let pivotDirective: { theme?: string } | undefined
        if (pivotFlagOn && !isFirstTurn) {
          if (pendingPivotRef.current) {
            pivotDirective = pendingPivotRef.current
            pendingPivotRef.current = null
          } else if (context?.ruminationWatch && !watchPivotUsedRef.current) {
            watchPivotUsedRef.current = true
            pivotDirective = { theme: context.ruminationWatch.theme }
          }
        }

        // User parts context + at most one proposal. The proposal block stays
        // available across turns (the model waits for a natural moment) until
        // a finalized message actually carries the marker; it never shares a
        // build with a pivot or softening — one intervention at a time.
        const partsFlagOn = signalFeatures?.userParts === true
        const activeUserParts = partsFlagOn && context?.activeUserParts?.length
          ? context.activeUserParts
          : undefined
        const lexicon = partsFlagOn && context?.personalFacts?.lexicon?.length
          ? context.personalFacts.lexicon
          : undefined
        const partProposal =
          partsFlagOn &&
          !isFirstTurn &&
          !pivotDirective &&
          !softenRef.current &&
          !proposalOfferedRef.current &&
          context?.partProposalCandidate
            ? context.partProposalCandidate
            : undefined

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
          isFirstTurn,
          inSessionRelaxBreaks,
          recentRelaxBreaks: context?.recentRelaxBreaks,
          repairContext,
          pivotDirective,
          softenStance: repairFlagOn && softenRef.current ? true : undefined,
          activeUserParts,
          lexicon,
          partProposal,
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

          // Serialized append: read the base list fresh INSIDE the queue so a
          // concurrent user/voice append can't be clobbered. Firestore writes
          // always run — the message belongs to currentSession and must persist
          // even if the user has since switched away.
          await enqueueAppend(async () => {
            await sessionMessagesDb.add(currentSession.id, newMessage)

            const base = messagesRef.current
            const updatedMessages = [...base, newMessage]
            const newMessageCount = updatedMessages.length
            const firstLine = currentSession.firstLine || fullText.trim().slice(0, 100)

            await db.sessions.update(currentSession.id, {
              messageCount: newMessageCount,
              firstLine,
              phase,
            })

            // Guard React-state writes against a mid-reveal session switch: if the
            // active session is no longer the one this message belongs to, applying
            // its messages/count/streaming state would corrupt the other session's
            // view (the cross-session bleed). The message is already persisted above.
            if (sessionRef.current?.id === currentSession.id) {
              setSession(prev => prev ? {
                ...prev,
                messageCount: newMessageCount,
                firstLine,
                phase,
              } : prev)
              setMessages(updatedMessages)
              messagesRef.current = updatedMessages
              setIsStreaming(false)
            }
            typewriter.reset()
            resolveMessages(updatedMessages)
          })

          // Consume-once repair: the opener that used the repair evidence has
          // now landed. Clear both the in-memory copy (so retries and later
          // turns don't re-include it) and the persistent slot. Best-effort —
          // a failed clear just risks one extra repair next session.
          if (repairIncludedRef.current) {
            repairIncludedRef.current = false
            if (contextRef.current) contextRef.current.repairContext = null
            void db.companionSignals
              .update('current', { pendingRepair: null, updatedAt: Date.now() })
              .catch(() => { /* best-effort */ })
          }

          // Part proposal: stamp proposedAt ONLY when the finalized message
          // actually carried the marker (the model may rightly never find a
          // natural moment — then nothing is stamped and the candidate
          // re-arms next session).
          if (partProposal && containsPartProposal(fullText)) {
            proposalOfferedRef.current = true
            if (contextRef.current) contextRef.current.partProposalCandidate = null
            void db.userParts
              .update(partProposal.id, { proposedAt: Date.now(), updatedAt: Date.now() })
              .catch(() => { /* best-effort */ })
          }
        }

        hrv.resetResponseStarted()

        const crisisAbortController = new AbortController()
        let firstTokenArrived = false
        let crisisAborted = false

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
            onRisk: (risk) => {
              if (risk !== 2) return
              activateGrounding('auto')
              // First attempt only: abort so the retry rebuilds the prompt
              // with isGrounding=true (which flips Real Talk → standard core
              // via useRealTalk). After first content token, SAFETY_RULES
              // already constrains the in-flight response.
              if (attempt === 0 && !firstTokenArrived) {
                crisisAborted = true
                crisisAbortController.abort()
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
    sessionRef, contextRef, messagesRef, orchestratorRef,
    setSession, setMessages, setIsStreaming, setOpenerError, enqueueAppend,
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

    // Serialized so a concurrent append (e.g. a voice transcript arriving while
    // this persists) can't read the same base array and clobber this message /
    // understate messageCount. The base list is read fresh INSIDE the queue.
    const result = await enqueueAppend(async (): Promise<AppendUserMessageResult> => {
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
      return { updatedMessages, firstLine, phase }
    })

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

    return result
  }, [
    sessionRef, messagesRef, orchestratorRef,
    setSession, setMessages, enqueueAppend,
    hrv, weatherEngine,
  ])

  return { generateTherapistMessage, appendUserMessage }
}
