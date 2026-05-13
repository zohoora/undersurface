import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import type { Part } from '../types'
import type { AppSettings } from '../store/settings'
import type { PartOrchestrator } from '../engine/partOrchestrator'
import type { PauseDetector } from '../engine/pauseDetector'
import type { ThoughtToOpen } from './useChatResponse'

// ─── Mocks (hoisted by Vitest) ────────────────────────────────

const streamMock = vi.fn()
vi.mock('../ai/openrouter', () => ({
  streamChatCompletion: (...a: unknown[]) => streamMock(...a),
  reasoningForSpeed: () => 'low',
}))

const buildInteractionReplyMock = vi.fn(() => [{ role: 'system', content: 'stub' }])
vi.mock('../ai/partPrompts', () => ({
  buildInteractionReply: (...a: unknown[]) => buildInteractionReplyMock(...a),
}))

const isGroundingMock = vi.fn(() => false)
vi.mock('../store/groundingState', () => ({
  isGroundingActive: () => isGroundingMock(),
}))

const interactionsAddMock = vi.fn(async () => {})
const interactionsUpdateMock = vi.fn(async () => {})
const memoriesAddMock = vi.fn(async () => {})
let idCounter = 0
vi.mock('../store/db', () => ({
  db: {
    interactions: {
      add: (...a: unknown[]) => interactionsAddMock(...a),
      update: (...a: unknown[]) => interactionsUpdateMock(...a),
    },
    memories: { add: (...a: unknown[]) => memoriesAddMock(...a) },
  },
  generateId: () => `id-${++idCounter}`,
}))

const trackEventMock = vi.fn()
vi.mock('../services/analytics', () => ({
  trackEvent: (...a: unknown[]) => trackEventMock(...a),
}))

const { useChatResponse } = await import('./useChatResponse')

// ─── Fixtures ─────────────────────────────────────────────────

function makePart(over: Partial<Part> = {}): Part {
  return {
    id: 'p-watcher',
    name: 'The Watcher',
    color: '#5A7F94',
    colorLight: '#5A7F9425',
    ifsRole: 'protector',
    voiceDescription: 'calm',
    concern: 'sees patterns',
    systemPrompt: 'You are the watcher.',
    isSeeded: true,
    createdAt: 0,
    ...over,
  }
}

function makeThought(over: Partial<ThoughtToOpen> = {}): ThoughtToOpen {
  return {
    id: 't-1',
    partId: 'p-watcher',
    partName: 'The Watcher',
    partColor: '#5A7F94',
    partColorLight: '#5A7F9425',
    content: 'You stopped writing.',
    isStreaming: false,
    ...over,
  }
}

function makeWiring(over: Partial<Parameters<typeof useChatResponse>[0]> = {}) {
  const editor = {
    getText: () => 'diary so far',
    commands: { focus: vi.fn() },
  } as unknown as Editor

  const suppress = vi.fn()
  const resume = vi.fn()
  const pauseDetector = { suppress, resume } as unknown as PauseDetector

  const orchestrator = {
    getParts: () => [makePart()],
  } as unknown as PartOrchestrator

  return {
    entryId: 'e-1',
    editor,
    settings: { responseSpeed: 1.0 } as AppSettings,
    orchestratorRef: { current: orchestrator },
    pauseDetectorRef: { current: pauseDetector },
    onPartColorChange: vi.fn(),
    onReplyComplete: vi.fn(),
    ...over,
    // expose for assertions even if caller overrode parts.
    _suppress: suppress,
    _resume: resume,
  } as Parameters<typeof useChatResponse>[0] & { _suppress: ReturnType<typeof vi.fn>; _resume: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  streamMock.mockReset()
  buildInteractionReplyMock.mockClear()
  interactionsAddMock.mockClear()
  interactionsUpdateMock.mockClear()
  memoriesAddMock.mockClear()
  trackEventMock.mockClear()
  isGroundingMock.mockReset().mockReturnValue(false)
  idCounter = 0
})

// ─── Tests: openInteraction ───────────────────────────────────

