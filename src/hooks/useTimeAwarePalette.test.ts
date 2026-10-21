import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// The time-aware shift writes the background onto <html> inline, which beats
// the stylesheet's [data-theme="dark"] rule. It must re-blend the moment the
// theme changes: in the evening a system switch to dark (macOS Auto
// appearance, at sunset) otherwise left the light background under the dark
// theme's light text for up to 15 minutes.

let config: unknown = { features: { timeAwareAtmosphere: true }, atmosphere: { timeShiftIntensity: 0.3 } }
vi.mock('../store/globalConfig', () => ({ useGlobalConfig: () => config }))

import { useTimeAwarePalette } from './useTimeAwarePalette'

const bg = () => document.documentElement.style.getPropertyValue('--bg-primary')

describe('useTimeAwarePalette', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 21, 18, 0))
    config = { features: { timeAwareAtmosphere: true }, atmosphere: { timeShiftIntensity: 0.3 } }
  })
  afterEach(() => {
    vi.useRealTimers()
    document.documentElement.removeAttribute('style')
  })

  it('re-blends at once when the theme turns dark in the evening', () => {
    const { rerender } = renderHook(({ theme }) => useTimeAwarePalette(theme), { initialProps: { theme: 'light' as 'light' | 'dark' } })
    expect(bg()).toBe('#faf7f2')
    rerender({ theme: 'dark' })
    expect(bg()).toBe('#1a1917')
    rerender({ theme: 'light' })
    expect(bg()).toBe('#faf7f2')
  })

  it('leaves the stylesheet alone in the afternoon and when switched off', () => {
    vi.setSystemTime(new Date(2026, 9, 21, 14, 0))
    const { unmount } = renderHook(() => useTimeAwarePalette('dark'))
    expect(bg()).toBe('')
    unmount()
    vi.setSystemTime(new Date(2026, 9, 21, 18, 0))
    config = { features: { timeAwareAtmosphere: false } }
    renderHook(() => useTimeAwarePalette('light'))
    expect(bg()).toBe('')
  })
})
