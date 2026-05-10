import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRelaxInstructions } from './relaxPrompts'
import type { RelaxSessionType } from '../types'

const ALL_TYPES: readonly RelaxSessionType[] = ['breathwork', 'body_scan', 'safe_place', 'open_awareness']

describe('buildRelaxInstructions', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('produces a non-empty instruction string for every session type', () => {
    for (const sessionType of ALL_TYPES) {
      const out = buildRelaxInstructions({ sessionType, durationMinutes: 10 })
      expect(out.length).toBeGreaterThan(50)
    }
  })

  it('includes the requested duration', () => {
    const out = buildRelaxInstructions({ sessionType: 'breathwork', durationMinutes: 5 })
    expect(out).toContain('5 minutes')
  })

  it('includes the one-way / no-improvisation hard rules', () => {
    const out = buildRelaxInstructions({ sessionType: 'body_scan', durationMinutes: 10 })
    expect(out).toMatch(/one-way|listener will not speak/i)
    expect(out).toMatch(/do not paraphrase|do not improvise|stay silent/i)
  })

  it('embeds optional voice traits when provided', () => {
    const out = buildRelaxInstructions({ sessionType: 'breathwork', durationMinutes: 10, voiceTraits: 'extra quiet, longer pauses' })
    expect(out).toContain('extra quiet, longer pauses')
  })

  it('omits the traits block when not provided', () => {
    const out = buildRelaxInstructions({ sessionType: 'breathwork', durationMinutes: 10 })
    expect(out).not.toContain('Tone notes:')
  })

  it('persona differs by session type', () => {
    const breathwork = buildRelaxInstructions({ sessionType: 'breathwork', durationMinutes: 10 })
    const bodyScan = buildRelaxInstructions({ sessionType: 'body_scan', durationMinutes: 10 })
    const safePlace = buildRelaxInstructions({ sessionType: 'safe_place', durationMinutes: 10 })
    const openAwareness = buildRelaxInstructions({ sessionType: 'open_awareness', durationMinutes: 10 })
    const set = new Set([breathwork, bodyScan, safePlace, openAwareness])
    expect(set.size).toBe(4)
  })
})
