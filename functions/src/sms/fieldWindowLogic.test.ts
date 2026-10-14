import { describe, expect, it } from 'vitest'
import {
  MIN_FIELD_WINDOW_MINUTES,
  buildFieldWindowDecision,
  buildFieldWindowResearchEvent,
  canDeliverFieldWindow,
  countsTowardWeeklyCap,
  fieldWindowDispatchBlock,
  fieldWindowIneligibility,
  fieldWindowMessage,
  fieldWindowTimezoneProblem,
  hasFieldWindowConsent,
  isValidTimezone,
  localWeekKey,
  parseFieldWindowPreferences,
  validFieldWindow,
  zonedClock,
  type FieldWindow,
  type FieldWindowDecision,
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

function withoutLabel(window: FieldWindow): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...window }
  delete copy.label
  return copy
}

function findDecision(arm: FieldWindowDecision['arm']): FieldWindowDecision {
  for (let suffix = 0; suffix < 200; suffix++) {
    const decision = buildFieldWindowDecision({
      uid: `writer-${suffix}`,
      window: weekdayWindow,
      timezone: 'America/Toronto',
      now: Date.parse('2026-07-10T21:30:00Z'),
    })
    if (decision?.arm === arm) return decision
  }
  throw new Error(`no ${arm} decision found`)
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
    })).toBeNull()
  })

  it('produces a retry-stable id and assignment', () => {
    const input = {
      uid: 'writer-1',
      window: weekdayWindow,
      timezone: 'America/Toronto',
      now: Date.parse('2026-07-10T21:30:00Z'),
    }
    const first = buildFieldWindowDecision(input)
    const retry = buildFieldWindowDecision({ ...input, now: input.now + 10 * 60_000 })
    expect(retry).toEqual(first)
    expect(first?.eventId).toMatch(/^field-window-[a-f0-9]{24}$/)
  })

  it('uses one writer-local event id across overlapping windows on the same date', () => {
    const input = {
      uid: 'writer-1', timezone: 'America/Toronto',
      now: Date.parse('2026-07-10T21:30:00Z'),
    }
    const first = buildFieldWindowDecision({ ...input, window: weekdayWindow })
    const second = buildFieldWindowDecision({ ...input, window: { ...weekdayWindow, id: 'commute', label: 'Commute' } })
    expect(first?.eventId).toBe(second?.eventId)
  })

  it('makes a capped day ineligible for BOTH arms so late-week days are not biased toward quiet', () => {
    expect(fieldWindowIneligibility({ recentCrisis: false, proactiveMessagesThisWeek: 0, maxPerWeek: 1 })).toBeNull()
    expect(fieldWindowIneligibility({ recentCrisis: false, proactiveMessagesThisWeek: 1, maxPerWeek: 1 })).toBe('ineligible_cap')
    for (const decision of [findDecision('field_no_contact'), findDecision('field_check_in')]) {
      const event = buildFieldWindowResearchEvent(decision, 100, 'ineligible_cap')
      expect(event).toMatchObject({ status: 'cancelled', cancelReason: 'ineligible_cap', assignedArm: decision.arm })
      expect(event).not.toHaveProperty('deliveredArm')
      expect(countsTowardWeeklyCap(event)).toBe(false)
    }
  })

  it('never treats a recent-crisis day as part of the experiment', () => {
    expect(fieldWindowIneligibility({ recentCrisis: true, proactiveMessagesThisWeek: 0, maxPerWeek: 3 })).toBe('recent_crisis')
    const event = buildFieldWindowResearchEvent(findDecision('field_no_contact'), 100, 'recent_crisis')
    expect(event).toMatchObject({ status: 'cancelled', cancelReason: 'recent_crisis' })
  })

  it('counts only live contact-arm events toward the weekly cap', () => {
    expect(countsTowardWeeklyCap({ assignedArm: 'field_check_in', status: 'assigned' })).toBe(true)
    expect(countsTowardWeeklyCap({ assignedArm: 'field_check_in', status: 'delivered' })).toBe(true)
    expect(countsTowardWeeklyCap({ assignedArm: 'field_check_in', status: 'cancelled' })).toBe(false)
    expect(countsTowardWeeklyCap({ assignedArm: 'field_check_in', status: 'failed' })).toBe(false)
    expect(countsTowardWeeklyCap({ assignedArm: 'field_no_contact', status: 'delivered' })).toBe(false)
  })

  it('keeps week boundaries in the writer timezone', () => {
    expect(localWeekKey(Date.parse('2026-07-12T23:30:00Z'), 'America/Toronto')).toBe('2026-07-06')
    expect(localWeekKey(Date.parse('2026-07-13T04:30:00Z'), 'America/Toronto')).toBe('2026-07-13')
  })

  it('uses fixed, purpose-specific copy with permission not to respond and an opt-out line', () => {
    expect(fieldWindowMessage('notice')).toContain('No need to reply')
    expect(fieldWindowMessage('settle')).toContain('exhale')
    expect(fieldWindowMessage('act')).toContain('next move')
    for (const purpose of ['notice', 'settle', 'act'] as const) {
      expect(fieldWindowMessage(purpose)).toMatch(/Reply STOP to opt out\.$/)
    }
  })

  it('records deliberate quiet as delivered without pretending it was an outcome', () => {
    const event = buildFieldWindowResearchEvent(findDecision('field_no_contact'), 100)
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

describe('field window preference validation', () => {
  const valid = {
    enabled: true,
    timezone: 'America/Toronto',
    maxPerWeek: 2,
    consentAt: 10,
    windows: [weekdayWindow],
  }

  it('accepts a well-formed preferences doc', () => {
    expect(parseFieldWindowPreferences(valid)).toEqual(valid)
  })

  it('rejects malformed top-level fields instead of throwing', () => {
    expect(parseFieldWindowPreferences(null)).toBeNull()
    expect(parseFieldWindowPreferences('on')).toBeNull()
    expect(parseFieldWindowPreferences({ ...valid, enabled: 'true' })).toBeNull()
    expect(parseFieldWindowPreferences({ ...valid, timezone: 'Mars/Olympus' })).toBeNull()
    expect(parseFieldWindowPreferences({ ...valid, timezone: 42 })).toBeNull()
    expect(parseFieldWindowPreferences({ ...valid, maxPerWeek: '2' })).toBeNull()
    expect(parseFieldWindowPreferences({ ...valid, maxPerWeek: 9 })).toBeNull()
    expect(parseFieldWindowPreferences({ ...valid, windows: 'all' })).toBeNull()
  })

  it('validates the timezone server-side and names the problem for an opted-in writer', () => {
    expect(isValidTimezone('America/Toronto')).toBe(true)
    expect(isValidTimezone('Eastern time')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone(`America/${'x'.repeat(80)}`)).toBe(false)
    expect(parseFieldWindowPreferences({ ...valid, timezone: 'Eastern time' })).toBeNull()

    expect(fieldWindowTimezoneProblem(valid)).toBeNull()
    expect(fieldWindowTimezoneProblem({ ...valid, timezone: 'Eastern time' })).toBe('invalid_timezone')
    expect(fieldWindowTimezoneProblem({ ...valid, timezone: undefined })).toBe('invalid_timezone')
    // Not opted in: nothing would be scheduled anyway, so nothing to report.
    expect(fieldWindowTimezoneProblem({ ...valid, enabled: false, timezone: 'Eastern time' })).toBeNull()
    expect(fieldWindowTimezoneProblem(null)).toBeNull()
  })

  it('drops malformed windows (missing label, non-objects, bad days) but keeps the good one', () => {
    const noLabel = withoutLabel(weekdayWindow)
    const parsed = parseFieldWindowPreferences({
      ...valid,
      windows: [noLabel, null, 'window', 7, { ...weekdayWindow, id: 'bad-days', days: ['Mon'] }, weekdayWindow],
    })
    expect(parsed?.windows.map(window => window.id)).toEqual([weekdayWindow.id])
  })

  it('validates every window field', () => {
    expect(validFieldWindow(weekdayWindow)).toBe(true)
    expect(validFieldWindow({ ...weekdayWindow, label: undefined })).toBe(false)
    expect(validFieldWindow({ ...weekdayWindow, label: 5 })).toBe(false)
    expect(validFieldWindow({ ...weekdayWindow, enabled: 'yes' })).toBe(false)
    expect(validFieldWindow({ ...weekdayWindow, id: '' })).toBe(false)
    expect(validFieldWindow({ ...weekdayWindow, days: [] })).toBe(false)
    expect(validFieldWindow({ ...weekdayWindow, days: [1.5] })).toBe(false)
    expect(validFieldWindow({ ...weekdayWindow, purpose: 'sell' })).toBe(false)
    expect(validFieldWindow({ ...weekdayWindow, startMinute: '17:00' })).toBe(false)
    expect(validFieldWindow([weekdayWindow])).toBe(false)
  })

  it('requires windows of at least 15 minutes so the 15-minute scheduler can observe them', () => {
    const start = 17 * 60
    expect(validFieldWindow({ ...weekdayWindow, startMinute: start, endMinute: start + MIN_FIELD_WINDOW_MINUTES })).toBe(true)
    expect(validFieldWindow({ ...weekdayWindow, startMinute: start, endMinute: start + 14 })).toBe(false)
  })

  it('does not throw on a window without a label (it used to call label.trim())', () => {
    expect(() => buildFieldWindowDecision({
      uid: 'writer-1',
      window: withoutLabel(weekdayWindow) as unknown as FieldWindow,
      timezone: 'America/Toronto',
      now: Date.parse('2026-07-10T21:30:00Z'),
    })).not.toThrow()
  })

  it('honors only consent given after the latest server-side opt-out', () => {
    expect(hasFieldWindowConsent({ consentAt: 10 }, null)).toBe(true)
    expect(hasFieldWindowConsent({ consentAt: 10 }, 20)).toBe(false)
    expect(hasFieldWindowConsent({ consentAt: 30 }, 20)).toBe(true)
    expect(hasFieldWindowConsent({}, null)).toBe(false)
  })
})

describe('field window pre-send recheck', () => {
  const preferences = parseFieldWindowPreferences({
    enabled: true,
    timezone: 'America/Toronto',
    maxPerWeek: 2,
    consentAt: 10,
    windows: [weekdayWindow],
  })
  const base = {
    preferences,
    windowId: weekdayWindow.id,
    localDate: '2026-07-10',
    hasLinkedPhone: true,
    optedOutAt: null,
    recentCrisis: false,
    now: Date.parse('2026-07-10T21:30:00Z'), // Friday 17:30 in Toronto
  }

  it('allows a send inside the window on the scheduled local date', () => {
    expect(fieldWindowDispatchBlock(base)).toBeNull()
  })

  it('cancels when the local clock has left the window or the local date changed', () => {
    expect(fieldWindowDispatchBlock({ ...base, now: Date.parse('2026-07-10T23:30:00Z') })).toBe('outside_window')
    expect(fieldWindowDispatchBlock({ ...base, localDate: '2026-07-09' })).toBe('outside_window')
    expect(fieldWindowDispatchBlock({ ...base, localDate: undefined })).toBe('outside_window')
  })

  it('cancels on a recent crisis', () => {
    expect(fieldWindowDispatchBlock({ ...base, recentCrisis: true })).toBe('recent_crisis')
  })

  it('cancels when consent, the window, or the link was removed', () => {
    expect(fieldWindowDispatchBlock({ ...base, preferences: null })).toBe('opt_in_or_link_removed')
    expect(fieldWindowDispatchBlock({ ...base, hasLinkedPhone: false })).toBe('opt_in_or_link_removed')
    expect(fieldWindowDispatchBlock({ ...base, windowId: 'removed' })).toBe('opt_in_or_link_removed')
    expect(fieldWindowDispatchBlock({ ...base, optedOutAt: 20 })).toBe('opt_in_or_link_removed')
  })
})
