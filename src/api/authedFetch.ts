import { getAuth } from 'firebase/auth'
import { apiUrl } from './apiBase'

export async function getAuthToken(): Promise<string> {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')
  return user.getIdToken()
}

/**
 * POST JSON to an internal Cloud Function endpoint with the current user's
 * Firebase ID token attached as a Bearer credential.
 *
 * Throws on non-2xx responses with a message including the status and body.
 */
export async function authedPost<T = unknown>(
  path: string,
  body: unknown,
  init?: RequestInit,
): Promise<T> {
  const token = await getAuthToken()
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`POST ${path} failed: ${response.status} ${text}`)
  }

  return response.json() as Promise<T>
}
