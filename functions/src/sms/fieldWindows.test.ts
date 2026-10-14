import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb, type FakeData } from './testing/fakeFirestore'
import { buildFieldWindowDecision, type FieldWindow, type FieldWindowArm } from './fieldWindowLogic'
import { hashSmsValue } from './linking'

const mocks = vi.hoisted(() => ({ create: vi.fn(), getUser: vi.fn() }))

vi.mock('firebase-admin/firestore', async () => (await import('./testing/fakeFirestore')).fakeFirestoreModule())
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUser: mocks.getUser }) }))
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: () => 'test-secret' })),
}))
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
}))
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}))
vi.mock('twilio', () => ({
  default: () => ({ messages: { create: mocks.create } }),
}))

const {
  dispatchFieldWindow,
  scheduleFieldWindows,
  sweepStaleFieldWindowDispatches,
  STALE_DISPATCH_MS,
} = await import('./fieldWindows')

// Friday 2026-07-10 17:30 in Toronto, inside the weekday 17:00-19:00 window.
const NOW = Date.parse('2026-07-10T21:30:00Z')
const HOUR = 60 * 60_000
const WEEK_KEY = '2026-07-06'

const window: FieldWindow = {
  id: 'after-work',
  label: 'After work',
  days: [1, 2, 3, 4, 5],
  startMinute: 17 * 60,
  endMinute: 19 * 60,
  purpose: 'settle',
  enabled: true,
}

function fieldWindows(overrides: FakeData = {}): FakeData {
  return {
    enabled: true,
    timezone: 'America/Toronto',
    maxPerWeek: 2,
    consentAt: NOW - 30 * 24 * HOUR,
    windows: [window],
    ...overrides,
  }
}

function uidForArm(arm: FieldWindowArm, prefix = 'writer'): string {
  for (let index = 0; index < 500; index++) {
    const uid = `${prefix}-${index}`
    if (buildFieldWindowDecision({ uid, window, timezone: 'America/Toronto', now: NOW })?.arm === arm) return uid
  }
  throw new Error('no uid for arm')
}

function seedUser(uid: string, options: { fieldWindows?: FakeData; preferences?: FakeData; linked?: boolean } = {}) {
  fakeDb.seed(`users/${uid}/companionPreferences/current`, {
    id: 'current',
    fieldWindows: options.fieldWindows ?? fieldWindows(),
    ...(options.preferences ?? {}),
  })
  if (options.linked === false) return
  const phone = `+1416555${String(Math.abs(hashCode(uid)) % 10_000).padStart(4, '0')}`
  const phoneHash = hashSmsValue(phone)
  fakeDb.seed(`users/${uid}/smsSettings/current`, { phoneHash, phoneLast4: phone.slice(-4), linkedAt: 1, enabled: true })
  fakeDb.seed(`smsPhoneLinks/${phoneHash}`, { uid, phoneE164: phone, phoneLast4: phone.slice(-4), linkedAt: 1, enabled: true })
}

function hashCode(value: string): number {
  return [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 7)
}

function researchEvents(uid: string): FakeData[] {
  return fakeDb.paths(`users/${uid}/researchEvents/`).map(path => fakeDb.read(path) as FakeData)
}

function dispatchPaths(): string[] {
  return fakeDb.paths('fieldWindowDispatches/')
}

