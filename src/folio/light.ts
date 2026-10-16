import { useEffect, useState } from 'react'
import { usableTimezone } from './kept/comeBack'

// The page's light follows the writer-local time of day (§2.2 Law 4, "Time is
// a material"; §3.11). Never what the writer wrote: the app never detects tone
// to apply an effect (Law 3). Shore and Quiet ignore it (flat, warm paper).

export type FolioLight = 'morning' | 'afternoon' | 'evening' | 'night'

/** The band for an hour (0–23), as Sessions' time-aware palette bands the day. */
export function lightForHour(hour: number): FolioLight {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

export function writerHour(tz: string | null | undefined, now: Date = new Date()): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: usableTimezone(tz) }).format(now)) % 24
  } catch {
    return now.getHours()
  }
}

/** The current band, re-read every five minutes and when the tab shows again. */
export function useFolioLight(tz: string | null | undefined): FolioLight {
  const [light, setLight] = useState<FolioLight>(() => lightForHour(writerHour(tz)))
  useEffect(() => {
    const update = () => setLight(lightForHour(writerHour(tz)))
    update()
    const timer = setInterval(update, 5 * 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') update() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [tz])
  return light
}
