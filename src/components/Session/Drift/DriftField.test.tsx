import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import type { DriftApi } from '../../../hooks/useDriftSession'
import type { DriftState } from '../../../engine/driftEngine'
import { DRIFT_LIMITS } from '../../../engine/driftEngine'

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

let currentSettings = { lastDriftBlsChannel: 'visual', lastDriftAudioVolume: 0.5, lastDriftVoice: false }
vi.mock('../../../store/settings', () => ({
  getSettings: () => currentSettings,
  updateSettings: vi.fn(),
}))

import { DriftField } from './DriftField'

function makeState(overrides: Partial<DriftState> = {}): DriftState {
  return {
    phase: 'arrive', setCount: 0, sameStreak: 0, inSettleRecheck: false,
    elapsedMs: 0, closureReason: null, lastInterweave: null, ...overrides,
  }
}

function makeApi(state: DriftState): DriftApi {
  return {
    state,
    transcript: [],
    streamingText: '',
    begin: vi.fn(async () => {}),
    confirmAnchor: vi.fn(),
    submitStartingPoint: vi.fn(async () => {}),
    submitBaseline: vi.fn(async () => {}),
    completeSet: vi.fn(),
    submitNotice: vi.fn(async () => {}),
    settleDone: vi.fn(),
    requestClose: vi.fn(),
    closureDone: vi.fn(async () => {}),
    abandon: vi.fn(async () => {}),
    voiceActive: false,
  }
}

function renderPhase(state: DriftState) {
  currentApi = makeApi(state)
  return render(<DriftField parentSessionId={null} hrvContext={null} voiceAvailable={false} onClose={() => {}} />)
}

beforeEach(() => {
  currentSettings = { lastDriftBlsChannel: 'visual', lastDriftAudioVolume: 0.5, lastDriftVoice: false }
})
afterEach(() => cleanup())

describe('DriftField', () => {
  it('arrive shows the not-therapy framing and NO Settle & close button', () => {
    renderPhase(makeState({ phase: 'arrive' }))
    expect(screen.queryByText('drift.arrive.notTherapy')).not.toBeNull()
    expect(screen.queryByText('drift.settleClose')).toBeNull()
  })

  it('anchor exposes the persistent Settle & close button', () => {
    renderPhase(makeState({ phase: 'anchor' }))
    expect(screen.queryByText('drift.settleClose')).not.toBeNull()
  })

  it('set renders the visual BLS dot and Skip advances the set', () => {
    renderPhase(makeState({ phase: 'set' }))
    expect(screen.queryByTestId('bls-dot')).not.toBeNull()
    fireEvent.click(screen.getByText('drift.set.skip'))
    expect(currentApi.completeSet).toHaveBeenCalled()
  })

  it('notice renders the directional pills and submits the chosen direction', () => {
    renderPhase(makeState({ phase: 'notice' }))
    fireEvent.click(screen.getByText('drift.notice.stronger'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'it is louder' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(currentApi.submitNotice).toHaveBeenCalledWith('it is louder', 'stronger')
  })

  it('a crisis closure shows the abort handoff line', () => {
    renderPhase(makeState({ phase: 'closure', closureReason: 'crisis' }))
    expect(screen.queryByText('drift.abort.handoff')).not.toBeNull()
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
    const props = { parentSessionId: null, hrvContext: null, voiceAvailable: false, onClose: () => {} }
    currentApi = makeApi(makeState({ phase: 'set' }))
    const { rerender, unmount } = render(<DriftField {...props} />)
    rerender(<DriftField {...props} />)
    rerender(<DriftField {...props} />)
    expect(currentApi.abandon).not.toHaveBeenCalled()
    unmount()
    expect(currentApi.abandon).toHaveBeenCalledTimes(1)
  })

  // Regression (Codex #1): the set timer must survive re-render churn. The real
  // 1s TICK re-renders the tree every second; a timer keyed on `drift` reset each
  // time and never reached setMs, so sets never auto-advanced.
  it('auto-advances a set after setMs even as tick churn re-renders it', () => {
    vi.useFakeTimers()
    try {
      const props = { parentSessionId: null, hrvContext: null, voiceAvailable: false, onClose: () => {} }
      currentApi = makeApi(makeState({ phase: 'set' }))
      const { rerender } = render(<DriftField {...props} />)
      const step = DRIFT_LIMITS.setMs / 5 // < setMs, so any per-render reset would starve the timer
      for (let i = 0; i < 6; i++) {
        act(() => { vi.advanceTimersByTime(step) })
        rerender(<DriftField {...props} />)
      }
      // Cumulative 6*step = 30s > setMs (25s): a stable timer has fired exactly once.
      expect(currentApi.completeSet).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
