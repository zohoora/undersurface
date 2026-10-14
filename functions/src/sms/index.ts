import type { Request, Response } from 'express'
import { FieldValue, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import twilio from 'twilio'
import { openAiKey, twilioAccountSid, twilioAuthToken } from '../shared/secrets.js'
import { detectCrisisKeywords } from '../shared/crisisFloor.js'
import { makeRateLimiter } from '../shared/rateLimit.js'
import {
  SMS_CRISIS_RESPONSE,
  SMS_DAILY_LIMIT_RESPONSE,
  SMS_HELP,
  SMS_MEDIA_UNAVAILABLE_RESPONSE,
  SMS_PAUSED_RESPONSE,
  SMS_UNAVAILABLE_RESPONSE,
  TWILIO_PHONE_NUMBER,
  TWILIO_WEBHOOK_URL,
  normalizePhone,
  parseSmsBody,
  renderTwiml,
} from './field.js'
import {
  getLinkedUid,
  linkPhoneByCode,
  unlinkPhone,
} from './linking.js'
import {
  fetchTwilioImages,
  parseTwilioMedia,
  type SmsImageInput,
  type SmsMediaDescriptor,
} from './media.js'
import {
  classifySmsCrisis,
  generateSmsTurn,
  type SmsHistoryMessage,
  type SmsTurnResult,
} from './openai.js'
import { loadSmsCompanionContext, type LoadedSmsCompanionContext } from './context.js'
import type { CompanionResponseMode } from '../shared/companionKernel.js'
import { persistSmsMomentMedia } from './moments.js'
import { buildSmsResearchEvent } from './research.js'
import {
  classifyTwilioSendError,
  deleteTwilioMedia,
  twilioErrorCategory,
} from './delivery.js'
import {
  isAccountDeleting,
  isSmsEnabled,
  readRecentCrisis,
  recordSmsRisk,
  reserveDailySmsTurn,
  revokeFieldWindowConsent,
} from './state.js'

const MAX_INBOUND_CHARS = 1600
const MAX_PROCESSING_ATTEMPTS = 3
const PROCESSING_LEASE_MS = 2 * 60_000
/**
 * Horizon for the `expireAt` field on top-level smsInbound queue docs. Message
 * content is cleared at completion; a Firestore TTL policy on `expireAt`
 * removes the remaining envelope.
 */
export const SMS_INBOUND_RETENTION_MS = 30 * 86_400_000
const NOT_LINKED_RESPONSE = 'This phone is not linked yet. In UnderSurface, open Settings → SMS field notes and create a link code.'
const checkWebhookRateLimit = makeRateLimiter({ windowMs: 60_000, max: 30 })

/** Everything needed to finish a reply that already went out through Twilio. */
interface SmsDeliveryRecord {
  reply: string
  risk: 0 | 1 | 2
  fieldNote: string | null
  responseMode: CompanionResponseMode | null
  usedFallback: boolean
  createMoment: boolean
  sentAt: number
}

interface SmsInboundQueueDoc {
  uid: string
  from: string
  to: string
  body: string
  media: SmsMediaDescriptor[]
  rejectedMediaCount: number
  inboundMessageId: string
  receivedAt: number
  status: 'pending' | 'processing' | 'completed' | 'terminal_failed'
  attempts: number
  expireAt?: Timestamp
  processingStartedAt?: number
  /** 'sending' is written immediately before Twilio is called. */
  sendState?: 'sending' | 'sent' | 'rejected'
  outboundSid?: string
  delivery?: SmsDeliveryRecord
  budgetReservedAt?: number
}

function twilioParams(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === 'string') params[key] = value
    else if (typeof value === 'number') params[key] = String(value)
  }
  return params
}

function signatureHeader(req: Request): string {
  const value = req.headers['x-twilio-signature']
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function sendTwiml(res: Response, message?: string): void {
  res.status(200)
  res.setHeader('Content-Type', 'text/xml; charset=utf-8')
  res.send(renderTwiml(message))
}

function validMessageSid(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(value)
}

function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: number | string } | null)?.code
  return code === 6 || code === 'already-exists'
}

