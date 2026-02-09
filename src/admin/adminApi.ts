import { getAuth } from 'firebase/auth'

async function getAuthToken(): Promise<string> {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')
  return user.getIdToken()
}

export async function adminFetch<T = unknown>(
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const token = await getAuthToken()

  const response = await fetch('/api/admin', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...params }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Admin API error: ${response.status}${body ? ` — ${body}` : ''}`)
  }

  return response.json()
}
