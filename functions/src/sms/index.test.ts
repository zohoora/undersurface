import { beforeEach, describe, expect, it, vi } from 'vitest'
import twilio from 'twilio'
import { TWILIO_PHONE_NUMBER, TWILIO_WEBHOOK_URL } from './field'
import { fakeDb, FakeTimestamp } from './testing/fakeFirestore'

const TEST_AUTH_TOKEN = 'twilio-test-auth-token'
const mockGetLinkedUid = vi.fn()
const mockLinkPhoneByCode = vi.fn()
const mockUnlinkPhone = vi.fn()

vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: () => TEST_AUTH_TOKEN })),
}))
vi.mock('firebase-functions/v2/https', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}))
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
}))
vi.mock('firebase-admin/firestore', async () => (await import('./testing/fakeFirestore')).fakeFirestoreModule())
vi.mock('./linking', () => ({
  getLinkedUid: mockGetLinkedUid,
  linkPhoneByCode: mockLinkPhoneByCode,
  unlinkPhone: mockUnlinkPhone,
}))

const { handleSmsWebhook, resolveGeneratedSmsTurn } = await import('./index')

function makeReq(params: Record<string, string>, signature?: string) {
  return {
    method: 'POST',
    headers: signature ? { 'x-twilio-signature': signature } : {},
    body: params,
  } as unknown as import('express').Request
}

function makeRes() {
  const result = {
    statusCode: 200,
    body: '',
    headers: {} as Record<string, string>,
    status: vi.fn((code: number) => { result.statusCode = code; return result }),
    json: vi.fn((value: unknown) => { result.body = JSON.stringify(value); return result }),
    setHeader: vi.fn((key: string, value: string) => { result.headers[key] = value }),
    send: vi.fn((value: string) => { result.body = value; return result }),
  }
  return result as unknown as import('express').Response & typeof result
}

function signedRequest(
  bodyText: string,
  sid = 'SM1234567890abcdef1234567890abcdef',
  extra: Record<string, string> = {},
  from = '+14165550123',
) {
  const params = {
    From: from,
    To: TWILIO_PHONE_NUMBER,
    Body: bodyText,
    MessageSid: sid,
    ...extra,
  }
  const signature = twilio.getExpectedTwilioSignature(
    TEST_AUTH_TOKEN,
    TWILIO_WEBHOOK_URL,
    params,
  )
  return makeReq(params, signature)
}

beforeEach(() => {
  fakeDb.reset()
  mockGetLinkedUid.mockReset()
  mockLinkPhoneByCode.mockReset()
  mockUnlinkPhone.mockReset()
  mockUnlinkPhone.mockResolvedValue(null)
})

