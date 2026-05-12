import { useEffect, useState } from 'react'
import { adminFetch } from './adminApi'

// Generic loader for `adminFetch<T>(action, params)`. All admin views fetch
// a one-shot response, so the surface is data | error | loading. The hook
// is race-protected: if `action`/`params` change before the previous response
// arrives, the in-flight result is discarded.
export function useAdminQuery<T>(action: string, params?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Stringify so callers can pass a fresh object literal without churning
  // the effect dep. params SHOULD be JSON-serializable — all admin actions
  // use primitive params today.
  const paramsKey = params ? JSON.stringify(params) : ''

  useEffect(() => {
    let cancelled = false
    adminFetch<T>(action, params)
      .then((res) => {
        if (cancelled) return
        setData(res)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load')
      })
    return () => { cancelled = true }
  // params dep is captured via paramsKey; the function-identity churn it
  // would otherwise cause would re-fetch on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, paramsKey])

  // setData is exposed for callers that mutate local state after a separate
  // adminFetch (e.g. AdminAnalytics' "refresh" button writes to a different
  // action and wants to swap the displayed result without re-mounting).
  return { data, error, loading: data === null && error === null, setData, setError }
}
