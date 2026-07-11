import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import type { Session, SessionMessage } from '../types'
import type { TherapistContext } from '../engine/sessionContextLoader'
import { SessionRuntime } from '../engine/sessionRuntime'

// ─── Mocks (hoisted by Vitest) ────────────────────────────────

// streamChatCompletion: tests reach in via streamMock.mockImplementation to
// control onToken/onComplete/onError per case.
const streamMock = vi.fn()
const classifyCrisisRiskMock = vi.fn(async () => ({ risk: 0 }))
const classifySignalsMock = vi.fn(async () => ({ withdrawal: 0 as const, rumination: 0 as const }))
vi.mock('../ai/openrouter', () => ({
  streamChatCompletion: (...args: unknown[]) => streamMock(...args),
  reasoningForSpeed: () => 'medium',
  classifyCrisisRisk: (...a: unknown[]) => classifyCrisisRiskMock(...a),
  classifySessionSignals: (...a: unknown[]) => classifySignalsMock(...a),
}))

// Captures the options of every prompt build so tests can assert threading.
const buildOptionsSpy = vi.fn()
vi.mock('../ai/therapistPrompts', () => ({
  buildTherapistMessages: (_h: unknown, opts: unknown) => {
    buildOptionsSpy(opts)
    return [{ role: 'system', content: 'stub' }]
  },
}))

let featuresMock: Record<string, boolean> = {}
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => ({ features: featuresMock }),
}))

vi.mock('../engine/sessionContextLoader', () => ({
  loadInSessionRelaxBreaks: async () => [],
}))

const isGroundingMock = vi.fn(() => false)
const activateGroundingMock = vi.fn()
vi.mock('./useGroundingMode', () => ({
  isGroundingActive: () => isGroundingMock(),
  activateGrounding: (...a: unknown[]) => activateGroundingMock(...a),
}))

const sessionMessageAddMock = vi.fn(async () => {})
const sessionUpdateMock = vi.fn(async () => {})
const companionSignalsUpdateMock = vi.fn(async () => {})
const userPartsUpdateMock = vi.fn(async () => {})
const intentionUpdateMock = vi.fn(async () => {})
const markResearchDeliveredMock = vi.fn(async () => {})
const writeAmbientTurnOutcomeMock = vi.fn(async () => {})
let idCounter = 0
vi.mock('../store/db', () => ({
  db: {
    sessions: { update: (...a: unknown[]) => sessionUpdateMock(...a) },
    companionSignals: { update: (...a: unknown[]) => companionSignalsUpdateMock(...a) },
    userParts: { update: (...a: unknown[]) => userPartsUpdateMock(...a) },
    sessionIntentions: { update: (...a: unknown[]) => intentionUpdateMock(...a) },
    userProfile: { get: async () => undefined, update: async () => {} },
  },
  sessionMessages: { add: (...a: unknown[]) => sessionMessageAddMock(...a) },
  generateId: () => `msg-${++idCounter}`,
}))
vi.mock('../store/personalScience', () => ({
  markResearchDelivered: (...args: unknown[]) => markResearchDeliveredMock(...args),
}))
vi.mock('../store/interventionOutcomes', () => ({
  writeAmbientTurnOutcome: (...args: unknown[]) => writeAmbientTurnOutcomeMock(...args),
}))

const weatherRecordMock = vi.fn()
const weatherShouldPersistMock = vi.fn(() => false)
const weatherPersistMock = vi.fn(() => Promise.resolve())
vi.mock('../store/weatherStore', () => ({
  getWeatherEngine: () => ({
    recordEmotion: weatherRecordMock,
    shouldPersist: weatherShouldPersistMock,
    persist: weatherPersistMock,
    getCurrentDominantEmotion: () => 'calm',
  }),
}))

vi.mock('../store/settings', () => ({
  useSettings: () => ({ responseSpeed: 'normal' }),
}))

vi.mock('../i18n', () => ({
  useTranslation: () => ({ 'session.error.therapistUnreachable': 'Therapist offline.' }),
  getLanguageCode: () => 'en',
}))

const { useSessionStream } = await import('./useSessionStream')

// ─── Fixtures ─────────────────────────────────────────────────

function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    startedAt: 1000,
    endedAt: null,
    status: 'active',
    hostPartId: 'therapist',
    participantPartIds: [],
    openingMethod: 'auto',
    sessionNote: null,
    messageCount: 0,
    firstLine: '',
    phase: 'opening',
    favorited: false,
    mode: 'standard',
    journalPartsEnabled: true,
    ...over,
  }
}

function makeContext(over: Partial<TherapistContext> = {}): TherapistContext {
  return {
    recentSessionNotes: [],
    relevantMemories: [],
    userProfile: null,
    personalFacts: null,
    recentRelaxBreaks: [],
    repairContext: null,
    ruminationWatch: null,
    activeUserParts: [],
    partProposalCandidate: null,
    openIntentions: [],
    intentionSlotsOpen: false,
    intentionPatternToName: null,
    stanceEntries: [],
    ...over,
  }
}

interface TypewriterMock {
  reset: ReturnType<typeof vi.fn>
  appendToken: ReturnType<typeof vi.fn>
  setOnComplete: ReturnType<typeof vi.fn>
  cleanup: ReturnType<typeof vi.fn>
  displayedContent: string
  pendingComplete: ((text: string) => Promise<void>) | null
}

function makeTypewriter(): TypewriterMock {
  const tw: TypewriterMock = {
    reset: vi.fn(),
    appendToken: vi.fn(),
    setOnComplete: vi.fn(),
    cleanup: vi.fn(),
    displayedContent: '',
    pendingComplete: null,
  }
  tw.setOnComplete.mockImplementation((cb: (text: string) => Promise<void>) => {
    tw.pendingComplete = cb
  })
  return tw
}

