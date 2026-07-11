import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { StreamCallbacks } from '../ai/openrouter'

// ─── Mocks (hoisted by Vitest) ───────────────────────────────────────────────

// streamChatCompletion — tests drive onToken/onComplete/onError via mockImplementation.
const streamMock = vi.fn(async (_messages: unknown, callbacks: StreamCallbacks) => {
  callbacks.onComplete('a quiet reflection')
})
const classifyCrisisRiskMock = vi.fn(async () => ({ risk: 0 as 0 | 1 | 2 }))
vi.mock('../ai/openrouter', () => ({
  streamChatCompletion: (...a: unknown[]) => streamMock(a[0], a[1] as StreamCallbacks),
  classifyCrisisRisk: (...a: unknown[]) => classifyCrisisRiskMock(...(a as [])),
  reasoningForSpeed: () => 'medium',
}))

// Real selectInterweave runs; only the prompt builder is a spy so we can assert
// the hook threads the selected interweave (rain for sad text) into the prompt.
const buildDriftSystemPromptMock = vi.fn((opts: { interweave: string | null }) => `SYS[iw=${opts.interweave}]`)
vi.mock('../ai/driftPrompts', () => ({
  buildDriftSystemPrompt: (opts: { interweave: string | null }) => buildDriftSystemPromptMock(opts),
}))

const detectCrisisKeywordsMock = vi.fn(() => false)
vi.mock('../engine/sessionOrchestrator', () => ({
  detectCrisisKeywords: (...a: unknown[]) => detectCrisisKeywordsMock(...(a as [])),
}))

const activateGroundingMock = vi.fn()
const isGroundingActiveMock = vi.fn(() => false)
let groundingCb: (() => void) | null = null
vi.mock('../store/groundingState', () => ({
  activateGrounding: (...a: unknown[]) => activateGroundingMock(...a),
  isGroundingActive: () => isGroundingActiveMock(),
  subscribeGrounding: (cb: () => void) => { groundingCb = cb; return () => { groundingCb = null } },
}))

const driftAddMock = vi.fn(async () => {})
const driftUpdateMock = vi.fn(async () => {})
const userPartsToArrayMock = vi.fn(async () => [] as unknown[])
vi.mock('../store/db', () => ({
  db: {
    driftSessions: { add: (...a: unknown[]) => driftAddMock(...a), update: (...a: unknown[]) => driftUpdateMock(...a) },
    userParts: { toArray: () => userPartsToArrayMock() },
  },
  generateId: () => 'drift-test-1',
}))

vi.mock('../store/settings', () => ({
  getSettings: () => ({ responseSpeed: 1 }),
}))

vi.mock('../i18n', () => ({
  getLanguageCode: () => 'en',
}))

import { useDriftSession } from './useDriftSession'
import type { DriftApi } from './useDriftSession'

// v2: one begin() call drives the machine to the first set; a completed set
// lands on the first notice. 'full' (7 waves) so multi-notice tests never cap.
async function toNotice(api: () => DriftApi) {
  await act(async () => {
    await api().begin({
      anchorKind: 'feet',
      blsChannel: 'audio',
      voice: false,
      length: 'full',
      focus: 'the tightness before a call',
      focusIsCustom: true,
    })
  })
  act(() => { api().completeSet() })
}

