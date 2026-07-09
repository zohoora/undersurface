import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import type { DriftApi } from '../../../hooks/useDriftSession'
import type { DriftState } from '../../../engine/driftEngine'

void React

let currentApi: DriftApi
// Return a FRESH object each render (spread), mirroring the real useDriftSession,
// which builds a new API object literal every render. Effects keyed on the whole
// `drift` object would thus re-run on every render — this is what makes the timer
// and abandon dependency-stability regressions observable in tests. The callbacks
// inside stay referentially stable (same vi.fn refs), exactly like the real hook's
// useCallback handlers.
vi.mock('../../../hooks/useDriftSession', () => ({
  useDriftSession: () => ({ ...currentApi }),
}))

// Voice wiring is covered by useDriftVoice.test; isolate DriftField from it.
vi.mock('../../../hooks/useDriftVoice', () => ({
  useDriftVoice: () => ({ voiceState: 'idle', assistantSpeaking: false }),
}))

// Isolate DriftField from BLS internals (Web Audio / rAF) — Task 4 tests those.
vi.mock('./BilateralStimulus', () => ({
  BilateralStimulus: ({ channel, running }: { channel: string; running: boolean }) =>
    running && channel === 'visual' ? React.createElement('div', { 'data-testid': 'bls-dot' }) : null,
}))

vi.mock('../../../i18n', () => ({ t: (k: string) => k }))

let currentSettings = {
  lastDriftBlsChannel: 'visual',
  lastDriftAudioVolume: 0.5,
  lastDriftVoice: false,
  lastDriftLength: 'short',
}
const updateSettingsMock = vi.fn()
vi.mock('../../../store/settings', () => ({
  getSettings: () => currentSettings,
  updateSettings: (...a: unknown[]) => updateSettingsMock(...a),
}))

import { DriftField } from './DriftField'

// v2 defaults mirror the 'short' preset (5 waves × 12s).
function makeState(overrides: Partial<DriftState> = {}): DriftState {
  return {
    phase: 'arrive', setCount: 0, sameStreak: 0, softerStreak: 0, softerTotal: 0,
    inSettleRecheck: false, elapsedMs: 0, closureReason: null, lastInterweave: null,
    limits: { setTarget: 5, setMs: 12_000, maxSessionMs: 360_000 },
    ...overrides,
  }
}

function makeApi(state: DriftState): DriftApi {
  return {
    state,
    transcript: [],
    streamingText: '',
    begin: vi.fn(async () => {}),
    completeSet: vi.fn(),
    submitNotice: vi.fn(async () => {}),
    submitNoticeTap: vi.fn(),
    settleDone: vi.fn(),
    requestClose: vi.fn(),
    closureDone: vi.fn(async () => {}),
    abandon: vi.fn(async () => {}),
    voiceActive: false,
  }
}

const PROPS = { parentSessionId: null, hrvContext: null, voiceAvailable: false, onClose: () => {} }

function renderPhase(state: DriftState) {
  currentApi = makeApi(state)
  return render(<DriftField {...PROPS} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  currentSettings = { lastDriftBlsChannel: 'visual', lastDriftAudioVolume: 0.5, lastDriftVoice: false, lastDriftLength: 'short' }
})
afterEach(() => cleanup())

