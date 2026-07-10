import { beforeEach, describe, expect, it, vi } from 'vitest'
import twilio from 'twilio'
import { TWILIO_PHONE_NUMBER, TWILIO_WEBHOOK_URL } from './field'

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
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
}))
vi.mock('./linking', () => ({
  getLinkedUid: mockGetLinkedUid,
  linkPhoneByCode: mockLinkPhoneByCode,
  unlinkPhone: mockUnlinkPhone,
}))

const { handleSmsWebhook } = await import('./index')

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

function signedRequest(bodyText: string, sid = 'SM1234567890abcdef1234567890abcdef') {
  const params = {
    From: '+14165550123',
    To: TWILIO_PHONE_NUMBER,
    Body: bodyText,
    MessageSid: sid,
  }
  const signature = twilio.getExpectedTwilioSignature(
    TEST_AUTH_TOKEN,
    TWILIO_WEBHOOK_URL,
    params,
  )
  return makeReq(params, signature)
}

beforeEach(() => {
  mockGetLinkedUid.mockReset()
  mockLinkPhoneByCode.mockReset()
  mockUnlinkPhone.mockReset()
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

  it('completes LINK through the synchronous TwiML path', async () => {
    mockLinkPhoneByCode.mockResolvedValue({ ok: true, uid: 'u1', phoneLast4: '0123' })
    const res = makeRes()

    await handleSmsWebhook(signedRequest('LINK AB23XY'), res)

    expect(mockLinkPhoneByCode).toHaveBeenCalledWith('+14165550123', 'AB23XY', expect.any(Number))
    expect(res.body).toContain('UnderSurface is connected')
  })
})