describe('useChatResponse — openInteraction', () => {
  it('opens the panel for a settled thought and suppresses pause detection', () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))

    let opened = false
    act(() => { opened = result.current.openInteraction(makeThought()) })

    expect(opened).toBe(true)
    expect(result.current.activeInteraction).not.toBeNull()
    expect(result.current.activeInteraction?.partName).toBe('The Watcher')
    expect((wiring as unknown as { _suppress: ReturnType<typeof vi.fn> })._suppress).toHaveBeenCalledOnce()
  })

  it('refuses to open while the thought is still streaming', () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))

    let opened = false
    act(() => { opened = result.current.openInteraction(makeThought({ isStreaming: true })) })

    expect(opened).toBe(false)
    expect(result.current.activeInteraction).toBeNull()
  })

  it('refuses to open a second panel while one is already active', () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))

    act(() => { result.current.openInteraction(makeThought({ id: 't-A' })) })
    let opened = false
    act(() => { opened = result.current.openInteraction(makeThought({ id: 't-B' })) })

    expect(opened).toBe(false)
    // Original panel survives.
    expect(result.current.activeInteraction?.thoughtId).toBe('t-A')
  })
})

// ─── Tests: closeInteraction ──────────────────────────────────

describe('useChatResponse — closeInteraction', () => {
  it('clears state, resumes pause detector, clears part color', () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))

    act(() => { result.current.openInteraction(makeThought()) })
    act(() => { result.current.closeInteraction() })

    expect(result.current.activeInteraction).toBeNull()
    expect((wiring as unknown as { _resume: ReturnType<typeof vi.fn> })._resume).toHaveBeenCalledOnce()
    expect(wiring.onPartColorChange).toHaveBeenCalledWith(null)
  })
})

// ─── Tests: dismissIfIdle ─────────────────────────────────────

describe('useChatResponse — dismissIfIdle', () => {
  it('clears the panel when no reply is mid-stream', () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))

    act(() => { result.current.openInteraction(makeThought()) })
    expect(result.current.activeInteraction).not.toBeNull()

    act(() => { result.current.dismissIfIdle() })
    expect(result.current.activeInteraction).toBeNull()
    // Unlike close: does NOT call resume() / onPartColorChange (editor path
    // handles those).
    expect((wiring as unknown as { _resume: ReturnType<typeof vi.fn> })._resume).not.toHaveBeenCalled()
    expect(wiring.onPartColorChange).not.toHaveBeenCalled()
  })

  it('keeps the panel open while a reply is streaming', async () => {
    const wiring = makeWiring()
    // Keep stream open mid-flight.
    let resolveStream!: () => void
    streamMock.mockImplementation(async (_msgs, callbacks: { onToken: (t: string) => void }) => {
      callbacks.onToken('hello')
      // Hang.
      return new Promise<void>((r) => { resolveStream = r })
    })

    const { result } = renderHook(() => useChatResponse(wiring))
    act(() => { result.current.openInteraction(makeThought()) })
    act(() => { void result.current.sendUserResponse('thanks') })

    await waitFor(() => expect(result.current.activeInteraction?.isReplyStreaming).toBe(true))

    act(() => { result.current.dismissIfIdle() })
    // Panel persists.
    expect(result.current.activeInteraction).not.toBeNull()
    expect(result.current.activeInteraction?.isReplyStreaming).toBe(true)
    resolveStream()
  })
})

// ─── Tests: sendUserResponse (streaming) ──────────────────────

