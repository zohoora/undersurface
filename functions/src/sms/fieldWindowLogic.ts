import { createHash } from 'node:crypto'

export type FieldWindowPurpose = 'notice' | 'settle' | 'act'
export type FieldWindowDay = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type FieldWindowArm = 'field_check_in' | 'field_no_contact'

export interface FieldWindow {
  id: string
  label: string
  days: FieldWindowDay[]
  startMinute: number
  endMinute: number
  purpose: FieldWindowPurpose
  enabled: boolean
}

export interface ZonedClock {
  dateKey: string
  day: FieldWindowDay
  minute: number
}

export interface FieldWindowDecision {
  eventId: string
  assignmentSeed: string
  localDate: string
  weekKey: string
  arm: FieldWindowArm
  windowId: string
  windowLabel: string
  purpose: FieldWindowPurpose
}

export interface FieldWindowResearchEvent {
  id: string
  protocolId: 'field-window-timing-v1'
  protocolVersion: 1
  assignmentKind: 'randomized'
  status: 'assigned' | 'delivered' | 'cancelled'
  source: 'sms'
  eligibilityPoint: string
  assignmentSeed: string
  assignedArm: FieldWindowArm
  deliveredArm?: FieldWindowArm
  provider: 'deterministic'
  deliveryFidelity: 'deterministic'
  promptVersion: 'field-window-v1'
  appVersion: '2026-07-10.1'
  windowId: string
  windowLabel: string
  purpose: FieldWindowPurpose
  localDate: string
  weekKey: string
  createdAt: number
  deliveredAt?: number
  updatedAt: number
}

const DAY_NUMBER: Record<string, FieldWindowDay> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function partsAt(timestamp: number, timezone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return Object.fromEntries(
    formatter.formatToParts(new Date(timestamp))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0)
    return true
  } catch {
    return false
  }
}

export function zonedClock(timestamp: number, timezone: string): ZonedClock {
  const parts = partsAt(timestamp, timezone)
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    day: DAY_NUMBER[parts.weekday] ?? 0,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

function isoDateMinusDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export function localWeekKey(timestamp: number, timezone: string): string {
  const clock = zonedClock(timestamp, timezone)
  const daysSinceMonday = (clock.day + 6) % 7
  return isoDateMinusDays(clock.dateKey, daysSinceMonday)
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assignedArm(seed: string): FieldWindowArm {
  return Number.parseInt(stableHash(seed).slice(0, 8), 16) % 2 === 0
    ? 'field_check_in'
    : 'field_no_contact'
}

export function validFieldWindow(window: FieldWindow): boolean {
  return typeof window.id === 'string'
    && window.id.length > 0
    && Array.isArray(window.days)
    && window.days.length > 0
    && window.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
    && Number.isInteger(window.startMinute)
    && Number.isInteger(window.endMinute)
    && window.startMinute >= 0
    && window.endMinute <= 24 * 60
    && window.endMinute > window.startMinute
    && ['notice', 'settle', 'act'].includes(window.purpose)
}

export function buildFieldWindowDecision(input: {
  uid: string
  window: FieldWindow
  timezone: string
  now: number
  proactiveMessagesThisWeek: number
  maxPerWeek: 1 | 2 | 3
}): FieldWindowDecision | null {
  const { uid, window, timezone, now, proactiveMessagesThisWeek, maxPerWeek } = input
  if (!uid || !window.enabled || !validFieldWindow(window) || !isValidTimezone(timezone)) return null
  const clock = zonedClock(now, timezone)
  if (!window.days.includes(clock.day)) return null
  if (clock.minute < window.startMinute || clock.minute >= window.endMinute) return null

  const assignmentSeed = `${uid}:${window.id}:${clock.dateKey}:field-window-timing-v1`
  const eventSeed = `${uid}:${clock.dateKey}:field-window-timing-v1`
  const arm = assignedArm(assignmentSeed)
  if (arm === 'field_check_in' && proactiveMessagesThisWeek >= maxPerWeek) return null

  return {
    // One event id per writer-local date means overlapping or separate
    // windows cannot create multiple proactive contacts on the same day.
    eventId: `field-window-${stableHash(eventSeed).slice(0, 24)}`,
    assignmentSeed,
    localDate: clock.dateKey,
    weekKey: localWeekKey(now, timezone),
    arm,
    windowId: window.id,
    windowLabel: window.label.trim().slice(0, 60) || 'Field window',
    purpose: window.purpose,
  }
}

export function buildFieldWindowResearchEvent(
  decision: FieldWindowDecision,
  now: number,
): FieldWindowResearchEvent {
  const delivered = decision.arm === 'field_no_contact'
  return {
    id: decision.eventId,
    protocolId: 'field-window-timing-v1',
    protocolVersion: 1,
    assignmentKind: 'randomized',
    status: delivered ? 'delivered' : 'assigned',
    source: 'sms',
    eligibilityPoint: `field-window:${decision.windowId}`,
    assignmentSeed: decision.assignmentSeed,
    assignedArm: decision.arm,
    ...(delivered ? { deliveredArm: decision.arm } : {}),
    provider: 'deterministic',
    deliveryFidelity: 'deterministic',
    promptVersion: 'field-window-v1',
    appVersion: '2026-07-10.1',
    windowId: decision.windowId,
    windowLabel: decision.windowLabel,
    purpose: decision.purpose,
    localDate: decision.localDate,
    weekKey: decision.weekKey,
    createdAt: now,
    ...(delivered ? { deliveredAt: now } : {}),
    updatedAt: now,
  }
}

const FIELD_WINDOW_MESSAGES: Record<FieldWindowPurpose, string> = {
  notice: 'A small field note: what is here right now, before you explain it? No need to reply.',
  settle: 'A small pause, if it fits: unclench one place and let one exhale run long. No need to reply.',
  act: 'A small field question: what is one next move that would make the next ten minutes easier? No need to reply.',
}

export function fieldWindowMessage(purpose: FieldWindowPurpose): string {
  return FIELD_WINDOW_MESSAGES[purpose]
}

export function canDeliverFieldWindow(input: {
  preferences: { enabled?: boolean; consentAt?: number; windows?: FieldWindow[] } | null
  windowId: string
  hasLinkedPhone: boolean
}): boolean {
  return Boolean(
    input.hasLinkedPhone
    && input.preferences?.enabled === true
    && typeof input.preferences.consentAt === 'number'
    && input.preferences.windows?.some(window => window.id === input.windowId && window.enabled),
  )
}
