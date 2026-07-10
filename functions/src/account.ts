import type { Response } from 'express'
import type { Request } from 'firebase-functions/v2/https'
import { onRequest } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import type { CollectionReference, Query } from 'firebase-admin/firestore'
import { ALLOWED_ORIGINS } from './shared/cors.js'
import { verifyAuth } from './shared/auth.js'
import { USER_SUBCOLLECTIONS } from './shared/collections.js'
import {
  createSmsLinkCode,
  getSmsStatus,
  unlinkSms,
} from './sms/linking.js'

// Delete every doc matched by a collection ref or query, in batches, until the
// query returns empty. Idempotent: re-running on an already-empty collection is
// a no-op, so the whole deletion flow is safely retryable.
async function deleteQuery(source: CollectionReference | Query) {
  const db = getFirestore()
  let snap = await source.limit(500).get()
  while (snap.docs.length > 0) {
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    snap = await source.limit(500).get()
  }
}

async function deleteCollection(uid: string, collName: string) {
  await deleteQuery(getFirestore().collection('users').doc(uid).collection(collName))
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
//   1. tombstone the user doc first (marks intent; client rules deny access)
//   2. delete the sessions/messages subcollections before their parent docs
//   3. delete every user subcollection (registry-driven, includes apiKeys)
//   4. delete the user's private Storage objects + top-level docs
//   5. delete the user doc (parent last)
//   6. delete the Auth user last, tolerating already-deleted
// Every step is idempotent, so a retry re-runs cleanly against partial state.
export async function handleDeleteAccount(uid: string, _params: Record<string, unknown>, res: Response): Promise<void> {
  const db = getFirestore()
  const userRef = db.collection('users').doc(uid)

  // 1. Tombstone-first.
  await userRef.set({ status: 'deleting', deletedAt: Date.now() }, { merge: true })

  // 2. sessions/{id}/messages before the sessions docs themselves.
  const sessionsSnap = await userRef.collection('sessions').get()
  for (const sessionDoc of sessionsSnap.docs) {
    await deleteQuery(sessionDoc.ref.collection('messages'))
  }

  // SMS linkage lives partly outside users/{uid}; remove it while smsSettings
  // still exists, then clean any orphaned mapping/queue docs by uid.
  await unlinkSms(uid)
  await deleteQuery(db.collection('smsPhoneLinks').where('uid', '==', uid))
  await deleteQuery(db.collection('smsLinkCodes').where('uid', '==', uid))
  await deleteQuery(db.collection('smsInbound').where('uid', '==', uid))
  await deleteQuery(db.collection('fieldWindowDispatches').where('uid', '==', uid))

  // 3. All user subcollections (single registry, includes apiKeys + SMS data).
  for (const coll of USER_SUBCOLLECTIONS) {
    await deleteCollection(uid, coll)
  }

  // 4. Private field-moment media and top-level records. deleteFiles is
  // prefix-idempotent: an already-empty prefix succeeds on retry.
  await getStorage().bucket().deleteFiles({ prefix: `field-moments/${uid}/` })
  await deleteQuery(db.collection('contactMessages').where('uid', '==', uid))
  await db.collection('quotas').doc(uid).delete()

  // 5. Parent user doc.
  await userRef.delete()

  // 6. Auth user — idempotent: a retry after this step already ran must not 500.
  try {
    await getAuth().deleteUser(uid)
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error
  }

  res.json({ success: true })
}

async function handleGetSmsStatus(uid: string, _params: Record<string, unknown>, res: Response): Promise<void> {
  res.json(await getSmsStatus(uid))
}

async function handleCreateSmsLinkCode(uid: string, _params: Record<string, unknown>, res: Response): Promise<void> {
  res.json(await createSmsLinkCode(uid))
}

async function handleUnlinkSms(uid: string, _params: Record<string, unknown>, res: Response): Promise<void> {
  await unlinkSms(uid)
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
    memory: '256MiB',
    timeoutSeconds: 60,
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
      console.error('Account API error:', error)
      res.status(500).json({ error: 'Request failed' })
    }
  },
)
