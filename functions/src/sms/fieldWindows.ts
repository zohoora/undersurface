import { getFirestore } from 'firebase-admin/firestore'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import twilio from 'twilio'
import { twilioAccountSid, twilioAuthToken } from '../shared/secrets.js'
import { TWILIO_PHONE_NUMBER } from './field.js'
import {
  buildFieldWindowDecision,
  buildFieldWindowResearchEvent,
  canDeliverFieldWindow,
  fieldWindowMessage,
  type FieldWindow,
  type FieldWindowArm,
  type FieldWindowPurpose,
} from './fieldWindowLogic.js'
import { getOutboundPhone } from './linking.js'

interface FieldWindowPreferencesDoc {
  enabled: boolean
  timezone: string
  maxPerWeek: 1 | 2 | 3
  windows: FieldWindow[]
  consentAt?: number
}

interface CompanionPreferencesDoc {
  fieldWindows?: FieldWindowPreferencesDoc
}

interface FieldWindowDispatchDoc {
  uid: string
  eventId: string
  windowId: string
  windowLabel: string
  purpose: FieldWindowPurpose
  status: 'pending' | 'sending' | 'completed' | 'cancelled' | 'terminal_failed'
  attempts: number
  createdAt: number
  updatedAt: number
}

function userCollection(uid: string, collection: string) {
  return getFirestore().collection('users').doc(uid).collection(collection)
}

function validPreferences(value: unknown): FieldWindowPreferencesDoc | null {
  if (!value || typeof value !== 'object') return null
  const preferences = value as Partial<FieldWindowPreferencesDoc>
  if (preferences.enabled !== true || typeof preferences.timezone !== 'string') return null
  if (![1, 2, 3].includes(Number(preferences.maxPerWeek)) || !Array.isArray(preferences.windows)) return null
  return preferences as FieldWindowPreferencesDoc
}

async function proactiveCount(uid: string, weekKey: string): Promise<number> {
  const snap = await userCollection(uid, 'researchEvents')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  return snap.docs.reduce((count, doc) => {
    const data = doc.data()
    return count + (
      data.protocolId === 'field-window-timing-v1'
      && data.weekKey === weekKey
      && data.assignedArm === 'field_check_in'
      && data.status !== 'cancelled'
        ? 1
        : 0
    )
  }, 0)
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

export async function scheduleFieldWindows(now = Date.now()): Promise<number> {
  const db = getFirestore()
  const preferenceDocs = await db.collectionGroup('companionPreferences')
    .where('fieldWindows.enabled', '==', true)
    .limit(500)
    .get()
  let created = 0

  for (const doc of preferenceDocs.docs) {
    const uid = doc.ref.parent.parent?.id
    if (!uid || doc.id !== 'current') continue
    const preferences = validPreferences((doc.data() as CompanionPreferencesDoc).fieldWindows)
    if (!preferences || typeof preferences.consentAt !== 'number') continue
    if (!await getOutboundPhone(uid)) continue

    for (const window of preferences.windows.slice(0, 3)) {
      const firstDecision = buildFieldWindowDecision({
        uid,
        window,
        timezone: preferences.timezone,
        now,
        proactiveMessagesThisWeek: 0,
        maxPerWeek: preferences.maxPerWeek,
      })
      if (!firstDecision) continue
      const count = await proactiveCount(uid, firstDecision.weekKey)
      const decision = buildFieldWindowDecision({
        uid,
        window,
        timezone: preferences.timezone,
        now,
        proactiveMessagesThisWeek: count,
        maxPerWeek: preferences.maxPerWeek,
      })
      if (!decision) continue

      const eventRef = userCollection(uid, 'researchEvents').doc(decision.eventId)
      const outcomeRef = userCollection(uid, 'interventionOutcomes').doc(`outcome-${decision.eventId}`)
      const dispatchRef = db.collection('fieldWindowDispatches').doc(decision.eventId)
      const didCreate = await db.runTransaction(async transaction => {
        const existing = await transaction.get(eventRef)
        if (existing.exists) return false
        transaction.create(eventRef, buildFieldWindowResearchEvent(decision, now))
        if (decision.arm === 'field_no_contact') {
          transaction.create(outcomeRef, outcomeForFieldWindow({
            eventId: decision.eventId,
            arm: decision.arm,
            windowLabel: decision.windowLabel,
            now,
          }))
        } else {
          transaction.create(dispatchRef, {
            uid,
            eventId: decision.eventId,
            windowId: decision.windowId,
            windowLabel: decision.windowLabel,
            purpose: decision.purpose,
            status: 'pending',
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          } satisfies FieldWindowDispatchDoc)
        }
        return true
      })
      if (didCreate) created++
    }
  }
  return created
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
    const created = await scheduleFieldWindows()
    if (created > 0) console.info(`[field-windows] created=${created}`)
  },
)

async function cancelDispatch(
  ref: FirebaseFirestore.DocumentReference,
  queued: FieldWindowDispatchDoc,
  reason: string,
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
    const ref = event.data.ref
    const queued = await claimDispatch(ref)
    if (!queued) return

    const [preferencesSnap, phone] = await Promise.all([
      userCollection(queued.uid, 'companionPreferences').doc('current').get(),
      getOutboundPhone(queued.uid),
    ])
    const preferences = validPreferences(
      preferencesSnap.exists
        ? (preferencesSnap.data() as CompanionPreferencesDoc).fieldWindows
        : null,
    )
    if (!phone || !canDeliverFieldWindow({
      preferences,
      windowId: queued.windowId,
      hasLinkedPhone: true,
    })) {
      await cancelDispatch(ref, queued, 'opt_in_or_link_removed')
      return
    }

    try {
      const body = fieldWindowMessage(queued.purpose)
      const client = twilio(twilioAccountSid.value(), twilioAuthToken.value())
      const outbound = await client.messages.create({
        from: TWILIO_PHONE_NUMBER,
        to: phone,
        body,
      })
      const sentAt = Date.now()
      const batch = getFirestore().batch()
      batch.set(userCollection(queued.uid, 'smsMessages').doc(outbound.sid), {
        id: outbound.sid,
        providerSid: outbound.sid,
        channel: 'sms',
        direction: 'outbound',
        body,
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
        sourceId: outbound.sid,
        outcomeId: `outcome-${queued.eventId}`,
        deliveredAt: sentAt,
        updatedAt: sentAt,
      })
      batch.update(ref, {
        status: 'completed',
        outboundSid: outbound.sid,
        completedAt: sentAt,
        updatedAt: sentAt,
      })
      await batch.commit()
    } catch (error) {
      // A proactive message is attempted at most once. Provider timeouts are
      // ambiguous, so automatic retry could create an intrusive duplicate.
      const category = error instanceof Error ? error.name : 'unknown'
      console.error(`[field-windows] send failed category=${category}`)
      await ref.update({
        status: 'terminal_failed',
        lastError: category,
        updatedAt: Date.now(),
      })
    }
  },
)
