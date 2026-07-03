// groundingState owns the module-level isGroundingActive() flag that
// gates the Real Talk → grounded-tone override (see CLAUDE.md). Several
// load-bearing invariants pass through this file: the flag must be true
// before the next therapist prompt is built, must propagate to subscribers,
// and the auto-exit timer must respect the configured window.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const engineLogMock = vi.fn()
vi.mock('../services/diagnostics', () => ({
  engineLog: (...a: unknown[]) => engineLogMock(...a),
}))

const globalConfigMock = vi.fn(() => null as Record<string, unknown> | null)
vi.mock('./globalConfig', () => ({
  getGlobalConfig: () => globalConfigMock(),
}))

const groundingModule = await import('./groundingState')
const {
  activateGrounding,
  deactivateGrounding,
  isGroundingActive,
  subscribeGrounding,
  clearAutoExitTimer,
} = groundingModule

// Module-level state persists across tests; reset between each.
beforeEach(() => {
  vi.useFakeTimers().setSystemTime(0)
  engineLogMock.mockReset()
  globalConfigMock.mockReset()
  globalConfigMock.mockReturnValue(null)
  if (isGroundingActive()) deactivateGrounding()
  clearAutoExitTimer()
  document.documentElement.removeAttribute('data-grounding')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('groundingState — activate/deactivate', () => {
  it('isGroundingActive is false before any activation', () => {
    expect(isGroundingActive()).toBe(false)
  })

  it('activateGrounding flips isGroundingActive to true', () => {
    activateGrounding()
    expect(isGroundingActive()).toBe(true)
  })

  it('deactivateGrounding flips the flag back to false', () => {
    activateGrounding()
    deactivateGrounding()
    expect(isGroundingActive()).toBe(false)
  })

  it('sets data-grounding="true" on documentElement on activate, removes on deactivate', () => {
    activateGrounding()
    expect(document.documentElement.getAttribute('data-grounding')).toBe('true')
    deactivateGrounding()
    expect(document.documentElement.getAttribute('data-grounding')).toBeNull()
  })

  it('deactivating when not active is a silent no-op (no analytics, no notify churn)', () => {
    const listener = vi.fn()
    subscribeGrounding(listener)
    deactivateGrounding()
    expect(listener).not.toHaveBeenCalled()
  })

  it('activating when ALREADY active does NOT re-fire the diagnostics event (just resets the timer)', () => {
    activateGrounding()
    expect(engineLogMock).toHaveBeenCalledTimes(1)
    engineLogMock.mockClear()
    activateGrounding()
    expect(engineLogMock).not.toHaveBeenCalled()
  })
})

describe('groundingState — observability', () => {
  // Crisis-state signals go to first-party diagnostics only. GA is keyed to
  // the user id and linked to Ads conversions; grounding events there would
  // attach sensitive health data to an advertising identifier.
  it('logs grounding.activated to diagnostics with trigger=auto by default', () => {
    activateGrounding()
    expect(engineLogMock).toHaveBeenCalledWith(
      'info', 'grounding.activated', expect.any(String), { extra: { trigger: 'auto' } },
    )
  })

  it('logs trigger=manual when explicitly requested', () => {
    activateGrounding('manual')
    expect(engineLogMock).toHaveBeenCalledWith(
      'info', 'grounding.activated', expect.any(String), { extra: { trigger: 'manual' } },
    )
  })
})

describe('groundingState — subscribers', () => {
  it('notifies subscribers on activate', () => {
    const listener = vi.fn()
    subscribeGrounding(listener)
    activateGrounding()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('notifies subscribers on deactivate', () => {
    const listener = vi.fn()
    activateGrounding()
    subscribeGrounding(listener)
    deactivateGrounding()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('unsubscribe function removes the listener', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeGrounding(listener)
    unsubscribe()
    activateGrounding()
    expect(listener).not.toHaveBeenCalled()
  })

  it('handles multiple subscribers independently', () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribeGrounding(a)
    subscribeGrounding(b)
    activateGrounding()
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })
})

describe('groundingState — auto-exit timer', () => {
  it('auto-deactivates after the configured autoExitMinutes window', () => {
    globalConfigMock.mockReturnValue({ grounding: { autoExitMinutes: 3 } })
    activateGrounding()
    expect(isGroundingActive()).toBe(true)
    vi.advanceTimersByTime(3 * 60 * 1000 - 1)
    expect(isGroundingActive()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isGroundingActive()).toBe(false)
  })

  it('defaults to 5 minutes when config is missing', () => {
    activateGrounding()
    vi.advanceTimersByTime(5 * 60 * 1000 - 1)
    expect(isGroundingActive()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isGroundingActive()).toBe(false)
  })

  it('re-activation while already active RESETS the auto-exit timer', () => {
    globalConfigMock.mockReturnValue({ grounding: { autoExitMinutes: 2 } })
    activateGrounding()
    vi.advanceTimersByTime(90 * 1000) // 1m30s through
    activateGrounding() // re-trigger
    vi.advanceTimersByTime(90 * 1000) // 90s more — total 3m but only 90s since last reset
    expect(isGroundingActive()).toBe(true)
    vi.advanceTimersByTime(30 * 1000) // hits 2m since last activation
    expect(isGroundingActive()).toBe(false)
  })

  it('deactivate clears the pending auto-exit timer (no late-fire surprise)', () => {
    globalConfigMock.mockReturnValue({ grounding: { autoExitMinutes: 2 } })
    activateGrounding()
    deactivateGrounding()
    activateGrounding()
    vi.advanceTimersByTime(2 * 60 * 1000 - 1)
    expect(isGroundingActive()).toBe(true)
  })

  it('clearAutoExitTimer is an idempotent no-op when no timer is pending', () => {
    expect(() => clearAutoExitTimer()).not.toThrow()
    expect(() => clearAutoExitTimer()).not.toThrow()
  })
})
