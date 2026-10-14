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

// accountApi's SMS kill-switch code (functions/src/account.ts SMS_DISABLED_CODE).
export const SMS_DISABLED_CODE = 'sms_disabled'

/** True when a request failed because SMS is paused (403 sms_disabled). */
export function isSmsDisabledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes(`"${SMS_DISABLED_CODE}"`)
}

export async function createSmsLinkCode(): Promise<SmsLinkCodeResult> {
  return authedPost<SmsLinkCodeResult>('/api/account', { action: 'createSmsLinkCode' })
}

export async function unlinkSms(): Promise<void> {
  await authedPost('/api/account', { action: 'unlinkSms' })
}
