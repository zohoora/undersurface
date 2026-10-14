import { createHash } from 'node:crypto'

export type FieldWindowPurpose = 'notice' | 'settle' | 'act'
export type FieldWindowDay = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type FieldWindowArm = 'field_check_in' | 'field_no_contact'
export type FieldWindowIneligibility = 'recent_crisis' | 'ineligible_cap'
export type FieldWindowCancelReason =
  | FieldWindowIneligibility
  | 'opt_in_or_link_removed'
  | 'outside_window'
  | 'sms_disabled'
  | 'recheck_failed'
  | 'stale_pending'
  | 'stale_claim'

/** Shortest window the 15-minute scheduler is guaranteed to observe. */
export const MIN_FIELD_WINDOW_MINUTES = 15
export const MAX_FIELD_WINDOWS = 3

export interface FieldWindow {
  id: string
  label: string
  days: FieldWindowDay[]
  startMinute: number
  endMinute: number
  purpose: FieldWindowPurpose
  enabled: boolean
}

export interface FieldWindowPreferences {
  enabled: true
  timezone: string
  maxPerWeek: 1 | 2 | 3
  windows: FieldWindow[]
  consentAt?: number
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
  status: 'assigned' | 'delivered' | 'cancelled' | 'failed'
  cancelReason?: FieldWindowCancelReason
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

function isFieldWindowDay(value: unknown): value is FieldWindowDay {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

/**
 * Validate one window from a client-writable preferences doc. Every field is
 * checked because one malformed entry must never throw inside the scheduler.
 */
export function validFieldWindow(value: unknown): value is FieldWindow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const window = value as Record<string, unknown>
  const { days, startMinute, endMinute } = window
  return typeof window.id === 'string'
    && window.id.length > 0
    && window.id.length <= 64
    && typeof window.label === 'string'
    && typeof window.enabled === 'boolean'
    && Array.isArray(days)
    && days.length > 0
    && days.length <= 7
    && days.every(isFieldWindowDay)
    && typeof startMinute === 'number'
    && typeof endMinute === 'number'
    && Number.isInteger(startMinute)
    && Number.isInteger(endMinute)
    && startMinute >= 0
    && endMinute <= 24 * 60
    && endMinute - startMinute >= MIN_FIELD_WINDOW_MINUTES
    && (window.purpose === 'notice' || window.purpose === 'settle' || window.purpose === 'act')
}

/**
 * Parse `companionPreferences/current.fieldWindows`. Returns null unless the
 * writer explicitly enabled windows with a valid timezone and weekly cap.
 * Invalid individual windows are dropped rather than failing the whole doc.
 */
export function parseFieldWindowPreferences(value: unknown): FieldWindowPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.enabled !== true) return null
  if (typeof raw.timezone !== 'string' || !raw.timezone || !isValidTimezone(raw.timezone)) return null
  const maxPerWeek = raw.maxPerWeek
  if (maxPerWeek !== 1 && maxPerWeek !== 2 && maxPerWeek !== 3) return null
  if (!Array.isArray(raw.windows)) return null
  const consentAt = typeof raw.consentAt === 'number' && Number.isFinite(raw.consentAt)
    ? raw.consentAt
    : undefined
  return {
    enabled: true,
    timezone: raw.timezone,
    maxPerWeek,
    windows: raw.windows.filter(validFieldWindow).slice(0, MAX_FIELD_WINDOWS),
    ...(consentAt !== undefined ? { consentAt } : {}),
  }
}

/**
 * Consent counts only when it was given after the most recent server-side
 * opt-out (STOP/UNLINK), so a stale client write cannot resurrect it.
 */
export function hasFieldWindowConsent(
  preferences: { consentAt?: number } | null,
  optedOutAt: number | null,
): boolean {
  if (!preferences || typeof preferences.consentAt !== 'number') return false
  return optedOutAt === null || preferences.consentAt > optedOutAt
}

export function isFieldWindowOpen(window: FieldWindow, clock: ZonedClock): boolean {
  return window.enabled
    && window.days.includes(clock.day)
    && clock.minute >= window.startMinute
    && clock.minute < window.endMinute
}

