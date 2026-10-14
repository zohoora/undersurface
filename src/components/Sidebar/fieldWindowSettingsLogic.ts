/**
 * The server scheduler runs every 15 minutes and rejects shorter windows
 * (functions/src/sms/fieldWindowLogic.ts MIN_FIELD_WINDOW_MINUTES), so the
 * editor never produces one.
 */
export const MIN_FIELD_WINDOW_MINUTES = 15
const LAST_MINUTE_OF_DAY = 23 * 60 + 59

export function minuteToTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function timeToMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null
}

/**
 * Moving the start later pushes the end along so the window stays at least
 * 15 minutes long. Returns null when no valid window can start there.
 */
export function windowWithStart(
  window: { startMinute: number; endMinute: number },
  startMinute: number,
): { startMinute: number; endMinute: number } | null {
  const minimumEnd = startMinute + MIN_FIELD_WINDOW_MINUTES
  if (minimumEnd > LAST_MINUTE_OF_DAY) return null
  return { startMinute, endMinute: Math.max(window.endMinute, minimumEnd) }
}

/** The end must stay at least 15 minutes after the start. */
export function windowWithEnd(
  window: { startMinute: number; endMinute: number },
  endMinute: number,
): { startMinute: number; endMinute: number } | null {
  return endMinute - window.startMinute >= MIN_FIELD_WINDOW_MINUTES
    ? { startMinute: window.startMinute, endMinute }
    : null
}
