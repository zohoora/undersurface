import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock globalConfig to avoid importing firebase.ts (needs real API keys)
vi.mock('./globalConfig', () => ({
  getGlobalConfig: () => null,
}))

// Mock localStorage
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
})

// Import after mocking
const { getSettings, updateSettings } = await import('./settings')

describe('settings', () => {
  beforeEach(() => {
    storage.clear()
    // Clear internal cache by updating with empty-ish partial
    // Force reload by clearing cache
    updateSettings({})
  })

  it('returns defaults when no saved settings', () => {
    storage.clear()
    // Force a fresh load by clearing + updating
    updateSettings({ responseSpeed: 1.0 })
    const s = getSettings()
    expect(s.openRouterModel).toBe('google/gemini-3-flash-preview')
    expect(s.autocorrect).toBe(true)
  })

  it('saves and loads settings', () => {
    updateSettings({ responseSpeed: 2.0 })
    const s = getSettings()
    expect(s.responseSpeed).toBe(2.0)
  })

  it('merges partial updates with existing settings', () => {
    updateSettings({ responseSpeed: 1.5 })
    updateSettings({ autocorrect: false })
    const s = getSettings()
    expect(s.responseSpeed).toBe(1.5)
    expect(s.autocorrect).toBe(false)
  })

  it('persists to localStorage', () => {
    updateSettings({ openRouterModel: 'test/model' })
    const raw = storage.get('undersurface:settings')
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw!)
    expect(parsed.openRouterModel).toBe('test/model')
  })
})
