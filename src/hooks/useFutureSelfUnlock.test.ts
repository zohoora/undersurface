import { describe, it, expect } from 'vitest'
import { computeFutureSelfUnlock } from './useFutureSelfUnlock'
import type { GlobalConfig } from '../admin/adminTypes'

function makeConfig(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return {
    defaultModel: 'test',
    defaultResponseSpeed: 1,
    defaultTypewriterScroll: 'off',
    features: {
      partsEnabled: true,
      visualEffectsEnabled: true,
      autocorrectEnabled: true,
      ...overrides.features,
    },
    announcement: null,
    updatedAt: 0,
    updatedBy: '',
    ...overrides,
  } as GlobalConfig
}

describe('computeFutureSelfUnlock', () => {
  it('returns disabled state when feature flag is off', () => {
    const config = makeConfig({ features: { partsEnabled: true, visualEffectsEnabled: true, autocorrectEnabled: true, futureSelfEnabled: false } })
    const state = computeFutureSelfUnlock(config, [], [])
    expect(state.enabled).toBe(false)
    expect(state.unlocked).toBe(false)
  })

  it('returns locked when enabled but counts below thresholds', () => {
    const config = makeConfig({
      features: { partsEnabled: true, visualEffectsEnabled: true, autocorrectEnabled: true, futureSelfEnabled: true },
      futureSelf: { minEntries: 15, minSessions: 3 },
    })
    const entries = Array.from({ length: 5 }, () => ({ plainText: 'content' }))
    const sessions = [{ messageCount: 4 }]

    const state = computeFutureSelfUnlock(config, entries, sessions)
    expect(state.enabled).toBe(true)
    expect(state.unlocked).toBe(false)
    expect(state.progress.entries).toEqual({ have: 5, need: 15 })
    expect(state.progress.sessions).toEqual({ have: 1, need: 3 })
  })

  it('unlocks when both thresholds are met', () => {
    const config = makeConfig({
      features: { partsEnabled: true, visualEffectsEnabled: true, autocorrectEnabled: true, futureSelfEnabled: true },
      futureSelf: { minEntries: 3, minSessions: 2 },
    })
    const entries = Array.from({ length: 5 }, () => ({ plainText: 'meaningful' }))
    const sessions = [{ messageCount: 4 }, { messageCount: 6 }, { messageCount: 10 }]
    const state = computeFutureSelfUnlock(config, entries, sessions)
    expect(state.unlocked).toBe(true)
  })

  it('force-unlocks when both thresholds are 0 (admin override)', () => {
    const config = makeConfig({
      features: { partsEnabled: true, visualEffectsEnabled: true, autocorrectEnabled: true, futureSelfEnabled: true },
      futureSelf: { minEntries: 0, minSessions: 0 },
    })
    const state = computeFutureSelfUnlock(config, [], [])
    expect(state.unlocked).toBe(true)
  })

  it('ignores empty entries when counting progress', () => {
    const config = makeConfig({
      features: { partsEnabled: true, visualEffectsEnabled: true, autocorrectEnabled: true, futureSelfEnabled: true },
      futureSelf: { minEntries: 3, minSessions: 0 },
    })
    const entries = [
      { plainText: 'real' },
      { plainText: '' },
      { plainText: '   ' },
      { plainText: 'real2' },
    ]
    const state = computeFutureSelfUnlock(config, entries, [])
    expect(state.progress.entries.have).toBe(2)
    expect(state.unlocked).toBe(false)
  })

  it('ignores sessions with fewer than 2 messages', () => {
    const config = makeConfig({
      features: { partsEnabled: true, visualEffectsEnabled: true, autocorrectEnabled: true, futureSelfEnabled: true },
      futureSelf: { minEntries: 0, minSessions: 2 },
    })
    const sessions = [{ messageCount: 0 }, { messageCount: 1 }, { messageCount: 3 }]
    const state = computeFutureSelfUnlock(config, [], sessions)
    expect(state.progress.sessions.have).toBe(1)
    expect(state.unlocked).toBe(false)
  })

  it('uses default thresholds when not set in config', () => {
    const config = makeConfig({
      features: { partsEnabled: true, visualEffectsEnabled: true, autocorrectEnabled: true, futureSelfEnabled: true },
    })
    const state = computeFutureSelfUnlock(config, [], [])
    expect(state.progress.entries.need).toBe(15)
    expect(state.progress.sessions.need).toBe(3)
  })

  it('handles null config gracefully', () => {
    const state = computeFutureSelfUnlock(null, [], [])
    expect(state.enabled).toBe(false)
    expect(state.unlocked).toBe(false)
  })
})
