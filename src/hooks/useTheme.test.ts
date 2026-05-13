import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AppSettings } from '../store/settings'

// ─── matchMedia shim ──────────────────────────────────────────
// The hook captures `window.matchMedia('(prefers-color-scheme: dark)')` ONCE
// at module-load time. So we must install the mock BEFORE importing the hook,
// and reuse the same captured MediaQueryList instance for the whole suite.

let prefersDark = false
const mediaListeners = new Set<() => void>()

const mediaQueryStub = {
  get matches() { return prefersDark },
  media: '(prefers-color-scheme: dark)',
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: (_evt: string, cb: () => void) => { mediaListeners.add(cb) },
  removeEventListener: (_evt: string, cb: () => void) => { mediaListeners.delete(cb) },
  dispatchEvent: () => false,
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: () => mediaQueryStub,
})

// ─── Settings mock ────────────────────────────────────────────

let currentSettings: AppSettings = {
  responseSpeed: 1.0,
  autoCapitalize: true,
  autocorrect: true,
  bilateralStimulation: true,
  theme: 'system',
  language: 'en',
  timezone: 'America/New_York',
  lastSessionMode: 'standard',
  lastRelaxDuration: 10,
  lastRelaxType: 'breathwork',
  lastRelaxAudio: 'ocean',
  lastRelaxAudioVolume: 0.5,
  lastRelaxVoiceEnabled: false,
  lastRelaxVisualMode: 'full',
}
const settingsListeners = new Set<() => void>()

function setSettings(patch: Partial<AppSettings>) {
  currentSettings = { ...currentSettings, ...patch }
  for (const l of settingsListeners) l()
}

vi.mock('../store/settings', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSettings: () =>
      useSyncExternalStore(
        (cb: () => void) => {
          settingsListeners.add(cb)
          return () => { settingsListeners.delete(cb) }
        },
        () => currentSettings,
      ),
    getSettings: () => currentSettings,
  }
})

const { useTheme, getResolvedTheme } = await import('./useTheme')

beforeEach(() => {
  prefersDark = false
  mediaListeners.clear()
  document.documentElement.removeAttribute('data-theme')
  currentSettings = { ...currentSettings, theme: 'system' }
})

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
})

describe('useTheme — explicit theme', () => {
  it('returns "light" when settings.theme === "light"', () => {
    setSettings({ theme: 'light' })
    const { result } = renderHook(() => useTheme())
    expect(result.current).toBe('light')
  })

  it('returns "dark" when settings.theme === "dark"', () => {
    setSettings({ theme: 'dark' })
    const { result } = renderHook(() => useTheme())
    expect(result.current).toBe('dark')
  })

  it('ignores prefers-color-scheme when an explicit theme is chosen', () => {
    prefersDark = true
    setSettings({ theme: 'light' })
    const { result } = renderHook(() => useTheme())
    expect(result.current).toBe('light')
  })
})

describe('useTheme — system theme', () => {
  it('resolves to "light" when the OS prefers light', () => {
    prefersDark = false
    setSettings({ theme: 'system' })
    const { result } = renderHook(() => useTheme())
    expect(result.current).toBe('light')
  })

  it('resolves to "dark" when the OS prefers dark', () => {
    prefersDark = true
    setSettings({ theme: 'system' })
    const { result } = renderHook(() => useTheme())
    expect(result.current).toBe('dark')
  })

  it('re-renders when the OS color scheme changes', () => {
    prefersDark = false
    setSettings({ theme: 'system' })
    const { result } = renderHook(() => useTheme())
    expect(result.current).toBe('light')

    act(() => {
      prefersDark = true
      for (const cb of mediaListeners) cb()
    })
    expect(result.current).toBe('dark')
  })
})

describe('useTheme — DOM side-effect', () => {
  it('mirrors the resolved theme onto document.documentElement.dataset.theme', () => {
    setSettings({ theme: 'dark' })
    renderHook(() => useTheme())
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('updates the data-theme attribute when settings change', () => {
    setSettings({ theme: 'light' })
    const { rerender } = renderHook(() => useTheme())
    expect(document.documentElement.dataset.theme).toBe('light')

    act(() => { setSettings({ theme: 'dark' }) })
    rerender()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('getResolvedTheme — non-React helper', () => {
  it('honors an explicit theme without consulting matchMedia', () => {
    prefersDark = true // would resolve to dark for 'system'
    setSettings({ theme: 'light' })
    expect(getResolvedTheme()).toBe('light')
  })

  it('falls through to matchMedia when theme === "system"', () => {
    prefersDark = true
    setSettings({ theme: 'system' })
    expect(getResolvedTheme()).toBe('dark')
  })
})
