import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import type { Session, SessionMessage } from '../types'
import type { TherapistContext } from '../engine/sessionContextLoader'

// ─── Mocks (hoisted by Vitest) ────────────────────────────────

// streamChatCompletion: tests reach in via streamMock.mockImplementation to
// control onToken/onComplete/onError per case.
const streamMock = vi.fn()
const classifyCrisisRiskMock = vi.fn(async () => ({ risk: 0 }))
vi.mock('../ai/openrouter', () => ({
  streamChatCompletion: (...args: unknown[]) => streamMock(...args),
  reasoningForSpeed: () => 'medium',
  classifyCrisisRisk: (...a: unknown[]) => classifyCrisisRiskMock(...a),
}))

vi.mock('../ai/therapistPrompts', () => ({
  buildTherapistMessages: () => [{ role: 'system', content: 'stub' }],
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
let idCounter = 0
vi.mock('../store/db', () => ({
  db: { sessions: { update: (...a: unknown[]) => sessionUpdateMock(...a) } },
  sessionMessages: { add: (...a: unknown[]) => sessionMessageAddMock(...a) },
  generateId: () => `msg-${++idCounter}`,
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

function makeContext(): TherapistContext {
  return {
    recentSessionNotes: [],
    relevantMemories: [],
    userProfile: null,
    personalFacts: null,
    recentRelaxBreaks: [],
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
  checkCrisisKeywords: (text: string) => void
  checkEmotionAfterMessage: (text: string) => Promise<{ emotion: string } | null>
  generateSessionNote: () => Promise<string>
}> = {}) {
  return {
    detectPhase: vi.fn(() => 'opening' as const),
    getMaxTokens: vi.fn(() => 300),
    checkCrisisKeywords: vi.fn(),
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
    orchestrator, // exposed for assertions
  }
}

// Mirror of useAppendQueue's chaining without the React wrapper.
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
    // Simulate a missing/malformed preamble that fails open to 0 — the stream
    // never calls onRisk — while the independent L2 classifier catches it.
    classifyCrisisRiskMock.mockResolvedValue({ risk: 2 })
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('I hear you.')
      callbacks.onComplete()
    })

    const tw = makeTypewriter()
    const userMsg = makeUserMsg('i cannot keep going like this')
    const wiring = makeWiring({ typewriter: tw, messages: [userMsg] })
    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const p = result.current.generateTherapistMessage([userMsg], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('I hear you.')
      await p
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(classifyCrisisRiskMock).toHaveBeenCalledWith('i cannot keep going like this', 'en')
    expect(activateGroundingMock).toHaveBeenCalledWith('auto')
  })

  it('backstop: classifier returning 0 does not activate grounding', async () => {
    classifyCrisisRiskMock.mockResolvedValue({ risk: 0 })
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('Tell me more.')
      callbacks.onComplete()
    })
    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw, messages: [makeUserMsg('just a normal day')] })
    const { result } = renderHook(() => useSessionStream(wiring))
    await act(async () => {
      const p = result.current.generateTherapistMessage([makeUserMsg('just a normal day')], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('Tell me more.')
      await p
      await Promise.resolve()
    })
    expect(activateGroundingMock).not.toHaveBeenCalled()
  })

  it('backstop: classifier is NOT called when grounding is already active', async () => {
    isGroundingMock.mockReturnValue(true)
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('gentle presence')
      callbacks.onComplete()
    })
    const tw = makeTypewriter()
    const wiring = makeWiring({ typewriter: tw, messages: [makeUserMsg('anything')] })
    const { result } = renderHook(() => useSessionStream(wiring))
    await act(async () => {
      const p = result.current.generateTherapistMessage([makeUserMsg('anything')], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('gentle presence')
      await p
    })
    expect(classifyCrisisRiskMock).not.toHaveBeenCalled()
  })

  it('backstop: classifier is not called on an opener turn (no user message)', async () => {
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
