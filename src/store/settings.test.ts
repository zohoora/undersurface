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
    updateSettings({ responseSpeed: 1.0 })
    const s = getSettings()
    expect(s.responseSpeed).toBe(1.0)
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
    updateSettings({ responseSpeed: 1.7 })
    const raw = storage.get('undersurface:settings')
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw!)
    expect(parsed.responseSpeed).toBe(1.7)
  })

  it('persists ONLY overrides, not baked-in defaults like language (C-5)', () => {
    storage.clear()
    updateSettings({ responseSpeed: 1.9 })
    const parsed = JSON.parse(storage.get('undersurface:settings')!)
    // The changed key is stored…
    expect(parsed.responseSpeed).toBe(1.9)
    // …but unchanged browser-detected/default keys are NOT baked in, so later
    // admin/language changes can still reach the device.
    expect('language' in parsed).toBe(false)
    expect('autocorrect' in parsed).toBe(false)
  })

  it('un-bakes an existing frozen full-object localStorage on the next save (C-5)', () => {
    // Simulate an existing user whose localStorage has the whole merged object.
    const detected = getSettings().language
    storage.set('undersurface:settings', JSON.stringify({
      responseSpeed: 1.0, autocorrect: true, language: detected, theme: 'dark',
    }))
    // Reset the in-memory cache so the store re-reads the seeded localStorage.
    updateSettings({ theme: 'light' })
    const parsed = JSON.parse(storage.get('undersurface:settings')!)
    // Only the genuinely-diverging key survives; the default-valued keys drop.
    expect(parsed.theme).toBe('light')
    expect('language' in parsed).toBe(false)
    expect('autocorrect' in parsed).toBe(false)
  })

  it('defaults Room to listen-first, five minutes, sparse voice, and ocean', () => {
    storage.clear()
    updateSettings({})
    const s = getSettings()
    expect(s.lastRoomApproach).toBe('listen_first')
    expect(s.lastRoomDuration).toBe(5)
    expect(s.lastRoomVoiceDensity).toBe('sparse')
    expect(s.lastRoomAudio).toBe('ocean')
  })

  it('round-trips lastRoomVoiceDensity through updateSettings', () => {
    updateSettings({ lastRoomVoiceDensity: 'present' })
    expect(getSettings().lastRoomVoiceDensity).toBe('present')
    // sparse-override persistence keeps only the diverging key
    const parsed = JSON.parse(storage.get('undersurface:settings')!)
    expect(parsed.lastRoomVoiceDensity).toBe('present')
  })

  it('defaults timezone to the device zone, not a hardcoded one', () => {
    // The timezone defines "today's session" boundaries — a hardcoded ET
    // default split non-US users' sessions mid-afternoon.
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const s = getSettings()
    expect(s.timezone).toBe(deviceZone)
    // Sanity: the value must be a valid IANA zone
    expect(() => new Intl.DateTimeFormat('en', { timeZone: s.timezone })).not.toThrow()
  })
})
