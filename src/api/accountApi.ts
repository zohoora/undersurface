import { getAuth } from 'firebase/auth'

async function getAuthToken(): Promise<string> {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')
  return user.getIdToken()
}

export async function deleteAccount(): Promise<void> {
  const token = await getAuthToken()
  const response = await fetch('/api/account', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'deleteAccount' }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Delete failed: ${response.status}${body ? ` — ${body}` : ''}`)
  }
}

export async function submitContactMessage(message: string): Promise<void> {
  const token = await getAuthToken()
  const response = await fetch('/api/account', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'submitContact', message }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Send failed: ${response.status}${body ? ` — ${body}` : ''}`)
  }
}