function makeOrchestrator(over: Partial<{
  detectPhase: () => 'opening' | 'deepening' | 'closing'
  getMaxTokens: () => number
  checkCrisisKeywords: (text: string) => boolean
  checkEmotionAfterMessage: (text: string) => Promise<{ emotion: string } | null>
  generateSessionNote: () => Promise<string>
}> = {}) {
  return {
    detectPhase: vi.fn(() => 'opening' as const),
    getMaxTokens: vi.fn(() => 300),
    checkCrisisKeywords: vi.fn(() => false),
    checkEmotionAfterMessage: vi.fn(async () => null),
    generateSessionNote: vi.fn(async () => ''),
    ...over,
  }
}

function makeWiring(over: {
  session?: Session
  messages?: SessionMessage[]
  context?: TherapistContext | null
  orchestrator?: ReturnType<typeof makeOrchestrator>
  typewriter?: TypewriterMock
} = {}) {
  const sessionRef = createRef<Session | null>() as RefObject<Session | null>
  ;(sessionRef as { current: Session | null }).current = over.session ?? makeSession()
  const messagesRef = createRef<SessionMessage[]>() as RefObject<SessionMessage[]>
  ;(messagesRef as { current: SessionMessage[] }).current = over.messages ?? []
  const contextRef = createRef<TherapistContext | null>() as RefObject<TherapistContext | null>
  ;(contextRef as { current: TherapistContext | null }).current = over.context !== undefined ? over.context : makeContext()
  const orchestrator = over.orchestrator ?? makeOrchestrator()
  const typewriter = over.typewriter ?? makeTypewriter()
  const runtime = new SessionRuntime()
  runtime.begin(sessionRef.current?.id ?? null)

  return {
    sessionRef,
    messagesRef,
    contextRef,
    orchestratorRef: { current: orchestrator } as unknown as Parameters<typeof useSessionStream>[0]['orchestratorRef'],
    setSession: vi.fn(),
    setMessages: vi.fn(),
    setIsStreaming: vi.fn(),
    setOpenerError: vi.fn(),
    hrv: {
      enabled: false,
      buildPromptContext: vi.fn(() => null),
      resetResponseStarted: vi.fn(),
      markResponseStarted: vi.fn(() => false),
      addConversationEvent: vi.fn(),
    } as unknown as Parameters<typeof useSessionStream>[0]['hrv'],
    typewriter: typewriter as unknown as Parameters<typeof useSessionStream>[0]['typewriter'],
    // Real serialization primitive: a promise-chain queue. Using the actual
    // behavior (not a passthrough) keeps the append-ordering tests honest.
    enqueueAppend: makeEnqueue(),
    runtime,
    orchestrator, // exposed for assertions
  }
}

// Mirror of SessionRuntime's append chaining for focused hook tests.
function makeEnqueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    tail = run.then(() => {}, () => {})
    return run
  }
}

beforeEach(() => {
  streamMock.mockReset()
  sessionMessageAddMock.mockClear()
  sessionUpdateMock.mockClear()
  weatherRecordMock.mockClear()
  weatherShouldPersistMock.mockClear()
  weatherPersistMock.mockClear()
  activateGroundingMock.mockClear()
  classifyCrisisRiskMock.mockReset()
  classifyCrisisRiskMock.mockResolvedValue({ risk: 0 })
  classifySignalsMock.mockReset()
  classifySignalsMock.mockResolvedValue({ withdrawal: 0, rumination: 0 })
  buildOptionsSpy.mockClear()
  companionSignalsUpdateMock.mockClear()
  userPartsUpdateMock.mockClear()
  intentionUpdateMock.mockClear()
  markResearchDeliveredMock.mockClear()
  writeAmbientTurnOutcomeMock.mockClear()
  featuresMock = {}
  isGroundingMock.mockReturnValue(false)
  idCounter = 0
})

function makeUserMsg(content: string): SessionMessage {
  return { id: 'u1', speaker: 'user', partId: null, partName: null, content, timestamp: 1, phase: 'opening', isEmergence: false }
}

// ─── Tests: generateTherapistMessage happy path ───────────────