beforeEach(() => {
  fakeDb.reset()
  mocks.create.mockReset()
  mocks.create.mockResolvedValue({ sid: 'SMoutbound0001' })
  mocks.getUser.mockReset()
  mocks.getUser.mockResolvedValue({ uid: 'someone' })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('scheduleFieldWindows', () => {
  it('logs a category (no uid) and counts an opted-in writer whose timezone is unusable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const uid = uidForArm('field_check_in')
    seedUser(uid, { fieldWindows: fieldWindows({ timezone: 'Eastern time' }) })

    const summary = await scheduleFieldWindows(NOW)

    expect(summary).toMatchObject({ created: 0, invalidTimezone: 1 })
    expect(researchEvents(uid)).toEqual([])
    expect(warn).toHaveBeenCalledWith('[field-windows] preferences skipped category=invalid_timezone')
    expect(warn.mock.calls.flat().join(' ')).not.toContain(uid)
  })

  it('assigns a contact day: research event plus a dispatch carrying the local date', async () => {
    const uid = uidForArm('field_check_in')
    seedUser(uid)

    const summary = await scheduleFieldWindows(NOW)

    expect(summary.created).toBe(1)
    const [event] = researchEvents(uid)
    expect(event).toMatchObject({ status: 'assigned', assignedArm: 'field_check_in', weekKey: WEEK_KEY })
    const [dispatchPath] = dispatchPaths()
    expect(fakeDb.read(dispatchPath)).toMatchObject({ uid, status: 'pending', localDate: '2026-07-10', windowId: window.id })
  })

  it('records a deliberate-quiet day as delivered with an outcome placeholder and no dispatch', async () => {
    const uid = uidForArm('field_no_contact')
    seedUser(uid)

    await scheduleFieldWindows(NOW)

    expect(researchEvents(uid)[0]).toMatchObject({ status: 'delivered', deliveredArm: 'field_no_contact' })
    expect(fakeDb.paths(`users/${uid}/interventionOutcomes/`)).toHaveLength(1)
    expect(dispatchPaths()).toEqual([])
  })

  it('is idempotent across ticks within the same local date', async () => {
    const uid = uidForArm('field_check_in')
    seedUser(uid)
    await scheduleFieldWindows(NOW)
    const second = await scheduleFieldWindows(NOW + 15 * 60_000)
    expect(second.created).toBe(0)
    expect(dispatchPaths()).toHaveLength(1)
  })

  it('checks the window before reading anything about the writer', async () => {
    const uid = uidForArm('field_check_in')
    seedUser(uid)
    const closed = Date.parse('2026-07-10T14:00:00Z') // 10:00 in Toronto
    vi.setSystemTime(closed)

    await scheduleFieldWindows(closed)

    expect(fakeDb.readLog.filter(path => path.startsWith('users/'))).toEqual([])
    expect(fakeDb.queryLog.filter(path => path.includes('researchEvents'))).toEqual([])
  })

  it('skips a malformed preferences doc and keeps scheduling everyone after it', async () => {
    const noLabel: FakeData = { ...window }
    delete noLabel.label
    seedUser('aaa-malformed', { fieldWindows: fieldWindows({ windows: [noLabel, 'junk', null] }) })
    seedUser('aab-broken-types', { fieldWindows: fieldWindows({ windows: 'every day', maxPerWeek: 'many' }) })
    const uid = uidForArm('field_check_in', 'zzz')
    seedUser(uid)

    const summary = await scheduleFieldWindows(NOW)

    expect(summary.created).toBe(1)
    expect(researchEvents(uid)).toHaveLength(1)
  })

  it('isolates a per-user failure with a category-only log line', async () => {
    const failing = uidForArm('field_check_in', 'aaa')
    const healthy = uidForArm('field_check_in', 'zzz')
    seedUser(failing)
    seedUser(healthy)
    fakeDb.beforeWrite = ops => {
      if (ops.some(op => op.path.startsWith(`users/${failing}/`))) {
        throw Object.assign(new Error('boom: private detail'), { code: 14 })
      }
    }

    const summary = await scheduleFieldWindows(NOW)

    expect(summary).toMatchObject({ created: 1, failedUsers: 1 })
    expect(researchEvents(healthy)).toHaveLength(1)
    const logged = vi.mocked(console.error).mock.calls.map(call => String(call[0]))
    expect(logged).toContain('[field-windows] user scheduling failed category=provider_14')
    expect(logged.join('\n')).not.toContain('private detail')
    expect(logged.join('\n')).not.toContain(failing)
  })

  it('paginates past the first page of preference docs', async () => {
    for (let index = 0; index < 305; index++) {
      seedUser(`aaa-filler-${String(index).padStart(3, '0')}`, { fieldWindows: fieldWindows({ consentAt: 'not-yet' }), linked: false })
    }
    const uid = uidForArm('field_check_in', 'zzz')
    seedUser(uid)

    const summary = await scheduleFieldWindows(NOW)

    expect(summary.created).toBe(1)
    expect(researchEvents(uid)).toHaveLength(1)
    expect(fakeDb.queryLog.filter(path => path === 'group:companionPreferences').length).toBeGreaterThan(1)
  })

  it('counts only field-window contact events for the weekly cap, however many other events exist', async () => {
    const uid = uidForArm('field_check_in')
    seedUser(uid)
    for (const [index, status] of ['delivered', 'assigned'].entries()) {
      fakeDb.seed(`users/${uid}/researchEvents/fw-${index}`, {
        protocolId: 'field-window-timing-v1', weekKey: WEEK_KEY, assignedArm: 'field_check_in', status, createdAt: NOW - (index + 2) * 24 * HOUR,
      })
    }
    for (let index = 0; index < 150; index++) {
      fakeDb.seed(`users/${uid}/researchEvents/sms-${index}`, {
        protocolId: 'naturalistic-sms-v1', status: 'delivered', createdAt: NOW - index,
      })
    }

    await scheduleFieldWindows(NOW)

    const today = researchEvents(uid).find(event => event.localDate === '2026-07-10')
    expect(today).toMatchObject({ status: 'cancelled', cancelReason: 'ineligible_cap' })
    expect(dispatchPaths()).toEqual([])
  })

  it('records a capped no-contact day as ineligible too (no biased quiet observation)', async () => {
    const uid = uidForArm('field_no_contact')
    seedUser(uid, { fieldWindows: fieldWindows({ maxPerWeek: 1 }) })
    fakeDb.seed(`users/${uid}/researchEvents/fw-earlier`, {
      protocolId: 'field-window-timing-v1', weekKey: WEEK_KEY, assignedArm: 'field_check_in', status: 'delivered',
    })

    await scheduleFieldWindows(NOW)

    const today = researchEvents(uid).find(event => event.localDate === '2026-07-10')
    expect(today).toMatchObject({ status: 'cancelled', cancelReason: 'ineligible_cap', assignedArm: 'field_no_contact' })
    expect(fakeDb.paths(`users/${uid}/interventionOutcomes/`)).toEqual([])
  })

  it('does not count cancelled or failed contact events toward the cap', async () => {
    const uid = uidForArm('field_check_in')
    seedUser(uid, { fieldWindows: fieldWindows({ maxPerWeek: 1 }) })
    for (const status of ['cancelled', 'failed']) {
      fakeDb.seed(`users/${uid}/researchEvents/fw-${status}`, {
        protocolId: 'field-window-timing-v1', weekKey: WEEK_KEY, assignedArm: 'field_check_in', status,
      })
    }

    const summary = await scheduleFieldWindows(NOW)

    expect(summary.created).toBe(1)
    expect(dispatchPaths()).toHaveLength(1)
  })

  it('cancels, with a reason, any window within 72 hours of an SMS crisis', async () => {
    const uid = uidForArm('field_check_in')
    seedUser(uid)
    fakeDb.seed(`users/${uid}/smsSettings/riskState`, { lastRiskAt: NOW - 10 * HOUR, lastRiskLevel: 2 })

    const summary = await scheduleFieldWindows(NOW)

    expect(summary).toMatchObject({ created: 0, ineligible: 1 })
    expect(researchEvents(uid)[0]).toMatchObject({ status: 'cancelled', cancelReason: 'recent_crisis' })
    expect(dispatchPaths()).toEqual([])
  })

  it('cancels within 72 hours of app grounding written by the web client', async () => {
    const uid = uidForArm('field_no_contact')
    seedUser(uid, { preferences: { lastGroundingAt: NOW - 71 * HOUR } })

    await scheduleFieldWindows(NOW)

    expect(researchEvents(uid)[0]).toMatchObject({ status: 'cancelled', cancelReason: 'recent_crisis' })
    expect(fakeDb.paths(`users/${uid}/interventionOutcomes/`)).toEqual([])
  })

  it('resumes once the crisis is older than 72 hours', async () => {
    const uid = uidForArm('field_check_in')
    seedUser(uid, { preferences: { lastGroundingAt: NOW - 73 * HOUR } })
    fakeDb.seed(`users/${uid}/smsSettings/riskState`, { lastRiskAt: NOW - 80 * HOUR })

    const summary = await scheduleFieldWindows(NOW)

    expect(summary.created).toBe(1)
  })

  it('ignores consent that predates a STOP/UNLINK opt-out', async () => {
    const uid = uidForArm('field_check_in')
    seedUser(uid, { fieldWindows: fieldWindows({ consentAt: NOW - 10 * HOUR }) })
    fakeDb.seed(`users/${uid}/smsSettings/optOut`, { optedOutAt: NOW - 5 * HOUR })

    const summary = await scheduleFieldWindows(NOW)

    expect(summary.created).toBe(0)
    expect(researchEvents(uid)).toEqual([])
  })

  it('does nothing while the SMS kill switch is off', async () => {
    const uid = uidForArm('field_check_in')
    seedUser(uid)
    fakeDb.seed('appConfig/global', { features: { smsEnabled: false } })

    const summary = await scheduleFieldWindows(NOW)

    expect(summary.created).toBe(0)
    expect(researchEvents(uid)).toEqual([])
  })
})

async function scheduledDispatch(uid: string) {
  seedUser(uid)
  await scheduleFieldWindows(NOW)
  const [path] = dispatchPaths()
  return fakeDb.doc(path) as unknown as FirebaseFirestore.DocumentReference
}

describe('fieldWindowDispatcher', () => {
  it('sends once with opt-out copy and records delivery and the outbound SID', async () => {
    const uid = uidForArm('field_check_in')
    const ref = await scheduledDispatch(uid)

    await dispatchFieldWindow(ref)

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0].body).toMatch(/Reply STOP to opt out\.$/)
    const dispatch = fakeDb.read(ref.path)
    expect(dispatch).toMatchObject({ status: 'completed', outboundSid: 'SMoutbound0001', sendState: 'sent' })
    expect(researchEvents(uid)[0]).toMatchObject({ status: 'delivered', sourceId: 'SMoutbound0001' })
    expect(fakeDb.read(`users/${uid}/smsMessages/SMoutbound0001`)).toMatchObject({ mode: 'field_window', direction: 'outbound' })
  })

  it('cancels at send time when a crisis happened after scheduling', async () => {
    const uid = uidForArm('field_check_in')
    const ref = await scheduledDispatch(uid)
    fakeDb.seed(`users/${uid}/smsSettings/riskState`, { lastRiskAt: NOW - 60_000 })

    await dispatchFieldWindow(ref)

    expect(mocks.create).not.toHaveBeenCalled()
    expect(fakeDb.read(ref.path)).toMatchObject({ status: 'cancelled', cancelReason: 'recent_crisis' })
    expect(researchEvents(uid)[0]).toMatchObject({ status: 'cancelled', cancelReason: 'recent_crisis' })
  })

  it('cancels when the writer-local clock has left the window by send time', async () => {
    const uid = uidForArm('field_check_in')
    const ref = await scheduledDispatch(uid)
    vi.setSystemTime(Date.parse('2026-07-10T23:05:00Z')) // 19:05 in Toronto

    await dispatchFieldWindow(ref)

    expect(mocks.create).not.toHaveBeenCalled()
    expect(fakeDb.read(ref.path)).toMatchObject({ status: 'cancelled', cancelReason: 'outside_window' })
  })

  it('marks the research event failed on a Twilio rejection so it frees the weekly cap', async () => {
    const uid = uidForArm('field_check_in')
    const ref = await scheduledDispatch(uid)
    mocks.create.mockRejectedValue(Object.assign(new Error('unsubscribed'), { status: 400, code: 21610 }))

    await dispatchFieldWindow(ref)

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(fakeDb.read(ref.path)).toMatchObject({ status: 'terminal_failed', lastError: 'twilio_21610' })
    expect(researchEvents(uid)[0]).toMatchObject({ status: 'failed' })
  })

  it('never resends when the post-send writes fail; the sweeper finishes them', async () => {
    const uid = uidForArm('field_check_in')
    const ref = await scheduledDispatch(uid)
    fakeDb.beforeWrite = ops => {
      if (ops.some(op => op.path.includes('/smsMessages/'))) throw Object.assign(new Error('unavailable'), { code: 14 })
    }

    await dispatchFieldWindow(ref)

    expect(fakeDb.read(ref.path)).toMatchObject({ status: 'sending', outboundSid: 'SMoutbound0001' })
    fakeDb.beforeWrite = null
    vi.setSystemTime(NOW + STALE_DISPATCH_MS + 60_000)
    expect(await sweepStaleFieldWindowDispatches(Date.now())).toBe(1)

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(fakeDb.read(ref.path)).toMatchObject({ status: 'completed', outboundSid: 'SMoutbound0001' })
    expect(researchEvents(uid)[0]).toMatchObject({ status: 'delivered' })
    expect(fakeDb.read(`users/${uid}/smsMessages/SMoutbound0001`)).toBeDefined()
  })

  it('treats a stuck send without a SID as ambiguous: failed, never resent', async () => {
    const uid = uidForArm('field_check_in')
    const ref = await scheduledDispatch(uid)
    fakeDb.beforeWrite = ops => {
      if (ops.some(op => op.data && 'outboundSid' in op.data)) throw Object.assign(new Error('deadline'), { code: 4 })
    }

    await dispatchFieldWindow(ref)
    fakeDb.beforeWrite = null
    vi.setSystemTime(NOW + STALE_DISPATCH_MS + 60_000)
    await sweepStaleFieldWindowDispatches(Date.now())

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(fakeDb.read(ref.path)).toMatchObject({ status: 'terminal_failed', lastError: 'ambiguous_send' })
    expect(researchEvents(uid)[0]).toMatchObject({ status: 'failed' })
  })

  it('sweeps a stale pending dispatch by cancelling it instead of sending late', async () => {
    const uid = uidForArm('field_check_in')
    const ref = await scheduledDispatch(uid)
    vi.setSystemTime(NOW + STALE_DISPATCH_MS + 60_000)

    await sweepStaleFieldWindowDispatches(Date.now())

    expect(mocks.create).not.toHaveBeenCalled()
    expect(fakeDb.read(ref.path)).toMatchObject({ status: 'cancelled', cancelReason: 'stale_pending' })
    expect(researchEvents(uid)[0]).toMatchObject({ status: 'cancelled' })
  })

  it('drops the dispatch without writing when the account is being deleted', async () => {
    const uid = uidForArm('field_check_in')
    const ref = await scheduledDispatch(uid)
    fakeDb.seed(`users/${uid}`, { status: 'deleting', deletedAt: NOW })

    await dispatchFieldWindow(ref)

    expect(mocks.create).not.toHaveBeenCalled()
    expect(fakeDb.read(ref.path)).toBeUndefined()
  })
})
