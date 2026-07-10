import { describe, expect, it } from 'vitest'
import {
  buildFieldWindowDecision,
  buildFieldWindowResearchEvent,
  canDeliverFieldWindow,
  fieldWindowMessage,
  localWeekKey,
  zonedClock,
  type FieldWindow,
} from './fieldWindowLogic'

const weekdayWindow: FieldWindow = {
  id: 'after-work',
  label: 'After work',
  days: [1, 2, 3, 4, 5],
  startMinute: 17 * 60,
  endMinute: 19 * 60,
  purpose: 'settle',
  enabled: true,
}

describe('field window timing', () => {
  it('evaluates the writer local clock rather than server time', () => {
    const now = Date.parse('2026-07-10T21:30:00Z')
    expect(zonedClock(now, 'America/Toronto')).toMatchObject({
      dateKey: '2026-07-10',
      day: 5,
      minute: 17 * 60 + 30,
    })
    expect(zonedClock(now, 'Europe/London')).toMatchObject({
      dateKey: '2026-07-10',
      day: 5,
      minute: 22 * 60 + 30,
    })
  })

  it('returns no decision outside the named day and time', () => {
    expect(buildFieldWindowDecision({
      uid: 'writer-1',
      window: weekdayWindow,
      timezone: 'America/Toronto',
      now: Date.parse('2026-07-11T21:30:00Z'),
      proactiveMessagesThisWeek: 0,
      maxPerWeek: 2,
    })).toBeNull()
  })

  it('produces a retry-stable id and assignment', () => {
    const input = {
      uid: 'writer-1',
      window: weekdayWindow,
      timezone: 'America/Toronto',
      now: Date.parse('2026-07-10T21:30:00Z'),
      proactiveMessagesThisWeek: 0,
      maxPerWeek: 2 as const,
    }
    const first = buildFieldWindowDecision(input)
    const retry = buildFieldWindowDecision({ ...input, now: input.now + 10 * 60_000 })
    expect(retry).toEqual(first)
    expect(first?.eventId).toMatch(/^field-window-[a-f0-9]{24}$/)
  })

  it('uses one writer-local event id across overlapping windows on the same date', () => {
    const input = {
      uid: 'writer-1', timezone: 'America/Toronto',
      now: Date.parse('2026-07-10T21:30:00Z'), proactiveMessagesThisWeek: 0, maxPerWeek: 3 as const,
    }
    const first = buildFieldWindowDecision({ ...input, window: weekdayWindow })
    const second = buildFieldWindowDecision({ ...input, window: { ...weekdayWindow, id: 'commute', label: 'Commute' } })
    expect(first?.eventId).toBe(second?.eventId)
  })

  it('enforces the message ceiling without inventing a no-contact observation', () => {
    const input = {
      uid: 'writer-1',
      window: weekdayWindow,
      timezone: 'America/Toronto',
      now: Date.parse('2026-07-10T21:30:00Z'),
      maxPerWeek: 1 as const,
    }
    const uncapped = buildFieldWindowDecision({ ...input, proactiveMessagesThisWeek: 0 })
    const capped = buildFieldWindowDecision({ ...input, proactiveMessagesThisWeek: 1 })
    expect(uncapped).not.toBeNull()
    if (uncapped?.arm === 'field_check_in') expect(capped).toBeNull()
    else expect(capped?.arm).toBe('field_no_contact')
  })

  it('keeps week boundaries in the writer timezone', () => {
    expect(localWeekKey(Date.parse('2026-07-12T23:30:00Z'), 'America/Toronto')).toBe('2026-07-06')
    expect(localWeekKey(Date.parse('2026-07-13T04:30:00Z'), 'America/Toronto')).toBe('2026-07-13')
  })

  it('uses fixed, purpose-specific copy with permission not to respond', () => {
    expect(fieldWindowMessage('notice')).toContain('No need to reply')
    expect(fieldWindowMessage('settle')).toContain('exhale')
    expect(fieldWindowMessage('act')).toContain('next move')
  })

  it('records deliberate quiet as delivered without pretending it was an outcome', () => {
    let suffix = 0
    let decision = null
    while (!decision || decision.arm !== 'field_no_contact') {
      decision = buildFieldWindowDecision({
        uid: `writer-${suffix++}`,
        window: weekdayWindow,
        timezone: 'America/Toronto',
        now: Date.parse('2026-07-10T21:30:00Z'),
        proactiveMessagesThisWeek: 0,
        maxPerWeek: 2,
      })
    }
    const event = buildFieldWindowResearchEvent(decision, 100)
    expect(event).toMatchObject({
      status: 'delivered',
      assignedArm: 'field_no_contact',
      deliveredArm: 'field_no_contact',
      deliveredAt: 100,
    })
    expect(event).not.toHaveProperty('outcome')
  })

  it('rechecks current consent, window state, and linkage immediately before delivery', () => {
    const preferences = { enabled: true, consentAt: 10, windows: [weekdayWindow] }
    expect(canDeliverFieldWindow({ preferences, windowId: weekdayWindow.id, hasLinkedPhone: true })).toBe(true)
    expect(canDeliverFieldWindow({ preferences: { ...preferences, enabled: false }, windowId: weekdayWindow.id, hasLinkedPhone: true })).toBe(false)
    expect(canDeliverFieldWindow({ preferences, windowId: weekdayWindow.id, hasLinkedPhone: false })).toBe(false)
    expect(canDeliverFieldWindow({ preferences, windowId: 'removed', hasLinkedPhone: true })).toBe(false)
  })
})