describe('useSessionStream — generateTherapistMessage (happy path)', () => {
  it('commits a new SessionMessage when the stream produces content', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('Hello ')
      callbacks.onToken('writer.')
      callbacks.onComplete()
    })

    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionStream(wiring))

    let returnedMessages: SessionMessage[] = []
    await act(async () => {
      const p = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      // The hook stashes a finalize callback via typewriter.setOnComplete.
      // Invoke it as the real typewriter would once display catches up.
      await Promise.resolve()
      const tw = wiring.typewriter as unknown as TypewriterMock
      await tw.pendingComplete?.('Hello writer.')
      returnedMessages = await p
    })

    expect(sessionMessageAddMock).toHaveBeenCalledOnce()
    const [sessionId, msg] = sessionMessageAddMock.mock.calls[0]
    expect(sessionId).toBe('sess-1')
    expect((msg as SessionMessage).speaker).toBe('therapist')
    expect((msg as SessionMessage).content).toBe('Hello writer.')
    expect(returnedMessages).toHaveLength(1)
    expect(wiring.setIsStreaming).toHaveBeenCalledWith(false)
  })

  it('stores the prior companion-to-writer fit and updates ambient context', async () => {
    const priorCompanion = { ...makeUserMsg('A companion reflection.'), id: 'a1', speaker: 'therapist' as const }
    const latestWriter = { ...makeUserMsg('That gets closer.'), id: 'u2' }
    const messages = [priorCompanion, latestWriter]
    streamMock.mockImplementation(async (_p, callbacks: {
      onToken: (t: string) => void
      onAmbientAssessment?: (value: unknown) => void
      onComplete: () => void
    }) => {
      callbacks.onAmbientAssessment?.({
        fit: 'partial', movement: 'clarified', agency: 'more', confidence: 'medium',
        state: 'open', capacity: 'stay', need: 'perspective',
      })
      callbacks.onToken('A reply.')
      callbacks.onComplete()
    })
    const wiring = makeWiring({ messages })
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const pending = result.current.generateTherapistMessage(messages, wiring.sessionRef.current!)
      await Promise.resolve()
      await (wiring.typewriter as unknown as TypewriterMock).pendingComplete?.('A reply.')
      await pending
      await Promise.resolve()
    })

    expect(buildOptionsSpy.mock.calls[0][0].includeAmbientAssessment).toBe(true)
    expect(writeAmbientTurnOutcomeMock).toHaveBeenCalledWith(
      priorCompanion,
      latestWriter,
      'sess-1',
      expect.objectContaining({ fit: 'partial', confidence: 'medium' }),
    )
    expect(sessionUpdateMock).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      researchContext: expect.objectContaining({ state: 'open', capacity: 'stay', need: 'perspective' }),
    }))
  })

  it('uses risk-only streaming and records no ambient evidence in Fresh eyes', async () => {
    const messages = [
      { ...makeUserMsg('A companion reflection.'), id: 'a1', speaker: 'therapist' as const },
      { ...makeUserMsg('Keep this private.'), id: 'u2' },
    ]
    streamMock.mockImplementation(async (_p, callbacks: {
      onToken: (t: string) => void
      onAmbientAssessment?: (value: unknown) => void
      onComplete: () => void
    }) => {
      expect(callbacks.onAmbientAssessment).toBeUndefined()
      callbacks.onToken('A private reply.')
      callbacks.onComplete()
    })
    const wiring = makeWiring({ session: makeSession({ memoryAperture: 'fresh' }), messages })
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const pending = result.current.generateTherapistMessage(messages, wiring.sessionRef.current!)
      await Promise.resolve()
      await (wiring.typewriter as unknown as TypewriterMock).pendingComplete?.('A private reply.')
      await pending
    })

    expect(buildOptionsSpy.mock.calls[0][0].includeAmbientAssessment).toBe(false)
    expect(writeAmbientTurnOutcomeMock).not.toHaveBeenCalled()
  })
})

// ─── Tests: cross-session guard (P0) ──────────────────────────

describe('useSessionStream — cross-session finalize guard', () => {
  it('persists to the original session but skips React-state writes after a session switch', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('A reply.')
      callbacks.onComplete()
    })

    const wiring = makeWiring() // session sess-1
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const p = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      await Promise.resolve()
      // User navigates to a different session before the reveal finalizes.
      ;(wiring.sessionRef as { current: Session | null }).current = makeSession({ id: 'sess-2' })
      const tw = wiring.typewriter as unknown as TypewriterMock
      await tw.pendingComplete?.('A reply.')
      await p
    })

    // The paid message is still persisted — to its OWN session, sess-1.
    expect(sessionMessageAddMock).toHaveBeenCalledOnce()
    expect(sessionMessageAddMock.mock.calls[0][0]).toBe('sess-1')
    // But it must NOT overwrite the now-active session's live view.
    expect(wiring.setMessages).not.toHaveBeenCalled()
    expect(wiring.setIsStreaming).not.toHaveBeenCalledWith(false)
  })
})

// ─── Tests: serialized appends (no lost messages) ─────────────

describe('useSessionStream — deterministic research delivery', () => {
  it('persists a fixed arm with research metadata through the serialized companion path', async () => {
    const wiring = makeWiring({ messages: [makeUserMsg('I need room.')] })
    const { result } = renderHook(() => useSessionStream(wiring))
    const event = {
      id: 'r1', protocolId: 'subtraction-v1', protocolVersion: 1, assignmentKind: 'randomized',
      status: 'assigned', source: 'talk', sessionId: 'sess-1', eligibilityPoint: 'user-turn-2',
      assignmentSeed: 'seed', assignedArm: 'designed_silence', responseMode: 'offer_quiet',
      provider: 'deterministic', promptVersion: 'personal-science-v1', appVersion: 'test',
      createdAt: 1, updatedAt: 1,
    } as const

    await act(async () => {
      await result.current.appendDeterministicCompanionMessage('Take the space.', event)
    })

    expect(sessionMessageAddMock).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      content: 'Take the space.',
      responseMode: 'offer_quiet',
      researchEventId: 'r1',
      researchArm: 'designed_silence',
    }))
    expect(markResearchDeliveredMock).toHaveBeenCalledWith(event, 'msg-1')
  })
})

describe('useSessionStream — appendUserMessage serialization', () => {
  it('two concurrent appends both land — neither clobbers the other (N → N+2)', async () => {
    // Add latency so both appends overlap: without the queue they would both
    // read the same base array and the last write would win (N+1, one lost).
    // Restore the default impl after — mockClear (beforeEach) keeps the impl,
    // so leaking it would hang later fake-timer tests on this real setTimeout.
    sessionMessageAddMock.mockImplementation(async () => { await new Promise(r => setTimeout(r, 5)) })
    try {
      const wiring = makeWiring()
      const { result } = renderHook(() => useSessionStream(wiring))

      await act(async () => {
        const a = result.current.appendUserMessage('first', 'text')
        const b = result.current.appendUserMessage('second', 'text')
        await Promise.all([a, b])
      })

      expect(wiring.messagesRef.current).toHaveLength(2)
      expect(wiring.messagesRef.current.map(m => m.content)).toEqual(['first', 'second'])
      // messageCount persisted must reach 2, not stay at 1.
      const lastUpdate = sessionUpdateMock.mock.calls.at(-1)?.[1] as { messageCount: number }
      expect(lastUpdate.messageCount).toBe(2)
    } finally {
      sessionMessageAddMock.mockImplementation(async () => {})
    }
  })
})

