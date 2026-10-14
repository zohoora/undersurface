import { getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import twilio from 'twilio'
import { twilioAccountSid, twilioAuthToken } from '../shared/secrets.js'
import { TWILIO_PHONE_NUMBER } from './field.js'
import {
  buildFieldWindowDecision,
  buildFieldWindowResearchEvent,
  countsTowardWeeklyCap,
  fieldWindowDispatchBlock,
  fieldWindowIneligibility,
  fieldWindowMessage,
  fieldWindowTimezoneProblem,
  hasFieldWindowConsent,
  parseFieldWindowPreferences,
  type FieldWindowArm,
  type FieldWindowCancelReason,
  type FieldWindowDecision,
  type FieldWindowPurpose,
} from './fieldWindowLogic.js'
import { getOutboundPhone } from './linking.js'
import { classifyTwilioSendError, twilioErrorCategory } from './delivery.js'
import {
  isAccountDeleting,
  isRecentCrisis,
  isSmsEnabled,
  lastGroundingAtFromPreferences,
  readServerSmsState,
} from './state.js'

const PREFERENCES_PAGE_SIZE = 300
const WEEKLY_EVENT_QUERY_LIMIT = 20
/** A dispatch untouched this long is stale: the trigger runs in seconds. */
export const STALE_DISPATCH_MS = 15 * 60_000
const SWEEP_LIMIT = 100

interface FieldWindowDispatchDoc {
  uid: string
  eventId: string
  windowId: string
  windowLabel: string
  purpose: FieldWindowPurpose
  /** Writer-local date the window was open on; rechecked at send time. */
  localDate?: string
  status: 'pending' | 'sending' | 'completed' | 'cancelled' | 'terminal_failed'
  /** 'sending' is written immediately before Twilio is called. */
  sendState?: 'sending' | 'sent'
  outboundSid?: string
  sentAt?: number
  attempts: number
  createdAt: number
  updatedAt: number
}

export interface FieldWindowScheduleSummary {
  created: number
  ineligible: number
  failedUsers: number
  swept: number
  /** Opted-in writers skipped because their timezone is unusable. */
  invalidTimezone: number
}

function userCollection(uid: string, collection: string, db: Firestore = getFirestore()) {
  return db.collection('users').doc(uid).collection(collection)
}

function categoryOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'number' || typeof code === 'string') return `provider_${String(code).slice(0, 40)}`
  return error instanceof Error ? error.name.slice(0, 40) : 'unknown'
}

/**
 * Proactive contacts already used this writer-local week. An indexed query on
 * the protocol, week, and arm: unrelated research events (SMS replies,
 * conductor turns) can never push field-window events out of the count.
 */
async function proactiveCount(uid: string, weekKey: string, db: Firestore): Promise<number> {
  const snap = await userCollection(uid, 'researchEvents', db)
    .where('protocolId', '==', 'field-window-timing-v1')
    .where('weekKey', '==', weekKey)
    .where('assignedArm', '==', 'field_check_in')
    .limit(WEEKLY_EVENT_QUERY_LIMIT)
    .get()
  return snap.docs.filter(doc => countsTowardWeeklyCap(doc.data())).length
}

