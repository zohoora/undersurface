import { getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import type {
  SharedCompanionContext,
  SharedMemory,
  SharedPersonalFacts,
  SharedProfile,
} from '../shared/companionKernel.js'
import { normalizeMemoryAperture } from '../shared/companionKernel.js'

const MEMORY_SOURCE_PARTS = new Set(['open', 'weaver', 'still'])
const FIELD_NOTE_MAX_AGE_MS = 14 * 86_400_000

export interface SmsContextDocuments {
  sessions: DocumentData[]
  memories: DocumentData[]
  profile: DocumentData | null
  personalFacts: DocumentData | null
  smsMessages: DocumentData[]
  userParts: DocumentData[]
  intentions: DocumentData[]
  stanceProfile: DocumentData | null
  values: DocumentData[]
  promises: DocumentData[]
  preferences?: DocumentData | null
  outcomes?: DocumentData[]
  personalProtocols?: DocumentData[]
  livingHypotheses?: DocumentData[]
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function number(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis
    if (typeof toMillis === 'function') return toMillis.call(value) as number
  }
  return 0
}

function profileFrom(data: DocumentData | null): SharedProfile | null {
  if (!data) return null
  return {
    innerLandscape: typeof data.innerLandscape === 'string' ? data.innerLandscape : undefined,
    recurringThemes: strings(data.recurringThemes),
    emotionalPatterns: strings(data.emotionalPatterns),
    avoidancePatterns: strings(data.avoidancePatterns),
    growthSignals: strings(data.growthSignals),
    lastUpdated: number(data.lastUpdated) || undefined,
  }
}

function personalFactsFrom(data: DocumentData | null): SharedPersonalFacts | null {
  if (!data) return null
  return {
    people: Array.isArray(data.people)
      ? data.people
          .filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .filter((item: Record<string, unknown>) => typeof item.name === 'string')
          .map((item: Record<string, unknown>) => ({
            name: item.name as string,
            relationship: typeof item.relationship === 'string' ? item.relationship : undefined,
            notes: typeof item.notes === 'string' ? item.notes : undefined,
          }))
      : [],
    dates: Array.isArray(data.dates)
      ? data.dates
          .filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .filter((item: Record<string, unknown>) => typeof item.event === 'string' && typeof item.date === 'string')
          .map((item: Record<string, unknown>) => ({ event: item.event as string, date: item.date as string }))
      : [],
    context: Array.isArray(data.context)
      ? data.context
          .filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .filter((item: Record<string, unknown>) => typeof item.category === 'string' && typeof item.value === 'string')
          .map((item: Record<string, unknown>) => ({ category: item.category as string, value: item.value as string }))
      : [],
    currentThreads: Array.isArray(data.currentThreads)
      ? data.currentThreads
          .filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .filter((item: Record<string, unknown>) => typeof item.topic === 'string')
          .map((item: Record<string, unknown>) => ({ topic: item.topic as string }))
      : [],
  }
}

export function deriveSmsCompanionContext(
  docs: SmsContextDocuments,
  features: Record<string, unknown>,
  now = Date.now(),
): SharedCompanionContext {
  const recentSessionNotes = docs.sessions
    .filter(session => session.status === 'closed' && typeof session.sessionNote === 'string' && session.sessionNote.trim())
    .sort((a, b) => (number(b.endedAt) || number(b.startedAt)) - (number(a.endedAt) || number(a.startedAt)))
    .slice(0, 5)
    .map(session => ({
      note: (session.sessionNote as string).trim(),
      date: number(session.endedAt) || number(session.startedAt),
    }))

  const seenMemories = new Set<string>()
  const relevantMemories: SharedMemory[] = docs.memories
    .filter(memory => MEMORY_SOURCE_PARTS.has(String(memory.partId ?? '')))
    .filter(memory => typeof memory.content === 'string' && memory.content.trim())
    .sort((a, b) => number(b.timestamp) - number(a.timestamp))
    .filter(memory => {
      const key = (memory.content as string).trim().toLowerCase()
      if (seenMemories.has(key)) return false
      seenMemories.add(key)
      return true
    })
    .slice(0, 12)
    .map(memory => ({
      content: (memory.content as string).trim(),
      type: typeof memory.type === 'string' ? memory.type : 'observation',
      timestamp: number(memory.timestamp),
    }))

  const recentFieldNotes = docs.smsMessages
    .filter(message => message.direction === 'inbound')
    .filter(message => now - number(message.createdAt) <= FIELD_NOTE_MAX_AGE_MS)
    .map(message => {
      if (message.carryForward === true && typeof message.fieldNote === 'string' && message.fieldNote.trim()) {
        return { text: message.fieldNote.trim(), date: number(message.createdAt) }
      }
      if (message.mode === 'capture' && message.status === 'captured' && typeof message.body === 'string') {
        return { text: message.body.trim(), date: number(message.createdAt) }
      }
      return null
    })
    .filter((note): note is { text: string; date: number } => Boolean(note?.text))
    .slice(0, 8)

  const userPartsOn = features.userParts === true
  const intentionsOn = features.sessionIntentions === true
  const stanceOn = features.stanceAdaptation === true
  const valuesOn = features.userValues === true
  const interiorityOn = features.companionInteriority === true

  const activeUserParts = userPartsOn
    ? docs.userParts
        .filter(part => part.status === 'active')
        .filter(part => typeof part.name === 'string' && typeof part.description === 'string')
        .sort((a, b) => number(b.lastActiveAt) - number(a.lastActiveAt))
        .slice(0, 9)
        .map(part => ({
          name: part.name as string,
          description: part.description as string,
          stance: typeof part.stance === 'string' ? part.stance : '',
        }))
    : []

  const activeValues = valuesOn
    ? docs.values
        .filter(value => value.status === 'active')
        .filter(value => typeof value.name === 'string' && typeof value.description === 'string')
        .slice(0, 6)
        .map(value => ({ name: value.name as string, description: value.description as string }))
    : []
  const valueNamesById = new Map(valuesOn
    ? docs.values
        .filter(value => value.status === 'active' && typeof value.id === 'string' && typeof value.name === 'string')
        .map(value => [value.id as string, value.name as string])
    : [],
  )

  const openIntentions = intentionsOn
    ? docs.intentions
        .filter(intention => intention.status === 'open' && typeof intention.text === 'string')
        .sort((a, b) => number(b.notYetCount) - number(a.notYetCount) || number(a.createdAt) - number(b.createdAt))
        .slice(0, 3)
        .map(intention => ({
          id: typeof intention.id === 'string' ? intention.id : undefined,
          text: intention.text as string,
          notYetCount: number(intention.notYetCount),
          serves: typeof intention.valueId === 'string' ? valueNamesById.get(intention.valueId) : undefined,
        }))
    : []

  const activePromises = interiorityOn
    ? docs.promises.filter(promise => promise.status === 'active' && typeof promise.text === 'string')
    : []
  const day = 86_400_000
  const duePromises = activePromises
    .filter(promise => {
      if (promise.dueKind === 'next_session') return true
      if (typeof promise.dueDate !== 'string') return false
      const due = new Date(promise.dueDate).getTime()
      return Number.isFinite(due) && due - now < 3 * day && now - due < 7 * day
    })
    .slice(0, 2)
    .map(promise => ({
      id: typeof promise.id === 'string' ? promise.id : '',
      text: promise.text as string,
    }))
  const missed = activePromises.find(promise => {
    if (promise.dueKind !== 'date' || typeof promise.dueDate !== 'string') return false
    const due = new Date(promise.dueDate).getTime()
    return Number.isFinite(due) && now - due >= 7 * day
  })

  return {
    memoryAperture: normalizeMemoryAperture(docs.preferences?.defaultMemoryAperture),
    fieldMosaicEnabled: docs.preferences?.fieldMosaicEnabled !== false,
    outcomeSampling: docs.preferences?.outcomeSampling === 'off' ? 'off' : 'light',
    alliancePreferences: docs.preferences?.alliance && typeof docs.preferences.alliance === 'object'
      ? docs.preferences.alliance
      : undefined,
    outcomeContext: (docs.outcomes ?? [])
      .filter(outcome => outcome.immediate || outcome.delayed)
      .slice(0, 8)
      .map(outcome => `${String(outcome.source ?? 'unknown')} ${String(outcome.intervention ?? 'move')}: immediate ${String(outcome.immediate ?? 'not rated')}${outcome.delayed ? `; later ${String(outcome.delayed)}` : ''}${outcome.agency ? `; agency ${String(outcome.agency)}` : ''}`),
    activePersonalProtocols: (docs.personalProtocols ?? [])
      .filter(protocol => protocol.status === 'active' && typeof protocol.title === 'string' && typeof protocol.preferredArm === 'string')
      .slice(0, 6)
      .map(protocol => ({
        title: protocol.title as string,
        preferredArm: protocol.preferredArm as string,
        context: protocol.context && typeof protocol.context === 'object'
          ? protocol.context as { state?: string; capacity?: string; need?: string }
          : undefined,
        transferStatus: protocol.transferStatus === 'graduated'
          ? 'graduated' as const
          : protocol.transferStatus === 'learning' || protocol.transferStatus === 'paused' || protocol.transferStatus === 'not_started'
            ? protocol.transferStatus
            : undefined,
        transferLevel: protocol.transferLevel === 'companion_led' || protocol.transferLevel === 'user_first' || protocol.transferLevel === 'minimal_cue' || protocol.transferLevel === 'independent'
          ? protocol.transferLevel
          : undefined,
      })),
    livingHypotheses: (docs.livingHypotheses ?? [])
      .filter(item => (item.status === 'confirmed' || item.status === 'contested') && typeof item.text === 'string')
      .slice(0, 12)
      .map(item => ({ text: item.text as string, status: item.status as 'confirmed' | 'contested' })),
    recentSessionNotes,
    relevantMemories,
    profile: profileFrom(docs.profile),
    personalFacts: personalFactsFrom(docs.personalFacts),
    recentFieldNotes,
    activeUserParts,
    lexicon: userPartsOn ? strings(docs.personalFacts?.lexicon) : [],
    openIntentions,
    stanceContext: stanceOn ? strings(docs.stanceProfile?.entries) : [],
    activeValues,
    duePromises,
    missedPromise: missed
      ? { id: typeof missed.id === 'string' ? missed.id : '', text: missed.text as string }
      : null,
  }
}

async function collectionData(
  db: Firestore,
  uid: string,
  collection: string,
  limit: number,
  orderBy?: string,
): Promise<DocumentData[]> {
  let query: FirebaseFirestore.Query = db.collection('users').doc(uid).collection(collection)
  if (orderBy) query = query.orderBy(orderBy, 'desc')
  const snap = await query.limit(limit).get()
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
}

async function documentData(
  db: Firestore,
  uid: string,
  collection: string,
  id = 'current',
): Promise<DocumentData | null> {
  const snap = await db.collection('users').doc(uid).collection(collection).doc(id).get()
  return snap.exists ? { id: snap.id, ...snap.data() } : null
}

export async function loadSmsCompanionContext(
  uid: string,
  db: Firestore = getFirestore(),
): Promise<SharedCompanionContext> {
  const configSnap = await db.collection('appConfig').doc('global').get()
  const rawFeatures = configSnap.data()?.features
  const features = rawFeatures && typeof rawFeatures === 'object'
    ? rawFeatures as Record<string, unknown>
    : {}

  const userPartsOn = features.userParts === true
  const intentionsOn = features.sessionIntentions === true
  const stanceOn = features.stanceAdaptation === true
  const valuesOn = features.userValues === true
  const interiorityOn = features.companionInteriority === true

  const [sessions, memories, profile, personalFacts, smsMessages, userParts, intentions, stanceProfile, values, promises, preferences, outcomes, personalProtocols, livingHypotheses] = await Promise.all([
    collectionData(db, uid, 'sessions', 50, 'startedAt'),
    collectionData(db, uid, 'memories', 60, 'timestamp'),
    documentData(db, uid, 'userProfile'),
    documentData(db, uid, 'personalFacts'),
    collectionData(db, uid, 'smsMessages', 24, 'createdAt'),
    userPartsOn ? collectionData(db, uid, 'userParts', 30) : Promise.resolve([]),
    intentionsOn ? collectionData(db, uid, 'sessionIntentions', 30) : Promise.resolve([]),
    stanceOn ? documentData(db, uid, 'stanceProfile') : Promise.resolve(null),
    valuesOn ? collectionData(db, uid, 'userValues', 20) : Promise.resolve([]),
    interiorityOn ? collectionData(db, uid, 'companionPromises', 10) : Promise.resolve([]),
    documentData(db, uid, 'companionPreferences'),
    collectionData(db, uid, 'interventionOutcomes', 20, 'createdAt'),
    collectionData(db, uid, 'personalProtocols', 20, 'updatedAt'),
    collectionData(db, uid, 'livingHypotheses', 16, 'updatedAt'),
  ])

  return deriveSmsCompanionContext({
    sessions,
    memories,
    profile,
    personalFacts,
    smsMessages,
    userParts,
    intentions,
    stanceProfile,
    values,
    promises,
    preferences,
    outcomes,
    personalProtocols,
    livingHypotheses,
  }, features)
}