describe('useChatResponse — sendUserResponse', () => {
  it('does nothing without an active interaction', async () => {
    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))

    await act(async () => { await result.current.sendUserResponse('hi') })
    expect(streamMock).not.toHaveBeenCalled()
    expect(interactionsAddMock).not.toHaveBeenCalled()
  })

  it('does nothing if the part can no longer be found in the orchestrator', async () => {
    const wiring = makeWiring()
    // Override orchestrator AFTER opening — simulates the part being removed.
    const { result } = renderHook(() => useChatResponse(wiring))
    act(() => { result.current.openInteraction(makeThought()) })

    ;(wiring.orchestratorRef as { current: PartOrchestrator | null }).current = {
      getParts: () => [],
    } as unknown as PartOrchestrator

    await act(async () => { await result.current.sendUserResponse('hi') })
    expect(streamMock).not.toHaveBeenCalled()
    expect(interactionsAddMock).not.toHaveBeenCalled()
  })

  it('persists the interaction (user_responded) and streams tokens into partReply', async () => {
    streamMock.mockImplementation(async (_msgs, callbacks: { onToken: (t: string) => void; onComplete: (full: string) => Promise<void> }) => {
      callbacks.onToken('I ')
      callbacks.onToken('hear ')
      callbacks.onToken('you.')
      await callbacks.onComplete('I hear you.')
    })

    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))
    act(() => { result.current.openInteraction(makeThought()) })

    await act(async () => { await result.current.sendUserResponse('that hit') })

    // user_responded persisted with status before onComplete fires.
    expect(interactionsAddMock).toHaveBeenCalledOnce()
    const inserted = interactionsAddMock.mock.calls[0][0] as { status: string; userResponse: string; partId: string }
    expect(inserted.status).toBe('user_responded')
    expect(inserted.userResponse).toBe('that hit')
    expect(inserted.partId).toBe('p-watcher')

    // After completion: update marks complete, memory is logged, panel reflects
    // final reply and not-streaming.
    expect(interactionsUpdateMock).toHaveBeenCalledOnce()
    const [, patch] = interactionsUpdateMock.mock.calls[0]
    expect((patch as { partReply: string; status: string }).status).toBe('complete')
    expect((patch as { partReply: string }).partReply).toBe('I hear you.')
    expect(memoriesAddMock).toHaveBeenCalledOnce()
    expect(result.current.activeInteraction?.isReplyStreaming).toBe(false)
    expect(result.current.activeInteraction?.partReply).toBe('I hear you.')
    expect(wiring.onReplyComplete).toHaveBeenCalledWith('#5A7F94')
  })

  it('fires the thinking_out_loud analytics event on send', async () => {
    streamMock.mockImplementation(async (_msgs, callbacks: { onComplete: (full: string) => Promise<void> }) => {
      await callbacks.onComplete('done')
    })
    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))
    act(() => { result.current.openInteraction(makeThought()) })
    await act(async () => { await result.current.sendUserResponse('ok') })

    expect(trackEventMock).toHaveBeenCalledWith(
      'thinking_out_loud',
      { part_name: 'The Watcher', status: 'user_responded' },
    )
  })

  it('passes the live isGrounding flag through to the prompt builder', async () => {
    isGroundingMock.mockReturnValue(true)
    streamMock.mockImplementation(async (_msgs, callbacks: { onComplete: (full: string) => Promise<void> }) => {
      await callbacks.onComplete('ok')
    })
    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))
    act(() => { result.current.openInteraction(makeThought()) })
    await act(async () => { await result.current.sendUserResponse('ok') })

    expect(buildInteractionReplyMock).toHaveBeenCalledOnce()
    const opts = buildInteractionReplyMock.mock.calls[0][4]
    expect(opts).toEqual({ isGrounding: true })
  })

  it('on stream error: turns off streaming flag but does not clear the panel', async () => {
    streamMock.mockImplementation(async (_msgs, callbacks: { onError: (e: Error) => void }) => {
      callbacks.onError(new Error('boom'))
    })
    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))
    act(() => { result.current.openInteraction(makeThought()) })

    // The hook calls console.error inside onError — silence for clean output.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { await result.current.sendUserResponse('ok') })
    spy.mockRestore()

    expect(result.current.activeInteraction).not.toBeNull()
    expect(result.current.activeInteraction?.isReplyStreaming).toBe(false)
    // Did NOT mark complete (no onComplete fired).
    expect(interactionsUpdateMock).not.toHaveBeenCalled()
  })

  it('preserves the original part color even if the panel is closed mid-stream', async () => {
    let resolveComplete!: () => void
    let captured!: { onComplete: (full: string) => Promise<void> }
    streamMock.mockImplementation(async (_msgs, callbacks: { onToken: (t: string) => void; onComplete: (full: string) => Promise<void> }) => {
      callbacks.onToken('mid')
      captured = callbacks
      return new Promise<void>((r) => { resolveComplete = r })
    })

    const wiring = makeWiring()
    const { result } = renderHook(() => useChatResponse(wiring))
    act(() => { result.current.openInteraction(makeThought()) })
    // Fire-and-forget; resolve later.
    act(() => { void result.current.sendUserResponse('go') })

    await waitFor(() => expect(result.current.activeInteraction?.isReplyStreaming).toBe(true))

    // User dismisses the panel mid-stream.
    act(() => { result.current.closeInteraction() })

    // Finalize.
    await act(async () => {
      await captured.onComplete('all done')
      resolveComplete()
    })

    // onReplyComplete should still receive the ORIGINAL part's color, not null.
    expect(wiring.onReplyComplete).toHaveBeenCalledWith('#5A7F94')
  })
})