// ─── Tests: empty-completion retries ──────────────────────────

describe('useSessionStream — empty-completion retries', () => {
  // Fake timers let the hook's internal backoff (`500 + n*300` ms) elapse
  // without burning real wall-clock time AND without leaking into the next
  // test's microtask queue, which was causing renderHook state pollution.
  beforeEach(() => { vi.useFakeTimers() })

  it('retries up to 3 times when finalize receives an empty string', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onComplete: () => void }) => {
      callbacks.onComplete()
    })

    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw })
    const { result } = renderHook(() => useSessionStream(wiring))

    let finalPromise: Promise<SessionMessage[]>
    await act(async () => {
      finalPromise = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      for (let i = 0; i < 3; i++) {
        await Promise.resolve()
        await tw.pendingComplete?.('')
        await vi.advanceTimersByTimeAsync(1200)
      }
      await finalPromise!
    })

    expect(sessionMessageAddMock).not.toHaveBeenCalled()
    expect(wiring.setOpenerError).toHaveBeenLastCalledWith('Therapist offline.')
    // The fixture's orchestrator starts at 300; retries must add 400 each.
    expect(streamMock.mock.calls.map(call => call[2])).toEqual([300, 700, 1100])
    vi.useRealTimers()
  })

  it('commits and returns early when a retry attempt succeeds', async () => {
    let callCount = 0
    streamMock.mockImplementation(async (_p, callbacks: { onComplete: () => void }) => {
      callCount++
      callbacks.onComplete()
    })

    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw })
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const p = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('')
      await vi.advanceTimersByTimeAsync(600)
      await Promise.resolve()
      await tw.pendingComplete?.('OK got it.')
      await p
    })

    expect(callCount).toBeGreaterThanOrEqual(2)
    expect(sessionMessageAddMock).toHaveBeenCalledOnce()
    expect(wiring.setOpenerError).not.toHaveBeenCalledWith('Therapist offline.')
    vi.useRealTimers()
  })
})

// ─── Tests: onRisk wiring (load-bearing safety invariant) ─────────────────

describe('useSessionStream — onRisk preamble wiring', () => {
  // The therapist now emits <<RISK:N>>\\n\\n as the first content of the
  // stream; the openrouter preamble parser strips it and fires onRisk
  // before any token reaches the typewriter. These tests cover the hook's
  // handling of that callback: risk=2 activates grounding, risk=2 on the
  // first attempt aborts and retries, risk=0/1 do not affect grounding.

  it('does NOT activate grounding when onRisk fires with risk=0', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onRisk?: (r: 0 | 1 | 2) => void; onComplete: () => void }) => {
      callbacks.onRisk?.(0)
      callbacks.onToken('All clear.')
      callbacks.onComplete()
    })

    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw })
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const p = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('All clear.')
      await p
    })

    expect(activateGroundingMock).not.toHaveBeenCalled()
  })

  it('does NOT activate grounding when onRisk fires with risk=1', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onRisk?: (r: 0 | 1 | 2) => void; onComplete: () => void }) => {
      callbacks.onRisk?.(1)
      callbacks.onToken('soft signal')
      callbacks.onComplete()
    })

    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw })
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const p = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('soft signal')
      await p
    })

    expect(activateGroundingMock).not.toHaveBeenCalled()
  })

  it('activates grounding without aborting when risk=2 arrives AFTER first content token', async () => {
    // Once the first content token has reached the typewriter, the hook
    // trusts SAFETY_RULES to constrain the in-flight response and does NOT
    // abort/retry — re-running on a Real Talk callout would loop forever.
    let callCount = 0
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onRisk?: (r: 0 | 1 | 2) => void; onComplete: () => void }) => {
      callCount++
      callbacks.onToken('content arrived')
      callbacks.onRisk?.(2)
      callbacks.onComplete()
    })

    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw })
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const p = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('content arrived')
      await p
    })

    expect(callCount).toBe(1) // No retry — stream was not aborted
    expect(activateGroundingMock).toHaveBeenCalledWith('auto')
  })

  it('backstop: the standalone classifier activates grounding when the preamble is absent', async () => {
    // L2 launches when the user turn is appended, independently of the
    // therapist stream and therefore also on the Speak surface.
    classifyCrisisRiskMock.mockResolvedValue({ risk: 2 })
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      await result.current.appendUserMessage('i cannot keep going like this')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(classifyCrisisRiskMock).toHaveBeenCalledWith('i cannot keep going like this', 'en')
    expect(activateGroundingMock).toHaveBeenCalledWith('auto')
  })

  it('backstop: classifier returning 0 does not activate grounding', async () => {
    classifyCrisisRiskMock.mockResolvedValue({ risk: 0 })
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionStream(wiring))
    await act(async () => {
      await result.current.appendUserMessage('just a normal day')
      await Promise.resolve()
    })
    expect(activateGroundingMock).not.toHaveBeenCalled()
  })

  it('backstop: classifier is NOT called when grounding is already active', async () => {
    isGroundingMock.mockReturnValue(true)
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionStream(wiring))
    await act(async () => {
      await result.current.appendUserMessage('anything')
    })
    expect(classifyCrisisRiskMock).not.toHaveBeenCalled()
  })

  it('backstop: classifier is not called by an opener generation (no appended user message)', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('Welcome.')
      callbacks.onComplete()
    })
    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw })
    const { result } = renderHook(() => useSessionStream(wiring))
    await act(async () => {
      const p = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('Welcome.')
      await p
    })
    expect(classifyCrisisRiskMock).not.toHaveBeenCalled()
  })

  it('forwards an AbortSignal to streamChatCompletion (the abort plumbing exists)', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('content')
      callbacks.onComplete()
    })

    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw })

    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const p = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('content')
      await p
    })

    const [, , , , signal] = streamMock.mock.calls[0]
    expect(signal).toBeInstanceOf(AbortSignal)
  })
})

