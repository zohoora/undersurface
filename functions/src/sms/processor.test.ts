import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb, FakeTimestamp, type FakeData } from './testing/fakeFirestore'
import { hashSmsValue } from './linking'
import { SMS_DAILY_TURN_LIMIT, utcDayKey } from './state'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  removeMedia: vi.fn(),
  classify: vi.fn(),
  generate: vi.fn(),
  loadContext: vi.fn(),
  fetchImages: vi.fn(),
  persistMedia: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('firebase-admin/firestore', async () => (await import('./testing/fakeFirestore')).fakeFirestoreModule())
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUser: mocks.getUser }) }))
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: () => 'ACtestaccount' })),
}))
vi.mock('firebase-functions/v2/https', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}))
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
}))
vi.mock('twilio', () => {
  const messages = Object.assign(
    (messageSid: string) => ({
      media: (mediaSid: string) => ({ remove: () => mocks.removeMedia(messageSid, mediaSid) }),
    }),
    { create: mocks.create },
  )
  return { default: Object.assign(() => ({ messages }), { validateRequest: () => true }) }
})
vi.mock('./openai', () => ({
  classifySmsCrisis: mocks.classify,
  generateSmsTurn: mocks.generate,
}))
vi.mock('./context', () => ({
  loadSmsCompanionContext: mocks.loadContext,
}))
vi.mock('./media', async importOriginal => ({
  ...await importOriginal<typeof import('./media')>(),
  fetchTwilioImages: mocks.fetchImages,
}))
vi.mock('./moments', () => ({
  persistSmsMomentMedia: mocks.persistMedia,
}))

const { processSmsInbound } = await import('./index')

const UID = 'writer-1'
const PHONE = '+14165550123'
const SID = 'SM00000000000000000000000000000001'
const QUEUE_PATH = `smsInbound/${SID}`
const HOUR = 60 * 60_000

function queueRef() {
  return fakeDb.doc(QUEUE_PATH) as unknown as FirebaseFirestore.DocumentReference
}

function seedJob(overrides: FakeData = {}) {
  const phoneHash = hashSmsValue(PHONE)
  fakeDb.seed(`users/${UID}/smsSettings/current`, { phoneHash, phoneLast4: '0123', linkedAt: 1, enabled: true })
  fakeDb.seed(`smsPhoneLinks/${phoneHash}`, { uid: UID, phoneE164: PHONE, phoneLast4: '0123', linkedAt: 1, enabled: true })
  fakeDb.seed(`users/${UID}/smsMessages/${SID}`, { id: SID, direction: 'inbound', body: 'A small thing happened', createdAt: Date.now(), status: 'received' })
  fakeDb.seed(QUEUE_PATH, {
    uid: UID,
    from: PHONE,
    to: '+12897780589',
    body: 'A small thing happened',
    media: [],
    rejectedMediaCount: 0,
    inboundMessageId: SID,
    receivedAt: Date.now(),
    status: 'pending',
    attempts: 0,
    expireAt: new FakeTimestamp(Date.now() + 30 * 24 * HOUR),
    ...overrides,
  })
}

function queue(): FakeData {
  return fakeDb.read(QUEUE_PATH) as FakeData
}

function sentBodies(): string[] {
  return mocks.create.mock.calls.map(call => String(call[0].body))
}

