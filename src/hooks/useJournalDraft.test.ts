import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createRef, useCallback, type RefObject } from 'react'
import type { Session, SessionMessage } from '../types'
import type { TherapistContext } from '../engine/sessionContextLoader'
import { SessionRuntime } from '../engine/sessionRuntime'

// Node's own localStorage global shadows jsdom's here (as in settings.test.ts),
// so install a complete in-memory Storage, including key() and length.
class MemoryStorage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  clear() { this.map.clear() }
  getItem(key: string) { return this.map.get(key) ?? null }
  key(index: number) { return [...this.map.keys()][index] ?? null }
  removeItem(key: string) { this.map.delete(key) }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
}
vi.stubGlobal('localStorage', new MemoryStorage())

// ─── Mocks (same seams as useSessionStream.test.ts) ──────────────────────────

const classifyCrisisRiskMock = vi.fn(async () => ({ risk: 0 }))
vi.mock('../ai/openrouter', () => ({
  streamChatCompletion: vi.fn(),
  reasoningForSpeed: () => 'medium',
  classifyCrisisRisk: (...a: unknown[]) => classifyCrisisRiskMock(...(a as [])),
  classifySessionSignals: vi.fn(async () => ({ withdrawal: 0, rumination: 0 })),
}))
vi.mock('../ai/therapistPrompts', () => ({ buildTherapistMessages: () => [] }))
vi.mock('../store/globalConfig', () => ({ getGlobalConfig: () => ({ features: {} }) }))
vi.mock('../engine/sessionContextLoader', () => ({ loadInSessionRelaxBreaks: async () => [] }))
vi.mock('./useGroundingMode', () => ({
  isGroundingActive: () => false,
  activateGrounding: vi.fn(),
}))

// A tiny Firestore stand-in: messages per session, keyed by message id, so a
// retried write with the same id overwrites exactly like setDoc does.
const storedMessages = new Map<string, Map<string, SessionMessage>>()
const sessionMessageAddMock = vi.fn(async (sessionId: string, message: SessionMessage) => {
  const forSession = storedMessages.get(sessionId) ?? new Map<string, SessionMessage>()
  forSession.set(message.id, message)
  storedMessages.set(sessionId, forSession)
})
const sessionUpdateMock = vi.fn(async (...args: unknown[]) => { void args })
let idCounter = 0
vi.mock('../store/db', () => ({
  db: {
    sessions: { update: (...a: unknown[]) => sessionUpdateMock(...a) },
    userProfile: { get: async () => undefined, update: async () => {} },
  },
  sessionMessages: {
    add: (sessionId: string, message: SessionMessage) => sessionMessageAddMock(sessionId, message),
  },
  generateId: () => `gen-${++idCounter}`,
}))
vi.mock('../store/personalScience', () => ({
  markResearchDelivered: vi.fn(async () => {}),
  markResearchCancelled: vi.fn(async () => {}),
}))
vi.mock('../store/interventionOutcomes', () => ({ writeAmbientTurnOutcome: vi.fn(async () => {}) }))
vi.mock('../store/weatherStore', () => ({
  getWeatherEngine: () => ({
    recordEmotion: vi.fn(),
    shouldPersist: () => false,
    persist: async () => {},
  }),
}))
vi.mock('../store/settings', () => ({ useSettings: () => ({ responseSpeed: 'normal' }) }))
vi.mock('../i18n', () => ({
  useTranslation: () => ({}),
  getLanguageCode: () => 'en',
}))

const { useSessionStream } = await import('./useSessionStream')
const { useJournalDraft, JOURNAL_DRAFT_DEBOUNCE_MS } = await import('./useJournalDraft')
const { clearJournalDraftsForUser, journalDraftKey, readJournalDraft, writeJournalDraft } = await import('../store/journalDrafts')
type JournalDraftOwner = import('./useJournalDraft').JournalDraftOwner

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UID = 'uid-1'

function makeSession(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
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

function makeEnqueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    tail = run.then(() => {}, () => {})
    return run
  }
}

