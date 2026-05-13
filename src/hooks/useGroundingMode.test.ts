import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ─── Mocks (hoisted by Vitest) ────────────────────────────────

const trackEventMock = vi.fn()
vi.mock('../services/analytics', () => ({
  trackEvent: (...a: unknown[]) => trackEventMock(...a),
}))

vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => ({ grounding: { autoExitMinutes: 5 } }),
}))

const {
  useGroundingMode,
  activateGrounding,
  deactivateGrounding,
  isGroundingActive,
} = await import('./useGroundingMode')

beforeEach(() => {
  // Force-clear module state before each test — grounding is a module-level
  // singleton (subscribed via useSyncExternalStore) so a previous test's
  // active flag would leak into the next.
  deactivateGrounding()
  trackEventMock.mockReset()
})

afterEach(() => {
  deactivateGrounding()
})

describe('useGroundingMode — useSyncExternalStore subscription', () => {
  it('returns false initially when grounding is inactive', () => {
    const { result } = renderHook(() => useGroundingMode())
    expect(result.current).toBe(false)
  })

  it('re-renders to true when activateGrounding fires', () => {
    const { result } = renderHook(() => useGroundingMode())
    expect(result.current).toBe(false)
    act(() => { activateGrounding('manual') })
    expect(result.current).toBe(true)
  })

  it('re-renders to false when deactivateGrounding fires', () => {
    activateGrounding('manual')
    const { result } = renderHook(() => useGroundingMode())
    expect(result.current).toBe(true)
    act(() => { deactivateGrounding() })
    expect(result.current).toBe(false)
  })

  it('exposes a stable isGroundingActive() that matches the hook return', () => {
    const { result } = renderHook(() => useGroundingMode())
    expect(result.current).toBe(isGroundingActive())
    act(() => { activateGrounding('auto') })
    expect(result.current).toBe(isGroundingActive())
    expect(result.current).toBe(true)
  })
})

describe('useGroundingMode — pure re-exports (back-compat surface)', () => {
  it('activateGrounding fires a grounding_activated analytics event with trigger', () => {
    act(() => { activateGrounding('auto') })
    expect(trackEventMock).toHaveBeenCalledWith('grounding_activated', { trigger: 'auto' })
  })

  it('activateGrounding is idempotent — second call does NOT re-fire analytics', () => {
    act(() => { activateGrounding('manual') })
    act(() => { activateGrounding('manual') })
    expect(trackEventMock).toHaveBeenCalledTimes(1)
  })

  it('deactivateGrounding is a no-op when grounding is already inactive', () => {
    // Multiple subscribers shouldn't be notified about a non-state-change.
    const renders: boolean[] = []
    renderHook(() => {
      const v = useGroundingMode()
      renders.push(v)
      return v
    })
    const beforeCount = renders.length
    act(() => { deactivateGrounding() })
    expect(renders.length).toBe(beforeCount)
  })

  it('sets the data-grounding attribute on document.documentElement when active', () => {
    act(() => { activateGrounding('manual') })
    expect(document.documentElement.getAttribute('data-grounding')).toBe('true')
    act(() => { deactivateGrounding() })
    expect(document.documentElement.getAttribute('data-grounding')).toBeNull()
  })
})
