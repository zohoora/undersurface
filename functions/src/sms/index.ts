import type { Request, Response } from 'express'
import { getFirestore, type DocumentData } from 'firebase-admin/firestore'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import twilio from 'twilio'
import { openAiKey, twilioAccountSid, twilioAuthToken } from '../shared/secrets.js'
import { detectCrisisKeywords } from '../shared/crisisFloor.js'
import { makeRateLimiter } from '../shared/rateLimit.js'
import {
  SMS_CRISIS_RESPONSE,
  SMS_HELP,
  SMS_MEDIA_UNAVAILABLE_RESPONSE,
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
  type SmsMediaDescriptor,
} from './media.js'
import {
  classifySmsCrisis,
  generateSmsTurn,
  type SmsHistoryMessage,
  type SmsTurnResult,
} from './openai.js'
import { loadSmsCompanionContext } from './context.js'
import type { CompanionResponseMode, SharedCompanionContext } from '../shared/companionKernel.js'
import type { SmsImageInput } from './media.js'
import { persistSmsMomentMedia } from './moments.js'
import { buildSmsResearchEvent } from './research.js'

const MAX_INBOUND_CHARS = 1600
const MAX_PROCESSING_ATTEMPTS = 3
const PROCESSING_LEASE_MS = 2 * 60_000
const checkWebhookRateLimit = makeRateLimiter({ windowMs: 60_000, max: 30 })

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
  processingStartedAt?: number
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
  await userSmsMessages(opts.uid).doc(opts.messageSid).set({
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
    } satisfies SmsInboundQueueDoc)
  } catch (error) {
    const code = (error as { code?: number | string }).code
    if (code !== 6 && code !== 'already-exists') throw error
  }
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

    if (!checkWebhookRateLimit(from)) {
      sendTwiml(res, 'Too many messages arrived at once. Please wait a minute and try again.')
      return
    }

    const receivedAt = Date.now()
    const body = (params.Body ?? '').slice(0, MAX_INBOUND_CHARS)
    const media = parseTwilioMedia(params)
    const intent = body.trim() || media.declaredCount === 0
      ? parseSmsBody(body)
      : { kind: 'message' as const, text: '' }

    if (intent.kind === 'opt_out') {
      await unlinkPhone(from)
      // Twilio supplies the standardized opt-out response.
      sendTwiml(res)
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
      sendTwiml(res, 'This phone is not linked yet. In UnderSurface, open Settings → SMS field notes and create a link code.')
      return
    }

    if (intent.kind === 'unlink') {
      await unlinkPhone(from)
      sendTwiml(res, 'This phone has been disconnected from UnderSurface.')
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

async function claimQueueDoc(ref: FirebaseFirestore.DocumentReference): Promise<SmsInboundQueueDoc | null> {
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
    const attempts = (data.attempts ?? 0) + 1
    if (attempts > MAX_PROCESSING_ATTEMPTS) {
      transaction.update(ref, { status: 'terminal_failed', attempts, updatedAt: now })
      return null
    }
    transaction.update(ref, {
      status: 'processing',
      attempts,
      processingStartedAt: now,
      updatedAt: now,
    })
    return { ...data, attempts, status: 'processing', processingStartedAt: now }
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
    const ref = event.data.ref
    const queued = await claimQueueDoc(ref)
    if (!queued) return

    try {
      let risk: 0 | 1 | 2 = detectCrisisKeywords(queued.body) ? 2 : 0
      if (risk === 0 && queued.body.trim()) {
        const classified = await classifySmsCrisis(queued.body, openAiKey.value())
        risk = classified.risk
      }

      let reply: string
      let fieldNote: string | null = null
      let responseMode: CompanionResponseMode | undefined
      let momentImages: SmsImageInput[] = []
      let companionContext: SharedCompanionContext = {}
      let usedFallback = false
      if (risk === 2) {
        reply = SMS_CRISIS_RESPONSE
      } else {
        try {
          const [history, loadedContext, fetched] = await Promise.all([
            recentSmsHistory(queued.uid, queued.inboundMessageId),
            // Context is valuable but never allowed to make the SMS transport
            // unavailable. A bounded, empty context preserves graceful
            // degradation if one of the optional collections cannot be read.
            loadSmsCompanionContext(queued.uid).catch(error => {
              console.error(`[sms] companion context unavailable category=${errorCategory(error)}`)
              return {}
            }),
            fetchTwilioImages({
              media: queued.media ?? [],
              accountSid: twilioAccountSid.value(),
              authToken: twilioAuthToken.value(),
              messageSid: queued.inboundMessageId,
            }),
          ])
          companionContext = loadedContext
          momentImages = fetched.images
          const failedImageCount = (queued.rejectedMediaCount ?? 0) + fetched.failedCount
          if (!queued.body.trim() && fetched.images.length === 0 && failedImageCount > 0) {
            reply = SMS_MEDIA_UNAVAILABLE_RESPONSE
          } else {
            const turn = await generateSmsTurn({
              text: queued.body,
              risk,
              history,
              images: fetched.images,
              failedImageCount,
              companionContext,
              apiKey: openAiKey.value(),
            })
            const resolved = resolveGeneratedSmsTurn(risk, turn)
            risk = resolved.risk
            reply = resolved.reply
            fieldNote = resolved.fieldNote
            responseMode = resolved.responseMode
          }
        } catch (error) {
          usedFallback = true
          console.error(`[sms] reply generation failed category=${errorCategory(error)}`)
          reply = SMS_UNAVAILABLE_RESPONSE
        }
      }

      const client = twilio(twilioAccountSid.value(), twilioAuthToken.value())
      const outbound = await client.messages.create({
        from: TWILIO_PHONE_NUMBER,
        to: queued.from,
        body: reply,
      })
      const sentAt = Date.now()
      const momentId = queued.inboundMessageId
      const researchEventId = responseMode && !usedFallback && risk < 2
        ? `research-sms-${queued.inboundMessageId}`
        : null
      const shouldCreateMoment = fieldNote !== null && companionContext.fieldMosaicEnabled !== false
      const mediaPaths = shouldCreateMoment && momentImages.length > 0
        ? await persistSmsMomentMedia(queued.uid, momentId, momentImages)
        : []
      const batch = getFirestore().batch()
      batch.set(userSmsMessages(queued.uid).doc(outbound.sid), {
        id: outbound.sid,
        providerSid: outbound.sid,
        channel: 'sms',
        direction: 'outbound',
        body: reply,
        mode: 'natural',
        createdAt: sentAt,
        status: 'sent',
        risk,
        usedFallback,
        replyTo: queued.inboundMessageId,
        ...(responseMode ? { responseMode } : {}),
        ...(researchEventId ? { researchEventId } : {}),
      })
      batch.update(userSmsMessages(queued.uid).doc(queued.inboundMessageId), {
        status: 'processed',
        risk,
        carryForward: fieldNote !== null,
        fieldNote,
        fieldNoteSelectedAt: sentAt,
        mediaProcessed: (queued.media?.length ?? 0) > 0,
        processedAt: sentAt,
        ...(responseMode ? { responseMode } : {}),
        ...(researchEventId ? { researchEventId } : {}),
      })
      if (shouldCreateMoment) {
        batch.set(
          getFirestore().collection('users').doc(queued.uid).collection('fieldMoments').doc(momentId),
          {
            id: momentId,
            source: 'sms',
            sourceId: queued.inboundMessageId,
            text: fieldNote,
            createdAt: queued.receivedAt,
            mediaPaths,
            status: 'unreviewed',
            ...(responseMode ? { responseMode } : {}),
            ...(researchEventId ? { researchEventId } : {}),
          },
        )
      }
      if (researchEventId && responseMode) {
        const researchEvent = buildSmsResearchEvent(
          queued.inboundMessageId,
          outbound.sid,
          responseMode,
          sentAt,
        )
        batch.set(
          getFirestore().collection('users').doc(queued.uid).collection('researchEvents').doc(researchEventId),
          researchEvent,
        )
      }
      batch.update(ref, {
        status: 'completed',
        risk,
        outboundSid: outbound.sid,
        media: [],
        mediaPurgedAt: sentAt,
        completedAt: sentAt,
        updatedAt: sentAt,
      })
      await batch.commit()
    } catch (error) {
      const category = errorCategory(error)
      console.error(`[sms] processing failed attempt=${queued.attempts} category=${category}`)
      const terminal = queued.attempts >= MAX_PROCESSING_ATTEMPTS
      await ref.update({
        status: terminal ? 'terminal_failed' : 'pending',
        ...(terminal ? { media: [], mediaPurgedAt: Date.now() } : {}),
        lastError: category,
        updatedAt: Date.now(),
      })
      if (!terminal) throw error
    }
  },
)