// Mirrors SessionView's wiring: one sessionRef that the test moves between
// sessions (the init effect's job in the app), shared by the stream and the
// draft. The draft's append is SessionView's adapter minus the remote re-read.
function makeWiring(session: Session | null) {
  const sessionRef = createRef<Session | null>() as RefObject<Session | null>
  ;(sessionRef as { current: Session | null }).current = session
  const messagesRef = createRef<SessionMessage[]>() as RefObject<SessionMessage[]>
  ;(messagesRef as { current: SessionMessage[] }).current = []
  const contextRef = createRef<TherapistContext | null>() as RefObject<TherapistContext | null>
  ;(contextRef as { current: TherapistContext | null }).current = null
  const orchestrator = {
    detectPhase: vi.fn(() => 'opening' as const),
    getMaxTokens: vi.fn(() => 300),
    checkCrisisKeywords: vi.fn(() => false),
    checkEmotionAfterMessage: vi.fn(async () => null),
  }
  const runtime = new SessionRuntime()
  runtime.begin(session?.id ?? null)
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
      buildPromptContext: vi.fn(() => undefined),
      resetResponseStarted: vi.fn(),
      markResponseStarted: vi.fn(() => false),
      addConversationEvent: vi.fn(),
    },
    typewriter: {} as unknown as Parameters<typeof useSessionStream>[0]['typewriter'],
    enqueueAppend: makeEnqueue(),
    runtime,
    orchestrator,
  }
}

type Wiring = ReturnType<typeof makeWiring>

function moveTo(wiring: Wiring, session: Session | null) {
  ;(wiring.sessionRef as { current: Session | null }).current = session
  ;(wiring.messagesRef as { current: SessionMessage[] }).current = []
  if (session) wiring.runtime.begin(session.id)
}

function useDraftFlow(wiring: Wiring, uid: string | null, sessionId: string | null) {
  const { appendUserMessage } = useSessionStream(wiring)
  const append = useCallback(async (text: string, owner: JournalDraftOwner) => {
    const result = await appendUserMessage(text, 'text', 'journal', {
      ownerSessionId: owner.sessionId,
      messageId: owner.messageId,
    })
    return result !== null
  }, [appendUserMessage])
  return useJournalDraft({ uid, sessionId, append })
}

function renderFlow(wiring: Wiring, sessionId: string | null, uid: string | null = UID) {
  return renderHook(
    ({ id, user }: { id: string | null; user: string | null }) => useDraftFlow(wiring, user, id),
    { initialProps: { id: sessionId, user: uid } },
  )
}

function messagesIn(sessionId: string): SessionMessage[] {
  return [...(storedMessages.get(sessionId)?.values() ?? [])]
}

function allStoredText(): string {
  return [...storedMessages.values()].flatMap(m => [...m.values()]).map(m => m.content).join('\n')
}

