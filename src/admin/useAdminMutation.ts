import { useCallback, useState } from 'react'
import { adminFetch } from './adminApi'

// Generic on-demand admin action. Counterpart to useAdminQuery (which fires
// on mount). Caller decides WHEN to invoke `run` — for button clicks,
// per-row loads, anything event-driven. Stores the last successful result
// and any error so consumers can render off the hook state without
// re-implementing the boilerplate every time.
export function useAdminMutation<TResult, TParams extends Record<string, unknown> = Record<string, unknown>>(
  action: string,
) {
  const [data, setData] = useState<TResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async (params?: TParams): Promise<TResult> => {
    setLoading(true)
    setError(null)
    try {
      const result = await adminFetch<TResult>(action, params)
      setData(result)
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : `Failed: ${action}`
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [action])

  // Clear local state without invoking the server again. Useful for
  // "close this expanded row" UX, where the next click should not flash
  // stale data from the last row.
  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return { run, data, error, loading, reset }
}
