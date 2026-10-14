import { describe, expect, it } from 'vitest'
import { buildSmsSystemPrompt, wrapSmsHistory } from './prompts'
import { parseLocalDate, timezoneFromPreferences } from './localTime'
import type { SharedCompanionContext } from '../shared/companionKernel'

// Wednesday 2026-10-14 08:00 in Toronto.
const NOW = Date.parse('2026-10-14T12:00:00Z')

const context: SharedCompanionContext = {
  recentSessionNotes: [{ note: 'The job decision remains open.', date: Date.parse('2026-10-14T02:00:00Z') }],
  activeValues: [{ name: 'craft', description: 'doing careful work' }],
  stanceContext: ['Concrete questions help.'],
}

describe('SMS prompt grounding', () => {
  it('keeps relational context and the response grammar on an ordinary turn', () => {
    const prompt = buildSmsSystemPrompt(0, context, { now: NOW, timezone: 'America/Toronto' })
    expect(prompt).toContain('doing careful work')
    expect(prompt).toContain('RESPONSE GRAMMAR')
    expect(prompt).not.toContain('GROUNDING:')
  })

  it('drops relational context and experimentation after a recent crisis', () => {
    const prompt = buildSmsSystemPrompt(0, context, { now: NOW, timezone: 'America/Toronto', grounding: true })
    expect(prompt).not.toContain('doing careful work')
    expect(prompt).not.toContain('Concrete questions help.')
    expect(prompt).toContain('EXPERIENCE POLICY DURING GROUNDING')
    expect(prompt).not.toContain('RESPONSE GRAMMAR')
    expect(prompt).toContain('GROUNDING: The writer has been through acute distress recently.')
    // Foundational continuity stays, as on the web Talk surface.
    expect(prompt).toContain('The job decision remains open.')
  })

  it('always grounds a risk-1 turn, even without a recent-crisis flag', () => {
    const prompt = buildSmsSystemPrompt(1, context, { now: NOW, timezone: 'America/Toronto' })
    expect(prompt).not.toContain('doing careful work')
    expect(prompt).toContain('EXPERIENCE POLICY DURING GROUNDING')
    expect(prompt).toContain('gently check immediate safety')
  })
})

describe('SMS prompt local time', () => {
  it('tells the model the writer-local time when the timezone is known', () => {
    const prompt = buildSmsSystemPrompt(0, {}, { now: NOW, timezone: 'America/Toronto' })
    expect(prompt).toContain('CURRENT LOCAL TIME FOR THE WRITER: Wednesday, October 14, 2026 at 8:00 AM (America/Toronto)')
  })

  it('says the timezone is unknown instead of implying UTC is local', () => {
    const prompt = buildSmsSystemPrompt(0, {}, { now: NOW, timezone: null })
    expect(prompt).toContain('timezone is unknown')
  })

  it('formats continuity dates in the writer timezone', () => {
    // 02:00 UTC on Oct 14 is still the evening of Oct 13 in Toronto.
    expect(buildSmsSystemPrompt(0, context, { now: NOW, timezone: 'America/Toronto' })).toContain('Oct 13: The job decision')
  })

  it('stamps SMS history in the writer timezone', () => {
    const history = [{ direction: 'inbound' as const, body: 'Hi', createdAt: Date.parse('2026-10-14T02:00:00Z') }]
    expect(wrapSmsHistory(history, 'America/Toronto')).toContain('[Oct 13, 10:00 PM] writer: Hi')
    expect(wrapSmsHistory(history, null)).toContain('[Oct 14, 2:00 AM UTC] writer: Hi')
  })
})

describe('writer-local date parsing', () => {
  it('reads a date-only string as local midnight, not UTC midnight', () => {
    expect(parseLocalDate('2026-10-14', 'America/Toronto')).toBe(Date.parse('2026-10-14T04:00:00Z'))
    expect(parseLocalDate('2026-10-14', 'Asia/Tokyo')).toBe(Date.parse('2026-10-13T15:00:00Z'))
    expect(parseLocalDate('2026-10-14', null)).toBe(Date.parse('2026-10-14T00:00:00Z'))
  })

  it('handles the offset on DST transition dates', () => {
    expect(parseLocalDate('2026-03-08', 'America/Toronto')).toBe(Date.parse('2026-03-08T05:00:00Z'))
    expect(parseLocalDate('2026-11-01', 'America/Toronto')).toBe(Date.parse('2026-11-01T04:00:00Z'))
  })

  it('reads the timezone only from valid field-window preferences', () => {
    expect(timezoneFromPreferences({ fieldWindows: { timezone: 'America/Toronto' } })).toBe('America/Toronto')
    expect(timezoneFromPreferences({ fieldWindows: { timezone: 'Mars/Olympus' } })).toBeNull()
    expect(timezoneFromPreferences({})).toBeNull()
    expect(timezoneFromPreferences(null)).toBeNull()
  })
})
