import type { Response } from 'express'
import type { Request } from 'firebase-functions/v2/https'
import { onRequest } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ALLOWED_ORIGINS } from './shared/cors.js'
import { verifyAuth } from './shared/auth.js'

async function deleteCollection(uid: string, collName: string) {
  const db = getFirestore()
  const collRef = db.collection('users').doc(uid).collection(collName)
  let snap = await collRef.limit(500).get()
  while (snap.docs.length > 0) {
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    snap = await collRef.limit(500).get()
  }
}

type AccountAction = 'deleteAccount' | 'submitContact'

type AccountHandler = (
  uid: string,
  params: Record<string, unknown>,
  res: Response,
) => Promise<void>

async function handleDeleteAccount(uid: string, _params: Record<string, unknown>, res: Response): Promise<void> {
  const collections = [
    'entries', 'parts', 'memories', 'thoughts', 'interactions',
    'entrySummaries', 'userProfile', 'personalFacts', 'fossils', 'letters',
    'sessionLog', 'innerWeather', 'consent', 'sessions',
    'hrvSessions', 'relaxSessions', 'diagnostics',
  ]
  for (const coll of collections) {
    await deleteCollection(uid, coll)
  }
  // Delete session message subcollections
  const sessionsSnap = await getFirestore()
    .collection('users').doc(uid).collection('sessions').get()
  for (const sessionDoc of sessionsSnap.docs) {
    const messagesSnap = await sessionDoc.ref.collection('messages').get()
    if (messagesSnap.docs.length > 0) {
      const batch = getFirestore().batch()
      messagesSnap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
    }
  }
  // Delete top-level contactMessages by this user
  const contactSnap = await getFirestore()
    .collection('contactMessages')
    .where('uid', '==', uid)
    .get()
  if (contactSnap.docs.length > 0) {
    const batch = getFirestore().batch()
    contactSnap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  await getFirestore().collection('users').doc(uid).delete()
  await getAuth().deleteUser(uid)
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
