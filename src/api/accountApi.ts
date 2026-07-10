import { authedPost } from './authedFetch'

export async function deleteAccount(): Promise<void> {
  await authedPost('/api/account', { action: 'deleteAccount' })
}

export async function submitContactMessage(message: string): Promise<void> {
  await authedPost('/api/account', { action: 'submitContact', message })
}

export interface SmsStatus {
  linked: boolean
  phoneLast4?: string
  linkedAt?: number
  phoneNumber: string
  phoneNumberE164: string
}

export interface SmsLinkCodeResult {
  code: string
  expiresAt: number
  phoneNumber: string
  phoneNumberE164: string
}

export async function getSmsStatus(): Promise<SmsStatus> {
  return authedPost<SmsStatus>('/api/account', { action: 'getSmsStatus' })
}

export async function createSmsLinkCode(): Promise<SmsLinkCodeResult> {
  return authedPost<SmsLinkCodeResult>('/api/account', { action: 'createSmsLinkCode' })
}

export async function unlinkSms(): Promise<void> {
  await authedPost('/api/account', { action: 'unlinkSms' })
}
