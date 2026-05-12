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

export async function verifyAdmin(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const decoded = await getAuth().verifyIdToken(authHeader.split('Bearer ')[1])
    if (decoded.email && ADMIN_EMAILS.includes(decoded.email)) return decoded.email
    return null
  } catch {
    return null
  }
}
