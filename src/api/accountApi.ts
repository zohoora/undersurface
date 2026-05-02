import { authedPost } from './authedFetch'

export async function deleteAccount(): Promise<void> {
  await authedPost('/api/account', { action: 'deleteAccount' })
}

export async function submitContactMessage(message: string): Promise<void> {
  await authedPost('/api/account', { action: 'submitContact', message })
}
