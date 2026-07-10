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
  SMS_UNAVAILABLE_RESPONSE,
  TWILIO_PHONE_NUMBER,
  TWILIO_WEBHOOK_URL,
  UNDERSURFACE_SESSION_URL,
  normalizePhone,
  parseSmsBody,
  renderTwiml,
} from './field.js'
import {
  getLinkedUid,
  linkPhoneByCode,
  unlinkPhone,
} from './linking.js'
import { classifySmsCrisis, generateSmsReply, type SmsHistoryMessage } from './openai.js'

const MAX_INBOUND_CHARS = 1600
const MAX_PROCESSING_ATTEMPTS = 3
const PROCESSING_LEASE_MS = 2 * 60_000
const checkWebhookRateLimit = makeRateLimiter({ windowMs: 60_000, max: 30 })

interface SmsInboundQueueDoc {
  uid: string
  from: string
  to: string
  body: string
  mode: 'exchange' | 'deep'
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

function userSmsMessages(uid: string) {
  return getFirestore().collection('users').doc(uid).collection('smsMessages')
}

async function storeInboundMessage(opts: {
  uid: string
  messageSid: string
  body: string
  mode: 'exchange' | 'deep' | 'capture'
  createdAt: number
}): Promise<void> {
  await userSmsMessages(opts.uid).doc(opts.messageSid).set({
    id: opts.messageSid,
    channel: 'sms',
    direction: 'inbound',
    body: opts.body,
    mode: opts.mode,
    createdAt: opts.createdAt,
    status: opts.mode === 'capture' ? 'captured' : 'received',
  })
}

async function enqueueInbound(opts: {
  uid: string
  from: string
  to: string
  messageSid: string
  body: string
  mode: 'exchange' | 'deep'
  receivedAt: number
}): Promise<void> {
  const queueRef = getFirestore().collection('smsInbound').doc(opts.messageSid)
  try {
    await queueRef.create({
      uid: opts.uid,
      from: opts.from,
      to: opts.to,
      body: opts.body,
      mode: opts.mode,
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
    const intent = parseSmsBody((params.Body ?? '').slice(0, MAX_INBOUND_CHARS))

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
    if (intent.kind === 'open') {
      sendTwiml(res, `Continue in UnderSurface: ${UNDERSURFACE_SESSION_URL}`)
      return
    }

    if (intent.kind === 'capture') {
      await storeInboundMessage({
        uid,
        messageSid,
        body: intent.text,
        mode: 'capture',
        createdAt: receivedAt,
      })
      sendTwiml(res, 'Saved as a field note. I will leave it there unless you bring it into a session.')
      return
    }

    await storeInboundMessage({
      uid,
      messageSid,
      body: intent.text,
      mode: intent.mode,
      createdAt: receivedAt,
    })
    await enqueueInbound({
      uid,
      from,
      to,
      messageSid,
      body: intent.text,
      mode: intent.mode,
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
      body: data.body as string,
      createdAt: data.createdAt as number,
    }))
}

function errorCategory(error: unknown): string {
  if (error instanceof Error && /^openai_\d+$/.test(error.message)) return error.message
  if (error instanceof Error && error.message === 'openai_empty') return error.message
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
      if (risk === 0) {
        const classified = await classifySmsCrisis(queued.body, openAiKey.value())
        risk = classified.risk
      }

      let reply: string
      let usedFallback = false
      if (risk === 2) {
        reply = SMS_CRISIS_RESPONSE
      } else {
        const history = await recentSmsHistory(queued.uid, queued.inboundMessageId)
        try {
          reply = await generateSmsReply({
            text: queued.body,
            mode: queued.mode,
            risk,
            history,
            apiKey: openAiKey.value(),
          })
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
      const batch = getFirestore().batch()
      batch.set(userSmsMessages(queued.uid).doc(outbound.sid), {
        id: outbound.sid,
        providerSid: outbound.sid,
        channel: 'sms',
        direction: 'outbound',
        body: reply,
        mode: queued.mode,
        createdAt: sentAt,
        status: 'sent',
        risk,
        usedFallback,
        replyTo: queued.inboundMessageId,
      })
      batch.update(userSmsMessages(queued.uid).doc(queued.inboundMessageId), {
        status: 'processed',
        risk,
        processedAt: sentAt,
      })
      batch.update(ref, {
        status: 'completed',
        risk,
        outboundSid: outbound.sid,
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
        lastError: category,
        updatedAt: Date.now(),
      })
      if (!terminal) throw error
    }
  },
)
