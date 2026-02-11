import { getAuth } from 'firebase/auth'

async function accountFetch(body: Record<string, unknown>): Promise<void> {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')
  const token = await user.getIdToken()

  const response = await fetch('/api/account', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Request failed: ${response.status}${detail ? ` — ${detail}` : ''}`)
  }
}

export async function deleteAccount(): Promise<void> {
  await accountFetch({ action: 'deleteAccount' })
}

export async function submitContactMessage(message: string): Promise<void> {
  await accountFetch({ action: 'submitContact', message })
}