export function resolveGeneratedSmsTurn(
  baseRisk: 0 | 1,
  turn: SmsTurnResult,
): { risk: 0 | 1 | 2; reply: string; fieldNote: string | null; responseMode: CompanionResponseMode } {
  const risk = Math.max(baseRisk, turn.visualRisk) as 0 | 1 | 2
  return {
    risk,
    reply: risk === 2 ? SMS_CRISIS_RESPONSE : turn.reply,
    fieldNote: risk === 2 ? null : turn.fieldNote,
    responseMode: turn.responseMode,
  }
}

function userSmsMessages(uid: string) {
  return getFirestore().collection('users').doc(uid).collection('smsMessages')
}

/**
 * `create()`, not `set()`: a Twilio webhook redelivery must never overwrite a
 * message the processor already annotated with risk or a field note.
 */
async function storeInboundMessage(opts: {
  uid: string
  messageSid: string
  body: string
  mediaCount: number
  mediaTypes: string[]
  createdAt: number
  replyTo?: string
  fieldWindowEventId?: string
}): Promise<void> {
  try {
    await userSmsMessages(opts.uid).doc(opts.messageSid).create({
      id: opts.messageSid,
      channel: 'sms',
      direction: 'inbound',
      body: opts.body,
      mediaCount: opts.mediaCount,
      mediaTypes: opts.mediaTypes,
      mode: 'natural',
      createdAt: opts.createdAt,
      status: 'received',
      carryForward: false,
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts.fieldWindowEventId ? { fieldWindowEventId: opts.fieldWindowEventId } : {}),
    })
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
  }
}

async function recentFieldWindowOrigin(
  uid: string,
  receivedAt: number,
): Promise<{ messageId: string; eventId: string } | null> {
  const snap = await userSmsMessages(uid).orderBy('createdAt', 'desc').limit(12).get()
  const origin = snap.docs.map(doc => doc.data()).find(data => (
    data.direction === 'outbound'
    && data.mode === 'field_window'
    && typeof data.createdAt === 'number'
    && receivedAt >= data.createdAt
    && receivedAt - data.createdAt <= 6 * 60 * 60_000
    && typeof data.researchEventId === 'string'
  ))
  return origin
    ? { messageId: String(origin.id), eventId: String(origin.researchEventId) }
    : null
}

async function enqueueInbound(opts: {
  uid: string
  from: string
  to: string
  messageSid: string
  body: string
  media: SmsMediaDescriptor[]
  rejectedMediaCount: number
  receivedAt: number
}): Promise<void> {
  const queueRef = getFirestore().collection('smsInbound').doc(opts.messageSid)
  try {
    await queueRef.create({
      uid: opts.uid,
      from: opts.from,
      to: opts.to,
      body: opts.body,
      media: opts.media,
      rejectedMediaCount: opts.rejectedMediaCount,
      inboundMessageId: opts.messageSid,
      receivedAt: opts.receivedAt,
      status: 'pending',
      attempts: 0,
      expireAt: Timestamp.fromMillis(opts.receivedAt + SMS_INBOUND_RETENTION_MS),
    } satisfies SmsInboundQueueDoc)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
  }
}

/** Unlink a phone and revoke proactive-SMS consent for its account. */
async function disconnectPhone(phone: string, now: number): Promise<string | null> {
  const uid = await unlinkPhone(phone)
  if (uid) {
    try {
      await revokeFieldWindowConsent(uid, now)
    } catch (error) {
      // The link is already gone, so nothing further can be sent; a failed
      // consent write only matters if the writer re-links later.
      console.error(`[sms] consent revoke failed category=${errorCategory(error)}`)
    }
  }
  return uid
}

