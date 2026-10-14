import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import type { Session, SessionMessage } from '../types'
import type { TherapistContext } from '../engine/sessionContextLoader'

// ─── Mocks ────────────────────────────────────────────────────
// These get hoisted by Vitest — must come before the import-under-test.

const voiceStartMock = vi.fn(async () => {})
const voiceStopMock = vi.fn()
const sendSessionUpdateMock = vi.fn()
let voiceState: 'idle' | 'connecting' | 'connected' | 'error' = 'idle'

vi.mock('./useVoiceSession', () => ({
  useVoiceSession: () => ({
    state: voiceState,
    error: null,
    muted: false,
    remoteStream: null,
    assistantSpeaking: false,
    userSpeaking: false,
    start: voiceStartMock,
    stop: voiceStopMock,
    speak: vi.fn(),
    toggleMute: vi.fn(),
    sendSessionUpdate: sendSessionUpdateMock,
  }),
}))

const isGroundingMock = vi.fn(() => false)
let groundingValue = false
vi.mock('./useGroundingMode', () => ({
  isGroundingActive: () => isGroundingMock(),
  useGroundingMode: () => groundingValue,
}))

const sessionMessageAddMock = vi.fn()
const sessionUpdateMock = vi.fn()
vi.mock('../store/db', () => ({
  db: {
    sessions: { update: (...a: unknown[]) => sessionUpdateMock(...a) },
  },
  sessionMessages: {
    add: (...a: unknown[]) => sessionMessageAddMock(...a),
  },
  generateId: () => 'msg-stub-id',
}))

vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => ({ voice: { defaultVoice: 'shimmer' } }),
}))

vi.mock('../ai/therapistPrompts', () => ({
  buildTherapistSystemPrompt: (opts: Record<string, unknown>) =>
    `SYS:${opts.phase}:${opts.mode}:firstTurn=${opts.isFirstTurn}:grounding=${opts.isGrounding}`,
}))

const loadRelaxMock = vi.fn(async () => [])
vi.mock('../engine/sessionContextLoader', () => ({
  loadInSessionRelaxBreaks: (...a: unknown[]) => loadRelaxMock(...a),
}))

const trackEventMock = vi.fn()
vi.mock('../services/analytics', () => ({
  trackEvent: (...a: unknown[]) => trackEventMock(...a),
}))

const { useSessionVoice } = await import('./useSessionVoice')

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
    ...over,
  }
}

function makeWiring(over: Partial<Parameters<typeof useSessionVoice>[0]> = {}) {
  const sessionRef = createRef<Session | null>() as RefObject<Session | null>
  ;(sessionRef as { current: Session | null }).current = makeSession()
  const messagesRef = createRef<SessionMessage[]>() as RefObject<SessionMessage[]>
  ;(messagesRef as { current: SessionMessage[] }).current = []
  const contextRef = createRef<TherapistContext | null>() as RefObject<TherapistContext | null>
  ;(contextRef as { current: TherapistContext | null }).current = makeContext()
  const orchestratorRef = {
    current: { detectPhase: () => 'opening' as const },
  } as RefObject<{ detectPhase: () => 'opening' | 'deepening' | 'closing' }> as unknown as Parameters<typeof useSessionVoice>[0]['orchestratorRef']

  return {
    sessionRef,
    messagesRef,
    contextRef,
    orchestratorRef,
    setSession: vi.fn(),
    setMessages: vi.fn(),
    appendUserMessage: vi.fn(async () => null),
    hrv: {
      enabled: false,
      buildPromptContext: vi.fn(() => null),
      addConversationEvent: vi.fn(),
    } as unknown as Parameters<typeof useSessionVoice>[0]['hrv'],
    enqueueAppend: makeEnqueue(),
    ...over,
  } as Parameters<typeof useSessionVoice>[0]
}

function makeEnqueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    tail = run.then(() => {}, () => {})
    return run
  }
}

beforeEach(() => {
  voiceState = 'idle'
  voiceStartMock.mockClear()
  voiceStopMock.mockClear()
  sessionMessageAddMock.mockClear()
  sessionUpdateMock.mockClear()
  loadRelaxMock.mockClear()
  trackEventMock.mockClear()
  sendSessionUpdateMock.mockClear()
  isGroundingMock.mockReturnValue(false)
  groundingValue = false
})

