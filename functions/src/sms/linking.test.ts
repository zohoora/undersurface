import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb } from './testing/fakeFirestore'

vi.mock('firebase-admin/firestore', async () => (await import('./testing/fakeFirestore')).fakeFirestoreModule())

const { getOutboundPhone, hashSmsValue, resolveOutboundPhone } = await import('./linking')

const settings = {
  phoneHash: 'hash',
  phoneLast4: '0123',
  linkedAt: 1,
  enabled: true,
}

describe('outbound phone resolution', () => {
  it('returns the server-owned E.164 destination for the same enabled account', () => {
    expect(resolveOutboundPhone('u1', settings, {
      uid: 'u1',
      phoneE164: '+14165550123',
      phoneLast4: '0123',
      linkedAt: 1,
      enabled: true,
    })).toBe('+14165550123')
  })

  it('refuses stale, disabled, malformed, and cross-account links', () => {
    const link = {
      uid: 'u1',
      phoneE164: '+14165550123',
      phoneLast4: '0123',
      linkedAt: 1,
      enabled: true,
    }
    expect(resolveOutboundPhone('u2', settings, link)).toBeNull()
    expect(resolveOutboundPhone('u1', { ...settings, enabled: false }, link)).toBeNull()
    expect(resolveOutboundPhone('u1', settings, { ...link, enabled: false })).toBeNull()
    expect(resolveOutboundPhone('u1', settings, { ...link, phoneE164: 'not-a-phone' })).toBeNull()
  })
})

describe('legacy destination backfill', () => {
  const PHONE = '+14165550123'
  const PHONE_HASH = hashSmsValue(PHONE)

  beforeEach(() => {
    fakeDb.reset()
    fakeDb.seed('users/u1/smsSettings/current', { phoneHash: PHONE_HASH, phoneLast4: '0123', linkedAt: 1, enabled: true })
    fakeDb.seed('smsInbound/SM1', { uid: 'u1', from: PHONE, status: 'pending' })
  })

  it('backfills phoneE164 onto an existing legacy link owned by the same uid', async () => {
    fakeDb.seed(`smsPhoneLinks/${PHONE_HASH}`, { uid: 'u1', phoneLast4: '0123', linkedAt: 1, enabled: true })

    await expect(getOutboundPhone('u1')).resolves.toBe(PHONE)
    expect(fakeDb.read(`smsPhoneLinks/${PHONE_HASH}`)).toMatchObject({ uid: 'u1', phoneE164: PHONE })
  })

  it('never merge-creates a link doc that does not already exist', async () => {
    await expect(getOutboundPhone('u1')).resolves.toBeNull()
    expect(fakeDb.read(`smsPhoneLinks/${PHONE_HASH}`)).toBeUndefined()
  })

  it('never writes onto a link that belongs to another account', async () => {
    fakeDb.seed(`smsPhoneLinks/${PHONE_HASH}`, { uid: 'someone-else', phoneLast4: '0123', linkedAt: 1, enabled: true })

    await expect(getOutboundPhone('u1')).resolves.toBeNull()
    expect(fakeDb.read(`smsPhoneLinks/${PHONE_HASH}`)).not.toHaveProperty('phoneE164')
  })

  it('never revives a disabled link', async () => {
    fakeDb.seed(`smsPhoneLinks/${PHONE_HASH}`, { uid: 'u1', phoneLast4: '0123', linkedAt: 1, enabled: false })

    await expect(getOutboundPhone('u1')).resolves.toBeNull()
    expect(fakeDb.read(`smsPhoneLinks/${PHONE_HASH}`)).not.toHaveProperty('phoneE164')
  })
})