beforeEach(() => {
  fakeDb.reset()
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.create.mockResolvedValue({ sid: 'SMreply000001' })
  mocks.removeMedia.mockResolvedValue(true)
  mocks.classify.mockResolvedValue({ risk: 0 })
  mocks.generate.mockResolvedValue({
    reply: 'That sounds like a full day.',
    fieldNote: null,
    visualRisk: 0,
    responseMode: 'witness',
  })
  mocks.loadContext.mockResolvedValue({ context: {}, timezone: 'America/Toronto' })
  mocks.fetchImages.mockResolvedValue({ images: [], failedCount: 0 })
  mocks.persistMedia.mockResolvedValue([])
  mocks.getUser.mockResolvedValue({ uid: UID })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SMS inbound processor', () => {
  it('replies once, records the turn, and clears message content from the queue doc', async () => {
    seedJob()

    await processSmsInbound(queueRef())

    expect(sentBodies()).toEqual(['That sounds like a full day.'])
    const done = queue()
    expect(done).toMatchObject({ status: 'completed', outboundSid: 'SMreply000001', sendState: 'sent' })
    expect(done).not.toHaveProperty('body')
    expect(done).not.toHaveProperty('from')
    expect(done).not.toHaveProperty('delivery')
    expect(done.expireAt).toBeInstanceOf(FakeTimestamp)
    expect(fakeDb.read(`users/${UID}/smsMessages/SMreply000001`)).toMatchObject({ direction: 'outbound', replyTo: SID })
    expect(fakeDb.read(`users/${UID}/smsMessages/${SID}`)).toMatchObject({ status: 'processed', risk: 0 })
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ grounding: false, timezone: 'America/Toronto' })
  })

  it('finishes a retried job from the recorded SID without regenerating or resending', async () => {
    seedJob()
    fakeDb.beforeWrite = ops => {
      if (ops.some(op => op.path === `users/${UID}/smsMessages/SMreply000001`)) {
        throw Object.assign(new Error('unavailable'), { code: 14 })
      }
    }

    await expect(processSmsInbound(queueRef())).rejects.toThrow('unavailable')
    expect(queue()).toMatchObject({ status: 'pending', outboundSid: 'SMreply000001', sendState: 'sent' })

    fakeDb.beforeWrite = null
    await processSmsInbound(queueRef())

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(queue()).toMatchObject({ status: 'completed', outboundSid: 'SMreply000001' })
    expect(fakeDb.read(`users/${UID}/smsMessages/SMreply000001`)).toMatchObject({ body: 'That sounds like a full day.' })
  })

  it('treats a job found mid-send without a SID as ambiguous and never resends it', async () => {
    seedJob()
    fakeDb.beforeWrite = ops => {
      if (ops.some(op => op.path === QUEUE_PATH && op.data && 'outboundSid' in op.data && op.data.sendState === 'sent')) {
        throw Object.assign(new Error('deadline'), { code: 4 })
      }
    }

    await expect(processSmsInbound(queueRef())).rejects.toThrow('deadline')
    fakeDb.beforeWrite = null
    await processSmsInbound(queueRef())

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(queue()).toMatchObject({ status: 'terminal_failed', lastError: 'ambiguous_send' })
    expect(queue()).not.toHaveProperty('body')
  })

  it('treats a Twilio 4xx such as 21610 as terminal (no retry)', async () => {
    seedJob()
    mocks.create.mockRejectedValue(Object.assign(new Error('unsubscribed recipient'), { status: 400, code: 21610 }))

    await expect(processSmsInbound(queueRef())).resolves.toBeUndefined()

    expect(queue()).toMatchObject({ status: 'terminal_failed', lastError: 'twilio_21610', sendState: 'rejected' })
    expect(queue()).not.toHaveProperty('from')
  })

  it('retries a 429 (definitely not sent) and sends on the next attempt', async () => {
    seedJob()
    mocks.create.mockRejectedValueOnce(Object.assign(new Error('rate'), { status: 429, code: 20429 }))

    await expect(processSmsInbound(queueRef())).rejects.toThrow('rate')
    expect(queue()).toMatchObject({ status: 'pending' })
    expect(queue()).not.toHaveProperty('sendState')

    await processSmsInbound(queueRef())
    expect(queue()).toMatchObject({ status: 'completed' })
  })

  it('keeps the reply when the moment image upload fails', async () => {
    seedJob()
    mocks.fetchImages.mockResolvedValue({ images: [{ contentType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AQID' }], failedCount: 0 })
    mocks.generate.mockResolvedValue({ reply: 'A crowded room.', fieldNote: 'Started the new job.', visualRisk: 0, responseMode: 'reflect' })
    mocks.persistMedia.mockRejectedValue(new Error('storage down'))

    await processSmsInbound(queueRef())

    expect(queue()).toMatchObject({ status: 'completed' })
    expect(fakeDb.read(`users/${UID}/fieldMoments/${SID}`)).toMatchObject({ text: 'Started the new job.', mediaPaths: [] })
  })

  it('deletes processed MMS media at Twilio after completion', async () => {
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/ACtestaccount/Messages/${SID}/Media/ME0123456789abcdef0123456789abcdef`
    seedJob({ media: [{ url: mediaUrl, contentType: 'image/jpeg' }] })

    await processSmsInbound(queueRef())

    expect(mocks.removeMedia).toHaveBeenCalledWith(SID, 'ME0123456789abcdef0123456789abcdef')
    expect(queue().media).toEqual([])
  })

  it('records SMS risk server-side and grounds the reply for a classifier risk of 1', async () => {
    seedJob()
    mocks.classify.mockResolvedValue({ risk: 1 })

    await processSmsInbound(queueRef())

    expect(fakeDb.read(`users/${UID}/smsSettings/riskState`)).toMatchObject({ lastRiskLevel: 1 })
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ risk: 1, grounding: true })
  })

  it('grounds an ordinary reply within 72 hours of an earlier SMS crisis', async () => {
    seedJob()
    fakeDb.seed(`users/${UID}/smsSettings/riskState`, { lastRiskAt: Date.now() - 20 * HOUR, lastRiskLevel: 2 })

    await processSmsInbound(queueRef())

    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ risk: 0, grounding: true })
  })

  it('grounds an ordinary reply within 72 hours of app grounding', async () => {
    seedJob()
    fakeDb.seed(`users/${UID}/companionPreferences/current`, { lastGroundingAt: Date.now() - 2 * HOUR })

    await processSmsInbound(queueRef())

    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ grounding: true })
  })

  it('answers explicit L1 crisis language with the fixed response and records the risk', async () => {
    seedJob({ body: 'I am going to kill myself tonight' })

    await processSmsInbound(queueRef())

    expect(mocks.generate).not.toHaveBeenCalled()
    expect(sentBodies()[0]).toContain('988')
    expect(fakeDb.read(`users/${UID}/smsSettings/riskState`)).toMatchObject({ lastRiskLevel: 2 })
  })

  it('resends the fixed crisis reply once when the first send is ambiguous', async () => {
    seedJob({ body: 'I am going to kill myself tonight' })
    mocks.create
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { name: 'Error' }))
      .mockResolvedValueOnce({ sid: 'SMreply000002' })

    await processSmsInbound(queueRef())

    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(sentBodies().every(body => body.includes('988'))).toBe(true)
    expect(queue()).toMatchObject({ status: 'completed', outboundSid: 'SMreply000002' })
  })

  it('never resends an ordinary reply after an ambiguous failure', async () => {
    seedJob()
    mocks.create.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { name: 'Error' }))

    await processSmsInbound(queueRef())

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(queue()).toMatchObject({ status: 'terminal_failed', lastError: 'ambiguous_send' })
  })

  it('logs a classifier fail-open distinctly from a genuine 0', async () => {
    seedJob()
    mocks.classify.mockResolvedValue({ risk: 0, failOpen: 'http_error' })

    await processSmsInbound(queueRef())

    expect(vi.mocked(console.warn)).toHaveBeenCalledWith('[sms] crisis classifier fail-open category=http_error')
  })

  it('falls back to a reply with an emergency line when generation fails', async () => {
    seedJob()
    mocks.generate.mockRejectedValue(new Error('openai_503'))

    await processSmsInbound(queueRef())

    expect(sentBodies()[0]).toContain('988')
    expect(fakeDb.read(`users/${UID}/smsMessages/SMreply000001`)).toMatchObject({ usedFallback: true })
  })

  it('does not call any model while the kill switch is off', async () => {
    seedJob()
    fakeDb.seed('appConfig/global', { features: { smsEnabled: false } })

    await processSmsInbound(queueRef())

    expect(mocks.classify).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(sentBodies()[0]).toContain('paused')
  })

  it('stops generating once the daily budget is used, with a fixed reply', async () => {
    seedJob()
    fakeDb.seed(`users/${UID}/smsSettings/usage`, { dayKey: utcDayKey(Date.now()), turns: SMS_DAILY_TURN_LIMIT })

    await processSmsInbound(queueRef())

    expect(mocks.generate).not.toHaveBeenCalled()
    expect(sentBodies()[0]).toContain("today's SMS limit")
    expect(sentBodies()[0]).toContain('988')
  })

  it('exempts crisis-adjacent turns from the daily budget', async () => {
    seedJob()
    fakeDb.seed(`users/${UID}/smsSettings/usage`, { dayKey: utcDayKey(Date.now()), turns: SMS_DAILY_TURN_LIMIT })
    mocks.classify.mockResolvedValue({ risk: 1 })

    await processSmsInbound(queueRef())

    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })

  it('counts one budget turn per message even across retries', async () => {
    seedJob()
    mocks.create.mockRejectedValueOnce(Object.assign(new Error('rate'), { status: 429 }))

    await expect(processSmsInbound(queueRef())).rejects.toThrow()
    await processSmsInbound(queueRef())

    expect(fakeDb.read(`users/${UID}/smsSettings/usage`)).toMatchObject({ turns: 1 })
  })

  it('drops the job without writing or sending when the account is being deleted', async () => {
    seedJob()
    fakeDb.seed(`users/${UID}`, { status: 'deleting', deletedAt: Date.now() })
    const before = fakeDb.paths(`users/${UID}/`)

    await processSmsInbound(queueRef())

    expect(mocks.create).not.toHaveBeenCalled()
    expect(fakeDb.read(QUEUE_PATH)).toBeUndefined()
    expect(fakeDb.paths(`users/${UID}/`)).toEqual(before)
  })

  it('re-checks the tombstone after generation, right before sending', async () => {
    seedJob()
    mocks.generate.mockImplementation(async () => {
      fakeDb.seed(`users/${UID}`, { status: 'deleting' })
      return { reply: 'late', fieldNote: null, visualRisk: 0, responseMode: 'witness' }
    })

    await processSmsInbound(queueRef())

    expect(mocks.create).not.toHaveBeenCalled()
    expect(fakeDb.read(QUEUE_PATH)).toBeUndefined()
  })

  it('treats a missing Auth user as deleted once the tombstone itself is gone', async () => {
    seedJob()
    mocks.getUser.mockRejectedValue(Object.assign(new Error('no user'), { code: 'auth/user-not-found' }))

    await processSmsInbound(queueRef())

    expect(mocks.create).not.toHaveBeenCalled()
    expect(fakeDb.read(QUEUE_PATH)).toBeUndefined()
  })

  it('writes nothing under the user when deletion starts while the reply is in flight', async () => {
    seedJob()
    mocks.create.mockImplementation(async () => {
      fakeDb.seed(`users/${UID}`, { status: 'deleting' })
      return { sid: 'SMreply000001' }
    })

    await processSmsInbound(queueRef())

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(fakeDb.read(`users/${UID}/smsMessages/SMreply000001`)).toBeUndefined()
    expect(fakeDb.read(QUEUE_PATH)).toBeUndefined()
  })

  it('drops a queued message whose phone was unlinked (STOP) before processing', async () => {
    seedJob()
    fakeDb.store.delete(`smsPhoneLinks/${hashSmsValue(PHONE)}`)

    await processSmsInbound(queueRef())

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
