import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useSettings } from '../store/settings'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { buildTherapistMessages } from '../ai/therapistPrompts'
import { streamChatCompletion, reasoningForSpeed, classifyCrisisRisk, classifySessionSignals } from '../ai/openrouter'
import { containsPartProposal, containsValueProposal } from '../ai/partProposalParser'
import { extractPromiseMarkers } from '../ai/promiseParser'
import { generateId as genId } from '../store/db'
import { loadInSessionRelaxBreaks } from '../engine/sessionContextLoader'
import { SignalTracker } from '../engine/signalTracker'
import { validateResearchDelivery, type ResearchAssignment } from '../engine/personalScience'
import { markResearchDelivered } from '../store/personalScience'
import { markResearchCancelled } from '../store/personalScience'
import { isRoomEnabled, isVoiceEnabled } from '../engine/surfaceAvailability'
import { writeAmbientTurnOutcome } from '../store/interventionOutcomes'
import type { TherapistContext } from '../engine/sessionContextLoader'
import { isGroundingActive, activateGrounding } from './useGroundingMode'
import { getWeatherEngine } from '../store/weatherStore'
import { useTranslation, getLanguageCode } from '../i18n'
import type { useTypewriter } from './useTypewriter'
import type { EnqueueAppend, SessionRuntime } from '../engine/sessionRuntime'
import type { SessionOrchestrator } from '../engine/sessionOrchestrator'
import type { Session, SessionMessage, SessionPhase, EmotionalTone, HrvConversationEventType, ResearchEvent } from '../types'

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
  runtime: SessionRuntime
}

export interface AppendUserMessageResult {
  updatedMessages: SessionMessage[]
  firstLine: string
  phase: SessionPhase
}

export interface AppendUserMessageOptions {
  /**
   * The session these words belong to, captured when they were written (a
   * Journal draft). The append is refused, never redirected, when that
   * session is no longer the one on screen or has closed.
   */
  ownerSessionId?: string
  /** Stable id so a retried append overwrites its own earlier attempt. */
  messageId?: string
}

