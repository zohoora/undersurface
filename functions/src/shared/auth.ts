import { getAuth } from 'firebase-admin/auth'

export const ADMIN_EMAILS = ['zohoora@gmail.com']

export async function verifyAuth(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const decoded = await getAuth().verifyIdToken(authHeader.split('Bearer ')[1])
    return decoded.uid
  } catch {
    return null
  }
}

// Like verifyAuth, but also resolves the caller's role in ONE token decode.
// Used by the quota path so it can apply per-role caps without a second verify.
export async function verifyAuthWithRole(
  authHeader: string | undefined,
): Promise<{ uid: string; role: 'admin' | 'standard' } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const decoded = await getAuth().verifyIdToken(authHeader.split('Bearer ')[1])
    const isAdmin = !!decoded.email && decoded.email_verified === true && ADMIN_EMAILS.includes(decoded.email)
    return { uid: decoded.uid, role: isAdmin ? 'admin' : 'standard' }
  } catch {
    return null
  }
}

export async function verifyAdmin(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const decoded = await getAuth().verifyIdToken(authHeader.split('Bearer ')[1])
    // email_verified is required: an unverified email claim must never grant
    // admin — it is the single credential guarding every user's raw data.
    if (decoded.email && decoded.email_verified === true && ADMIN_EMAILS.includes(decoded.email)) {
      return decoded.email
    }
    return null
  } catch {
    return null
  }
}