describe('useDriftSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamMock.mockImplementation(async (_m, cb: StreamCallbacks) => { cb.onComplete('a quiet reflection') })
    classifyCrisisRiskMock.mockResolvedValue({ risk: 0 })
    detectCrisisKeywordsMock.mockReturnValue(false)
    isGroundingActiveMock.mockReturnValue(false)
    userPartsToArrayMock.mockResolvedValue([])
    groundingCb = null
  })

  it('L1 keyword hit on a notice aborts to grounding with NO LLM call', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    detectCrisisKeywordsMock.mockReturnValue(true)
    await act(async () => { await result.current.submitNotice('i want to die', 'softer') })
    expect(streamMock).not.toHaveBeenCalled()
    expect(activateGroundingMock).toHaveBeenCalled()
    expect(result.current.state.phase).toBe('closure')
    expect(result.current.state.closureReason).toBe('crisis')
  })

  it('L2 risk=2 classifier resolution aborts to grounding even when L1 missed', async () => {
    classifyCrisisRiskMock.mockResolvedValue({ risk: 2 })
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    await act(async () => { await result.current.submitNotice('i keep sinking', 'same') })
    await waitFor(() => {
      expect(result.current.state.phase).toBe('closure')
      expect(result.current.state.closureReason).toBe('crisis')
    })
    expect(activateGroundingMock).toHaveBeenCalled()
  })

  it('a sad notice threads the rain interweave into the prompt and continues to a set', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    await act(async () => { await result.current.submitNotice('i feel so sad and lonely', 'softer') })
    expect(buildDriftSystemPromptMock).toHaveBeenCalledWith(expect.objectContaining({ interweave: 'rain' }))
    expect(streamMock).toHaveBeenCalled()
    expect(result.current.state.phase).toBe('set')
    expect(result.current.state.lastInterweave).toBe('rain')
    expect(result.current.transcript.some(e => e.role === 'companion' && e.content === 'a quiet reflection')).toBe(true)
  })

  it('two consecutive "same" notices route to stuck closure', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    await act(async () => { await result.current.submitNotice('nothing really', 'same') })
    act(() => { result.current.completeSet() })
    await act(async () => { await result.current.submitNotice('still nothing', 'same') })
    expect(result.current.state.phase).toBe('closure')
    expect(result.current.state.closureReason).toBe('stuck')
  })

  it('requestClose from a set routes to a user closure', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    await act(async () => { await result.current.submitNotice('softer now', 'softer') })
    act(() => { result.current.requestClose() })
    expect(result.current.state.phase).toBe('closure')
    expect(result.current.state.closureReason).toBe('user')
  })

  it('closureDone persists the mapped outcome (eased_early for a user close)', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    act(() => { result.current.requestClose() })
    await act(async () => { await result.current.closureDone() })
    expect(driftUpdateMock).toHaveBeenCalledWith('drift-test-1', expect.objectContaining({ outcome: 'eased_early' }))
    expect(driftUpdateMock).toHaveBeenCalledWith('drift-test-1', expect.objectContaining({ endedAt: expect.any(Number) }))
  })

  it('external grounding activation dispatches a crisis abort', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    isGroundingActiveMock.mockReturnValue(true)
    act(() => { groundingCb?.() })
    expect(result.current.state.phase).toBe('closure')
    expect(result.current.state.closureReason).toBe('crisis')
  })

  it('abandon before closure persists the abandoned outcome', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    await act(async () => { await result.current.abandon() })
    expect(driftUpdateMock).toHaveBeenCalledWith('drift-test-1', expect.objectContaining({ outcome: 'abandoned' }))
  })

  it('a failed stream still advances the flow (dispatches NOTICE, never wedges)', async () => {
    streamMock.mockImplementation(async (_m, cb: StreamCallbacks) => { cb.onError(new Error('boom')) })
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    await act(async () => { await result.current.submitNotice('softer', 'softer') })
    expect(result.current.state.phase).toBe('set')
    // onError appends no companion entry
    expect(result.current.transcript.some(e => e.role === 'companion')).toBe(false)
  })

  // ── v2: one-screen begin + tap-only check-ins ─────────────────────────────

  it('begin() lands directly in the first set with the chosen length applied', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await act(async () => {
      await result.current.begin({
        anchorKind: 'calm_place', blsChannel: 'visual', voice: false,
        length: 'quick', focus: 'a knot of worry', focusIsCustom: false,
      })
    })
    expect(result.current.state.phase).toBe('set')
    expect(result.current.state.limits.setTarget).toBe(3)
    // The focus opens the transcript so later typed exchanges have context.
    expect(result.current.transcript[0]).toMatchObject({ role: 'user', content: 'a knot of worry' })
    // A chip is app-authored copy — never crisis-classified.
    expect(detectCrisisKeywordsMock).not.toHaveBeenCalled()
    expect(classifyCrisisRiskMock).not.toHaveBeenCalled()
    expect(driftAddMock).toHaveBeenCalledWith(expect.objectContaining({ length: 'quick' }))
  })

  it('records content-free device telemetry and accepts late guidance/audio updates', async () => {
    const { result } = renderHook(() => useDriftSession('parent-1'))
    await act(async () => {
      await result.current.begin({
        anchorKind: 'calm_place', blsChannel: 'audio', voice: true,
        length: 'quick', focus: 'a built-in chip', focusIsCustom: false,
        audioState: 'priming', displayMode: 'standalone',
      })
    })
    expect(driftAddMock).toHaveBeenCalledWith(expect.objectContaining({
      audioState: 'priming', voiceGuidanceState: 'connecting', displayMode: 'standalone',
      firstWaveStartedAt: expect.any(Number),
    }))
    act(() => result.current.updateExperienceTelemetry({ voiceGuidanceState: 'connected', firstCueRequestedAt: 123 }))
    await waitFor(() => expect(driftUpdateMock).toHaveBeenCalledWith('drift-test-1', expect.objectContaining({
      voiceGuidanceState: 'connected', firstCueRequestedAt: 123,
    })))
  })

  it('L1 keyword hit on a TYPED focus aborts to grounding before the first wave', async () => {
    detectCrisisKeywordsMock.mockReturnValue(true)
    const { result } = renderHook(() => useDriftSession(null))
    await act(async () => {
      await result.current.begin({
        anchorKind: 'feet', blsChannel: 'audio', voice: false,
        length: 'short', focus: 'i want to die', focusIsCustom: true,
      })
    })
    expect(activateGroundingMock).toHaveBeenCalled()
    expect(result.current.state.phase).toBe('closure')
    expect(result.current.state.closureReason).toBe('crisis')
    expect(streamMock).not.toHaveBeenCalled()
  })

  it('a tap-only check-in advances instantly with no LLM call and no classifier', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    vi.clearAllMocks()
    act(() => { result.current.submitNoticeTap('softer') })
    expect(result.current.state.phase).toBe('set')
    expect(result.current.state.softerStreak).toBe(1)
    expect(streamMock).not.toHaveBeenCalled()
    expect(classifyCrisisRiskMock).not.toHaveBeenCalled()
  })

  it('a tap-only "stronger" pendulates to settle (engine-owned, no text needed)', async () => {
    const { result } = renderHook(() => useDriftSession(null))
    await toNotice(() => result.current)
    act(() => { result.current.submitNoticeTap('stronger') })
    expect(result.current.state.phase).toBe('settle')
    expect(result.current.state.inSettleRecheck).toBe(true)
  })
})
