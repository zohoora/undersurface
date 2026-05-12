import { useMemo } from 'react'
import { useAdminQuery } from './useAdminQuery'
import type { AdminUserDetailResponse } from './adminTypes'

// Fetches the full per-user detail blob exposed by the adminApi
// 'getUserDetail' action. Thin wrapper around useAdminQuery for the typed
// response shape.
export function useAdminUser(uid: string) {
  const params = useMemo(() => ({ uid }), [uid])
  return useAdminQuery<AdminUserDetailResponse>('getUserDetail', params)
}