// ─── Tests: appendUserMessage ─────────────────────────────────

describe('useSessionStream — appendUserMessage', () => {
  it('persists a user turn and fires the synchronous crisis-keyword check', async () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionStream(wiring))

    let res: Awaited<ReturnType<typeof result.current.appendUserMessage>>
    await act(async () => {
      res = await result.current.appendUserMessage('I have been feeling down.')
    })

    expect(sessionMessageAddMock).toHaveBeenCalledOnce()
    const [, msg] = sessionMessageAddMock.mock.calls[0]
    expect((msg as SessionMessage).speaker).toBe('user')
    expect((msg as SessionMessage).content).toBe('I have been feeling down.')
    // Crisis keyword check fired synchronously BEFORE return — the in-prompt
    // grounding invariant relies on this.
    expect(wiring.orchestrator.checkCrisisKeywords).toHaveBeenCalledWith('I have been feeling down.')
    expect(res).not.toBeNull()
    expect(res!.updatedMessages).toHaveLength(1)
  })

  it('records weather emotion when the async LLM check returns one', async () => {
    const orchestrator = makeOrchestrator({
      checkEmotionAfterMessage: vi.fn(async () => ({ emotion: 'sad' })),
    })
    const wiring = makeWiring({ orchestrator })
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => { await result.current.appendUserMessage('hard day') })
    await waitFor(() => {
      expect(weatherRecordMock).toHaveBeenCalledWith('sad')
    })
  })

  it('drops whitespace-only content', async () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionStream(wiring))

    let res: Awaited<ReturnType<typeof result.current.appendUserMessage>>
    await act(async () => { res = await result.current.appendUserMessage('   ') })

    expect(res).toBeNull()
    expect(sessionMessageAddMock).not.toHaveBeenCalled()
  })

  it('returns null for a closed session (race protection)', async () => {
    const wiring = makeWiring({ session: makeSession({ status: 'closed' }) })
    const { result } = renderHook(() => useSessionStream(wiring))

    let res: Awaited<ReturnType<typeof result.current.appendUserMessage>>
    await act(async () => { res = await result.current.appendUserMessage('hello') })

    expect(res).toBeNull()
    expect(sessionMessageAddMock).not.toHaveBeenCalled()
  })

  it('tags voice-input turns with inputMethod=voice', async () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => { await result.current.appendUserMessage('spoken aloud', 'voice') })
    const [, msg] = sessionMessageAddMock.mock.calls[0]
    expect((msg as SessionMessage).inputMethod).toBe('voice')
  })
})

// ─── Rupture repair / rumination pivot wiring ────────────────────────────────

