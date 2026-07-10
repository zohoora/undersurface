import { describe, expect, it } from 'vitest'
import { resolveOutboundPhone } from './linking'

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