export async function handleSmsWebhook(req: Request, res: Response): Promise<void> {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const params = twilioParams(req.body)
    const signature = signatureHeader(req)
    if (!signature || !twilio.validateRequest(
      twilioAuthToken.value(),
      signature,
      TWILIO_WEBHOOK_URL,
      params,
    )) {
      res.status(403).json({ error: 'Invalid webhook signature' })
      return
    }

    const from = normalizePhone(params.From ?? '')
    const to = normalizePhone(params.To ?? '')
    const messageSid = params.MessageSid ?? params.SmsMessageSid ?? ''
    if (!from || to !== TWILIO_PHONE_NUMBER || !validMessageSid(messageSid)) {
      res.status(400).json({ error: 'Invalid message envelope' })
      return
    }

    const receivedAt = Date.now()
    const body = (params.Body ?? '').slice(0, MAX_INBOUND_CHARS)
    const media = parseTwilioMedia(params)
    const intent = body.trim() || media.declaredCount === 0
      ? parseSmsBody(body)
      : { kind: 'message' as const, text: '' }

    // Opt-out is honored first: before rate limiting, before the kill switch,
    // and whether or not the phone is linked.
    if (intent.kind === 'opt_out') {
      await disconnectPhone(from, receivedAt)
      // Twilio supplies the standardized opt-out response.
      sendTwiml(res)
      return
    }
    if (intent.kind === 'unlink') {
      // The disconnect itself is protective and idempotent, so it always runs.
      // The confirmation is a paid outbound SMS, so it respects the rate limit:
      // a flood of UNLINK texts must not become a flood of replies.
      const uid = await disconnectPhone(from, receivedAt)
      if (!checkWebhookRateLimit(from)) {
        sendTwiml(res)
        return
      }
      sendTwiml(res, uid ? 'This phone has been disconnected from UnderSurface.' : NOT_LINKED_RESPONSE)
      return
    }

    if (!checkWebhookRateLimit(from)) {
      sendTwiml(res, 'Too many messages arrived at once. Please wait a minute and try again.')
      return
    }

    if (!await isSmsEnabled()) {
      sendTwiml(res, SMS_PAUSED_RESPONSE)
      return
    }

    if (intent.kind === 'link') {
      const result = await linkPhoneByCode(from, intent.code, receivedAt)
      if (!result.ok) {
        sendTwiml(res, result.reason === 'expired'
          ? 'That link code expired. Create a new one in UnderSurface Settings.'
          : 'That link code is not valid. Check the code or create a new one in UnderSurface Settings.')
        return
      }
      sendTwiml(res, `UnderSurface is connected to this phone. ${SMS_HELP}`)
      return
    }

    if (intent.kind === 'invalid_link') {
      sendTwiml(res, 'Use LINK followed by the six-character code shown in UnderSurface Settings.')
      return
    }

    const uid = await getLinkedUid(from)
    if (!uid) {
      sendTwiml(res, NOT_LINKED_RESPONSE)
      return
    }

    if (intent.kind === 'help') {
      sendTwiml(res, SMS_HELP)
      return
    }
    if (!intent.text && media.images.length === 0) {
      sendTwiml(res, SMS_MEDIA_UNAVAILABLE_RESPONSE)
      return
    }
    const fieldWindowOrigin = await recentFieldWindowOrigin(uid, receivedAt).catch(() => null)
    await storeInboundMessage({
      uid,
      messageSid,
      body: intent.text,
      mediaCount: media.declaredCount,
      mediaTypes: media.images.map(item => item.contentType),
      createdAt: receivedAt,
      ...(fieldWindowOrigin ? {
        replyTo: fieldWindowOrigin.messageId,
        fieldWindowEventId: fieldWindowOrigin.eventId,
      } : {}),
    })
    await enqueueInbound({
      uid,
      from,
      to,
      messageSid,
      body: intent.text,
      media: media.images,
      rejectedMediaCount: media.rejectedCount,
      receivedAt,
    })
    sendTwiml(res)
}

export const smsApi = onRequest(
  {
    secrets: [twilioAuthToken],
    memory: '256MiB',
    timeoutSeconds: 30,
    region: 'us-central1',
  },
  handleSmsWebhook,
)

/**
 * Fields cleared when a queue doc reaches a final state: the message body,
 * sender number, pending reply, and media URLs are not retained top-level.
 */