describe('Twilio webhook envelope', () => {
  it('rejects an invalid webhook signature before any account lookup', async () => {
    const res = makeRes()
    await handleSmsWebhook(makeReq({ From: '+14165550123' }, 'bad-signature'), res)
    expect(res.statusCode).toBe(403)
    expect(mockGetLinkedUid).not.toHaveBeenCalled()
  })

  it('accepts a real Twilio-signed request and gives an unlinked phone the linking path', async () => {
    mockGetLinkedUid.mockResolvedValue(null)
    const res = makeRes()

    await handleSmsWebhook(signedRequest('A moment from my day'), res)

    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toContain('text/xml')
    expect(res.body).toContain('not linked yet')
    expect(mockGetLinkedUid).toHaveBeenCalledWith('+14165550123')
  })

  it('accepts Twilio-signed image-only MMS envelopes', async () => {
    mockGetLinkedUid.mockResolvedValue(null)
    const res = makeRes()

    await handleSmsWebhook(signedRequest('', 'MM1234567890abcdef1234567890abcdef', {
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1234567890abcdef1234567890abcdef/Media/MEtest',
      MediaContentType0: 'image/jpeg',
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('not linked yet')
  })

  it('explains unsupported image-only media without queueing it', async () => {
    mockGetLinkedUid.mockResolvedValue('u1')
    const res = makeRes()

    await handleSmsWebhook(signedRequest('', 'MM1234567890abcdef1234567890abcdee', {
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/media/video',
      MediaContentType0: 'video/mp4',
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('couldn&apos;t read that image')
  })

  it('completes LINK through the synchronous TwiML path', async () => {
    mockLinkPhoneByCode.mockResolvedValue({ ok: true, uid: 'u1', phoneLast4: '0123' })
    const res = makeRes()

    await handleSmsWebhook(signedRequest('LINK AB23XY'), res)

    expect(mockLinkPhoneByCode).toHaveBeenCalledWith('+14165550123', 'AB23XY', expect.any(Number))
    expect(res.body).toContain('UnderSurface is connected')
  })
})

describe('opt-out and account controls', () => {
  function seedFieldWindowConsent(uid: string) {
    fakeDb.seed(`users/${uid}/companionPreferences/current`, {
      id: 'current',
      fieldMosaicEnabled: true,
      fieldWindows: { enabled: true, timezone: 'America/Toronto', maxPerWeek: 2, consentAt: 5, windows: [], updatedAt: 5 },
    })
  }

  it.each(['STOP', 'stop', 'OPTOUT', 'REVOKE', 'UNSUBSCRIBE', 'QUIT'])(
    '%s unlinks the phone and revokes proactive-SMS consent server-side',
    async keyword => {
      mockUnlinkPhone.mockResolvedValue('u1')
      seedFieldWindowConsent('u1')
      const res = makeRes()

      await handleSmsWebhook(signedRequest(keyword), res)

      expect(mockUnlinkPhone).toHaveBeenCalledWith('+14165550123')
      expect(res.body).toContain('<Response></Response>')
      const preferences = fakeDb.read('users/u1/companionPreferences/current') as { fieldWindows: Record<string, unknown> }
      expect(preferences.fieldWindows.enabled).toBe(false)
      expect(preferences.fieldWindows).not.toHaveProperty('consentAt')
      expect(fakeDb.read('users/u1/smsSettings/optOut')).toMatchObject({ optedOutAt: expect.any(Number) })
    },
  )

  it('UNLINK also revokes field-window consent', async () => {
    mockUnlinkPhone.mockResolvedValue('u1')
    seedFieldWindowConsent('u1')
    const res = makeRes()

    await handleSmsWebhook(signedRequest('UNLINK'), res)

    expect(res.body).toContain('disconnected')
    expect((fakeDb.read('users/u1/companionPreferences/current') as { fieldWindows: Record<string, unknown> }).fieldWindows.enabled).toBe(false)
  })

  it('honors STOP even after the sender hit the rate limit', async () => {
    const from = '+14165550999'
    mockGetLinkedUid.mockResolvedValue(null)
    for (let index = 0; index < 31; index++) {
      await handleSmsWebhook(signedRequest('hello', `SMratelimit${String(index).padStart(8, '0')}`, {}, from), makeRes())
    }
    const limited = makeRes()
    await handleSmsWebhook(signedRequest('hello', 'SMratelimitlast0001', {}, from), limited)
    expect(limited.body).toContain('Too many messages')

    const res = makeRes()
    await handleSmsWebhook(signedRequest('STOP', 'SMratelimitstop0001', {}, from), res)

    expect(mockUnlinkPhone).toHaveBeenCalledWith(from)
    expect(res.body).not.toContain('Too many messages')
  })

  it('replies with a fixed paused message while the kill switch is off, but still honors STOP', async () => {
    fakeDb.seed('appConfig/global', { features: { smsEnabled: false } })
    mockGetLinkedUid.mockResolvedValue('u1')

    const paused = makeRes()
    await handleSmsWebhook(signedRequest('A moment from my day', 'SMpaused000000000001', {}, '+14165550777'), paused)
    expect(paused.body).toContain('paused')
    expect(fakeDb.paths('smsInbound/')).toEqual([])

    mockUnlinkPhone.mockResolvedValue('u1')
    await handleSmsWebhook(signedRequest('STOP', 'SMpaused000000000002', {}, '+14165550777'), makeRes())
    expect(mockUnlinkPhone).toHaveBeenCalled()
  })

  it('never overwrites a processed inbound message on webhook redelivery', async () => {
    mockGetLinkedUid.mockResolvedValue('u1')
    const sid = 'SMredelivery00000000000000000001'
    fakeDb.seed(`users/u1/smsMessages/${sid}`, {
      id: sid, direction: 'inbound', body: 'original', status: 'processed', risk: 1, fieldNote: 'kept note', createdAt: 1,
    })

    await handleSmsWebhook(signedRequest('original', sid, {}, '+14165550555'), makeRes())

    expect(fakeDb.read(`users/u1/smsMessages/${sid}`)).toMatchObject({ status: 'processed', risk: 1, fieldNote: 'kept note' })
  })

  it('stamps queued messages with a TTL expiry', async () => {
    mockGetLinkedUid.mockResolvedValue('u1')
    const sid = 'SMttl000000000000000000000000001'

    await handleSmsWebhook(signedRequest('A moment', sid, {}, '+14165550444'), makeRes())

    const queued = fakeDb.read(`smsInbound/${sid}`) as { expireAt: FakeTimestamp; receivedAt: number }
    expect(queued.expireAt).toBeInstanceOf(FakeTimestamp)
    expect(queued.expireAt.toMillis() - queued.receivedAt).toBe(30 * 86_400_000)
  })
})

describe('multimodal SMS safety resolution', () => {
  it('replaces a generated reply and drops its note on clear visual danger', () => {
    const result = resolveGeneratedSmsTurn(0, {
      reply: 'Generated response',
      fieldNote: 'Unsafe note',
      visualRisk: 2,
      responseMode: 'witness',
    })

    expect(result.risk).toBe(2)
    expect(result.reply).toContain('immediate danger')
    expect(result.fieldNote).toBeNull()
  })

  it('keeps the generated turn for ordinary images', () => {
    expect(resolveGeneratedSmsTurn(0, {
      reply: 'That looks like a crowded room.',
      fieldNote: null,
      visualRisk: 0,
      responseMode: 'reflect',
    })).toEqual({
      risk: 0,
      reply: 'That looks like a crowded room.',
      fieldNote: null,
      responseMode: 'reflect',
    })
  })
})
