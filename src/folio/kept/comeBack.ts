import type { FolioTrace } from '../../types/folio'

// Come back to this (draft 4 §3.8): the writer chooses a day; the trace is due
// at 07:00 in their timezone on that day, and appears the next time they open
// Folio on or after it. Deterministic, no model, no notifications.

export const COME_BACK_HOUR = 7

export interface Ymd { y: number; m: number; d: number }

export type ComeBackChoice = 'tomorrow' | 'week' | 'month' | { pick: string }

/** The writer's zone if the runtime accepts it; else the device's; else UTC. */
export function usableTimezone(tz: string | null | undefined): string {
  for (const candidate of [tz, safeResolvedZone(), 'UTC']) {
    if (!candidate) continue
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate })
      return candidate
    } catch { /* try the next */ }
  }
  return 'UTC'
}

function safeResolvedZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined }
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    formatters.set(tz, f)
  }
  return f
}

function zonedParts(ms: number, tz: string): Ymd & { h: number; mi: number; s: number } {
  const out: Record<string, number> = {}
  for (const p of formatter(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return { y: out.year, m: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second }
}

/** The calendar day of `ms` in `tz`. */
export function ymdIn(ms: number, tz: string): Ymd {
  const p = zonedParts(ms, tz)
  return { y: p.y, m: p.m, d: p.d }
}

export function addDays(day: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** The same day next month, or the month's last day when it's shorter (31 Jan → 28 or 29 Feb). */
export function addMonths(day: Ymd, n: number): Ymd {
  const first = new Date(Date.UTC(day.y, day.m - 1 + n, 1))
  const y = first.getUTCFullYear()
  const m = first.getUTCMonth() + 1
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { y, m, d: Math.min(day.d, last) }
}

function offsetAt(ms: number, tz: string): number {
  const p = zonedParts(ms, tz)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000
}

/** The instant that is `hour`:00 on `day` in `tz` (DST-correct; 07:00 never falls in a gap in practice). */
export function zonedTime(day: Ymd, hour: number, tz: string): number {
  const wall = Date.UTC(day.y, day.m - 1, day.d, hour)
  const first = wall - offsetAt(wall, tz)
  return wall - offsetAt(first, tz)
}

export function compareYmd(a: Ymd, b: Ymd): number {
  return a.y - b.y || a.m - b.m || a.d - b.d
}

export function parseYmd(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const day = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
  const check = addDays(day, 0)
  return compareYmd(check, day) === 0 ? day : null
}

export function formatYmd(day: Ymd): string {
  return `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`
}

/** The day a choice names, from today in `tz`. A picked day must be after today. */
export function chosenDay(choice: ComeBackChoice, now: number, tz: string): Ymd | null {
  const today = ymdIn(now, tz)
  if (choice === 'tomorrow') return addDays(today, 1)
  if (choice === 'week') return addDays(today, 7)
  if (choice === 'month') return addMonths(today, 1)
  const day = parseYmd(choice.pick)
  return day && compareYmd(day, today) > 0 ? day : null
}

/** The fields a come-back choice writes on the trace; null for an invalid pick. */
export function comeBackFields(choice: ComeBackChoice, now: number, tz: string): Pick<FolioTrace, 'comeBackAt' | 'comeBackTz' | 'comeBackSetAt' | 'lastComeBackShownAt'> | null {
  const zone = usableTimezone(tz)
  const day = chosenDay(choice, now, zone)
  if (!day) return null
  return { comeBackAt: zonedTime(day, COME_BACK_HOUR, zone), comeBackTz: zone, comeBackSetAt: now, lastComeBackShownAt: null }
}

/** "Don't bring this back", and what opening a come-back does: the date is cleared. */
export const CLEARED: Pick<FolioTrace, 'comeBackAt' | 'comeBackTz' | 'comeBackSetAt' | 'lastComeBackShownAt'> = {
  comeBackAt: null, comeBackTz: null, comeBackSetAt: null, lastComeBackShownAt: null,
}

export function isDue(trace: Pick<FolioTrace, 'comeBackAt'>, now: number): boolean {
  return typeof trace.comeBackAt === 'number' && trace.comeBackAt <= now
}

/** "Not now" hides a slip until the next day the writer opens Folio. */
export function setAsideToday(trace: Pick<FolioTrace, 'lastComeBackShownAt'>, now: number, tz: string): boolean {
  if (typeof trace.lastComeBackShownAt !== 'number') return false
  return compareYmd(ymdIn(trace.lastComeBackShownAt, tz), ymdIn(now, tz)) >= 0
}

/** Due traces, earliest first. */
export function dueTraces<T extends Pick<FolioTrace, 'comeBackAt'>>(traces: T[], now: number): T[] {
  return traces.filter((t) => isDue(t, now)).sort((a, b) => (a.comeBackAt as number) - (b.comeBackAt as number))
}

/** The one slip to show now, earliest due first, or none. */
export function nextSlip<T extends Pick<FolioTrace, 'comeBackAt' | 'lastComeBackShownAt'>>(traces: T[], now: number, tz: string): T | null {
  return dueTraces(traces, now).find((t) => !setAsideToday(t, now, tz)) ?? null
}
