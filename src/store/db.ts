import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  writeBatch,
  getCountFromServer,
  where,
  deleteDoc,
} from 'firebase/firestore'
import type { DocumentData } from 'firebase/firestore'
import { firestore } from '../firebase'
import { getAuth } from 'firebase/auth'
import { SEEDED_PARTS } from '../ai/partPrompts'

function getUid(): string {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')
  return user.uid
}

function userCollection(name: string) {
  return collection(firestore, 'users', getUid(), name)
}

function userDoc(collectionName: string, id: string) {
  return doc(firestore, 'users', getUid(), collectionName, id)
}

// Wrapper that mimics the Dexie API used throughout the codebase
function createCollectionProxy(name: string) {
  return {
    async add(data: DocumentData) {
      const id = data.id as string
      await setDoc(userDoc(name, id), data)
    },

    async get(id: string) {
      const snap = await getDoc(userDoc(name, id))
      return snap.exists() ? (snap.data() as DocumentData) : undefined
    },

    async update(id: string, partial: DocumentData) {
      await updateDoc(userDoc(name, id), partial)
    },

    async delete(id: string) {
      await deleteDoc(userDoc(name, id))
    },

    async bulkPut(items: DocumentData[]) {
      const batch = writeBatch(firestore)
      for (const item of items) {
        batch.set(userDoc(name, item.id as string), item)
      }
      await batch.commit()
    },

    async count() {
      const snap = await getCountFromServer(userCollection(name))
      return snap.data().count
    },

    async toArray() {
      const snap = await getDocs(userCollection(name))
      return snap.docs.map((d) => d.data())
    },

    orderBy(field: string) {
      return {
        reverse() {
          return {
            async toArray() {
              const q = query(userCollection(name), orderBy(field, 'desc'))
              const snap = await getDocs(q)
              return snap.docs.map((d) => d.data())
            },
          }
        },
        async toArray() {
          const q = query(userCollection(name), orderBy(field, 'asc'))
          const snap = await getDocs(q)
          return snap.docs.map((d) => d.data())
        },
      }
    },

    where(field: string) {
      return {
        equals(value: unknown) {
          return {
            async toArray() {
              const q = query(userCollection(name), where(field, '==', value))
              const snap = await getDocs(q)
              return snap.docs.map((d) => d.data())
            },
          }
        },
      }
    },
  }
}

export const db = {
  entries: createCollectionProxy('entries'),
  parts: createCollectionProxy('parts'),
  memories: createCollectionProxy('memories'),
  thoughts: createCollectionProxy('thoughts'),
  interactions: createCollectionProxy('interactions'),
  entrySummaries: createCollectionProxy('entrySummaries'),
  userProfile: createCollectionProxy('userProfile'),
  fossils: createCollectionProxy('fossils'),
  letters: createCollectionProxy('letters'),
  sessionLog: createCollectionProxy('sessionLog'),
  innerWeather: createCollectionProxy('innerWeather'),
  consent: createCollectionProxy('consent'),
}

export async function initializeDB() {
  const existingParts = await db.parts.count()
  if (existingParts === 0) {
    await db.parts.bulkPut(
      SEEDED_PARTS.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        colorLight: p.colorLight,
        ifsRole: p.ifsRole,
        voiceDescription: p.voiceDescription,
        concern: p.concern,
        systemPrompt: p.systemPrompt,
        isSeeded: p.isSeeded,
        createdAt: p.createdAt,
      })),
    )
  }
}

export function generateId(): string {
  return crypto.randomUUID()
}

export async function exportAllData() {
  const [entries, parts, memories, thoughts, interactions, entrySummaries, userProfile, fossils, letters, sessionLog, innerWeather, consent] = await Promise.all([
    db.entries.toArray(),
    db.parts.toArray(),
    db.memories.toArray(),
    db.thoughts.toArray(),
    db.interactions.toArray(),
    db.entrySummaries.toArray(),
    db.userProfile.toArray(),
    db.fossils.toArray(),
    db.letters.toArray(),
    db.sessionLog.toArray(),
    db.innerWeather.toArray(),
    db.consent.toArray(),
  ])

  const data = { entries, parts, memories, thoughts, interactions, entrySummaries, userProfile, fossils, letters, sessionLog, innerWeather, consent, exportedAt: new Date().toISOString() }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `undersurface-export-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}