// Owns the message-lifecycle side of a session: writing therapist + user
// turns to Firestore, streaming the model's tokens through the typewriter,
// and the load-bearing crisis-detection race (L2 classifier fires in
// parallel with token streaming; risk=2 returning before first token aborts
// the stream and retries with grounding flipped on).
export function useSessionStream(wiring: SessionStreamWiring) {
  const {
    sessionRef, messagesRef, contextRef, orchestratorRef,
    setSession, setMessages, setIsStreaming, setOpenerError, enqueueAppend, runtime,
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
  // Same one-shot semantics for the closing intention offer and the once-ever
  // slipping-pattern nudge.
  const intentionOfferedRef = useRef(false)
  const patternNamedRef = useRef(false)
  // Interiority: carried noticing consumed at the opener; missed-promise
  // acknowledgment armed once per session.
  const carriedConsumedRef = useRef(false)
  const missedAcknowledgedRef = useRef(false)
  const arcDeliveredRef = useRef(false)

  const resetSignalsForSession = (sessionId: string) => {
    if (signalSessionIdRef.current === sessionId) return
    signalSessionIdRef.current = sessionId
    signalTrackerRef.current.reset()
    pendingPivotRef.current = null
    softenRef.current = false
    watchPivotUsedRef.current = false
    repairIncludedRef.current = false
    proposalOfferedRef.current = false
    intentionOfferedRef.current = false
    patternNamedRef.current = false
    carriedConsumedRef.current = false
    missedAcknowledgedRef.current = false
    arcDeliveredRef.current = false
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
    researchAssignment?: ResearchAssignment,
  ): Promise<SessionMessage[]> => {
    setIsStreaming(true)
    setOpenerError(null)
    const durableContextEnabled = currentSession.memoryAperture !== 'fresh'
    const activeResearchAssignment = !durableContextEnabled
      ? undefined
      : researchAssignment
    let latestUserIndex = -1
    for (let index = currentMessages.length - 1; index >= 0; index--) {
      if (currentMessages[index].speaker === 'user') {
        latestUserIndex = index
        break
      }
    }
    const assessedUserMessage = latestUserIndex >= 0 ? currentMessages[latestUserIndex] : undefined
    const assessedCompanionMessage = latestUserIndex > 0
      ? [...currentMessages.slice(0, latestUserIndex)].reverse().find(message => message.speaker === 'therapist')
      : undefined

    const orchestrator = orchestratorRef.current

    // Per-turn withdrawal/rumination signal classification (flag-gated).
    // Fire-and-forget alongside the crisis backstop — the result lands during
    // streaming and shapes the NEXT turn's prompt via the tracker refs. Only
    // from user turn 3 (trends need history) and never during grounding.
    resetSignalsForSession(currentSession.id)
    const signalFeatures = getGlobalConfig()?.features
    const repairFlagOn = durableContextEnabled && signalFeatures?.ruptureRepair === true
    const pivotFlagOn = durableContextEnabled && signalFeatures?.ruminationPivot === true
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
        // Each empty retry gets more reasoning/output headroom. Repeating the
        // exact budget after a length-starved completion only reproduces the
        // same failure; the server caps this safely at 4,000 tokens.
        const maxTokens = orchestrator.getMaxTokens(phase) + emptyAttempt * 400

        const context = contextRef.current
        const hrvContext = hrv.buildPromptContext()
        // Read grounding live for every attempt: the crisis retry after a
        // risk-2 preamble must rebuild without the research arm. Grounding
        // suppresses research turns entirely, so the assignment is dropped
        // (and cancelled at finalize) rather than delivered half-applied.
        const groundedNow = isGroundingActive()
        const turnAssignment = groundedNow ? undefined : activeResearchAssignment
        // Per-turn refresh of in-session relax breaks (cheap query). Lets the
        // therapist see breaks that happened mid-conversation without
        // reloading the entire context.
        const inSessionRelaxBreaks = currentSession.id
          ? await loadInSessionRelaxBreaks(currentSession.id)
          : []
        const isFirstTurn = isFirstTherapistTurn(currentMessages)
        // A Personal Science turn compares one interaction form at a time.
        // Do not stack proposals, pivots, presence, humor, or surface markers
        // onto the assigned form; that would make both the experience and the
        // evidence uninterpretable.
        const exclusiveResearchTurn = Boolean(turnAssignment)

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
        if (pivotFlagOn && !isFirstTurn && !exclusiveResearchTurn) {
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
        const partsFlagOn = durableContextEnabled && signalFeatures?.userParts === true
        const activeUserParts = partsFlagOn && context?.activeUserParts?.length
          ? context.activeUserParts
          : undefined
        const lexicon = partsFlagOn && context?.personalFacts?.lexicon?.length
          ? context.personalFacts.lexicon
          : undefined
        const partProposal =
          partsFlagOn &&
          !exclusiveResearchTurn &&
          !isFirstTurn &&
          !pivotDirective &&
          !softenRef.current &&
          !proposalOfferedRef.current &&
          context?.partProposalCandidate
            ? context.partProposalCandidate
            : undefined

        // The thread: follow-up context every turn; a once-ever pattern nudge
        // for a slipping intention (never stacked with another intervention);
        // the closing offer while slots remain and none was made yet.
        const intentionsFlagOn = durableContextEnabled && signalFeatures?.sessionIntentions === true
        const openIntentions = intentionsFlagOn && context?.openIntentions?.length
          ? context.openIntentions
          : undefined
        const namePatternFor =
          intentionsFlagOn &&
          !exclusiveResearchTurn &&
          !isFirstTurn &&
          !pivotDirective &&
          !softenRef.current &&
          !partProposal &&
          !patternNamedRef.current &&
          context?.intentionPatternToName
            ? { text: context.intentionPatternToName.text }
            : undefined
        const intentionOffer =
          intentionsFlagOn && !exclusiveResearchTurn && !intentionOfferedRef.current && context?.intentionSlotsOpen === true
            ? true
            : undefined

        const stanceContext =
          durableContextEnabled && signalFeatures?.stanceAdaptation === true && context?.stanceEntries?.length
            ? context.stanceEntries
            : undefined

        // Interiority bundle: carried noticing rides the opener (consume-once);
        // disclosure/promise context every turn; missed acknowledgment once.
        const interiorityFlagOn = durableContextEnabled && signalFeatures?.companionInteriority === true
        const carriedNoticing = interiorityFlagOn && isFirstTurn && !carriedConsumedRef.current && context?.carriedNoticing
          ? context.carriedNoticing
          : undefined
        const disclosureContext = interiorityFlagOn && context?.disclosureContext
          ? context.disclosureContext
          : undefined
        const duePromises = interiorityFlagOn && context?.duePromises?.length
          ? context.duePromises
          : undefined
        const missedPromise = interiorityFlagOn && !missedAcknowledgedRef.current && context?.missedPromise
          ? context.missedPromise
          : undefined
        const promiseInvite = interiorityFlagOn && context?.promiseSlotsOpen === true ? true : undefined

        // Story arc: delivered once on a non-opener turn, then cleared.
        const storyArc =
          durableContextEnabled && !exclusiveResearchTurn && signalFeatures?.storyArcs === true && !isFirstTurn && !arcDeliveredRef.current && context?.storyArc
            ? context.storyArc
            : undefined

        // Presence + humor: register-level permissions, prompt-gated.
        const allowPresence = !exclusiveResearchTurn && signalFeatures?.companionPresence === true ? true : undefined
        const allowHumor = !exclusiveResearchTurn && signalFeatures?.earnedHumor === true ? true : undefined

        // Values: context every turn; the value proposal shares the single
        // per-session proposal slot with part proposals (parts win).
        const valuesFlagOn = durableContextEnabled && signalFeatures?.userValues === true
        const activeValues = valuesFlagOn && context?.activeValues?.length
          ? context.activeValues
          : undefined
        const valueProposal =
          valuesFlagOn &&
          !exclusiveResearchTurn &&
          !isFirstTurn &&
          !pivotDirective &&
          !softenRef.current &&
          !partProposal &&
          !proposalOfferedRef.current &&
          context?.valueProposalCandidate
            ? context.valueProposalCandidate
            : undefined

        const promptMessages = buildTherapistMessages(currentMessages, {
          channel: 'web',
          memoryAperture: currentSession.memoryAperture ?? context?.memoryAperture,
          phase,
          recentSessionNotes: context?.recentSessionNotes,
          recentFieldNotes: context?.recentFieldNotes,
          relevantMemories: context?.relevantMemories,
          profile: context?.userProfile,
          personalFacts: context?.personalFacts,
          isGrounding: groundedNow,
          hrvContext,
          mode: currentSession.mode ?? 'standard',
          includeAmbientAssessment: durableContextEnabled,
          allowRecommendations: !exclusiveResearchTurn,
          // Only teach #switch links for surfaces this session can actually
          // open: a link to a disabled surface would start hidden voice.
          availableSurfaces: [
            'journal',
            ...(isVoiceEnabled(signalFeatures) ? ['speak' as const] : []),
            ...(isRoomEnabled(signalFeatures) ? ['room' as const] : []),
          ],
          availableSurfaceArcs: durableContextEnabled
            ? [
                'journal',
                ...(isVoiceEnabled(signalFeatures) ? ['speak' as const] : []),
                ...(isRoomEnabled(signalFeatures) ? ['room' as const] : []),
              ]
            : [],
          isFirstTurn,
          inSessionRelaxBreaks,
          recentRelaxBreaks: context?.recentRelaxBreaks,
          repairContext,
          pivotDirective,
          softenStance: repairFlagOn && softenRef.current && !exclusiveResearchTurn ? true : undefined,
          activeUserParts,
          lexicon,
          partProposal,
          openIntentions,
          namePatternFor,
          intentionOffer,
          stanceContext,
          outcomeContext: context?.outcomeContext,
          alliancePreferences: context?.alliancePreferences,
          experimentDirective: turnAssignment?.directive,
          personalProtocols: context?.activePersonalProtocols,
          livingHypotheses: context?.livingHypotheses,
          activeValues,
          valueProposal,
          carriedNoticing,
          disclosureContext,
          duePromises,
          missedPromise,
          promiseInvite,
          allowPresence,
          allowHumor,
          storyArc,
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
          const deliveryValidation = turnAssignment
            ? validateResearchDelivery(turnAssignment, fullText)
            : null
          const deliveredAssignment = deliveryValidation?.delivered === false ? null : turnAssignment
          const newMessage: SessionMessage = {
            id: msgId,
            speaker: 'therapist',
            partId: null,
            partName: null,
            content: fullText.trim(),
            timestamp: Date.now(),
            phase,
            isEmergence: false,
            surface: 'talk',
            ...(deliveredAssignment ? {
              responseMode: deliveredAssignment.responseMode,
              researchEventId: deliveredAssignment.event.id,
              researchArm: deliveredAssignment.event.assignedArm,
            } : {}),
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

            if (activeResearchAssignment && !turnAssignment) {
              await markResearchCancelled(activeResearchAssignment.event.id, 'grounding')
                .catch(() => { /* response persistence outranks research telemetry */ })
            } else if (deliveryValidation?.delivered === false && turnAssignment) {
              await markResearchCancelled(turnAssignment.event.id, deliveryValidation.reason)
                .catch(() => { /* response persistence outranks research telemetry */ })
            } else if (deliveredAssignment) {
              await markResearchDelivered(deliveredAssignment.event, msgId)
                .catch(() => { /* response persistence outranks research telemetry */ })
            }

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

          // Story arc: consumed by the build that delivered it.
          if (storyArc) {
            arcDeliveredRef.current = true
            if (contextRef.current) contextRef.current.storyArc = null
            void db.companionSignals
              .update('current', { pendingArc: null, updatedAt: Date.now() })
              .catch(() => { /* best-effort */ })
          }

          // Carried noticing: consumed by the opener that carried it.
          if (carriedNoticing) {
            carriedConsumedRef.current = true
            if (contextRef.current) contextRef.current.carriedNoticing = null
            void db.companionSignals
              .update('current', { carriedNoticing: null, updatedAt: Date.now() })
              .catch(() => { /* best-effort */ })
          }

          // Promise lifecycle from the finalized text: new commitments are
          // recorded (cap 2 enforced), deliveries marked kept, and a slipped
          // dated promise acknowledged once.
          if (interiorityFlagOn) {
            const { made, keptIds } = extractPromiseMarkers(fullText)
            const activeCount = (contextRef.current?.duePromises?.length ?? 0)
            for (const [idx, m] of made.slice(0, Math.max(0, 2 - activeCount)).entries()) {
              void idx
              void db.companionPromises.add({
                id: genId(),
                text: m.text.slice(0, 160),
                dueKind: m.dueDate ? 'date' : 'next_session',
                ...(m.dueDate ? { dueDate: m.dueDate } : {}),
                status: 'active',
                sessionId: currentSession.id,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }).catch(() => { /* best-effort */ })
            }
            for (const id of keptIds) {
              void db.companionPromises
                .update(id, { status: 'kept', keptAt: Date.now(), updatedAt: Date.now() })
                .catch(() => { /* best-effort */ })
            }
            if (missedPromise) {
              missedAcknowledgedRef.current = true
              if (contextRef.current) contextRef.current.missedPromise = null
              void db.companionPromises
                .update(missedPromise.id, { status: 'acknowledged_missed', updatedAt: Date.now() })
                .catch(() => { /* best-effort */ })
            }
          }

          // Value proposal: same consume-once mechanics as part proposals,
          // sharing the one proposal slot per session.
          if (valueProposal && containsValueProposal(fullText)) {
            proposalOfferedRef.current = true
            if (contextRef.current) contextRef.current.valueProposalCandidate = null
            void db.userValues
              .update(valueProposal.id, { proposedAt: Date.now(), updatedAt: Date.now() })
              .catch(() => { /* best-effort */ })
          }

          // Intention offer: one per session, counted only when the marker
          // actually appeared.
          if (intentionOffer && fullText.includes('](#offer-intention)')) {
            intentionOfferedRef.current = true
          }

          // Slipping-pattern nudge: once EVER per intention. The build that
          // carried the instruction counts as the naming — mark it in
          // Firestore and feed the existing avoidance machinery.
          if (namePatternFor && context?.intentionPatternToName) {
            patternNamedRef.current = true
            const { id, text } = context.intentionPatternToName
            if (contextRef.current) contextRef.current.intentionPatternToName = null
            void db.sessionIntentions
              .update(id, { patternNamed: true, updatedAt: Date.now() })
              .catch(() => { /* best-effort */ })
            void db.userProfile.get('current').then((profile) => {
              if (!profile) return
              const line = `keeps deferring the intention "${text.slice(0, 60)}"`
              if (profile.avoidancePatterns.includes(line)) return
              return db.userProfile.update('current', {
                avoidancePatterns: [...profile.avoidancePatterns, line].slice(-10),
                lastUpdated: Date.now(),
              })
            }).catch(() => { /* best-effort */ })
          }
        }

        hrv.resetResponseStarted()

        const crisisAbortController = runtime.createAbortController()
        let firstTokenArrived = false
        let crisisAborted = false

        try {
          await streamChatCompletion(
            promptMessages,
            {
            onToken: (token) => {
              if (!runtime.isSessionActive(currentSession.id)) return
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
            onAmbientAssessment: durableContextEnabled ? (assessment) => {
              if (assessment.state !== 'unclear' && assessment.capacity !== 'unclear' && assessment.need !== 'unclear') {
                const researchContext = {
                  state: assessment.state,
                  capacity: assessment.capacity,
                  need: assessment.need,
                  capturedAt: Date.now(),
                }
                currentSession.researchContext = researchContext
                if (sessionRef.current?.id === currentSession.id) {
                  sessionRef.current = { ...sessionRef.current, researchContext }
                  setSession(previous => previous?.id === currentSession.id ? { ...previous, researchContext } : previous)
                }
                void db.sessions.update(currentSession.id, { researchContext }).catch(() => {})
              }
              if (assessedCompanionMessage && assessedUserMessage) {
                void writeAmbientTurnOutcome(assessedCompanionMessage, assessedUserMessage, currentSession.id, assessment).catch(() => {})
              }
            } : undefined,
            onComplete: () => {
              if (!runtime.isSessionActive(currentSession.id)) {
                resolveMessages(currentMessages)
                return
              }
              typewriter.setOnComplete(finalizeMessage)
              if (hrv.enabled) {
                hrv.addConversationEvent('ai_response_complete', currentMessages.length)
              }
            },
            onError: (error) => {
              if (crisisAborted) return
              if (!runtime.isSessionActive(currentSession.id)) {
                resolveMessages(currentMessages)
                return
              }
              console.error('Session stream error:', error)
              typewriter.reset()
              resolveMessages(currentMessages)
            },
            },
            maxTokens,
            reasoningForSpeed(settings.responseSpeed),
            crisisAbortController.signal,
          )
        } finally {
          runtime.releaseAbortController(crisisAbortController)
        }

        if (crisisAborted) continue

        crisisLoopResult = await messagesPromise
        break
      }

      if (!crisisLoopResult) {
        if (runtime.isSessionActive(currentSession.id)) setIsStreaming(false)
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
    if (runtime.isSessionActive(currentSession.id)) {
      setOpenerError(tr['session.error.therapistUnreachable'])
      setIsStreaming(false)
    }
    return currentMessages
  }, [
    sessionRef, contextRef, messagesRef, orchestratorRef,
    setSession, setMessages, setIsStreaming, setOpenerError, enqueueAppend,
    hrv, typewriter, settings.responseSpeed, tr, runtime,
  ])

  // Fixed, transparent research interventions use the same serialized append
  // path as model responses. This makes designed silence and a Journal offer
  // real delivered arms without pretending the model generated them.
  //
  // Defense in depth for the P0 crisis path: a canned offer must never answer
  // a grounded turn. Grounding is re-read here (and again inside the append
  // queue, which can lag behind an L1/L2 activation); when it is active the
  // arm is cancelled and an ordinary model turn runs instead, which rebuilds
  // the prompt with isGrounding=true.
  const appendDeterministicCompanionMessage = useCallback(async (
    content: string,
    event: ResearchEvent,
  ): Promise<SessionMessage[] | null> => {
    const currentSession = sessionRef.current
    if (!currentSession || currentSession.status !== 'active') return null
    const trimmed = content.trim()
    if (!trimmed) return null

    const fallBackToModelTurn = () => {
      void markResearchCancelled(event.id, 'grounding').catch(() => { /* telemetry only */ })
      return generateTherapistMessage(messagesRef.current, sessionRef.current ?? currentSession)
    }
    if (isGroundingActive()) return fallBackToModelTurn()

    const delivered = await enqueueAppend(async (): Promise<SessionMessage[] | null> => {
      if (isGroundingActive()) return null
      const phase = orchestratorRef.current.detectPhase(messagesRef.current)
      const message: SessionMessage = {
        id: generateId(),
        speaker: 'therapist',
        partId: null,
        partName: null,
        content: trimmed,
        timestamp: Date.now(),
        phase,
        isEmergence: false,
        surface: 'talk',
        responseMode: event.responseMode,
        researchEventId: event.id,
        researchArm: event.assignedArm,
      }
      await sessionMessagesDb.add(currentSession.id, message)
      const updatedMessages = [...messagesRef.current, message]
      const firstLine = currentSession.firstLine || trimmed.slice(0, 100)
      await db.sessions.update(currentSession.id, {
        messageCount: updatedMessages.length,
        firstLine,
        phase,
      })
      await markResearchDelivered(event, message.id)
        .catch(() => { /* companion delivery must not fail on telemetry */ })
      if (runtime.isSessionActive(currentSession.id)) {
        setSession(previous => previous ? { ...previous, messageCount: updatedMessages.length, firstLine, phase } : previous)
        setMessages(updatedMessages)
        messagesRef.current = updatedMessages
      }
      return updatedMessages
    })
    // Grounding activated while this append waited in the queue. The model
    // turn is generated outside the queue (its own finalize enqueues).
    if (delivered === null) return fallBackToModelTurn()
    return delivered
  }, [enqueueAppend, generateTherapistMessage, messagesRef, orchestratorRef, runtime, sessionRef, setMessages, setSession])

  // Realtime surfaces that are not Speak still share the parent session's
  // transcript and continuity. They can persist an organic companion turn
  // here without fabricating a research event or starting a text generation.
  const appendRealtimeCompanionMessage = useCallback(async (
    content: string,
    surface: SessionMessage['surface'],
  ): Promise<SessionMessage[] | null> => {
    const currentSession = sessionRef.current
    if (!currentSession || currentSession.status !== 'active') return null
    const trimmed = content.trim()
    if (!trimmed) return null
    return enqueueAppend(async () => {
      const phase = orchestratorRef.current.detectPhase(messagesRef.current)
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
        surface,
      }
      await sessionMessagesDb.add(currentSession.id, message)
      const updatedMessages = [...messagesRef.current, message]
      const firstLine = currentSession.firstLine || trimmed.slice(0, 100)
      await db.sessions.update(currentSession.id, {
        messageCount: updatedMessages.length,
        firstLine,
        phase,
      })
      if (runtime.isSessionActive(currentSession.id)) {
        setSession(previous => previous ? { ...previous, messageCount: updatedMessages.length, firstLine, phase } : previous)
        setMessages(updatedMessages)
        messagesRef.current = updatedMessages
      }
      return updatedMessages
    })
  }, [enqueueAppend, messagesRef, orchestratorRef, runtime, sessionRef, setMessages, setSession])

  // Persist a user-authored message (text or voice) and run the synchronous
  // side effects: HRV event, crisis-keyword check, async emotion/weather update.
  // Returns the updated message list + computed firstLine so callers can chain
  // (text path immediately calls generateTherapistMessage; voice path doesn't).
  const appendUserMessage = useCallback(async (
    content: string,
    inputMethod?: 'text' | 'voice',
    surface: SessionMessage['surface'] = inputMethod === 'voice' ? 'speak' : 'talk',
    options: AppendUserMessageOptions = {},
  ): Promise<AppendUserMessageResult | null> => {
    const currentSession = sessionRef.current
    if (!currentSession || currentSession.status === 'closed') return null
    const { ownerSessionId } = options
    if (ownerSessionId !== undefined && currentSession.id !== ownerSessionId) return null
    const trimmed = content.trim()
    if (!trimmed) return null

    // Serialized so a concurrent append (e.g. a voice transcript arriving while
    // this persists) can't read the same base array and clobber this message /
    // understate messageCount. The base list is read fresh INSIDE the queue.
    const result = await enqueueAppend(async (): Promise<AppendUserMessageResult | null> => {
      // Owned words re-check inside the queue: the session may have closed or
      // the view moved on while earlier appends ran. The base list below is
      // only this session's while it is still the one on screen.
      if (ownerSessionId !== undefined) {
        const latest = sessionRef.current
        if (latest?.id !== ownerSessionId || latest.status === 'closed') return null
      }
      const currentMessages = messagesRef.current
      const phase = orchestratorRef.current.detectPhase(currentMessages)
      const userMessage: SessionMessage = {
        id: options.messageId ?? generateId(),
        speaker: 'user',
        partId: null,
        partName: null,
        content: trimmed,
        timestamp: Date.now(),
        phase,
        isEmergence: false,
        surface,
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

      if (runtime.isSessionActive(currentSession.id)) {
        setSession(prev => prev ? { ...prev, messageCount: updatedMessages.length, firstLine } : prev)
        setMessages(updatedMessages)
        messagesRef.current = updatedMessages
      }
      return { updatedMessages, firstLine, phase }
    })
    if (!result) return null

    // L1 runs synchronously before any response. If the narrow hard floor does
    // not fire, L2 reads context in parallel with the response. Keeping the L2
    // launch here gives Talk and Speak the same safety path; previously voice
    // transcripts only received L1 because they do not call
    // generateTherapistMessage.
    const hardFloorHit = orchestratorRef.current.checkCrisisKeywords(trimmed)
    if (!hardFloorHit && !isGroundingActive()) {
      void classifyCrisisRisk(trimmed, getLanguageCode())
        .then(result => { if (result.risk === 2) activateGrounding('auto') })
        .catch(() => { /* classifyCrisisRisk already fails open to 0 */ })
    }

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
    hrv, weatherEngine, runtime,
  ])

  return { generateTherapistMessage, appendUserMessage, appendDeterministicCompanionMessage, appendRealtimeCompanionMessage }
}
