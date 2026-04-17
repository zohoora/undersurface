import { useEffect, useState } from 'react'
import { db } from '../store/db'
import { useGlobalConfig } from '../store/globalConfig'
import type { GlobalConfig } from '../admin/adminTypes'

// Defaults used when admin has not set explicit thresholds.
// Kept reasonably generous so new users feel motion toward unlock
// without making the mode available before enough personal data exists
// to form a believable Future Self persona.
export const DEFAULT_MIN_ENTRIES = 15
export const DEFAULT_MIN_SESSIONS = 3

export interface FutureSelfProgress {
  entries: { have: number; need: number }
  sessions: { have: number; need: number }
}

export interface FutureSelfUnlockState {
  // True when the feature flag is on AND either the user has met both thresholds
  // or the admin has set both thresholds to zero (force-unlock).
  unlocked: boolean
  // Feature is enabled globally. If false, the entry choice screen hides the button entirely.
  enabled: boolean
  progress: FutureSelfProgress
  loading: boolean
}

// Pure — safe to unit test without a React renderer.
export function computeFutureSelfUnlock(
  config: GlobalConfig | null,
  entries: { plainText?: string }[],
  sessions: { messageCount?: number }[],
): FutureSelfUnlockState {
  const enabled = config?.features?.futureSelfEnabled === true
  const minEntries = config?.futureSelf?.minEntries ?? DEFAULT_MIN_ENTRIES
  const minSessions = config?.futureSelf?.minSessions ?? DEFAULT_MIN_SESSIONS

  const realEntries = entries.filter(e => (e.plainText ?? '').trim().length > 0).length
  const realSessions = sessions.filter(s => (s.messageCount ?? 0) >= 2).length

  const unlocked = enabled && realEntries >= minEntries && realSessions >= minSessions

  return {
    enabled,
    unlocked,
    loading: false,
    progress: {
      entries: { have: realEntries, need: minEntries },
      sessions: { have: realSessions, need: minSessions },
    },
  }
}

export function useFutureSelfUnlock(): FutureSelfUnlockState {
  const globalConfig = useGlobalConfig()
  const enabled = globalConfig?.features?.futureSelfEnabled === true
  const minEntries = globalConfig?.futureSelf?.minEntries ?? DEFAULT_MIN_ENTRIES
  const minSessions = globalConfig?.futureSelf?.minSessions ?? DEFAULT_MIN_SESSIONS

  const [entryCount, setEntryCount] = useState<number | null>(null)
  const [sessionCount, setSessionCount] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      try {
        const [entries, sessions] = await Promise.all([
          db.entries.toArray(),
          db.sessions.toArray(),
        ])
        if (cancelled) return
        const realEntries = entries.filter(e => (e.plainText ?? '').trim().length > 0)
        const realSessions = sessions.filter(s => (s.messageCount ?? 0) >= 2)
        setEntryCount(realEntries.length)
        setSessionCount(realSessions.length)
      } catch (error) {
        console.error('useFutureSelfUnlock: failed to load counts', error)
        if (!cancelled) {
          setEntryCount(0)
          setSessionCount(0)
        }
      }
    })()
    return () => { cancelled = true }
  }, [enabled])

  const have = {
    entries: entryCount ?? 0,
    sessions: sessionCount ?? 0,
  }
  const loading = enabled && (entryCount === null || sessionCount === null)
  const unlocked = enabled && !loading && have.entries >= minEntries && have.sessions >= minSessions

  return {
    unlocked,
    enabled,
    loading,
    progress: {
      entries: { have: have.entries, need: minEntries },
      sessions: { have: have.sessions, need: minSessions },
    },
  }
}