function retentionClear(now: number): Record<string, unknown> {
  return {
    body: FieldValue.delete(),
    from: FieldValue.delete(),
    delivery: FieldValue.delete(),
    media: [],
    mediaPurgedAt: now,
    updatedAt: now,
  }
}

type ClaimResult =
  | { kind: 'process'; queued: SmsInboundQueueDoc }
  | { kind: 'closed'; queued: SmsInboundQueueDoc }

async function claimQueueDoc(ref: FirebaseFirestore.DocumentReference): Promise<ClaimResult | null> {
  const db = getFirestore()
  const now = Date.now()
  return db.runTransaction(async transaction => {
    const snap = await transaction.get(ref)
    if (!snap.exists) return null
    const data = snap.data() as SmsInboundQueueDoc
    if (data.status === 'completed' || data.status === 'terminal_failed') return null
    if (data.status === 'processing' && now - (data.processingStartedAt ?? now) < PROCESSING_LEASE_MS) {
      return null
    }
    if (data.sendState === 'sending' && !data.outboundSid) {
      // An earlier attempt reached Twilio but never recorded the result. The
      // reply may have been delivered, so it is never sent again.
      transaction.update(ref, { status: 'terminal_failed', lastError: 'ambiguous_send', ...retentionClear(now) })
      return { kind: 'closed', queued: data }
    }
    const attempts = (data.attempts ?? 0) + 1
    if (attempts > MAX_PROCESSING_ATTEMPTS) {
      transaction.update(ref, { status: 'terminal_failed', attempts, lastError: 'attempts_exhausted', ...retentionClear(now) })
      return { kind: 'closed', queued: data }
    }
    transaction.update(ref, {
      status: 'processing',
      attempts,
      processingStartedAt: now,
      updatedAt: now,
    })
    return { kind: 'process', queued: { ...data, attempts, status: 'processing', processingStartedAt: now } }
  })
}

async function recentSmsHistory(uid: string, currentMessageId: string): Promise<SmsHistoryMessage[]> {
  const snap = await userSmsMessages(uid)
    .orderBy('createdAt', 'desc')
    .limit(12)
    .get()
  return snap.docs
    .map(doc => doc.data() as DocumentData)
    .filter(data => data.id !== currentMessageId)
    .filter(data => data.direction === 'inbound' || data.direction === 'outbound')
    .filter(data => typeof data.body === 'string' && typeof data.createdAt === 'number')
    .slice(0, 8)
    .reverse()
    .map(data => ({
      direction: data.direction as 'inbound' | 'outbound',
      body: (data.body as string).trim() || (Number(data.mediaCount) > 0 ? '[Image shared]' : ''),
      createdAt: data.createdAt as number,
    }))
}

function errorCategory(error: unknown): string {
  if (error instanceof Error && /^openai_\d+$/.test(error.message)) return error.message
  if (error instanceof Error && (error.message === 'openai_empty' || error.message === 'openai_malformed')) return error.message
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'number' || typeof code === 'string') return `provider_${String(code).slice(0, 40)}`
  return 'unknown'
}

function twilioClient() {
  return twilio(twilioAccountSid.value(), twilioAuthToken.value())
}

/** Best-effort removal of this message's MMS media at Twilio. */
async function cleanupTwilioMedia(queued: SmsInboundQueueDoc): Promise<void> {
  if (!queued.media?.length) return
  try {
    await deleteTwilioMedia({
      client: twilioClient(),
      media: queued.media,
      accountSid: twilioAccountSid.value(),
      messageSid: queued.inboundMessageId,
    })
  } catch (error) {
    console.error(`[sms] media cleanup failed category=${twilioErrorCategory(error)}`)
  }
}

/** Drop a job whose account is being deleted or whose phone was unlinked. */
async function dropJob(
  ref: FirebaseFirestore.DocumentReference,
  queued: SmsInboundQueueDoc,
  reason: 'account_deleting' | 'link_removed',
): Promise<void> {
  console.info(`[sms] job dropped reason=${reason}`)
  await ref.delete()
  await cleanupTwilioMedia(queued)
}

