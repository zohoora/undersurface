import { isValidTimezone } from './fieldWindowLogic.js'

/** The writer's IANA timezone from their (client-written) preferences, if valid. */
export function timezoneFromPreferences(preferences: unknown): string | null {
  if (!preferences || typeof preferences !== 'object') return null
  const fieldWindows = (preferences as { fieldWindows?: unknown }).fieldWindows
  if (!fieldWindows || typeof fieldWindows !== 'object') return null
  const timezone = (fieldWindows as { timezone?: unknown }).timezone
  return typeof timezone === 'string' && timezone.length > 0 && timezone.length <= 64 && isValidTimezone(timezone)
    ? timezone
    : null
}

function zonedParts(timestamp: number, timezone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  return Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]),
  )
}

/** Offset (ms) of `timezone` from UTC at the given instant. */
export function zoneOffsetMs(timestamp: number, timezone: string): number {
  const parts = zonedParts(timestamp, timezone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - Math.floor(timestamp / 1000) * 1000
}

/**
 * Parse a date value as the writer means it. A date-only `YYYY-MM-DD` string
 * is the start of that calendar day in the writer's timezone; `new Date()`
 * would read it as UTC midnight, which is the previous evening in the
 * Americas. Anything else falls back to the platform parser.
 */
export function parseLocalDate(value: string, timezone: string | null): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return new Date(value).getTime()
  const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (!Number.isFinite(utcMidnight) || !timezone) return utcMidnight
  // Two passes settle the offset across a DST transition on that date.
  const firstGuess = utcMidnight - zoneOffsetMs(utcMidnight, timezone)
  return utcMidnight - zoneOffsetMs(firstGuess, timezone)
}

/** "Tuesday, October 14, 2026, 8:05 PM" in the writer's timezone. */
export function formatLocalDateTime(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

/** Compact "Oct 14, 8:05 PM" stamp for SMS history lines. */
export function formatLocalStamp(timestamp: number, timezone: string): string {
  if (!Number.isFinite(timestamp)) return 'unknown time'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

/** Short date for continuity blocks ("Oct 14", or "Oct 14, 2025" for other years). */
export function makeLocalDateFormatter(timezone: string, now: number): (timestamp: number) => string {
  const currentYear = zonedParts(now, timezone).year
  return (timestamp: number) => {
    if (!Number.isFinite(timestamp)) return 'unknown date'
    const sameYear = zonedParts(timestamp, timezone).year === currentYear
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(new Date(timestamp))
  }
}
