import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import type { Session, SessionMessage } from '../types'
import type { TherapistContext } from '../engine/sessionContextLoader'

// ─── Mocks (hoisted by Vitest) ────────────────────────────────

// streamChatCompletion: tests reach in via streamMock.mockImplementation to
// control onToken/onComplete/onError per case.
const streamMock = vi.fn()
vi.mock('../ai/openrouter', () => ({
  streamChatCompletion: (...args: unknown[]) => streamMock(...args),
  reasoningForSpeed: () => 'medium',
}))

vi.mock('../ai/therapistPrompts', () => ({
  buildTherapistMessages: () => [{ role: 'system', content: 'stub' }],
}))

vi.mock('../engine/sessionContextLoader', () => ({
  loadInSessionRelaxBreaks: async () => [],
}))

const isGroundingMock = vi.fn(() => false)
vi.mock('./useGroundingMode', () => ({
  isGroundingActive: () => isGroundingMock(),
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
  checkCrisisRisk: (text: string, lang: string) => Promise<{ risk: 0 | 1 | 2; reason: string }>
  checkCrisisKeywords: (text: string) => void
  checkEmotionAfterMessage: (text: string) => Promise<{ emotion: string } | null>
  generateSessionNote: () => Promise<string>
}> = {}) {
  return {
    detectPhase: vi.fn(() => 'opening' as const),
    getMaxTokens: vi.fn(() => 300),
    checkCrisisRisk: vi.fn(async () => ({ risk: 0 as const, reason: '' })),
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
    orchestrator, // exposed for assertions
  }
}

beforeEach(() => {
  streamMock.mockReset()
  sessionMessageAddMock.mockClear()
  sessionUpdateMock.mockClear()
  weatherRecordMock.mockClear()
  weatherShouldPersistMock.mockClear()
  weatherPersistMock.mockClear()
  isGroundingMock.mockReturnValue(false)
  idCounter = 0
})

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

// ─── Tests: crisis-detection race (load-bearing safety invariant) ─────────

describe('useSessionStream — crisis-detection race wiring', () => {
  // Note: the precise abort-before-first-token timing is sensitive to JS
  // microtask scheduling and is hard to reproduce reliably in jsdom. These
  // tests verify the STRUCTURE — the classifier is fired in parallel with
  // streaming, with the right inputs, and on the right turns. The aborting
  // behavior itself is validated end-to-end on the live site.

  it('fires checkCrisisRisk in parallel on the first attempt when a user message exists', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('safe')
      callbacks.onComplete()
    })

    const orchestrator = makeOrchestrator({
      checkCrisisRisk: vi.fn(async () => ({ risk: 0 as const, reason: '' })),
    })
    const tw = makeTypewriter()
    const wiring = makeWiring({
      orchestrator,
      typewriter: tw,
      messages: [{ id: 'u1', speaker: 'user', partId: null, partName: null, content: 'how are you?', timestamp: 1, phase: 'opening', isEmergence: false }],
    })

    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const p = result.current.generateTherapistMessage(wiring.messagesRef.current!, wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('all good')
      await p
    })

    expect(orchestrator.checkCrisisRisk).toHaveBeenCalledWith('how are you?', 'en')
  })

  it('does NOT fire the L2 classifier when the conversation has no user message yet (opening turn)', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('Hello.')
      callbacks.onComplete()
    })

    const orchestrator = makeOrchestrator()
    const tw = makeTypewriter()
    const wiring = makeWiring({ orchestrator, typewriter: tw })

    const { result } = renderHook(() => useSessionStream(wiring))

    await act(async () => {
      const p = result.current.generateTherapistMessage([], wiring.sessionRef.current!)
      await Promise.resolve()
      await tw.pendingComplete?.('Hello.')
      await p
    })

    expect(orchestrator.checkCrisisRisk).not.toHaveBeenCalled()
  })

  it('forwards an AbortSignal to streamChatCompletion (the abort plumbing exists)', async () => {
    streamMock.mockImplementation(async (_p, callbacks: { onToken: (t: string) => void; onComplete: () => void }) => {
      callbacks.onToken('content')
      callbacks.onComplete()
    })

    const orchestrator = makeOrchestrator()
    const tw = makeTypewriter()
    const wiring = makeWiring({ orchestrator, typewriter: tw })

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