async function recordRiskSafely(uid: string, risk: 0 | 1 | 2, now: number): Promise<void> {
  if (risk < 1) return
  try {
    await recordSmsRisk(uid, risk, now)
  } catch (error) {
    console.error(`[sms] risk state write failed category=${errorCategory(error)}`)
  }
}

interface ReplyPlan extends Omit<SmsDeliveryRecord, 'sentAt'> {
  momentImages: SmsImageInput[]
}

function fixedReply(reply: string, risk: 0 | 1 | 2, usedFallback: boolean): ReplyPlan {
  return { reply, risk, fieldNote: null, responseMode: null, usedFallback, createMoment: false, momentImages: [] }
}

async function planReply(
  ref: FirebaseFirestore.DocumentReference,
  queued: SmsInboundQueueDoc,
  now: number,
): Promise<ReplyPlan> {
  let risk: 0 | 1 | 2 = detectCrisisKeywords(queued.body) ? 2 : 0

  if (!await isSmsEnabled()) {
    // Kill switch: no classifier or companion model calls. The synchronous L1
    // floor still answers explicit crisis language with the fixed response.
    await recordRiskSafely(queued.uid, risk, now)
    return risk === 2
      ? fixedReply(SMS_CRISIS_RESPONSE, 2, false)
      : fixedReply(SMS_PAUSED_RESPONSE, 0, true)
  }

  if (risk === 0 && queued.body.trim()) {
    const classified = await classifySmsCrisis(queued.body, openAiKey.value())
    if (classified.failOpen) {
      // Distinct from a genuine 0: L1 remains the floor, but an outage of the
      // contextual classifier must be visible in logs.
      console.warn(`[sms] crisis classifier fail-open category=${classified.failOpen}`)
    }
    risk = classified.risk
  }
  await recordRiskSafely(queued.uid, risk, now)
  if (risk === 2) return fixedReply(SMS_CRISIS_RESPONSE, 2, false)

  // Crisis-adjacent turns (risk 1) are exempt from the daily budget.
  if (risk === 0 && !await reserveDailySmsTurn(queued.uid, ref, now)) {
    return fixedReply(SMS_DAILY_LIMIT_RESPONSE, 0, true)
  }

  try {
    const [history, loaded, fetched, recentCrisis] = await Promise.all([
      recentSmsHistory(queued.uid, queued.inboundMessageId),
      // Context is valuable but never allowed to make the SMS transport
      // unavailable. A bounded, empty context preserves graceful
      // degradation if one of the optional collections cannot be read.
      loadSmsCompanionContext(queued.uid, getFirestore(), now).catch((error): LoadedSmsCompanionContext => {
        console.error(`[sms] companion context unavailable category=${errorCategory(error)}`)
        return { context: {}, timezone: null }
      }),
      fetchTwilioImages({
        media: queued.media ?? [],
        accountSid: twilioAccountSid.value(),
        authToken: twilioAuthToken.value(),
        messageSid: queued.inboundMessageId,
      }),
      // Unknown crisis state grounds the reply: the safe direction.
      readRecentCrisis(queued.uid, now).catch(error => {
        console.error(`[sms] crisis state unavailable category=${errorCategory(error)}`)
        return true
      }),
    ])
    const failedImageCount = (queued.rejectedMediaCount ?? 0) + fetched.failedCount
    if (!queued.body.trim() && fetched.images.length === 0 && failedImageCount > 0) {
      return fixedReply(SMS_MEDIA_UNAVAILABLE_RESPONSE, risk, false)
    }
    const turn = await generateSmsTurn({
      text: queued.body,
      risk,
      history,
      images: fetched.images,
      failedImageCount,
      companionContext: loaded.context,
      grounding: risk >= 1 || recentCrisis,
      timezone: loaded.timezone,
      now,
      apiKey: openAiKey.value(),
    })
    const resolved = resolveGeneratedSmsTurn(risk, turn)
    if (resolved.risk > risk) await recordRiskSafely(queued.uid, resolved.risk, now)
    return {
      reply: resolved.reply,
      risk: resolved.risk,
      fieldNote: resolved.fieldNote,
      responseMode: resolved.responseMode,
      usedFallback: false,
      createMoment: resolved.fieldNote !== null && loaded.context.fieldMosaicEnabled !== false,
      momentImages: fetched.images,
    }
  } catch (error) {
    console.error(`[sms] reply generation failed category=${errorCategory(error)}`)
    return fixedReply(SMS_UNAVAILABLE_RESPONSE, risk, true)
  }
}

