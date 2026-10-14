import type { Response } from 'express'
import type { Request } from 'firebase-functions/v2/https'
import { onRequest } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import type { DocumentReference, Query } from 'firebase-admin/firestore'
import twilio from 'twilio'
import { ALLOWED_ORIGINS } from './shared/cors.js'
import { verifyAuth } from './shared/auth.js'
import { twilioAccountSid, twilioAuthToken } from './shared/secrets.js'
import {
  createSmsLinkCode,
  getSmsStatus,
  unlinkSms,
} from './sms/linking.js'
import { revokeFieldWindowConsent } from './sms/state.js'

// Deletion tombstone, written to users/{uid} before anything is deleted:
//   { status: 'deleting', deletedAt: <ms epoch> }
// Server code that writes user data asynchronously (the SMS processor) must
// treat the user as gone when users/{uid}.status === 'deleting', OR when the
// Auth user no longer exists (getAuth().getUser(uid) → auth/user-not-found).
// The tombstone doc is the last thing removed, after the Auth user, so at
// every moment during and after deletion at least one of the two holds.
export const ACCOUNT_DELETION_STATUS = 'deleting'

// Delete every doc matched by a query, in batches, until the query returns
// empty. Idempotent: re-running on an already-empty query is a no-op.
async function deleteQuery(source: Query) {
  const db = getFirestore()
  let snap = await source.limit(500).get()
  while (snap.docs.length > 0) {
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    snap = await source.limit(500).get()
  }
}

// Category-only error label for logs: never a uid, phone number, SID, path,
// or provider message body.
function errorCategory(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'number' || typeof code === 'string') return `code_${String(code).slice(0, 40)}`
  const status = (error as { status?: unknown })?.status
  if (typeof status === 'number') return `status_${status}`
  return error instanceof Error ? error.name : 'unknown'
}

function isAuthUserMissing(error: unknown): boolean {
  return (error as { code?: string })?.code === 'auth/user-not-found'
}

// ── Twilio-side copies of the user's SMS/MMS ──────────────────────────────
// Twilio keeps every message body and MMS image until deleted. The SIDs are
// the doc ids in users/{uid}/smsMessages (inbound = Twilio MessageSid,
// outbound = the created message's sid).

// Twilio Message SIDs: SM (SMS) or MM (MMS) + 32 hex chars. smsMessages is
// client-writable until the rules fix lands, so only well-formed SIDs are sent
// to Twilio. SIDs are unguessable, so a planted id cannot name another user's
// message in practice.
const TWILIO_MESSAGE_SID = /^(?:SM|MM)[0-9a-f]{32}$/i
const MAX_TWILIO_MESSAGES_PER_DELETION = 2000
const TWILIO_CLEANUP_BUDGET_MS = 90_000
const TWILIO_CLEANUP_CONCURRENCY = 4

export interface TwilioMessageTarget {
  sid: string
  hasMedia: boolean
}

export interface TwilioCleanupClient {
  listMediaSids(messageSid: string): Promise<string[]>
  removeMedia(messageSid: string, mediaSid: string): Promise<void>
  removeMessage(messageSid: string): Promise<void>
}

export interface TwilioCleanupResult {
  deleted: number
  failed: number
  skipped: number
}

async function collectTwilioMessageTargets(userRef: DocumentReference): Promise<TwilioMessageTarget[]> {
  const snap = await userRef.collection('smsMessages').select('mediaCount').get()
  const targets: TwilioMessageTarget[] = []
  for (const doc of snap.docs) {
    if (!TWILIO_MESSAGE_SID.test(doc.id)) continue
    const mediaCount = doc.get('mediaCount')
    targets.push({ sid: doc.id, hasMedia: typeof mediaCount === 'number' && mediaCount > 0 })
    if (targets.length >= MAX_TWILIO_MESSAGES_PER_DELETION) break
  }
  return targets
}

function isNotFound(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown }
  return e?.status === 404 || e?.code === 20404
}

/**
 * Best-effort, time-bounded deletion of Twilio message records and their MMS
 * media. Never throws: a provider outage must not block erasing the user's
 * own data. Already-deleted resources count as deleted.
 */