function outcomeForFieldWindow(input: {
  eventId: string
  arm: FieldWindowArm
  windowLabel: string
  now: number
}) {
  return {
    id: `outcome-${input.eventId}`,
    source: 'sms' as const,
    sourceId: input.eventId,
    intervention: 'field_window' as const,
    researchEventId: input.eventId,
    fieldWindowArm: input.arm,
    windowLabel: input.windowLabel,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

type UserScheduleResult = 'none' | 'created' | 'ineligible' | 'invalid_timezone'

/**
 * Schedule one writer. Checks run cheapest-first: the pure window check, then
 * one doc read (already decided today?), then the weekly count, then crisis
 * and opt-out state, and the phone lookup last.
 */
async function scheduleUser(
  db: Firestore,
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  now: number,
): Promise<UserScheduleResult> {
  const uid = doc.ref.parent.parent?.id
  if (!uid || doc.id !== 'current') return 'none'
  const data = doc.data()
  const preferences = parseFieldWindowPreferences(data.fieldWindows)
  if (!preferences) {
    // An opted-in writer whose timezone the scheduler cannot use would
    // otherwise never get a window, with nothing in the logs to say why.
    const problem = fieldWindowTimezoneProblem(data.fieldWindows)
    if (problem) {
      console.warn(`[field-windows] preferences skipped category=${problem}`)
      return 'invalid_timezone'
    }
    return 'none'
  }
  if (typeof preferences.consentAt !== 'number') return 'none'

  let decision: FieldWindowDecision | null = null
  for (const window of preferences.windows) {
    decision = buildFieldWindowDecision({ uid, window, timezone: preferences.timezone, now })
    if (decision) break
  }
  if (!decision) return 'none'

  const eventRef = userCollection(uid, 'researchEvents', db).doc(decision.eventId)
  if ((await eventRef.get()).exists) return 'none'

  const count = await proactiveCount(uid, decision.weekKey, db)
  const serverState = await readServerSmsState(uid, db)
  if (!hasFieldWindowConsent(preferences, serverState.optedOutAt)) return 'none'
  const ineligibility = fieldWindowIneligibility({
    recentCrisis: isRecentCrisis({
      lastRiskAt: serverState.lastRiskAt,
      lastGroundingAt: lastGroundingAtFromPreferences(data),
    }, now),
    proactiveMessagesThisWeek: count,
    maxPerWeek: preferences.maxPerWeek,
  })
  if (!await getOutboundPhone(uid)) return 'none'

  const chosen = decision
  const outcomeRef = userCollection(uid, 'interventionOutcomes', db).doc(`outcome-${decision.eventId}`)
  const dispatchRef = db.collection('fieldWindowDispatches').doc(decision.eventId)
  const didCreate = await db.runTransaction(async transaction => {
    const existing = await transaction.get(eventRef)
    if (existing.exists) return false
    // Ineligible days are recorded with their reason (and excluded from
    // analysis and the cap) rather than silently skipped.
    transaction.create(eventRef, buildFieldWindowResearchEvent(chosen, now, ineligibility))
    if (ineligibility) return true
    if (chosen.arm === 'field_no_contact') {
      transaction.create(outcomeRef, outcomeForFieldWindow({
        eventId: chosen.eventId,
        arm: chosen.arm,
        windowLabel: chosen.windowLabel,
        now,
      }))
    } else {
      transaction.create(dispatchRef, {
        uid,
        eventId: chosen.eventId,
        windowId: chosen.windowId,
        windowLabel: chosen.windowLabel,
        purpose: chosen.purpose,
        localDate: chosen.localDate,
        status: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      } satisfies FieldWindowDispatchDoc)
    }
    return true
  })
  if (!didCreate) return 'none'
  return ineligibility ? 'ineligible' : 'created'
}

export async function scheduleFieldWindows(now = Date.now()): Promise<FieldWindowScheduleSummary> {
  const db = getFirestore()
  const summary: FieldWindowScheduleSummary = { created: 0, ineligible: 0, failedUsers: 0, swept: 0, invalidTimezone: 0 }
  try {
    summary.swept = await sweepStaleFieldWindowDispatches(now)
  } catch (error) {
    console.error(`[field-windows] sweep failed category=${categoryOf(error)}`)
  }
  if (!await isSmsEnabled(db)) return summary

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    let query = db.collectionGroup('companionPreferences')
      .where('fieldWindows.enabled', '==', true)
      .limit(PREFERENCES_PAGE_SIZE)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    for (const doc of page.docs) {
      try {
        const result = await scheduleUser(db, doc, now)
        if (result === 'created') summary.created++
        if (result === 'ineligible') summary.ineligible++
        if (result === 'invalid_timezone') summary.invalidTimezone++
      } catch (error) {
        // One malformed or unreadable user must never stop everyone after it.
        summary.failedUsers++
        console.error(`[field-windows] user scheduling failed category=${categoryOf(error)}`)
      }
    }
    if (page.docs.length < PREFERENCES_PAGE_SIZE) break
    cursor = page.docs[page.docs.length - 1]
  }
  return summary
}

export const fieldWindowScheduler = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'UTC',
    memory: '256MiB',
    timeoutSeconds: 120,
    region: 'us-central1',
  },
  async () => {
    const summary = await scheduleFieldWindows()
    if (summary.created + summary.ineligible + summary.failedUsers + summary.swept + summary.invalidTimezone > 0) {
      console.info(`[field-windows] created=${summary.created} ineligible=${summary.ineligible} failedUsers=${summary.failedUsers} swept=${summary.swept} invalidTimezone=${summary.invalidTimezone}`)
    }
  },
)

