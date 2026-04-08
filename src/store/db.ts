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
  onSnapshot,
} from 'firebase/firestore'
import type { DocumentData } from 'firebase/firestore'
import { firestore } from '../firebase'
import { getAuth } from 'firebase/auth'
import { SEEDED_PARTS } from '../ai/partPrompts'
import type {
  DiaryEntry, Part, PartMemory, PartThought, ThinkingOutLoudInteraction,
  EntrySummary, UserProfile, EntryFossil, PartLetter, SessionLog,
  InnerWeather, ConsentRecord, Session, SessionMessage, ApiKey,
} from '../types'
import type { HrvSessionData, CameraHrvConsent } from '../types/hrv'

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
function createCollectionProxy<T extends DocumentData = DocumentData>(name: string) {
  return {
    async add(data: T) {
      const id = (data as DocumentData).id as string
      await setDoc(userDoc(name, id), data)
    },

    async get(id: string): Promise<T | undefined> {
      const snap = await getDoc(userDoc(name, id))
      return snap.exists() ? (snap.data() as T) : undefined
    },

    async update(id: string, partial: Partial<T>) {
      await updateDoc(userDoc(name, id), partial as DocumentData)
    },

    async delete(id: string) {
      await deleteDoc(userDoc(name, id))
    },

    async bulkPut(items: T[]) {
      const batch = writeBatch(firestore)
      for (const item of items) {
        batch.set(userDoc(name, (item as DocumentData).id as string), item)
      }
      await batch.commit()
    },

    async count() {
      const snap = await getCountFromServer(userCollection(name))
      return snap.data().count
    },

    async toArray(): Promise<T[]> {
      const snap = await getDocs(userCollection(name))
      return snap.docs.map((d) => d.data() as T)
    },

    orderBy(field: string) {
      return {
        reverse() {
          return {
            async toArray(): Promise<T[]> {
              const q = query(userCollection(name), orderBy(field, 'desc'))
              const snap = await getDocs(q)
              return snap.docs.map((d) => d.data() as T)
            },
          }
        },
        async toArray(): Promise<T[]> {
          const q = query(userCollection(name), orderBy(field, 'asc'))
          const snap = await getDocs(q)
          return snap.docs.map((d) => d.data() as T)
        },
      }
    },

    where(field: string) {
      return {
        equals(value: unknown) {
          return {
            async toArray(): Promise<T[]> {
              const q = query(userCollection(name), where(field, '==', value))
              const snap = await getDocs(q)
              return snap.docs.map((d) => d.data() as T)
            },
          }
        },
      }
    },
  }
}

export const db = {
  entries: createCollectionProxy<DiaryEntry>('entries'),
  parts: createCollectionProxy<Part>('parts'),
  memories: createCollectionProxy<PartMemory>('memories'),
  thoughts: createCollectionProxy<PartThought>('thoughts'),
  interactions: createCollectionProxy<ThinkingOutLoudInteraction>('interactions'),
  entrySummaries: createCollectionProxy<EntrySummary>('entrySummaries'),
  userProfile: createCollectionProxy<UserProfile>('userProfile'),
  fossils: createCollectionProxy<EntryFossil>('fossils'),
  letters: createCollectionProxy<PartLetter>('letters'),
  sessionLog: createCollectionProxy<SessionLog>('sessionLog'),
  innerWeather: createCollectionProxy<InnerWeather>('innerWeather'),
  consent: createCollectionProxy<ConsentRecord | CameraHrvConsent>('consent'),
  sessions: createCollectionProxy<Session>('sessions'),
  apiKeys: createCollectionProxy<ApiKey>('apiKeys'),
  hrvSessions: createCollectionProxy<HrvSessionData>('hrvSessions'),
}

export const sessionMessages = {
  async add(sessionId: string, data: SessionMessage) {
    const ref = doc(firestore, 'users', getUid(), 'sessions', sessionId, 'messages', data.id)
    await setDoc(ref, data)
  },

  async getAll(sessionId: string): Promise<SessionMessage[]> {
    const colRef = collection(firestore, 'users', getUid(), 'sessions', sessionId, 'messages')
    const q = query(colRef, orderBy('timestamp', 'asc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => d.data() as SessionMessage)
  },

  subscribe(sessionId: string, callback: (messages: SessionMessage[]) => void) {
    const colRef = collection(firestore, 'users', getUid(), 'sessions', sessionId, 'messages')
    const q = query(colRef, orderBy('timestamp', 'asc'))
    return onSnapshot(q, snap => {
      callback(snap.docs.map(d => d.data() as SessionMessage))
    })
  },
}

function toStorablePart(p: typeof SEEDED_PARTS[number]): Part {
  return {
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
  }
}

export async function initializeDB() {
  const existingParts = await db.parts.count()

  if (existingParts === 0) {
    await db.parts.bulkPut(SEEDED_PARTS.map(toStorablePart))
    return
  }

  // Seed any new seeded parts for existing users who don't have them yet
  await seedMissingPart('quiet')
}

async function seedMissingPart(partId: string): Promise<void> {
  const existing = await db.parts.get(partId)
  if (existing) return

  const definition = SEEDED_PARTS.find(p => p.id === partId)
  if (definition) {
    await db.parts.add(toStorablePart(definition))
  }
}

export function generateId(): string {
  return crypto.randomUUID()
}