/**
 * Everything after a successful Twilio send. Safe to re-run on a retried
 * claim: every write is a deterministic set/update, and nothing here sends.
 */
async function finishDelivery(
  ref: FirebaseFirestore.DocumentReference,
  queued: SmsInboundQueueDoc,
  outboundSid: string,
  delivery: SmsDeliveryRecord,
  momentImages: SmsImageInput[],
): Promise<void> {
  const db = getFirestore()
  const momentId = queued.inboundMessageId
  const researchEventId = delivery.responseMode && !delivery.usedFallback && delivery.risk < 2
    ? `research-sms-${queued.inboundMessageId}`
    : null
  let mediaPaths: string[] = []
  if (delivery.createMoment && momentImages.length > 0) {
    try {
      mediaPaths = await persistSmsMomentMedia(queued.uid, momentId, momentImages)
    } catch (error) {
      // The moment keeps its text; a failed image upload must not fail (and
      // so retry) a reply that has already been delivered.
      console.error(`[sms] moment media upload failed category=${errorCategory(error)}`)
    }
  }
  const batch = db.batch()
  batch.set(userSmsMessages(queued.uid).doc(outboundSid), {
    id: outboundSid,
    providerSid: outboundSid,
    channel: 'sms',
    direction: 'outbound',
    body: delivery.reply,
    mode: 'natural',
    createdAt: delivery.sentAt,
    status: 'sent',
    risk: delivery.risk,
    usedFallback: delivery.usedFallback,
    replyTo: queued.inboundMessageId,
    ...(delivery.responseMode ? { responseMode: delivery.responseMode } : {}),
    ...(researchEventId ? { researchEventId } : {}),
  })
  batch.update(userSmsMessages(queued.uid).doc(queued.inboundMessageId), {
    status: 'processed',
    risk: delivery.risk,
    carryForward: delivery.fieldNote !== null,
    fieldNote: delivery.fieldNote,
    fieldNoteSelectedAt: delivery.sentAt,
    mediaProcessed: (queued.media?.length ?? 0) > 0,
    processedAt: delivery.sentAt,
    ...(delivery.responseMode ? { responseMode: delivery.responseMode } : {}),
    ...(researchEventId ? { researchEventId } : {}),
  })
  if (delivery.createMoment) {
    batch.set(
      db.collection('users').doc(queued.uid).collection('fieldMoments').doc(momentId),
      {
        id: momentId,
        source: 'sms',
        sourceId: queued.inboundMessageId,
        text: delivery.fieldNote,
        createdAt: queued.receivedAt,
        mediaPaths,
        status: 'unreviewed',
        ...(delivery.responseMode ? { responseMode: delivery.responseMode } : {}),
        ...(researchEventId ? { researchEventId } : {}),
      },
    )
  }
  if (researchEventId && delivery.responseMode) {
    batch.set(
      db.collection('users').doc(queued.uid).collection('researchEvents').doc(researchEventId),
      buildSmsResearchEvent(queued.inboundMessageId, outboundSid, delivery.responseMode, delivery.sentAt),
    )
  }
  const completedAt = Date.now()
  batch.update(ref, {
    status: 'completed',
    risk: delivery.risk,
    outboundSid,
    sendState: 'sent',
    completedAt,
    ...retentionClear(completedAt),
  })
  await batch.commit()
  await cleanupTwilioMedia(queued)
}