// ─── Tests ────────────────────────────────────────────────────

describe('useSessionVoice — handleStart', () => {
  it('builds the therapist system prompt and forwards it to voice.start', async () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))

    await act(async () => { await result.current.handleStart() })

    expect(voiceStartMock).toHaveBeenCalledOnce()
    const startOpts = voiceStartMock.mock.calls[0][0] as { instructions: string; voice: string }
    // The prompt was built with phase=opening, mode=standard, isFirstTurn=true, grounding=false.
    expect(startOpts.instructions).toBe('SYS:opening:standard:firstTurn=true:grounding=false')
    expect(startOpts.voice).toBe('shimmer')
  })

  it('passes isFirstTurn=false once the therapist has already spoken', async () => {
    const wiring = makeWiring()
    ;(wiring.messagesRef as { current: SessionMessage[] }).current = [
      { id: 'm1', speaker: 'therapist', partId: null, partName: null, content: 'Hi.', timestamp: 1, phase: 'opening', isEmergence: false },
    ]
    const { result } = renderHook(() => useSessionVoice(wiring))

    await act(async () => { await result.current.handleStart() })

    const startOpts = voiceStartMock.mock.calls[0][0] as { instructions: string }
    expect(startOpts.instructions).toContain('firstTurn=false')
  })

  it('respects the grounding flag when building the prompt (no Real Talk via voice while grounded)', async () => {
    isGroundingMock.mockReturnValue(true)
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })
    expect((voiceStartMock.mock.calls[0][0] as { instructions: string }).instructions).toContain('grounding=true')
  })

  // TECH_ISSUES #33: SessionView reverts "speak + idle" to Talk. During the
  // await before voice.start the hook must already report 'connecting'.
  it('reports connecting (never idle) while instructions are still being prepared', async () => {
    let releaseBreaks: (value: never[]) => void = () => {}
    loadRelaxMock.mockImplementationOnce(() => new Promise<never[]>(resolve => { releaseBreaks = resolve }))
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))

    let pending: Promise<void> = Promise.resolve()
    act(() => { pending = result.current.handleStart() })
    expect(result.current.state).toBe('connecting')
    expect(voiceStartMock).not.toHaveBeenCalled()

    await act(async () => {
      releaseBreaks([])
      await pending
    })
    expect(voiceStartMock).toHaveBeenCalledOnce()
    expect(result.current.state).toBe('idle') // the mocked voice stays idle after start
  })

  it('stop() during the instruction await cancels the start before the mic opens', async () => {
    let releaseBreaks: (value: never[]) => void = () => {}
    loadRelaxMock.mockImplementationOnce(() => new Promise<never[]>(resolve => { releaseBreaks = resolve }))
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))

    let pending: Promise<void> = Promise.resolve()
    act(() => { pending = result.current.handleStart() })
    act(() => { result.current.stop() })
    expect(result.current.state).toBe('idle')
    await act(async () => {
      releaseBreaks([])
      await pending
    })
    expect(voiceStartMock).not.toHaveBeenCalled()
  })

  // T5: Talk → Speak must carry what was just said in this session.
  it('seeds the voice session with the current Talk turns', async () => {
    const wiring = makeWiring()
    ;(wiring.messagesRef as { current: SessionMessage[] }).current = [
      { id: 'a1', speaker: 'therapist', partId: null, partName: null, content: 'What is here?', timestamp: 1, phase: 'opening', isEmergence: false, surface: 'talk' },
      { id: 'u1', speaker: 'user', partId: null, partName: null, content: 'UNIQUE_TALK_FACT: the interview is on Friday.', timestamp: 2, phase: 'opening', isEmergence: false, surface: 'talk' },
    ]
    const { result } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })
    const { instructions } = voiceStartMock.mock.calls[0][0] as { instructions: string }
    expect(instructions).toContain('THIS SESSION SO FAR')
    expect(instructions).toContain('- Writer (Talk): <user_turn>UNIQUE_TALK_FACT: the interview is on Friday.</user_turn>')
    expect(sessionMessageAddMock).not.toHaveBeenCalled() // the seed is never persisted again
  })

  it('bails silently when context has not loaded yet', async () => {
    const wiring = makeWiring()
    ;(wiring.contextRef as { current: TherapistContext | null }).current = null
    const { result } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })
    expect(voiceStartMock).not.toHaveBeenCalled()
  })

  it('emits a voice_session_started analytics event with the session id', async () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })
    expect(trackEventMock).toHaveBeenCalledWith('voice_session_started', { session_id: 'sess-1' })
  })
})

