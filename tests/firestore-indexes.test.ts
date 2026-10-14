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

  await db.doc(`users/${TEST_UID}/companionPreferences/current`).set({
    fieldWindows: { enabled: true },
  })
  await db.doc('users/test-user-2/companionPreferences/current').set({
    fieldWindows: { enabled: true },
  })

  await db.doc(`users/${TEST_UID}/researchEvents/field-window-1`).set({
    protocolId: 'field-window-timing-v1',
    weekKey: '2026-10-12',
    assignedArm: 'field_check_in',
    status: 'delivered',
  })

  await db.doc('fieldWindowDispatches/field-window-1').set({
    uid: TEST_UID,
    status: 'pending',
    updatedAt: 1,
  })

  // Seven newer reviewed moments in front of one older unreviewed moment: the
  // old "newest six, then filter" load never saw it.
  for (let index = 0; index < 7; index++) {
    await db.doc(`users/${TEST_UID}/fieldMoments/kept-${index}`).set({
      id: `kept-${index}`, status: 'kept', createdAt: 100 + index, text: 'kept',
    })
  }
  await db.doc(`users/${TEST_UID}/fieldMoments/older-unreviewed`).set({
    id: 'older-unreviewed', status: 'unreviewed', createdAt: 1, text: 'still waiting',
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

  it('collectionGroup companionPreferences filters enabled field windows', async () => {
    // Source: functions/src/sms/fieldWindows.ts scheduleFieldWindows
    const snap = await db
      .collectionGroup('companionPreferences')
      .where('fieldWindows.enabled', '==', true)
      .limit(500)
      .get()
    expect(snap.empty).toBe(false)
  })

  it('collectionGroup companionPreferences paginates with startAfter', async () => {
    // Source: functions/src/sms/fieldWindows.ts scheduleFieldWindows (pages of 300)
    const first = await db
      .collectionGroup('companionPreferences')
      .where('fieldWindows.enabled', '==', true)
      .limit(1)
      .get()
    const second = await db
      .collectionGroup('companionPreferences')
      .where('fieldWindows.enabled', '==', true)
      .limit(1)
      .startAfter(first.docs[0])
      .get()
    expect(second.docs[0]?.ref.path).not.toBe(first.docs[0]?.ref.path)
    expect(second.empty).toBe(false)
  })

  it('researchEvents weekly field-window cap query', async () => {
    // Source: functions/src/sms/fieldWindows.ts proactiveCount
    const snap = await db
      .collection(`users/${TEST_UID}/researchEvents`)
      .where('protocolId', '==', 'field-window-timing-v1')
      .where('weekKey', '==', '2026-10-12')
      .where('assignedArm', '==', 'field_check_in')
      .limit(20)
      .get()
    expect(snap.size).toBe(1)
  })

  it('fieldWindowDispatches stale-dispatch sweep query', async () => {
    // Source: functions/src/sms/fieldWindows.ts sweepStaleFieldWindowDispatches
    const snap = await db
      .collection('fieldWindowDispatches')
      .where('status', 'in', ['pending', 'sending'])
      .where('updatedAt', '<', Date.now())
      .limit(100)
      .get()
    expect(snap.empty).toBe(false)
  })

  it('fieldMoments unreviewed, newest first (Field Mosaic)', async () => {
    // Source: src/store/fieldMoments.ts loadUnreviewedFieldMoments
    const snap = await db
      .collection(`users/${TEST_UID}/fieldMoments`)
      .where('status', '==', 'unreviewed')
      .orderBy('createdAt', 'desc')
      .limit(6)
      .get()
    expect(snap.docs.map(doc => doc.id)).toEqual(['older-unreviewed'])
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