describe('session signals wiring', () => {
  function streamOk(text = 'A reply.') {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken(text)
      callbacks.onComplete()
    })
  }

  async function runGenerate(
    result: { current: { generateTherapistMessage: (m: SessionMessage[], s: Session) => Promise<SessionMessage[]> } },
    wiring: ReturnType<typeof makeWiring>,
    tw: TypewriterMock,
    messages: SessionMessage[],
    reply = 'A reply.',
  ) {
    await act(async () => {
      // Wait for THIS generate's completion handler to register — a fixed
      // single microtask undercounts when the fire-and-forget classifier
      // consumes ticks, leaving pendingComplete pointing at the previous
      // generate's (already-settled) closure and hanging the run.
      tw.pendingComplete = null
      const p = result.current.generateTherapistMessage(messages, wiring.sessionRef.current!)
      for (let i = 0; i < 1000 && !tw.pendingComplete; i++) await Promise.resolve()
      await tw.pendingComplete?.(reply)
      await p
      // Let the fire-and-forget classifier .then land.
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const threeUserMsgs = [
    makeUserMsg('first message here'),
    makeUserMsg('second message here'),
    makeUserMsg('third message here'),
  ]

  it('fires the signal classifier from user turn 3 when a flag is on', async () => {
    featuresMock = { ruminationPivot: true }
    streamOk()
    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw, messages: threeUserMsgs })
    const { result } = renderHook(() => useSessionStream(wiring))

    await runGenerate(result, wiring, tw, threeUserMsgs)

    expect(classifySignalsMock).toHaveBeenCalledTimes(1)
    expect(classifySignalsMock).toHaveBeenCalledWith([
      'first message here', 'second message here', 'third message here',
    ])
  })

  it('does NOT fire the classifier below 3 user messages or with flags off', async () => {
    streamOk()
    const tw = makeTypewriter()
    // Flags off, 3 messages:
    const wiring = makeWiring({ typewriter: tw, messages: threeUserMsgs })
    const { result } = renderHook(() => useSessionStream(wiring))
    await runGenerate(result, wiring, tw, threeUserMsgs)
    expect(classifySignalsMock).not.toHaveBeenCalled()

    // Flag on, 2 messages:
    featuresMock = { ruptureRepair: true }
    const tw2 = makeTypewriter()
    const wiring2 = makeWiring({ typewriter: tw2, messages: threeUserMsgs.slice(0, 2) })
    const { result: result2 } = renderHook(() => useSessionStream(wiring2))
    await runGenerate(result2, wiring2, tw2, threeUserMsgs.slice(0, 2))
    expect(classifySignalsMock).not.toHaveBeenCalled()
  })

  it('threads repairContext into the opener build, then consumes it exactly once', async () => {
    featuresMock = { ruptureRepair: true }
    streamOk('Good to see you again.')
    const tw = makeTypewriter()
    const context = makeContext({ repairContext: { evidence: 'abandoned' } })
    const wiring = makeWiring({ typewriter: tw, context })
    const { result } = renderHook(() => useSessionStream(wiring))

    // Opener (no messages → first turn).
    await runGenerate(result, wiring, tw, [], 'Good to see you again.')

    expect(buildOptionsSpy.mock.calls[0][0]).toMatchObject({
      isFirstTurn: true,
      repairContext: { evidence: 'abandoned' },
    })
    // Consume-once: in-memory copy nulled + persistent slot cleared.
    expect(wiring.contextRef.current?.repairContext).toBeNull()
    expect(companionSignalsUpdateMock).toHaveBeenCalledWith('current', expect.objectContaining({
      pendingRepair: null,
    }))

    // A second first-turn build must NOT re-include it.
    buildOptionsSpy.mockClear()
    await runGenerate(result, wiring, tw, [], 'Welcome back.')
    expect(buildOptionsSpy.mock.calls[0][0].repairContext).toBeUndefined()
  })

  it('does not thread repairContext when its flag is off', async () => {
    featuresMock = { ruminationPivot: true } // other flag on, repair off
    streamOk()
    const tw = makeTypewriter()
    const context = makeContext({ repairContext: { evidence: 'atypical_gap' } })
    const wiring = makeWiring({ typewriter: tw, context })
    const { result } = renderHook(() => useSessionStream(wiring))

    await runGenerate(result, wiring, tw, [])

    expect(buildOptionsSpy.mock.calls[0][0].repairContext).toBeUndefined()
    expect(companionSignalsUpdateMock).not.toHaveBeenCalled()
  })

  it('an armed ruminationWatch pivots at most once per session, never on the opener', async () => {
    featuresMock = { ruminationPivot: true }
    streamOk()
    const tw = makeTypewriter()
    const context = makeContext({ ruminationWatch: { theme: 'the job decision' } })
    const withTherapist = [...threeUserMsgs, { ...makeUserMsg('x'), speaker: 'therapist' as const }]
    // messagesRef must track the passed history — the finalize path treats an
    // append that doesn't grow past currentMessages as an empty completion.
    const wiring = makeWiring({ typewriter: tw, context, messages: withTherapist })
    const { result } = renderHook(() => useSessionStream(wiring))

    // Opener: no pivot.
    await runGenerate(result, wiring, tw, [])
    expect(buildOptionsSpy.mock.calls[0][0].pivotDirective).toBeUndefined()

    // First non-first turn: pivot with the watch theme.
    buildOptionsSpy.mockClear()
    await runGenerate(result, wiring, tw, withTherapist)
    expect(buildOptionsSpy.mock.calls[0][0].pivotDirective).toEqual({ theme: 'the job decision' })

    // Next turn: not again.
    buildOptionsSpy.mockClear()
    await runGenerate(result, wiring, tw, withTherapist)
    expect(buildOptionsSpy.mock.calls[0][0].pivotDirective).toBeUndefined()
  })

  it('live tracker: 2 consecutive elevated rumination turns arm exactly one pivot (then cooldown)', async () => {
    featuresMock = { ruminationPivot: true }
    classifySignalsMock.mockResolvedValue({ withdrawal: 0, rumination: 2, theme: 'the move' })
    streamOk()
    const tw = makeTypewriter()
    const withTherapist = [...threeUserMsgs, { ...makeUserMsg('x'), speaker: 'therapist' as const }]
    const wiring = makeWiring({ typewriter: tw, messages: withTherapist })
    const { result } = renderHook(() => useSessionStream(wiring))

    // Whether the arming record lands just before or just after a given build
    // is a microtask-ordering detail; the invariant is exactly ONE pivot fires
    // across sustained elevation (cooldown blocks repeats).
    await runGenerate(result, wiring, tw, withTherapist) // record #1 — not armed
    await runGenerate(result, wiring, tw, withTherapist) // record #2 — arms
    await runGenerate(result, wiring, tw, withTherapist) // consumes / cooldown
    await runGenerate(result, wiring, tw, withTherapist) // cooldown

    const pivots = buildOptionsSpy.mock.calls
      .map((c) => (c[0] as { pivotDirective?: { theme?: string } }).pivotDirective)
      .filter(Boolean)
    expect(pivots).toEqual([{ theme: 'the move' }])
  })

  it('live tracker: sustained withdrawal holds softenStance on later builds', async () => {
    featuresMock = { ruptureRepair: true }
    classifySignalsMock.mockResolvedValue({ withdrawal: 2, rumination: 0 })
    streamOk()
    const tw = makeTypewriter()
    const withTherapist = [...threeUserMsgs, { ...makeUserMsg('x'), speaker: 'therapist' as const }]
    const wiring = makeWiring({ typewriter: tw, messages: withTherapist })
    const { result } = renderHook(() => useSessionStream(wiring))

    await runGenerate(result, wiring, tw, withTherapist) // record #1
    await runGenerate(result, wiring, tw, withTherapist) // record #2 — soft arms
    await runGenerate(result, wiring, tw, withTherapist) // held

    const lastBuild = buildOptionsSpy.mock.calls.at(-1)![0] as { softenStance?: boolean }
    expect(lastBuild.softenStance).toBe(true)
  })
})