beforeEach(() => {
  localStorage.clear()
  storedMessages.clear()
  sessionMessageAddMock.mockClear()
  sessionUpdateMock.mockClear()
  classifyCrisisRiskMock.mockClear()
  idCounter = 0
  // Rejected appends are logged by design; keep the run output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── 1. Durable across reloads ───────────────────────────────────────────────

describe('journal draft persistence', () => {
  it('restores a draft after a remount (simulated reload)', () => {
    vi.useFakeTimers()
    const marker = 'marker-reload-7f3a'
    const wiring = makeWiring(makeSession('A'))
    const first = renderFlow(wiring, 'A')

    act(() => { first.result.current.setText(marker, first.result.current.scope) })
    act(() => { vi.advanceTimersByTime(JOURNAL_DRAFT_DEBOUNCE_MS) })
    expect(readJournalDraft(UID, 'A')?.text).toBe(marker)
    first.unmount()

    const second = renderFlow(makeWiring(makeSession('A')), 'A')
    expect(second.result.current.text).toBe(marker)
  })

  it('debounces writes but flushes on pagehide, so a tab closed mid-sentence keeps it', () => {
    vi.useFakeTimers()
    const wiring = makeWiring(makeSession('A'))
    const { result } = renderFlow(wiring, 'A')

    act(() => { result.current.setText('half a sente', result.current.scope) })
    expect(readJournalDraft(UID, 'A')).toBeNull()

    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(readJournalDraft(UID, 'A')?.text).toBe('half a sente')
  })

  it('flushes a pending change on unmount', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderFlow(makeWiring(makeSession('A')), 'A')
    act(() => { result.current.setText('unsaved yet', result.current.scope) })
    unmount()
    expect(readJournalDraft(UID, 'A')?.text).toBe('unsaved yet')
  })
})

// ─── 2. Session switches never carry words across ────────────────────────────

describe('journal draft ownership across sessions', () => {
  it('A → B → A without submitting: B never contains the marker and A restores it', async () => {
    const marker = 'marker-owned-by-A-91c2'
    const sessionA = makeSession('A')
    const sessionB = makeSession('B')
    const wiring = makeWiring(sessionA)
    const { result, rerender } = renderFlow(wiring, 'A')

    act(() => { result.current.setText(marker, result.current.scope) })
    const scopeA = result.current.scope

    // Sidebar / history navigation to B.
    moveTo(wiring, sessionB)
    rerender({ id: 'B', user: UID })
    expect(result.current.text).toBe('')
    expect(result.current.scope).not.toBe(scopeA)

    // A stale editor event from A's page cannot write into B's draft.
    act(() => { result.current.setText(`${marker} and more`, scopeA) })
    expect(result.current.text).toBe('')

    // Leaving Journal in B contributes only B's own words.
    let outcome: string | undefined
    await act(async () => { outcome = await result.current.commit() })
    expect(outcome).toBe('empty')
    act(() => { result.current.setText('words for B', result.current.scope) })
    await act(async () => { outcome = await result.current.commit() })
    expect(outcome).toBe('sent')
    expect(messagesIn('B').map(m => m.content)).toEqual(['words for B'])

    // Back to A: the marker is restored, untouched.
    moveTo(wiring, sessionA)
    rerender({ id: 'A', user: UID })
    expect(result.current.text).toBe(marker)

    expect(messagesIn('B').some(m => m.content.includes(marker))).toBe(false)
    expect(localStorage.getItem(journalDraftKey(UID, 'B')) ?? '').not.toContain(marker)
    expect(messagesIn('A')).toHaveLength(0)
  })

  it('refuses (never redirects) a commit whose owner is no longer the session on screen', async () => {
    const marker = 'marker-captured-A-55d0'
    const wiring = makeWiring(makeSession('A'))
    const { result } = renderFlow(wiring, 'A')
    act(() => { result.current.setText(marker, result.current.scope) })

    // The route already moved to B but the draft is still bound to A.
    moveTo(wiring, makeSession('B'))
    let outcome: string | undefined
    await act(async () => { outcome = await result.current.commit() })

    expect(outcome).toBe('failed')
    expect(sessionMessageAddMock).not.toHaveBeenCalled()
    expect(result.current.text).toBe(marker)
    expect(readJournalDraft(UID, 'A')?.text).toBe(marker)
  })
})

// ─── 3. A rejected append keeps the words ────────────────────────────────────

describe('journal draft contribution', () => {
  it('keeps the draft when an append is rejected; a retry stores exactly one message', async () => {
    const marker = 'marker-retry-every-word-c0de'
    const wiring = makeWiring(makeSession('A'))
    const { result } = renderFlow(wiring, 'A')
    act(() => { result.current.setText(marker, result.current.scope) })

    sessionMessageAddMock.mockImplementationOnce(async () => { throw new Error('offline') })
    let outcome: string | undefined
    await act(async () => { outcome = await result.current.commit() })
    expect(outcome).toBe('failed')
    expect(result.current.failed).toBe(true)
    expect(result.current.text).toBe(marker)
    expect(readJournalDraft(UID, 'A')?.text).toBe(marker)
    expect(messagesIn('A')).toHaveLength(0)

    await act(async () => { outcome = await result.current.commit() })
    expect(outcome).toBe('sent')
    expect(messagesIn('A').map(m => m.content)).toEqual([marker])
    expect(messagesIn('A')[0].surface).toBe('journal')
    expect(result.current.text).toBe('')
    expect(result.current.failed).toBe(false)
    expect(readJournalDraft(UID, 'A')).toBeNull()
  })

  it('a retry after a partial write (message stored, session update failed) still yields one message', async () => {
    const marker = 'marker-partial-write-4b1e'
    const wiring = makeWiring(makeSession('A'))
    const { result } = renderFlow(wiring, 'A')
    act(() => { result.current.setText(marker, result.current.scope) })

    sessionUpdateMock.mockImplementationOnce(async () => { throw new Error('flaky') })
    await act(async () => { await result.current.commit() })
    expect(result.current.text).toBe(marker)

    await act(async () => { await result.current.commit() })
    expect(messagesIn('A').map(m => m.content)).toEqual([marker])
    expect(sessionMessageAddMock).toHaveBeenCalledTimes(2)
    expect(sessionMessageAddMock.mock.calls[0][1].id).toBe(sessionMessageAddMock.mock.calls[1][1].id)
  })

  it('the stable message id survives a reload between a failure and the retry', async () => {
    const marker = 'marker-id-across-reload-2a2a'
    const wiring = makeWiring(makeSession('A'))
    const first = renderFlow(wiring, 'A')
    act(() => { first.result.current.setText(marker, first.result.current.scope) })
    sessionUpdateMock.mockImplementationOnce(async () => { throw new Error('flaky') })
    await act(async () => { await first.result.current.commit() })
    first.unmount()

    const second = renderFlow(makeWiring(makeSession('A')), 'A')
    expect(second.result.current.text).toBe(marker)
    await act(async () => { await second.result.current.commit() })
    expect(messagesIn('A').map(m => m.content)).toEqual([marker])
  })

  // ─── 4. Exactly once ───────────────────────────────────────────────────────

  it('rapid double surface changes produce exactly one append', async () => {
    const marker = 'marker-double-tap-77aa'
    const wiring = makeWiring(makeSession('A'))
    const { result } = renderFlow(wiring, 'A')
    act(() => { result.current.setText(marker, result.current.scope) })

    let first: Promise<string> | undefined
    let second: Promise<string> | undefined
    await act(async () => {
      first = result.current.commit()
      second = result.current.commit()
      await Promise.all([first, second])
    })
    expect(first).toBe(second)
    expect(await first).toBe('sent')

    let third: string | undefined
    await act(async () => { third = await result.current.commit() })
    expect(third).toBe('empty')
    expect(sessionMessageAddMock).toHaveBeenCalledTimes(1)
    expect(messagesIn('A').map(m => m.content)).toEqual([marker])
  })

  it('journal words still pass through the crisis checks in appendUserMessage', async () => {
    const wiring = makeWiring(makeSession('A'))
    const { result } = renderFlow(wiring, 'A')
    act(() => { result.current.setText('  a heavy page  ', result.current.scope) })
    await act(async () => { await result.current.commit() })
    expect(wiring.orchestrator.checkCrisisKeywords).toHaveBeenCalledWith('a heavy page')
    expect(classifyCrisisRiskMock).toHaveBeenCalledWith('a heavy page', 'en')
  })

  // ─── 5. Closed sessions are never written ──────────────────────────────────

  it('a closed session receives no write and the draft is kept', async () => {
    const marker = 'marker-closed-session-0ff1'
    const wiring = makeWiring(makeSession('A'))
    const { result } = renderFlow(wiring, 'A')
    act(() => { result.current.setText(marker, result.current.scope) })

    ;(wiring.sessionRef as { current: Session | null }).current = makeSession('A', { status: 'closed' })
    let outcome: string | undefined
    await act(async () => { outcome = await result.current.commit() })

    expect(outcome).toBe('failed')
    expect(sessionMessageAddMock).not.toHaveBeenCalled()
    expect(sessionUpdateMock).not.toHaveBeenCalled()
    expect(result.current.text).toBe(marker)
    expect(readJournalDraft(UID, 'A')?.text).toBe(marker)
  })

  it('a session that closes while the append waits in the queue is not written', async () => {
    const marker = 'marker-closed-in-queue-b00c'
    const wiring = makeWiring(makeSession('A'))
    const { result } = renderFlow(wiring, 'A')
    act(() => { result.current.setText(marker, result.current.scope) })

    // An earlier write holds the append queue.
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const blocker = wiring.enqueueAppend(() => held)

    let commit: Promise<string> | undefined
    act(() => { commit = result.current.commit() })
    ;(wiring.sessionRef as { current: Session | null }).current = makeSession('A', { status: 'closed' })
    release()
    await act(async () => { await blocker; await commit })

    expect(await commit).toBe('failed')
    expect(allStoredText()).not.toContain(marker)
    expect(result.current.text).toBe(marker)
  })
})

// ─── 6. /session/new adopting its real id ────────────────────────────────────

describe('journal draft on a brand-new session', () => {
  it('keeps the words when /session/new adopts its real id, without remounting the editor', () => {
    vi.useFakeTimers()
    const marker = 'marker-new-session-e11e'
    const wiring = makeWiring(null)
    const { result, rerender, unmount } = renderFlow(wiring, null)
    act(() => { result.current.setText(marker, result.current.scope) })
    const scopeBefore = result.current.scope

    moveTo(wiring, makeSession('real-id'))
    rerender({ id: 'real-id', user: UID })

    expect(result.current.text).toBe(marker)
    expect(result.current.scope).toBe(scopeBefore)
    expect(readJournalDraft(UID, 'real-id')?.text).toBe(marker)
    // The editor of the same scope keeps writing to the adopted owner.
    act(() => { result.current.setText(`${marker} continued`, scopeBefore) })
    unmount()
    expect(readJournalDraft(UID, 'real-id')?.text).toBe(`${marker} continued`)
  })

  it('a reloaded session restores its saved draft once it loads, without overwriting words typed meanwhile', () => {
    writeJournalDraft(UID, 'A', { text: 'saved before reload' })
    const wiring = makeWiring(null)
    const { result, rerender } = renderFlow(wiring, null)
    act(() => { result.current.setText('typed while loading', result.current.scope) })

    moveTo(wiring, makeSession('A'))
    rerender({ id: 'A', user: UID })

    expect(result.current.text).toBe('saved before reload\n\ntyped while loading')
    expect(readJournalDraft(UID, 'A')?.text).toBe('saved before reload\n\ntyped while loading')
  })

  it('a commit requested before the id exists is contributed once, to the real id', async () => {
    const marker = 'marker-held-until-adopt-5e55'
    const wiring = makeWiring(null)
    const { result, rerender } = renderFlow(wiring, null)
    act(() => { result.current.setText(marker, result.current.scope) })

    let outcome: string | undefined
    await act(async () => { outcome = await result.current.commit() })
    expect(outcome).toBe('held')
    expect(sessionMessageAddMock).not.toHaveBeenCalled()

    moveTo(wiring, makeSession('real-id'))
    await act(async () => { rerender({ id: 'real-id', user: UID }) })
    await act(async () => { await Promise.resolve() })

    expect(messagesIn('real-id').map(m => m.content)).toEqual([marker])
    expect(sessionMessageAddMock).toHaveBeenCalledTimes(1)
    expect(result.current.text).toBe('')
  })
})

// ─── 7. Sign-out ─────────────────────────────────────────────────────────────

describe('journal drafts and sign-out', () => {
  it('a view unmounting after sign-out cannot write the drafts back', () => {
    vi.useFakeTimers()
    writeJournalDraft(UID, 'other-session', { text: 'older draft' })
    const { result, unmount } = renderFlow(makeWiring(makeSession('A')), 'A')
    act(() => { result.current.setText('typed just before sign-out', result.current.scope) })

    clearJournalDraftsForUser(UID)
    unmount()
    act(() => { vi.runAllTimers() })

    expect(readJournalDraft(UID, 'A')).toBeNull()
    expect(readJournalDraft(UID, 'other-session')).toBeNull()
  })
})
