import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { driftReduce, initialDriftState, selectInterweave, outcomeForReason } from '../engine/driftEngine'
import type { DriftState, DriftLength, NoticeDirection } from '../engine/driftEngine'
import { buildDriftSystemPrompt } from '../ai/driftPrompts'
import { streamChatCompletion, classifyCrisisRisk, reasoningForSpeed } from '../ai/openrouter'
import type { CrisisRisk } from '../ai/openrouter'
import { detectCrisisKeywords } from '../engine/sessionOrchestrator'
import { activateGrounding, isGroundingActive, subscribeGrounding } from '../store/groundingState'
import { getSettings } from '../store/settings'
import { getLanguageCode } from '../i18n'
import { db, generateId } from '../store/db'
import type { DriftAnchorKind, DriftBlsChannel, DriftCheckIn, DriftOutcome, DriftSession, DriftTranscriptEntry } from '../types'

// Matches Talk's proven floor (getMaxTokens 300–600): gpt-5.x reasoning eats the
// budget before content, and too-tight caps return empty completions. 220 sat
// below that floor — raised to 400 (Checkpoint C finding).
const NOTICE_MAX_TOKENS = 400
const RISK_RACE_MS = 1500
const PERSIST_DEBOUNCE_MS = 2000

// Chat message shape accepted by streamChatCompletion.
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// v2: the single begin screen collects everything (anchor, length, focus), and
// begin() drives the verified state machine through its opening phases in one
// call. A typed focus still runs the full crisis stack before the practice
// proceeds; chips are app-authored copy and dispatch directly.
export interface DriftBeginOptions {
  anchorKind: DriftAnchorKind
  blsChannel: DriftBlsChannel
  voice: boolean
  length: DriftLength
  // What's stirring — a chip label or the writer's own words. Recorded as the
  // opening transcript entry so typed exchanges later have this as context.
  focus: string
  // True when the writer typed the focus themselves → L1 + L2 crisis checks.
  focusIsCustom: boolean
}

export interface DriftApi {
  state: DriftState
  transcript: DriftTranscriptEntry[]
  streamingText: string
  companionCue: string
  isSubmitting: boolean
  begin: (opts: DriftBeginOptions) => Promise<void>
  completeSet: () => void
  // Typed check-in — the LLM companion path (unchanged, eval-verified).
  submitNotice: (text: string, direction: NoticeDirection) => Promise<void>
  // Tap-only check-in — instant, no LLM, no text to classify. The scripted
  // micro-line is the UI's concern; the engine routes the direction.
  submitNoticeTap: (direction: NoticeDirection) => void
  settleDone: () => void
  requestClose: () => void
  closureDone: () => Promise<void>
  abandon: () => Promise<void>
  recordInterruption: () => void
  voiceActive: boolean
}

