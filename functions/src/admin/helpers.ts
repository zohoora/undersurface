import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

export async function getCollectionDocs(uid: string, name: string) {
  const snap = await getFirestore().collection('users').doc(uid).collection(name).get()
  return snap.docs.map((d) => d.data())
}

export async function getCollectionCount(uid: string, name: string): Promise<number> {
  const snap = await getFirestore().collection('users').doc(uid).collection(name).count().get()
  return snap.data().count
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w: string) => w.length > 0).length
}

export function computeLastActive(
  entries: Array<{ updatedAt?: number }>,
  sessions: Array<{ startedAt?: number }>,
): number | null {
  let lastActive: number | null = null
  for (const e of entries) {
    const t = e.updatedAt || 0
    if (!lastActive || t > lastActive) lastActive = t
  }
  for (const s of sessions) {
    const t = s.startedAt || 0
    if (!lastActive || t > lastActive) lastActive = t
  }
  return lastActive
}

// Paginate through all Firebase Auth users (listUsers returns max 1000 per call)
export async function getAllUsers() {
  const allUsers: import('firebase-admin/auth').UserRecord[] = []
  let pageToken: string | undefined
  do {
    const result = await getAuth().listUsers(1000, pageToken)
    allUsers.push(...result.users)
    pageToken = result.pageToken
  } while (pageToken)
  return allUsers
}