describe('useSessionVoice — grounding reaches the live voice channel', () => {
  it('pushes grounded instructions via session.update when grounding activates mid-session', async () => {
    voiceState = 'connected'
    const wiring = makeWiring()
    ;(wiring.sessionRef as { current: Session | null }).current = makeSession({ mode: 'real_talk' })
    const { result, rerender } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })
    sendSessionUpdateMock.mockClear()

    // Crisis keywords activate grounding while the voice session is live.
    await act(async () => {
      groundingValue = true
      rerender()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendSessionUpdateMock).toHaveBeenCalled()
    const arg = sendSessionUpdateMock.mock.calls[0][0] as { instructions: string }
    // Real Talk must be gone; the prompt is rebuilt with grounding on.
    expect(arg.instructions).toContain('grounding=true')
  })

  it('does not push when grounding is inactive', async () => {
    voiceState = 'connected'
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })
    sendSessionUpdateMock.mockClear()
    await act(async () => { await Promise.resolve() })
    expect(sendSessionUpdateMock).not.toHaveBeenCalled()
  })

  it('does not push when no voice session is connected', async () => {
    voiceState = 'idle'
    const wiring = makeWiring()
    const { rerender } = renderHook(() => useSessionVoice(wiring))
    await act(async () => {
      groundingValue = true
      rerender()
      await Promise.resolve()
    })
    expect(sendSessionUpdateMock).not.toHaveBeenCalled()
  })
})

describe('useSessionVoice — handleEnd', () => {
  it('stops the realtime channel and emits voice_session_ended', () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))
    act(() => { result.current.handleEnd() })
    expect(voiceStopMock).toHaveBeenCalledOnce()
    expect(trackEventMock).toHaveBeenCalledWith('voice_session_ended', { session_id: 'sess-1' })
  })
})

describe('useSessionVoice — voice transcript callbacks (assistant side)', () => {
  it('persists the therapist transcript by appending a new SessionMessage', async () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })

    // Grab the onAssistantTranscript callback that was passed to voice.start
    const startOpts = voiceStartMock.mock.calls[0][0] as { onAssistantTranscript: (t: string) => void }
    await act(async () => { await startOpts.onAssistantTranscript('Carry that with you.') })

    expect(sessionMessageAddMock).toHaveBeenCalledOnce()
    const [sessionId, message] = sessionMessageAddMock.mock.calls[0]
    expect(sessionId).toBe('sess-1')
    expect((message as SessionMessage).speaker).toBe('therapist')
    expect((message as SessionMessage).content).toBe('Carry that with you.')
    expect((message as SessionMessage).inputMethod).toBe('voice')
  })

  it('drops empty/whitespace transcripts without writing', async () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })

    const startOpts = voiceStartMock.mock.calls[0][0] as { onAssistantTranscript: (t: string) => void }
    await act(async () => { await startOpts.onAssistantTranscript('   ') })
    expect(sessionMessageAddMock).not.toHaveBeenCalled()
  })

  it('does not write to a closed session (race: voice channel emits late)', async () => {
    const wiring = makeWiring()
    ;(wiring.sessionRef as { current: Session | null }).current = makeSession({ status: 'closed' })
    const { result } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })

    const startOpts = voiceStartMock.mock.calls[0][0] as { onAssistantTranscript: (t: string) => void }
    await act(async () => { await startOpts.onAssistantTranscript('Stale message after close.') })
    expect(sessionMessageAddMock).not.toHaveBeenCalled()
  })
})

describe('useSessionVoice — voice transcript callbacks (user side)', () => {
  it('routes user transcripts to appendUserMessage with inputMethod=voice', async () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useSessionVoice(wiring))
    await act(async () => { await result.current.handleStart() })

    const startOpts = voiceStartMock.mock.calls[0][0] as { onUserTranscript: (t: string) => void }
    await act(async () => { startOpts.onUserTranscript('hello there') })

    expect(wiring.appendUserMessage).toHaveBeenCalledWith('hello there', 'voice')
  })
})
