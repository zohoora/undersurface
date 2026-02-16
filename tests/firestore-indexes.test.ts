/**
 * Integration tests that run against the Firebase Emulator to validate
 * that firestore.indexes.json correctly supports all query patterns
 * used in the codebase. The emulator enforces index definitions, so
 * queries that need a missing index will throw.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initializeApp, deleteApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore, FieldValue } from 'firebase-admin/firestore'

let app: App
let db: Firestore

const TEST_UID = 'test-user-1'

beforeAll(async () => {
  // 'demo-' prefix lets the emulator accept connections without credentials
  app = initializeApp({ projectId: 'demo-test' })
  db = getFirestore(app)

  // Seed test data
  const userEntries = db.collection(`users/${TEST_UID}/entries`)
  await userEntries.doc('entry-1').set({
    id: 'entry-1',
    updatedAt: FieldValue.serverTimestamp(),
    plainText: 'Test entry text',
    content: '{}',
  })
  await userEntries.doc('entry-2').set({
    id: 'entry-2',
    updatedAt: FieldValue.serverTimestamp(),
    plainText: 'Another entry',
    content: '{}',
  })

  const userSummaries = db.collection(`users/${TEST_UID}/entrySummaries`)
  await userSummaries.doc('summary-1').set({
    id: 'summary-1',
    entryId: 'entry-1',
    timestamp: FieldValue.serverTimestamp(),
    summary: 'Test summary',
  })

  const userMemories = db.collection(`users/${TEST_UID}/memories`)
  await userMemories.doc('memory-1').set({
    id: 'memory-1',
    partId: 'part-1',
    content: 'A memory',
    timestamp: FieldValue.serverTimestamp(),
  })

  const userThoughts = db.collection(`users/${TEST_UID}/thoughts`)
  await userThoughts.doc('thought-1').set({
    id: 'thought-1',
    entryId: 'entry-1',
    partId: 'part-1',
    content: 'A thought',
  })

  const userInteractions = db.collection(`users/${TEST_UID}/interactions`)
  await userInteractions.doc('interaction-1').set({
    id: 'interaction-1',
    entryId: 'entry-1',
    partId: 'part-1',
    partOpening: 'Hello',
    status: 'complete',
  })

  const userFossils = db.collection(`users/${TEST_UID}/fossils`)
  await userFossils.doc('fossil-1').set({
    id: 'fossil-1',
    entryId: 'entry-1',
    content: 'A fossil',
    createdAt: FieldValue.serverTimestamp(),
  })

  const contactMessages = db.collection('contactMessages')
  await contactMessages.doc('msg-1').set({
    id: 'msg-1',
    uid: TEST_UID,
    message: 'Hello',
    createdAt: FieldValue.serverTimestamp(),
  })
})

afterAll(async () => {
  await deleteApp(app)
})

describe('Firestore index validation', () => {
  // ── Collection group queries (adminApi) ──────────────────────────

  it('collectionGroup entries orderBy updatedAt desc', async () => {
    // Source: functions/src/index.ts handleGetOverview
    const snap = await db
      .collectionGroup('entries')
      .orderBy('updatedAt', 'desc')
      .limit(10)
      .get()
    expect(snap.empty).toBe(false)
  })

  // ── User subcollection: entries ──────────────────────────────────

  it('entries orderBy updatedAt desc (COLLECTION scope)', async () => {
    // Source: App.tsx, EntriesList.tsx via db.entries.orderBy('updatedAt').reverse()
    const snap = await db
      .collection(`users/${TEST_UID}/entries`)
      .orderBy('updatedAt', 'desc')
      .get()
    expect(snap.empty).toBe(false)
  })

  it('entries orderBy updatedAt asc (COLLECTION scope)', async () => {
    // Source: db.ts orderBy without reverse()
    const snap = await db
      .collection(`users/${TEST_UID}/entries`)
      .orderBy('updatedAt', 'asc')
      .get()
    expect(snap.empty).toBe(false)
  })

  // ── User subcollection: entrySummaries ───────────────────────────

  it('entrySummaries orderBy timestamp desc', async () => {
    // Source: multiple engines (reflection, quote, echo, thread, exploration, letter)
    const snap = await db
      .collection(`users/${TEST_UID}/entrySummaries`)
      .orderBy('timestamp', 'desc')
      .get()
    expect(snap.empty).toBe(false)
  })

  it('entrySummaries where entryId == x', async () => {
    // Source: reflectionEngine
    const snap = await db
      .collection(`users/${TEST_UID}/entrySummaries`)
      .where('entryId', '==', 'entry-1')
      .get()
    expect(snap.empty).toBe(false)
  })

  // ── User subcollection: memories ─────────────────────────────────

  it('memories where partId == x', async () => {
    // Source: partOrchestrator, reflectionEngine, partGrowthEngine, letterEngine
    const snap = await db
      .collection(`users/${TEST_UID}/memories`)
      .where('partId', '==', 'part-1')
      .get()
    expect(snap.empty).toBe(false)
  })

  // ── User subcollection: thoughts ─────────────────────────────────

  it('thoughts where entryId == x', async () => {
    // Source: reflectionEngine
    const snap = await db
      .collection(`users/${TEST_UID}/thoughts`)
      .where('entryId', '==', 'entry-1')
      .get()
    expect(snap.empty).toBe(false)
  })

  // ── User subcollection: interactions ─────────────────────────────

  it('interactions where entryId == x', async () => {
    // Source: reflectionEngine
    const snap = await db
      .collection(`users/${TEST_UID}/interactions`)
      .where('entryId', '==', 'entry-1')
      .get()
    expect(snap.empty).toBe(false)
  })

  // ── User subcollection: fossils ──────────────────────────────────

  it('fossils where entryId == x', async () => {
    // Source: fossilEngine
    const snap = await db
      .collection(`users/${TEST_UID}/fossils`)
      .where('entryId', '==', 'entry-1')
      .get()
    expect(snap.empty).toBe(false)
  })

  // ── Top-level: contactMessages ───────────────────────────────────

  it('contactMessages orderBy createdAt desc', async () => {
    // Source: adminApi list contact messages
    const snap = await db
      .collection('contactMessages')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get()
    expect(snap.empty).toBe(false)
  })

  it('contactMessages where uid == x', async () => {
    // Source: functions/src/index.ts account deletion
    const snap = await db
      .collection('contactMessages')
      .where('uid', '==', TEST_UID)
      .get()
    expect(snap.empty).toBe(false)
  })
})