describe('DriftField v2', () => {
  it('the begin screen shows chips, lengths, the anchor row, and the not-therapy line — no Settle & close', () => {
    renderPhase(makeState({ phase: 'arrive' }))
    expect(screen.queryByText('drift.begin.whats')).not.toBeNull()
    expect(screen.queryByText('drift.chip.worry')).not.toBeNull()
    expect(screen.queryByText('drift.length.quick')).not.toBeNull()
    expect(screen.queryByText('drift.begin.anchorLabel')).not.toBeNull()
    expect(screen.queryByText('drift.arrive.notTherapy')).not.toBeNull()
    expect(screen.queryByText('drift.settleClose')).toBeNull()
  })

  it('Begin starts immediately with the selected chip (no crisis-checked custom text)', () => {
    renderPhase(makeState({ phase: 'arrive' }))
    fireEvent.click(screen.getByText('drift.chip.worry'))
    fireEvent.click(screen.getByText('drift.length.quick'))
    fireEvent.click(screen.getByText('drift.arrive.begin'))
    expect(currentApi.begin).toHaveBeenCalledWith(expect.objectContaining({
      focus: 'drift.chip.worry',
      focusIsCustom: false,
      length: 'quick',
      anchorKind: 'feet',
    }))
    expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ lastDriftLength: 'quick' }))
  })

  it('a typed focus goes out as custom (the crisis-checked path)', () => {
    renderPhase(makeState({ phase: 'arrive' }))
    fireEvent.click(screen.getByText('drift.begin.somethingElse'))
    fireEvent.change(screen.getByLabelText('drift.begin.somethingElse'), { target: { value: 'the call tomorrow' } })
    fireEvent.click(screen.getByText('drift.arrive.begin'))
    expect(currentApi.begin).toHaveBeenCalledWith(expect.objectContaining({
      focus: 'the call tomorrow',
      focusIsCustom: true,
    }))
  })

  it('a wave renders the BLS dot, the progress dots, and Skip advances', () => {
    renderPhase(makeState({ phase: 'set', setCount: 2 }))
    expect(screen.queryByTestId('bls-dot')).not.toBeNull()
    const progress = screen.getByTestId('drift-progress')
    expect(progress.getAttribute('aria-label')).toBe('3/5')
    expect(progress.querySelectorAll('[data-filled="true"]').length).toBe(2)
    fireEvent.click(screen.getByText('drift.set.skip'))
    expect(currentApi.completeSet).toHaveBeenCalled()
  })

  it('a pill tap submits the check-in instantly — no typing, no LLM path', () => {
    renderPhase(makeState({ phase: 'notice', setCount: 1 }))
    fireEvent.click(screen.getByText('drift.notice.softer'))
    expect(currentApi.submitNoticeTap).toHaveBeenCalledWith('softer')
    expect(currentApi.submitNotice).not.toHaveBeenCalled()
  })

  it('"add a word" routes the typed text through the companion path with the tapped direction', () => {
    renderPhase(makeState({ phase: 'notice', setCount: 1 }))
    fireEvent.click(screen.getByText('+ drift.notice.addWord'))
    fireEvent.change(screen.getByLabelText('drift.notice.addWord'), { target: { value: 'it is louder' } })
    fireEvent.click(screen.getByText('drift.notice.stronger'))
    expect(currentApi.submitNotice).toHaveBeenCalledWith('it is louder', 'stronger')
    expect(currentApi.submitNoticeTap).not.toHaveBeenCalled()
  })

  it('after a tap-only softer, the next wave carries a scripted micro-line', () => {
    currentApi = makeApi(makeState({ phase: 'notice', setCount: 1 }))
    const { rerender } = render(<DriftField {...PROPS} />)
    fireEvent.click(screen.getByText('drift.notice.softer'))
    currentApi = { ...currentApi, state: makeState({ phase: 'set', setCount: 1, softerStreak: 1 }) }
    rerender(<DriftField {...PROPS} />)
    expect(screen.queryByText('drift.micro.softer2')).not.toBeNull() // rotation: wave 1 → variant 2
  })

  it('a crisis closure shows the abort handoff line and no contrast line', () => {
    renderPhase(makeState({ phase: 'closure', closureReason: 'crisis' }))
    expect(screen.queryByText('drift.abort.handoff')).not.toBeNull()
    expect(screen.queryByText('drift.closing.steady')).toBeNull()
  })

  it('a settled closure with softening shows the softened contrast line at the end', () => {
    renderPhase(makeState({ phase: 'closure', closureReason: 'cap', softerTotal: 2 }))
    // Walk the landing lines to the end (click-to-advance).
    fireEvent.click(screen.getByText('drift.closure.anchor'))
    fireEvent.click(screen.getByText('drift.closure.container'))
    expect(screen.queryByText('drift.closing.softened')).not.toBeNull()
  })

  it('Escape outside arrive requests a graceful close (never a dead exit)', () => {
    renderPhase(makeState({ phase: 'notice' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(currentApi.requestClose).toHaveBeenCalled()
  })

  // Regression (Codex #2): the abandon cleanup must fire only on true unmount.
  // With effects keyed on the whole `drift` object, every re-render ran the
  // cleanup → abandon() → persistFinal('abandoned') on an active session.
  it('abandons only on unmount, never on ordinary re-renders', () => {
    currentApi = makeApi(makeState({ phase: 'set' }))
    const { rerender, unmount } = render(<DriftField {...PROPS} />)
    rerender(<DriftField {...PROPS} />)
    rerender(<DriftField {...PROPS} />)
    expect(currentApi.abandon).not.toHaveBeenCalled()
    unmount()
    expect(currentApi.abandon).toHaveBeenCalledTimes(1)
  })

  // Regression (Codex #1): the wave timer must survive re-render churn. The real
  // 1s TICK re-renders the tree every second; a timer keyed on `drift` reset each
  // time and never reached the wave duration, so waves never auto-advanced.
  it('auto-advances a wave after its duration even as tick churn re-renders it', () => {
    vi.useFakeTimers()
    try {
      currentApi = makeApi(makeState({ phase: 'set' }))
      const { rerender } = render(<DriftField {...PROPS} />)
      const waveMs = currentApi.state.limits.setMs
      const step = waveMs / 4 // < waveMs, so any per-render reset would starve the timer
      for (let i = 0; i < 5; i++) {
        act(() => { vi.advanceTimersByTime(step) })
        rerender(<DriftField {...PROPS} />)
      }
      // Cumulative 5*step > waveMs: a stable timer has fired exactly once.
      expect(currentApi.completeSet).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
