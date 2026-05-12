import { useEffect, useState } from 'react'
import { adminFetch } from './adminApi'
import type { AdminUserDetailResponse } from './adminTypes'

// Fetches the full per-user detail blob exposed by the adminApi
// 'getUserDetail' action. The admin UI inspects sensitive data (entries,
// memories, conversations) so the load path is worth testing in isolation.
export function useAdminUser(uid: string) {
  const [data, setData] = useState<AdminUserDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    adminFetch<AdminUserDetailResponse>('getUserDetail', { uid })
      .then((res) => {
        if (cancelled) return
        setData(res)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load user')
      })
    return () => { cancelled = true }
  }, [uid])

  return { data, error, loading: data === null && error === null }
}