export async function deleteTwilioMessages(
  targets: readonly TwilioMessageTarget[],
  client: TwilioCleanupClient,
  opts: { budgetMs?: number; concurrency?: number; now?: () => number } = {},
): Promise<TwilioCleanupResult> {
  const now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? TWILIO_CLEANUP_BUDGET_MS)
  const result: TwilioCleanupResult = { deleted: 0, failed: 0, skipped: 0 }
  let next = 0

  const deleteOne = async (target: TwilioMessageTarget) => {
    try {
      if (target.hasMedia) {
        const mediaSids = await client.listMediaSids(target.sid).catch((error: unknown) => {
          if (isNotFound(error)) return []
          throw error
        })
        for (const mediaSid of mediaSids) {
          await client.removeMedia(target.sid, mediaSid).catch((error: unknown) => {
            if (!isNotFound(error)) throw error
          })
        }
      }
      await client.removeMessage(target.sid).catch((error: unknown) => {
        if (!isNotFound(error)) throw error
      })
      result.deleted++
    } catch {
      result.failed++
    }
  }

  const worker = async () => {
    while (next < targets.length) {
      if (now() > deadline) {
        result.skipped += targets.length - next
        next = targets.length
        return
      }
      const target = targets[next++]
      await deleteOne(target)
    }
  }
  const workers = Math.max(1, Math.min(opts.concurrency ?? TWILIO_CLEANUP_CONCURRENCY, targets.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return result
}

function liveTwilioCleanupClient(): TwilioCleanupClient {
  const client = twilio(twilioAccountSid.value(), twilioAuthToken.value())
  return {
    listMediaSids: async (messageSid) =>
      (await client.messages(messageSid).media.list({ limit: 20 })).map(media => media.sid),
    removeMedia: async (messageSid, mediaSid) => {
      await client.messages(messageSid).media(mediaSid).remove()
    },
    removeMessage: async (messageSid) => {
      await client.messages(messageSid).remove()
    },
  }
}

async function cleanUpTwilioCopies(targets: readonly TwilioMessageTarget[]): Promise<void> {
  if (targets.length === 0) return
  try {
    const result = await deleteTwilioMessages(targets, liveTwilioCleanupClient())
    if (result.failed > 0 || result.skipped > 0) {
      console.warn(`[account] twilio-cleanup incomplete deleted=${result.deleted} failed=${result.failed} skipped=${result.skipped}`)
    }
  } catch (error) {
    // Secret access or client construction failed. Firestore erasure proceeds.
    console.warn(`[account] twilio-cleanup unavailable category=${errorCategory(error)}`)
  }
}

type AccountAction =
  | 'deleteAccount'
  | 'submitContact'
  | 'getSmsStatus'
  | 'createSmsLinkCode'
  | 'unlinkSms'

type AccountHandler = (
  uid: string,
  params: Record<string, unknown>,
  res: Response,
) => Promise<void>

// Full account deletion. Ordered for safe retry after a mid-way failure:
//   1. tombstone users/{uid} first (ACCOUNT_DELETION_STATUS; see above)
//   2. revoke refresh tokens so no device can mint a fresh ID token
//   3. snapshot the Twilio message SIDs while users/{uid}/smsMessages exists
//   4. unlink SMS and delete the top-level docs keyed by uid
//   5. delete the Twilio-side messages + MMS media (best effort, time-bounded)
//   6. recursiveDelete every subcollection under users/{uid} — registry-free,
//      so collections added later (or nested ones like sessions/{id}/messages)
//      can't be missed; the tombstone doc itself stays
//   7. delete private Storage objects, contact messages, and the quota doc
//   8. delete the Auth user, tolerating already-deleted
//   9. recursiveDelete(users/{uid}): removes the tombstone plus anything an
//      already-open tab wrote while steps 6-8 ran
// Every step is idempotent, so a retry re-runs cleanly against partial state
// (the caller's existing ID token stays verifiable for up to an hour).
export async function handleDeleteAccount(uid: string, _params: Record<string, unknown>, res: Response): Promise<void> {
  const db = getFirestore()
  const userRef = db.collection('users').doc(uid)

  // 1. Tombstone-first.
  await userRef.set({ status: ACCOUNT_DELETION_STATUS, deletedAt: Date.now() }, { merge: true })

  // 2. Sign out every device. Already-issued ID tokens live out their hour;
  // only security rules that honor the tombstone can close that window.
  try {
    await getAuth().revokeRefreshTokens(uid)
  } catch (error) {
    if (!isAuthUserMissing(error)) throw error
  }

  // 3. Provider SIDs must be read before the Firestore tree is gone.
  const twilioTargets = await collectTwilioMessageTargets(userRef)

  // 4. SMS linkage lives partly outside users/{uid}; remove it while
  // smsSettings still exists, then clean any orphaned mapping/queue docs.
  await unlinkSms(uid)
  await deleteQuery(db.collection('smsPhoneLinks').where('uid', '==', uid))
  await deleteQuery(db.collection('smsLinkCodes').where('uid', '==', uid))
  await deleteQuery(db.collection('smsInbound').where('uid', '==', uid))
  await deleteQuery(db.collection('fieldWindowDispatches').where('uid', '==', uid))

  // 5. Twilio copies. Never throws.
  await cleanUpTwilioCopies(twilioTargets)

  // 6. Everything nested under users/{uid}, leaving the tombstone doc.
  for (const collection of await userRef.listCollections()) {
    await db.recursiveDelete(collection)
  }

  // 7. Private field-moment media and top-level records. deleteFiles is
  // prefix-idempotent: an already-empty prefix succeeds on retry.
  await getStorage().bucket().deleteFiles({ prefix: `field-moments/${uid}/` })
  await deleteQuery(db.collection('contactMessages').where('uid', '==', uid))
  await db.collection('quotas').doc(uid).delete()

  // 8. Auth user — idempotent: a retry after this step already ran must not 500.
  try {
    await getAuth().deleteUser(uid)
  } catch (error) {
    if (!isAuthUserMissing(error)) throw error
  }

  // 9. Final sweep, tombstone last.
  await db.recursiveDelete(userRef)

  res.json({ success: true })
}

async function handleGetSmsStatus(uid: string, _params: Record<string, unknown>, res: Response): Promise<void> {
  res.json(await getSmsStatus(uid))
}

async function handleCreateSmsLinkCode(uid: string, _params: Record<string, unknown>, res: Response): Promise<void> {
  res.json(await createSmsLinkCode(uid))
}

export async function handleUnlinkSms(uid: string, _params: Record<string, unknown>, res: Response): Promise<void> {
  await unlinkSms(uid)
  // Disconnecting in Settings revokes proactive consent exactly like texting
  // STOP, so re-linking later never silently resumes field windows.
  await revokeFieldWindowConsent(uid, Date.now())
  res.json({ success: true })
}

async function handleSubmitContact(uid: string, params: Record<string, unknown>, res: Response): Promise<void> {
  const message = params.message
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'Message is required' })
    return
  }
  if (message.length > 5000) {
    res.status(400).json({ error: 'Message too long (max 5000 characters)' })
    return
  }
  const userRecord = await getAuth().getUser(uid)
  await getFirestore().collection('contactMessages').add({
    uid,
    email: userRecord.email || '',
    displayName: userRecord.displayName || '',
    message: message.trim(),
    createdAt: Date.now(),
  })
  res.json({ success: true })
}

