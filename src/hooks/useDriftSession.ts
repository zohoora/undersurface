import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { driftReduce, initialDriftState, selectInterweave, outcomeForReason } from '../engine/driftEngine'
import type { DriftState, NoticeDirection } from '../engine/driftEngine'
import { buildDriftSystemPrompt } from '../ai/driftPrompts'
import { streamChatCompletion, classifyCrisisRisk, reasoningForSpeed } from '../ai/openrouter'
import type { CrisisRisk } from '../ai/openrouter'
import { detectCrisisKeywords } from '../engine/sessionOrchestrator'
import { activateGrounding, isGroundingActive, subscribeGrounding } from '../store/groundingState'
import { getSettings } from '../store/settings'
import { getLanguageCode } from '../i18n'
import { db, generateId } from '../store/db'
import type { DriftAnchorKind, DriftBlsChannel, DriftOutcome, DriftSession, DriftTranscriptEntry } from '../types'

const NOTICE_MAX_TOKENS = 220
const RISK_RACE_MS = 1500
const PERSIST_DEBOUNCE_MS = 2000

// Chat message shape accepted by streamChatCompletion.
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface DriftApi {
  state: DriftState
  transcript: DriftTranscriptEntry[]
  streamingText: string
  begin: (anchorKind: DriftAnchorKind, blsChannel: DriftBlsChannel, voice: boolean) => Promise<void>
  confirmAnchor: () => void
  submitStartingPoint: (text: string) => Promise<void>
  submitBaseline: (text: string) => Promise<void>
  completeSet: () => void
  submitNotice: (text: string, direction: NoticeDirection) => Promise<void>
  settleDone: () => void
  requestClose: () => void
  closureDone: () => Promise<void>
  abandon: () => Promise<void>
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
  const [voiceActive, setVoiceActive] = useState(false)

  const startRef = useRef<number | null>(null)
  const docIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const userPartNamesRef = useRef<string[]>([])
  const interweavesUsedRef = useRef<string[]>([])

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

  const begin = useCallback(async (anchorKind: DriftAnchorKind, blsChannel: DriftBlsChannel, voice: boolean) => {
    startRef.current = Date.now()
    setVoiceActive(voice)
    try {
      const parts = await db.userParts.toArray()
      userPartNamesRef.current = parts.filter(p => p.status === 'active').map(p => p.name)
    } catch {
      userPartNamesRef.current = []
    }
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
      voiceUsed: voice,
      hrvPresent: hrvContext != null,
    }
    try { await db.driftSessions.add(record) } catch { /* persistence is non-fatal */ }
    dispatch({ type: 'BEGIN' })
  }, [parentSessionId, hrvContext])

  const confirmAnchor = useCallback(() => { dispatch({ type: 'ANCHOR_CONFIRMED' }) }, [])

  // choose/baseline: crisis-check + store, no LLM call (the next prompt is UI copy).
  const submitStartingPoint = useCallback(async (text: string) => {
    appendEntry({ role: 'user', content: text, atMs: Date.now() })
    if (detectCrisisKeywords(text)) { activateGrounding(); dispatch({ type: 'CRISIS' }); return }
    raceCrisisAbort(text)
    dispatch({ type: 'STARTING_POINT' })
  }, [appendEntry, raceCrisisAbort])

  const submitBaseline = useCallback(async (text: string) => {
    appendEntry({ role: 'user', content: text, atMs: Date.now() })
    if (detectCrisisKeywords(text)) { activateGrounding(); dispatch({ type: 'CRISIS' }); return }
    raceCrisisAbort(text)
    dispatch({ type: 'BASELINE_DONE' })
  }, [appendEntry, raceCrisisAbort])

  const completeSet = useCallback(() => { dispatch({ type: 'SET_COMPLETE' }) }, [])

  const submitNotice = useCallback(async (text: string, direction: NoticeDirection) => {
    appendEntry({ role: 'user', content: text, atMs: Date.now() })
    // L1 deterministic floor — runs before any generation.
    if (detectCrisisKeywords(text)) { activateGrounding(); dispatch({ type: 'CRISIS' }); return }

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
    if (companion != null) appendEntry({ role: 'companion', content: companion, atMs: Date.now() })

    let timer: ReturnType<typeof setTimeout>
    const risk = await Promise.race<CrisisRisk>([
      riskPromise,
      new Promise<CrisisRisk>((res) => { timer = setTimeout(() => res(0), RISK_RACE_MS) }),
    ])
    clearTimeout(timer!)
    // NOTICE is a no-op if a crisis already closed the session (reducer guards it).
    dispatch({ type: 'NOTICE', direction, risk, interweave })
  }, [appendEntry, hrvContext])

  const settleDone = useCallback(() => { dispatch({ type: 'SETTLE_DONE' }) }, [])
  const requestClose = useCallback(() => { dispatch({ type: 'REQUEST_CLOSE' }) }, [])

  const persistFinal = useCallback(async (outcome: DriftOutcome) => {
    const id = docIdRef.current
    if (!id) return
    try {
      await db.driftSessions.update(id, {
        outcome,
        endedAt: Date.now(),
        setCount: stateRef.current.setCount,
        interweavesUsed: interweavesUsedRef.current,
        transcript: transcriptRef.current,
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
      void db.driftSessions.update(docId, {
        transcript: transcriptRef.current,
        setCount: state.setCount,
        interweavesUsed: interweavesUsedRef.current,
      }).catch(() => {})
    }, PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [state.setCount, state.phase, transcript])

  return {
    state,
    transcript,
    streamingText,
    begin,
    confirmAnchor,
    submitStartingPoint,
    submitBaseline,
    completeSet,
    submitNotice,
    settleDone,
    requestClose,
    closureDone,
    abandon,
    voiceActive,
  }
}