async function cancelDispatch(
  ref: FirebaseFirestore.DocumentReference,
  queued: FieldWindowDispatchDoc,
  reason: FieldWindowCancelReason,
): Promise<void> {
  const now = Date.now()
  const batch = getFirestore().batch()
  batch.update(ref, { status: 'cancelled', cancelReason: reason, updatedAt: now })
  batch.update(userCollection(queued.uid, 'researchEvents').doc(queued.eventId), {
    status: 'cancelled',
    cancelReason: reason,
    updatedAt: now,
  })
  await batch.commit()
}

/** A failed send must not keep counting toward the weekly cap. */
async function markDispatchFailed(
  ref: FirebaseFirestore.DocumentReference,
  queued: FieldWindowDispatchDoc,
  reason: string,
): Promise<void> {
  const now = Date.now()
  const batch = getFirestore().batch()
  batch.update(ref, { status: 'terminal_failed', lastError: reason, updatedAt: now })
  batch.update(userCollection(queued.uid, 'researchEvents').doc(queued.eventId), {
    status: 'failed',
    failureReason: reason,
    updatedAt: now,
  })
  await batch.commit()
}

/** Every write after a successful send. Deterministic, so safe to re-run. */
async function finalizeDispatchDelivery(
  ref: FirebaseFirestore.DocumentReference,
  queued: FieldWindowDispatchDoc,
  outboundSid: string,
  sentAt: number,
): Promise<void> {
  const batch = getFirestore().batch()
  batch.set(userCollection(queued.uid, 'smsMessages').doc(outboundSid), {
    id: outboundSid,
    providerSid: outboundSid,
    channel: 'sms',
    direction: 'outbound',
    body: fieldWindowMessage(queued.purpose),
    mode: 'field_window',
    createdAt: sentAt,
    status: 'sent',
    risk: 0,
    researchEventId: queued.eventId,
  })
  batch.set(
    userCollection(queued.uid, 'interventionOutcomes').doc(`outcome-${queued.eventId}`),
    outcomeForFieldWindow({
      eventId: queued.eventId,
      arm: 'field_check_in',
      windowLabel: queued.windowLabel,
      now: sentAt,
    }),
  )
  batch.update(userCollection(queued.uid, 'researchEvents').doc(queued.eventId), {
    status: 'delivered',
    deliveredArm: 'field_check_in',
    sourceId: outboundSid,
    outcomeId: `outcome-${queued.eventId}`,
    deliveredAt: sentAt,
    updatedAt: sentAt,
  })
  batch.update(ref, {
    status: 'completed',
    outboundSid,
    sendState: 'sent',
    completedAt: Date.now(),
    updatedAt: Date.now(),
  })
  await batch.commit()
}

async function claimDispatch(
  ref: FirebaseFirestore.DocumentReference,
): Promise<FieldWindowDispatchDoc | null> {
  return getFirestore().runTransaction(async transaction => {
    const snap = await transaction.get(ref)
    if (!snap.exists) return null
    const queued = snap.data() as FieldWindowDispatchDoc
    if (queued.status !== 'pending') return null
    transaction.update(ref, {
      status: 'sending',
      attempts: (queued.attempts ?? 0) + 1,
      sendingAt: Date.now(),
      updatedAt: Date.now(),
    })
    return { ...queued, attempts: (queued.attempts ?? 0) + 1, status: 'sending' }
  })
}

type DispatchRecheck =
  | { reason: FieldWindowCancelReason; phone: null }
  | { reason: null; phone: string }

/** Re-evaluate everything immediately before the send. */
async function recheckDispatch(
  queued: FieldWindowDispatchDoc,
  now: number,
): Promise<DispatchRecheck> {
  const db = getFirestore()
  if (!await isSmsEnabled(db)) return { reason: 'sms_disabled', phone: null }
  const [preferencesSnap, phone, serverState] = await Promise.all([
    userCollection(queued.uid, 'companionPreferences', db).doc('current').get(),
    getOutboundPhone(queued.uid),
    readServerSmsState(queued.uid, db),
  ])
  const preferencesDoc: DocumentData | null = preferencesSnap.exists ? preferencesSnap.data() ?? null : null
  const reason = fieldWindowDispatchBlock({
    preferences: parseFieldWindowPreferences(preferencesDoc?.fieldWindows),
    windowId: queued.windowId,
    localDate: queued.localDate,
    hasLinkedPhone: Boolean(phone),
    optedOutAt: serverState.optedOutAt,
    recentCrisis: isRecentCrisis({
      lastRiskAt: serverState.lastRiskAt,
      lastGroundingAt: lastGroundingAtFromPreferences(preferencesDoc),
    }, now),
    now,
  })
  if (reason) return { reason, phone: null }
  return phone ? { reason: null, phone } : { reason: 'opt_in_or_link_removed', phone: null }
}