// Drives the pure Drift engine: owns timers, streams between-set exchanges through
// the existing /api/chat path, wires the two-layer crisis stack, and persists to
// the driftSessions collection. The engine keeps authority over flow, caps, and
// the abort path; this hook only feeds it events and side-effects.
export function useDriftSession(parentSessionId: string | null, hrvContext?: string | null): DriftApi {
  const [state, dispatch] = useReducer(driftReduce, undefined, initialDriftState)
  // Latest committed state, for reads inside async callbacks (never in render).
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const [transcript, setTranscript] = useState<DriftTranscriptEntry[]>([])
  const transcriptRef = useRef<DriftTranscriptEntry[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [companionCue, setCompanionCue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false)

  const startRef = useRef<number | null>(null)
  const docIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const userPartNamesRef = useRef<string[]>([])
  const interweavesUsedRef = useRef<string[]>([])
  const checkInsRef = useRef<DriftCheckIn[]>([])
  const interruptionsRef = useRef(0)
  const noticeStartedRef = useRef<number | null>(null)
  const submittingRef = useRef(false)
  const persistReadyRef = useRef<Promise<void>>(Promise.resolve())

  const appendEntry = useCallback((entry: DriftTranscriptEntry) => {
    const next = [...transcriptRef.current, entry]
    transcriptRef.current = next
    setTranscript(next)
  }, [])

  // L2 backstop that escalates only on risk=2 (fire-and-forget). Notice risk=1
  // routing is handled inline in submitNotice, folded into the NOTICE event.
  const raceCrisisAbort = useCallback((text: string) => {
    void classifyCrisisRisk(text, getLanguageCode()).then((r) => {
      if (r.risk === 2) {
        activateGrounding()
        dispatch({ type: 'CRISIS' })
        abortRef.current?.abort()
      }
    }).catch(() => { /* classifier fails open to 0 */ })
  }, [])

  const begin = useCallback(async (opts: DriftBeginOptions) => {
    const { anchorKind, blsChannel, voice, length, focus, focusIsCustom } = opts
    startRef.current = Date.now()
    setVoiceActive(voice)
    const id = generateId()
    docIdRef.current = id
    const record: DriftSession = {
      id,
      parentSessionId,
      startedAt: startRef.current,
      endedAt: null,
      outcome: null,
      setCount: 0,
      interweavesUsed: [],
      transcript: [],
      anchorKind,
      blsChannel,
      length,
      voiceUsed: voice,
      hrvPresent: hrvContext != null,
    }
    // Storage and personalization begin immediately but never block the first
    // render. Starting them before crisis routing also guarantees that an
    // early safety closure still has a record to finalize.
    persistReadyRef.current = db.driftSessions.add(record).then(() => undefined).catch(() => undefined)
    void db.userParts.toArray().then((parts) => {
      userPartNamesRef.current = parts.filter(p => p.status === 'active').map(p => p.name)
    }).catch(() => { userPartNamesRef.current = [] })

    // Drive the verified machine through its opening phases — the same events
    // the v1 UI gated on, dispatched in order. The no-return invariant and the
    // crisis paths are untouched; the writer just isn't asked to type through
    // four screens to reach the first wave.
    dispatch({ type: 'BEGIN', length })
    dispatch({ type: 'ANCHOR_CONFIRMED' })
    appendEntry({ role: 'user', content: focus, atMs: Date.now() })
    if (focusIsCustom) {
      // The writer's own words → full crisis stack before the practice proceeds.
      if (detectCrisisKeywords(focus)) { activateGrounding(); dispatch({ type: 'CRISIS' }); return }
      raceCrisisAbort(focus)
    }
    dispatch({ type: 'STARTING_POINT' })
    dispatch({ type: 'BASELINE_DONE' })

  }, [parentSessionId, hrvContext, appendEntry, raceCrisisAbort])

  const completeSet = useCallback(() => {
    setCompanionCue('')
    noticeStartedRef.current = Date.now()
    dispatch({ type: 'SET_COMPLETE' })
  }, [])

  // Tap-only check-in: nothing typed → nothing to crisis-classify, no LLM turn.
  // Instant by design — momentum is the default, depth (typing) is opt-in.
  const submitNoticeTap = useCallback((direction: NoticeDirection) => {
    checkInsRef.current = [...checkInsRef.current, {
      wave: stateRef.current.setCount,
      direction,
      usedWords: false,
      atMs: Date.now(),
      responseLatencyMs: Math.max(0, Date.now() - (noticeStartedRef.current ?? Date.now())),
    }]
    dispatch({ type: 'NOTICE', direction, risk: 0, interweave: null })
  }, [])

  const submitNotice = useCallback(async (text: string, direction: NoticeDirection) => {
    if (submittingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    checkInsRef.current = [...checkInsRef.current, {
      wave: stateRef.current.setCount,
      direction,
      usedWords: true,
      atMs: Date.now(),
      responseLatencyMs: Math.max(0, Date.now() - (noticeStartedRef.current ?? Date.now())),
    }]
    appendEntry({ role: 'user', content: text, atMs: Date.now() })
    // L1 deterministic floor — runs before any generation.
    if (detectCrisisKeywords(text)) {
      activateGrounding(); dispatch({ type: 'CRISIS' }); submittingRef.current = false; setIsSubmitting(false); return
    }

    // L2 classifier: risk=2 aborts immediately; the resolved risk (0|1) is folded
    // into the NOTICE, capped at RISK_RACE_MS so routing includes it when fast.
    const riskPromise: Promise<CrisisRisk> = classifyCrisisRisk(text, getLanguageCode())
      .then(r => r.risk)
      .catch(() => 0 as CrisisRisk)
    void riskPromise.then((risk) => {
      if (risk === 2) { activateGrounding(); dispatch({ type: 'CRISIS' }); abortRef.current?.abort() }
    })

    const interweave = selectInterweave(text, {
      lastInterweave: stateRef.current.lastInterweave,
      grounding: isGroundingActive(),
      userPartNames: userPartNamesRef.current,
    })
    if (interweave) interweavesUsedRef.current = [...interweavesUsedRef.current, interweave]

    const system = buildDriftSystemPrompt({
      language: getLanguageCode(),
      hrvContext,
      interweave,
      userPartNames: userPartNamesRef.current,
    })
    const history: ChatMessage[] = transcriptRef.current
      .filter(e => e.role !== 'cue')
      .map(e => ({ role: e.role === 'companion' ? 'assistant' : 'user', content: e.content }))
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history]

    const controller = new AbortController()
    abortRef.current = controller
    setStreamingText('')
    let acc = ''
    let companion: string | null = null
    await streamChatCompletion(messages, {
      onToken: (tok) => { acc += tok; setStreamingText(acc) },
      onComplete: (full) => { companion = full },
      onError: () => { /* leave companion null; the flow still advances below */ },
    }, NOTICE_MAX_TOKENS, reasoningForSpeed(getSettings().responseSpeed), controller.signal)
    setStreamingText('')
    // Truthy, not just non-null: a truncated/empty completion must not append a
    // blank companion bubble (the flow still advances via the NOTICE dispatch).
    if (companion) {
      appendEntry({ role: 'companion', content: companion, atMs: Date.now() })
      setCompanionCue(companion)
    }

    let timer: ReturnType<typeof setTimeout>
    const risk = await Promise.race<CrisisRisk>([
      riskPromise,
      new Promise<CrisisRisk>((res) => { timer = setTimeout(() => res(0), RISK_RACE_MS) }),
    ])
    clearTimeout(timer!)
    // NOTICE is a no-op if a crisis already closed the session (reducer guards it).
    dispatch({ type: 'NOTICE', direction, risk, interweave })
    submittingRef.current = false
    setIsSubmitting(false)
  }, [appendEntry, hrvContext])

  const settleDone = useCallback(() => { dispatch({ type: 'SETTLE_DONE' }) }, [])
  const requestClose = useCallback(() => { dispatch({ type: 'REQUEST_CLOSE' }) }, [])

  const persistFinal = useCallback(async (outcome: DriftOutcome) => {
    const id = docIdRef.current
    if (!id) return
    try {
      await persistReadyRef.current
      await db.driftSessions.update(id, {
        outcome,
        endedAt: Date.now(),
        setCount: stateRef.current.setCount,
        interweavesUsed: interweavesUsedRef.current,
        transcript: transcriptRef.current,
        checkIns: checkInsRef.current,
        softerTotal: stateRef.current.softerTotal,
        closureReason: stateRef.current.closureReason,
        actualDurationMs: startRef.current == null ? undefined : Date.now() - startRef.current,
        interruptions: interruptionsRef.current,
      })
    } catch { /* non-fatal */ }
  }, [])

  const closureDone = useCallback(async () => {
    const outcome = outcomeForReason(stateRef.current.closureReason)
    dispatch({ type: 'CLOSURE_DONE' })
    await persistFinal(outcome)
  }, [persistFinal])

  const abandon = useCallback(async () => {
    if (stateRef.current.phase === 'closed') return
    await persistFinal('abandoned')
  }, [persistFinal])

  const recordInterruption = useCallback(() => { interruptionsRef.current += 1 }, [])

  // Grounding from ANY source (L1/L2 here, or crisis raised elsewhere) aborts Drift.
  useEffect(() => subscribeGrounding(() => {
    if (isGroundingActive()) dispatch({ type: 'CRISIS' })
  }), [])

  // Session clock → TICK. The session/time cap lives in the reducer.
  useEffect(() => {
    const id = setInterval(() => {
      if (startRef.current == null) return
      dispatch({ type: 'TICK', elapsedMs: Date.now() - startRef.current })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // Debounced mid-session persistence while active; finals go through persistFinal.
  useEffect(() => {
    if (!docIdRef.current || state.phase === 'closed') return
    const id = setTimeout(() => {
      const docId = docIdRef.current
      if (!docId) return
      void persistReadyRef.current.then(() => db.driftSessions.update(docId, {
        transcript: transcriptRef.current,
        setCount: state.setCount,
        interweavesUsed: interweavesUsedRef.current,
        checkIns: checkInsRef.current,
        interruptions: interruptionsRef.current,
      })).catch(() => {})
    }, PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [state.setCount, state.phase, transcript])

  return {
    state,
    transcript,
    streamingText,
    companionCue,
    isSubmitting,
    begin,
    completeSet,
    submitNotice,
    submitNoticeTap,
    settleDone,
    requestClose,
    closureDone,
    abandon,
    recordInterruption,
    voiceActive,
  }
}
