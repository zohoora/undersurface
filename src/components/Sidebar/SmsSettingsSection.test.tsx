import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SmsLinkCodeResult, SmsStatus } from '../../api/accountApi'

const api = vi.hoisted(() => ({
  getSmsStatus: vi.fn<() => Promise<SmsStatus>>(),
  createSmsLinkCode: vi.fn<() => Promise<SmsLinkCodeResult>>(),
  unlinkSms: vi.fn(async () => {}),
}))
vi.mock('../../api/accountApi', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/accountApi')>(),
  ...api,
}))

const config = vi.hoisted(() => ({ value: null as { features: { smsEnabled?: boolean } } | null }))
vi.mock('../../store/globalConfig', () => ({ useGlobalConfig: () => config.value }))
vi.mock('../../i18n', () => ({
  useTranslation: () => new Proxy({}, { get: (_target, key: string) => `t:${key}` }),
}))
vi.mock('./FieldWindowSettings', () => ({ FieldWindowSettings: () => null }))

const { SmsSettingsSection } = await import('./SmsSettingsSection')

void React

const unlinked: SmsStatus = { linked: false, phoneNumber: '(289) 778-0589', phoneNumberE164: '+12897780589' }
const linked: SmsStatus = { ...unlinked, linked: true, phoneLast4: '0123' }

beforeEach(() => {
  vi.clearAllMocks()
  config.value = null
  api.getSmsStatus.mockResolvedValue(unlinked)
})

afterEach(cleanup)

describe('SmsSettingsSection — SMS kill switch', () => {
  it('shows a short paused message and no way to link while SMS is paused', async () => {
    config.value = { features: { smsEnabled: false } }
    render(<SmsSettingsSection isOpen />)
    expect(await screen.findByText('t:settings.sms.paused')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 't:settings.sms.createCode' })).toBeNull()
  })

  it('treats a 403 sms_disabled from the server as paused, not as an error', async () => {
    api.createSmsLinkCode.mockRejectedValue(new Error('POST /api/account failed: 403 {"error":"SMS is paused right now.","code":"sms_disabled"}'))
    render(<SmsSettingsSection isOpen />)
    fireEvent.click(await screen.findByRole('button', { name: 't:settings.sms.createCode' }))
    expect(await screen.findByText('t:settings.sms.paused')).toBeTruthy()
    expect(screen.queryByText('t:settings.sms.error')).toBeNull()
    expect(screen.queryByRole('button', { name: 't:settings.sms.createCode' })).toBeNull()
  })

  it('keeps Disconnect available for a linked phone while paused', async () => {
    config.value = { features: { smsEnabled: false } }
    api.getSmsStatus.mockResolvedValue(linked)
    render(<SmsSettingsSection isOpen />)
    expect(await screen.findByRole('button', { name: 't:settings.sms.unlink' })).toBeTruthy()
    expect(screen.getByText('t:settings.sms.paused')).toBeTruthy()
  })

  it('offers linking normally when the switch is on or unset', async () => {
    render(<SmsSettingsSection isOpen />)
    expect(await screen.findByRole('button', { name: 't:settings.sms.createCode' })).toBeTruthy()
    expect(screen.queryByText('t:settings.sms.paused')).toBeNull()
  })
})
