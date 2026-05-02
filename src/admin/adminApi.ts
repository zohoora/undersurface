import { authedPost } from '../api/authedFetch'

export async function adminFetch<T = unknown>(
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return authedPost<T>('/api/admin', { action, ...params })
}