export async function processSmsInbound(ref: FirebaseFirestore.DocumentReference): Promise<void> {
  const claim = await claimQueueDoc(ref)
  if (!claim) return
  if (claim.kind === 'closed') {
    await cleanupTwilioMedia(claim.queued)
    return
  }
  const queued = claim.queued

  try {
    // Account deletion tombstones the user doc first. Nothing may be written
    // under users/{uid} (or sent) once deletion has begun.
    if (await isAccountDeleting(queued.uid)) {
      await dropJob(ref, queued, 'account_deleting')
      return
    }

    if (queued.outboundSid && queued.delivery) {
      // A retried claim after a successful send: never regenerate or resend;
      // only finish the remaining writes.
      await finishDelivery(ref, queued, queued.outboundSid, queued.delivery, [])
      return
    }

    // STOP/UNLINK (or a re-link elsewhere) after this message was queued.
    if (await getLinkedUid(queued.from) !== queued.uid) {
      await dropJob(ref, queued, 'link_removed')
      return
    }

    const now = Date.now()
    const plan = await planReply(ref, queued, now)

    // Generation can take seconds; re-check the tombstone right before sending.
    if (await isAccountDeleting(queued.uid)) {
      await dropJob(ref, queued, 'account_deleting')
      return
    }

    await ref.update({ sendState: 'sending', updatedAt: Date.now() })
    let outboundSid: string
    const send = () => twilioClient().messages.create({
      from: TWILIO_PHONE_NUMBER,
      to: queued.from,
      body: plan.reply,
    })
    try {
      let outbound: Awaited<ReturnType<typeof send>>
      try {
        outbound = await send()
      } catch (firstError) {
        // The fixed crisis reply is the one message where a duplicate is far
        // better than a miss: on an ambiguous failure, send it once more now.
        if (plan.risk !== 2 || classifyTwilioSendError(firstError) !== 'ambiguous') throw firstError
        console.error(`[sms] crisis send ambiguous; resending once category=${twilioErrorCategory(firstError)}`)
        outbound = await send()
      }
      outboundSid = outbound.sid
    } catch (error) {
      const failure = classifyTwilioSendError(error)
      const category = twilioErrorCategory(error)
      if (failure === 'retryable') {
        // Definitely not sent (429): clear the marker and let the trigger retry.
        await ref.update({ sendState: FieldValue.delete(), updatedAt: Date.now() })
        throw error
      }
      // terminal: a definite rejection such as 21610 (unsubscribed).
      // ambiguous: the message may have gone out; never resend it.
      console.error(`[sms] send failed kind=${failure} category=${category}`)
      await ref.update({
        status: 'terminal_failed',
        lastError: failure === 'terminal' ? category : 'ambiguous_send',
        ...(failure === 'terminal' ? { sendState: 'rejected' } : {}),
        ...retentionClear(Date.now()),
      })
      await cleanupTwilioMedia(queued)
      return
    }

    const { momentImages, ...rest } = plan
    const delivery: SmsDeliveryRecord = { ...rest, sentAt: Date.now() }
    await ref.update({ outboundSid, sendState: 'sent', delivery, updatedAt: delivery.sentAt })
    // Deletion may have begun while the reply was in flight: never write
    // under users/{uid} (media upload, transcript) once it has.
    if (await isAccountDeleting(queued.uid)) {
      await dropJob(ref, queued, 'account_deleting')
      return
    }
    await finishDelivery(ref, queued, outboundSid, delivery, momentImages)
  } catch (error) {
    const category = errorCategory(error)
    console.error(`[sms] processing failed attempt=${queued.attempts} category=${category}`)
    const terminal = queued.attempts >= MAX_PROCESSING_ATTEMPTS
    const now = Date.now()
    await ref.update({
      status: terminal ? 'terminal_failed' : 'pending',
      ...(terminal ? retentionClear(now) : {}),
      lastError: category,
      updatedAt: now,
    })
    if (!terminal) throw error
    await cleanupTwilioMedia(queued)
  }
}

export const smsInboundProcessor = onDocumentCreated(
  {
    document: 'smsInbound/{messageSid}',
    secrets: [openAiKey, twilioAccountSid, twilioAuthToken],
    memory: '256MiB',
    timeoutSeconds: 120,
    region: 'us-central1',
    retry: true,
  },
  async event => {
    if (!event.data) return
    await processSmsInbound(event.data.ref)
  },
)
