export const COMMON_TIMEZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/Toronto',
  'America/New_York',
  'America/Halifax',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Helsinki',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const

export function timezoneOptions(current: string): string[] {
  return [...new Set([current, ...COMMON_TIMEZONES].filter(Boolean))]
}

export function timezoneLabel(iana: string, locale: string): string {
  const place = (iana.split('/').at(-1) ?? iana).replaceAll('_', ' ')
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: iana,
      timeZoneName: 'long',
    }).formatToParts(new Date())
    const zoneName = parts.find(part => part.type === 'timeZoneName')?.value
    return zoneName ? `${place} — ${zoneName}` : place
  } catch {
    return iana
  }
}