/** Pure window check: the decision for this window if it is open right now. */
export function buildFieldWindowDecision(input: {
  uid: string
  window: FieldWindow
  timezone: string
  now: number
}): FieldWindowDecision | null {
  const { uid, window, timezone, now } = input
  if (!uid || !validFieldWindow(window) || !window.enabled || !isValidTimezone(timezone)) return null
  const clock = zonedClock(now, timezone)
  if (!isFieldWindowOpen(window, clock)) return null

  const assignmentSeed = `${uid}:${window.id}:${clock.dateKey}:field-window-timing-v1`
  const eventSeed = `${uid}:${clock.dateKey}:field-window-timing-v1`
  return {
    // One event id per writer-local date means overlapping or separate
    // windows cannot create multiple proactive contacts on the same day.
    eventId: `field-window-${stableHash(eventSeed).slice(0, 24)}`,
    assignmentSeed,
    localDate: clock.dateKey,
    weekKey: localWeekKey(now, timezone),
    arm: assignedArm(assignmentSeed),
    windowId: window.id,
    windowLabel: window.label.trim().slice(0, 60) || 'Field window',
    purpose: window.purpose,
  }
}

/**
 * Days that cannot take part in the timing experiment. The weekly cap applies
 * to BOTH arms: recording a quiet day only when the contact arm is capped
 * would push late-week days into no-contact. Crisis days are never an
 * experiment at all.
 */
export function fieldWindowIneligibility(input: {
  recentCrisis: boolean
  proactiveMessagesThisWeek: number
  maxPerWeek: 1 | 2 | 3
}): FieldWindowIneligibility | null {
  if (input.recentCrisis) return 'recent_crisis'
  if (input.proactiveMessagesThisWeek >= input.maxPerWeek) return 'ineligible_cap'
  return null
}

export function buildFieldWindowResearchEvent(
  decision: FieldWindowDecision,
  now: number,
  ineligibility: FieldWindowIneligibility | null = null,
): FieldWindowResearchEvent {
  const delivered = ineligibility === null && decision.arm === 'field_no_contact'
  return {
    id: decision.eventId,
    protocolId: 'field-window-timing-v1',
    protocolVersion: 1,
    assignmentKind: 'randomized',
    status: ineligibility ? 'cancelled' : delivered ? 'delivered' : 'assigned',
    ...(ineligibility ? { cancelReason: ineligibility } : {}),
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

/** Events that used (or may have used) one of the week's proactive contacts. */
export function countsTowardWeeklyCap(event: { assignedArm?: unknown; status?: unknown }): boolean {
  return event.assignedArm === 'field_check_in'
    && event.status !== 'cancelled'
    && event.status !== 'failed'
}

const FIELD_WINDOW_OPT_OUT = 'Reply STOP to opt out.'

const FIELD_WINDOW_MESSAGES: Record<FieldWindowPurpose, string> = {
  notice: `A small field note: what is here right now, before you explain it? No need to reply. ${FIELD_WINDOW_OPT_OUT}`,
  settle: `A small pause, if it fits: unclench one place and let one exhale run long. No need to reply. ${FIELD_WINDOW_OPT_OUT}`,
  act: `A small field question: what is one next move that would make the next ten minutes easier? No need to reply. ${FIELD_WINDOW_OPT_OUT}`,
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

/**
 * The dispatcher's final check, immediately before Twilio is called. Returns
 * the reason to cancel, or null when the send may proceed.
 */
export function fieldWindowDispatchBlock(input: {
  preferences: FieldWindowPreferences | null
  windowId: string
  localDate: string | undefined
  hasLinkedPhone: boolean
  optedOutAt: number | null
  recentCrisis: boolean
  now: number
}): FieldWindowCancelReason | null {
  const { preferences } = input
  if (
    !preferences
    || !canDeliverFieldWindow({ preferences, windowId: input.windowId, hasLinkedPhone: input.hasLinkedPhone })
    || !hasFieldWindowConsent(preferences, input.optedOutAt)
  ) {
    return 'opt_in_or_link_removed'
  }
  if (input.recentCrisis) return 'recent_crisis'
  const window = preferences.windows.find(item => item.id === input.windowId)
  const clock = zonedClock(input.now, preferences.timezone)
  if (!window || !input.localDate || clock.dateKey !== input.localDate || !isFieldWindowOpen(window, clock)) {
    return 'outside_window'
  }
  return null
}