// ─── User parts wiring ───────────────────────────────────────────────────────

describe('user parts wiring', () => {
  function streamOk(text: string) {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken(text)
      callbacks.onComplete()
    })
  }

  async function runGenerate(
    result: { current: { generateTherapistMessage: (m: SessionMessage[], s: Session) => Promise<SessionMessage[]> } },
    wiring: ReturnType<typeof makeWiring>,
    tw: TypewriterMock,
    messages: SessionMessage[],
    reply: string,
  ) {
    await act(async () => {
      tw.pendingComplete = null
      const p = result.current.generateTherapistMessage(messages, wiring.sessionRef.current!)
      for (let i = 0; i < 1000 && !tw.pendingComplete; i++) await Promise.resolve()
      await tw.pendingComplete?.(reply)
      await p
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const nonOpener = [makeUserMsg('hello there'), { ...makeUserMsg('x'), speaker: 'therapist' as const }]
  const candidate = { id: 'up-7', tentativeName: 'the bracer', description: 'braces before good news', quote: 'here we go again' }

  it('threads activeUserParts + lexicon into the build under the flag', async () => {
    featuresMock = { userParts: true }
    streamOk('A reply.')
    const tw = makeTypewriter()
    const context = makeContext({
      activeUserParts: [{ name: 'the bracer', description: 'braces', stance: 'protective' }],
      personalFacts: { id: 'current', people: [], dates: [], context: [], currentThreads: [], lexicon: ['the basement'], lastUpdated: 1 } as never,
    })
    const wiring = makeWiring({ typewriter: tw, context, messages: nonOpener })
    const { result } = renderHook(() => useSessionStream(wiring))

    await runGenerate(result, wiring, tw, nonOpener, 'A reply.')

    const opts = buildOptionsSpy.mock.calls[0][0]
    expect(opts.activeUserParts).toEqual([{ name: 'the bracer', description: 'braces', stance: 'protective' }])
    expect(opts.lexicon).toEqual(['the basement'])
  })

  it('omits parts context when the flag is off', async () => {
    featuresMock = {}
    streamOk('A reply.')
    const tw = makeTypewriter()
    const context = makeContext({
      activeUserParts: [{ name: 'the bracer', description: 'braces', stance: 'protective' }],
      partProposalCandidate: candidate,
    })
    const wiring = makeWiring({ typewriter: tw, context, messages: nonOpener })
    const { result } = renderHook(() => useSessionStream(wiring))

    await runGenerate(result, wiring, tw, nonOpener, 'A reply.')

    const opts = buildOptionsSpy.mock.calls[0][0]
    expect(opts.activeUserParts).toBeUndefined()
    expect(opts.partProposal).toBeUndefined()
  })

  it('proposal: included on non-openers, stays available until the marker lands, then stamps proposedAt', async () => {
    featuresMock = { userParts: true }
    const tw = makeTypewriter()
    const context = makeContext({ partProposalCandidate: candidate })
    const wiring = makeWiring({ typewriter: tw, context, messages: nonOpener })
    const { result } = renderHook(() => useSessionStream(wiring))

    // Build 1: proposal included; model does NOT emit the marker.
    streamOk('No natural moment yet.')
    await runGenerate(result, wiring, tw, nonOpener, 'No natural moment yet.')
    expect(buildOptionsSpy.mock.calls[0][0].partProposal).toEqual(candidate)
    expect(userPartsUpdateMock).not.toHaveBeenCalled() // no marker → no stamp

    // Build 2: still available; model emits the marker → stamp + stop.
    buildOptionsSpy.mockClear()
    const withMarker = 'I noticed [a part of you that braces?](#propose-part:up-7) today.'
    streamOk(withMarker)
    await runGenerate(result, wiring, tw, nonOpener, withMarker)
    expect(buildOptionsSpy.mock.calls[0][0].partProposal).toEqual(candidate)
    expect(userPartsUpdateMock).toHaveBeenCalledWith('up-7', expect.objectContaining({ proposedAt: expect.any(Number) }))

    // Build 3: offered — no longer included.
    buildOptionsSpy.mockClear()
    streamOk('Onward.')
    await runGenerate(result, wiring, tw, nonOpener, 'Onward.')
    expect(buildOptionsSpy.mock.calls[0][0].partProposal).toBeUndefined()
  })

  it('proposal never rides the opener or a pivot build', async () => {
    featuresMock = { userParts: true, ruminationPivot: true }
    streamOk('A reply.')
    const tw = makeTypewriter()
    const context = makeContext({
      partProposalCandidate: candidate,
      ruminationWatch: { theme: 'the loop' },
    })
    const wiring = makeWiring({ typewriter: tw, context, messages: nonOpener })
    const { result } = renderHook(() => useSessionStream(wiring))

    // Opener build: neither proposal nor pivot.
    await runGenerate(result, wiring, tw, [], 'A reply.')
    expect(buildOptionsSpy.mock.calls[0][0].partProposal).toBeUndefined()

    // Non-opener: the watch pivot fires this build → proposal must wait.
    buildOptionsSpy.mockClear()
    await runGenerate(result, wiring, tw, nonOpener, 'A reply.')
    const opts = buildOptionsSpy.mock.calls[0][0]
    expect(opts.pivotDirective).toEqual({ theme: 'the loop' })
    expect(opts.partProposal).toBeUndefined()

    // Next build: pivot consumed → proposal may ride now.
    buildOptionsSpy.mockClear()
    await runGenerate(result, wiring, tw, nonOpener, 'A reply.')
    expect(buildOptionsSpy.mock.calls[0][0].partProposal).toEqual(candidate)
  })
})

// ─── Intentions + stance wiring ──────────────────────────────────────────────

describe('intentions + stance wiring', () => {
  function streamOk(text: string) {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken(text)
      callbacks.onComplete()
    })
  }

  async function runGenerate(
    result: { current: { generateTherapistMessage: (m: SessionMessage[], s: Session) => Promise<SessionMessage[]> } },
    wiring: ReturnType<typeof makeWiring>,
    tw: TypewriterMock,
    messages: SessionMessage[],
    reply: string,
  ) {
    await act(async () => {
      tw.pendingComplete = null
      const p = result.current.generateTherapistMessage(messages, wiring.sessionRef.current!)
      for (let i = 0; i < 1000 && !tw.pendingComplete; i++) await Promise.resolve()
      await tw.pendingComplete?.(reply)
      await p
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const nonOpener = [makeUserMsg('hello there'), { ...makeUserMsg('x'), speaker: 'therapist' as const }]

  it('threads openIntentions, stanceContext, and the offer flag under their flags', async () => {
    featuresMock = { sessionIntentions: true, stanceAdaptation: true }
    streamOk('A reply.')
    const tw = makeTypewriter()
    const context = makeContext({
      openIntentions: [{ id: 'i1', text: 'call him thursday', notYetCount: 1 }],
      intentionSlotsOpen: true,
      stanceEntries: ['short replies land well'],
    })
    const wiring = makeWiring({ typewriter: tw, context, messages: nonOpener })
    const { result } = renderHook(() => useSessionStream(wiring))

    await runGenerate(result, wiring, tw, nonOpener, 'A reply.')

    const opts = buildOptionsSpy.mock.calls[0][0]
    expect(opts.openIntentions).toEqual([{ id: 'i1', text: 'call him thursday', notYetCount: 1 }])
    expect(opts.intentionOffer).toBe(true)
    expect(opts.stanceContext).toEqual(['short replies land well'])
  })

  it('omits all of it when flags are off', async () => {
    featuresMock = {}
    streamOk('A reply.')
    const tw = makeTypewriter()
    const context = makeContext({
      openIntentions: [{ id: 'i1', text: 'call him thursday', notYetCount: 0 }],
      intentionSlotsOpen: true,
      stanceEntries: ['x'],
    })
    const wiring = makeWiring({ typewriter: tw, context, messages: nonOpener })
    const { result } = renderHook(() => useSessionStream(wiring))

    await runGenerate(result, wiring, tw, nonOpener, 'A reply.')

    const opts = buildOptionsSpy.mock.calls[0][0]
    expect(opts.openIntentions).toBeUndefined()
    expect(opts.intentionOffer).toBeUndefined()
    expect(opts.stanceContext).toBeUndefined()
  })

  it('the offer stops re-arming once a finalized message carried the marker', async () => {
    featuresMock = { sessionIntentions: true }
    const tw = makeTypewriter()
    const context = makeContext({ intentionSlotsOpen: true })
    const wiring = makeWiring({ typewriter: tw, context, messages: nonOpener })
    const { result } = renderHook(() => useSessionStream(wiring))

    const withMarker = 'Carry [calling him](#offer-intention) with you?'
    streamOk(withMarker)
    await runGenerate(result, wiring, tw, nonOpener, withMarker)
    expect(buildOptionsSpy.mock.calls[0][0].intentionOffer).toBe(true)

    buildOptionsSpy.mockClear()
    streamOk('Onward.')
    await runGenerate(result, wiring, tw, nonOpener, 'Onward.')
    expect(buildOptionsSpy.mock.calls[0][0].intentionOffer).toBeUndefined()
  })

  it('pattern nudge: included once, marks patternNamed + feeds avoidance, never stacks with a pivot', async () => {
    featuresMock = { sessionIntentions: true, ruminationPivot: true }
    streamOk('A reply.')
    const tw = makeTypewriter()
    const context = makeContext({
      intentionPatternToName: { id: 'i9', text: 'call him thursday' },
      ruminationWatch: { theme: 'the loop' },
    })
    const wiring = makeWiring({ typewriter: tw, context, messages: nonOpener })
    const { result } = renderHook(() => useSessionStream(wiring))

    // Build 1: the watch pivot wins; nudge must wait.
    await runGenerate(result, wiring, tw, nonOpener, 'A reply.')
    expect(buildOptionsSpy.mock.calls[0][0].pivotDirective).toEqual({ theme: 'the loop' })
    expect(buildOptionsSpy.mock.calls[0][0].namePatternFor).toBeUndefined()

    // Build 2: pivot consumed → nudge rides, then marks named.
    buildOptionsSpy.mockClear()
    await runGenerate(result, wiring, tw, nonOpener, 'A reply.')
    expect(buildOptionsSpy.mock.calls[0][0].namePatternFor).toEqual({ text: 'call him thursday' })
    expect(intentionUpdateMock).toHaveBeenCalledWith('i9', expect.objectContaining({ patternNamed: true }))

    // Build 3: never again.
    buildOptionsSpy.mockClear()
    await runGenerate(result, wiring, tw, nonOpener, 'A reply.')
    expect(buildOptionsSpy.mock.calls[0][0].namePatternFor).toBeUndefined()
  })
})