const ACCOUNT_HANDLERS: Record<AccountAction, AccountHandler> = {
  deleteAccount: handleDeleteAccount,
  submitContact: handleSubmitContact,
  getSmsStatus: handleGetSmsStatus,
  createSmsLinkCode: handleCreateSmsLinkCode,
  unlinkSms: handleUnlinkSms,
}

export const accountApi = onRequest(
  {
    cors: ALLOWED_ORIGINS,
    // Twilio credentials are only used by deleteAccount, to erase the
    // provider-side copies of the user's SMS/MMS.
    secrets: [twilioAccountSid, twilioAuthToken],
    memory: '256MiB',
    // Deletion now includes a recursive Firestore delete and up to 90s of
    // Twilio cleanup; 60s was too tight for heavy accounts.
    timeoutSeconds: 300,
    region: 'us-central1',
  },
  async (req: Request, res: Response) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const uid = await verifyAuth(req.headers.authorization)
    if (!uid) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    if (!req.body || typeof req.body.action !== 'string') {
      res.status(400).json({ error: 'Missing action' })
      return
    }

    const { action, ...params } = req.body
    const handler = ACCOUNT_HANDLERS[action as AccountAction]
    if (!handler) {
      res.status(400).json({ error: `Unknown action: ${action}` })
      return
    }

    try {
      await handler(uid, params, res)
    } catch (error) {
      // Category only: errors from deletion can carry document paths (uid).
      console.error(`[account] ${action} failed category=${errorCategory(error)}`)
      res.status(500).json({ error: 'Request failed' })
    }
  },
)
