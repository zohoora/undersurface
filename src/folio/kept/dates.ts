// Dates in Folio's own words: "14 Oct", with the year only when it isn't this
// year. The writer's language and timezone, never a hardcoded one.

export function shortDate(ms: number, locale: string, tz?: string, now: number = Date.now()): string {
  const zone = tz || undefined
  try {
    const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: zone })
    const sameYear = year.format(ms) === year.format(now)
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: zone }).format(ms)
  } catch {
    return new Date(ms).toLocaleDateString()
  }
}