export async function dispatchFieldWindow(ref: FirebaseFirestore.DocumentReference): Promise<void> {
  const queued = await claimDispatch(ref)
  if (!queued) return

  if (await isAccountDeleting(queued.uid)) {
    // Never write under a user that is being deleted; deletion removes the rest.
    await ref.delete()
    return
  }

  let recheck: DispatchRecheck
  try {
    recheck = await recheckDispatch(queued, Date.now())
  } catch (error) {
    console.error(`[field-windows] recheck failed category=${categoryOf(error)}`)
    recheck = { reason: 'recheck_failed', phone: null }
  }
  if (recheck.reason !== null) {
    await cancelDispatch(ref, queued, recheck.reason)
    return
  }
  const phone = recheck.phone
  if (await isAccountDeleting(queued.uid)) {
    await ref.delete()
    return
  }

  await ref.update({ sendState: 'sending', updatedAt: Date.now() })
  let outboundSid: string
  try {
    const outbound = await twilio(twilioAccountSid.value(), twilioAuthToken.value()).messages.create({
      from: TWILIO_PHONE_NUMBER,
      to: phone,
      body: fieldWindowMessage(queued.purpose),
    })
    outboundSid = outbound.sid
  } catch (error) {
    // A proactive message is attempted at most once. Ambiguous provider
    // failures (timeouts, 5xx) may have delivered, so nothing is retried.
    const kind = classifyTwilioSendError(error)
    const category = twilioErrorCategory(error)
    console.error(`[field-windows] send failed kind=${kind} category=${category}`)
    await markDispatchFailed(ref, queued, kind === 'ambiguous' ? 'ambiguous_send' : category)
    return
  }

  const sentAt = Date.now()
  try {
    await ref.update({ outboundSid, sendState: 'sent', sentAt, updatedAt: sentAt })
    if (await isAccountDeleting(queued.uid)) {
      await ref.delete()
      return
    }
    await finalizeDispatchDelivery(ref, queued, outboundSid, sentAt)
  } catch (error) {
    // The text went out. Leave the doc in `sending` (with its SID when that
    // write landed) for the sweeper to finish; never resend.
    console.error(`[field-windows] post-send write failed category=${categoryOf(error)}`)
  }
}

export const fieldWindowDispatcher = onDocumentCreated(
  {
    document: 'fieldWindowDispatches/{eventId}',
    secrets: [twilioAccountSid, twilioAuthToken],
    memory: '256MiB',
    timeoutSeconds: 60,
    region: 'us-central1',
    retry: false,
  },
  async event => {
    if (!event.data) return
    await dispatchFieldWindow(event.data.ref)
  },
)

/**
 * Resolve dispatch docs stuck in `pending` (trigger never ran) or `sending`
 * (instance died mid-flight). Nothing here ever sends:
 * - with an outbound SID: the text went out; finish the remaining writes;
 * - `sending` that reached Twilio without a SID: ambiguous, mark failed;
 * - otherwise: cancel. A late proactive text is worse than none.
 */
export async function sweepStaleFieldWindowDispatches(now = Date.now()): Promise<number> {
  const db = getFirestore()
  const cutoff = now - STALE_DISPATCH_MS
  const snap = await db.collection('fieldWindowDispatches')
    .where('status', 'in', ['pending', 'sending'])
    .where('updatedAt', '<', cutoff)
    .limit(SWEEP_LIMIT)
    .get()
  let swept = 0
  for (const doc of snap.docs) {
    const queued = doc.data() as FieldWindowDispatchDoc
    try {
      if (await isAccountDeleting(queued.uid)) {
        await doc.ref.delete()
      } else if (queued.outboundSid) {
        await finalizeDispatchDelivery(doc.ref, queued, queued.outboundSid, queued.sentAt ?? queued.updatedAt)
      } else if (queued.status === 'sending' && queued.sendState === 'sending') {
        await markDispatchFailed(doc.ref, queued, 'ambiguous_send')
      } else {
        await cancelDispatch(doc.ref, queued, queued.status === 'pending' ? 'stale_pending' : 'stale_claim')
      }
      swept++
    } catch (error) {
      console.error(`[field-windows] sweep item failed category=${categoryOf(error)}`)
    }
  }
  return swept
}
