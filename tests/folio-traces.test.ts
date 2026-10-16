// Folio's kept things on the emulator (draft 4 §6.6, C3; build plan step 7):
// the owner creates, reads and deletes traces and entries; nobody can change a
// kept field or an entry's text; only the title, the come-back fields and the
// checked set can be updated; other writers can do nothing; and the generic
// owner rule doesn't reopen writes through the nested entries path.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import type { FolioTrace, FolioTraceEntry } from '../src/types/folio'

const ALICE = 'alice-uid'
const BOB = 'bob-uid'
let env: RulesTestEnvironment

function emulatorHost(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST
  if (!raw) return { host: '127.0.0.1', port: 8080 }
  const [host, port] = raw.split(':')
  return { host: host || '127.0.0.1', port: Number(port) || 8080 }
}

beforeAll(async () => {
  const { host, port } = emulatorHost()
  env = await initializeTestEnvironment({
    projectId: 'demo-folio-traces',
    firestore: { rules: readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8'), host, port },
  })
})
afterAll(async () => { await env.cleanup() })
beforeEach(async () => { await env.clearFirestore() })

const db = (uid: string) => env.authenticatedContext(uid).firestore()
const traceRef = (uid: string, owner: string, id: string) => doc(db(uid), 'users', owner, 'folioTraces', id)
const entryRef = (uid: string, owner: string, traceId: string, id: string) => doc(db(uid), 'users', owner, 'folioTraces', traceId, 'entries', id)

function trace(id: string, extra: Partial<FolioTrace> = {}): FolioTrace {
  return {
    id,
    keptAt: 1_792_000_000_000,
    source: { pageId: 'page-1', foldId: 'fold-1', revId: 'rev-1' },
    surface: 'It was nice to see everyone.',
    gap: 2,
    composition: JSON.stringify({ v: 1, line: [{ type: 'text', text: 'It was nice to see everyone.' }], gap: 2, between: null, beneath: [{ type: 'paragraph', content: [{ type: 'text', text: 'I felt absent.' }] }] }),
    author: 'writer',
    groundedNearKeep: false,
    safety: { checked: [] },
    schemaVersion: 2,
    ...extra,
  }
}

const entry = (id: string, text = 'I think I was waiting for someone to notice.'): FolioTraceEntry => ({ id, addedAt: 1_792_100_000_000, text, author: 'writer' })

describe('traces', () => {
  it('the owner creates, reads, lists and deletes a trace', async () => {
    await assertSucceeds(setDoc(traceRef(ALICE, ALICE, 't1'), trace('t1')))
    await assertSucceeds(getDoc(traceRef(ALICE, ALICE, 't1')))
    await assertSucceeds(getDocs(query(collection(db(ALICE), 'users', ALICE, 'folioTraces'), where('source.pageId', '==', 'page-1'))))
    await assertSucceeds(deleteDoc(traceRef(ALICE, ALICE, 't1')))
  })

  it('a malformed trace is rejected', async () => {
    await assertFails(setDoc(traceRef(ALICE, ALICE, 't1'), trace('other-id')))
    await assertFails(setDoc(traceRef(ALICE, ALICE, 't1'), { ...trace('t1'), author: 'companion' }))
    await assertFails(setDoc(traceRef(ALICE, ALICE, 't1'), { ...trace('t1'), gap: 5 }))
    await assertFails(setDoc(traceRef(ALICE, ALICE, 't1'), { ...trace('t1'), extra: 'field' }))
    await assertFails(setDoc(traceRef(ALICE, ALICE, 't1'), { ...trace('t1'), safety: { checked: Array.from({ length: 1001 }, (_, i) => String(i)) } }))
    await assertFails(setDoc(traceRef(ALICE, ALICE, 't1'), { ...trace('t1'), title: 'x'.repeat(201) }))
  })

  it('no client write changes a kept field', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'users', ALICE, 'folioTraces', 't1'), trace('t1')) })
    const ref = traceRef(ALICE, ALICE, 't1')
    await assertFails(updateDoc(ref, { surface: 'Rewritten.' }))
    await assertFails(updateDoc(ref, { composition: '{}' }))
    await assertFails(updateDoc(ref, { gap: 0 }))
    await assertFails(updateDoc(ref, { keptAt: 1 }))
    await assertFails(updateDoc(ref, { 'source.pageId': 'elsewhere' }))
    await assertFails(updateDoc(ref, { groundedNearKeep: true }))
    await assertFails(updateDoc(ref, { previousTraceId: 'x' }))
    await assertFails(setDoc(ref, { ...trace('t1'), surface: 'Overwritten.' }))
  })

  it('the title, the come-back fields and the checked set can change', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'users', ALICE, 'folioTraces', 't1'), trace('t1')) })
    const ref = traceRef(ALICE, ALICE, 't1')
    await assertSucceeds(updateDoc(ref, { title: 'the soup incident' }))
    await assertSucceeds(updateDoc(ref, { comeBackAt: 1_792_500_000_000, comeBackTz: 'America/Toronto', comeBackSetAt: 1_792_000_000_000, lastComeBackShownAt: null }))
    await assertSucceeds(updateDoc(ref, { comeBackAt: null, comeBackTz: null, comeBackSetAt: null }))
    await assertSucceeds(updateDoc(ref, { 'safety.checked': ['0123456789abcdef'] }))
    // H3: the trace's own Return switch and when Return last showed it.
    await assertSucceeds(updateDoc(ref, { returnEligible: true }))
    await assertSucceeds(updateDoc(ref, { lastReturnShownAt: 1_792_900_000_000 }))
    await assertFails(updateDoc(ref, { returnEligible: 'yes' }))
  })

  it('involvement: the companion may keep and name; the words stay the writer\'s', async () => {
    await assertSucceeds(setDoc(traceRef(ALICE, ALICE, 't2'), { ...trace('t2'), keptBy: 'companion', title: 'the mirror', titleBy: 'companion' }))
    await assertFails(setDoc(traceRef(ALICE, ALICE, 't3'), { ...trace('t3'), keptBy: 'writer' }))
    await assertFails(setDoc(traceRef(ALICE, ALICE, 't3'), { ...trace('t3'), titleBy: 'someone' }))
    await assertFails(setDoc(traceRef(ALICE, ALICE, 't3'), { ...trace('t3'), keptBy: 'companion', author: 'companion' }))
    const ref = traceRef(ALICE, ALICE, 't2')
    // Renaming makes the name the writer's; who kept it never changes.
    await assertSucceeds(updateDoc(ref, { title: 'nobody', titleBy: null }))
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'users', ALICE, 'folioTraces', 't4'), trace('t4')) })
    await assertFails(updateDoc(traceRef(ALICE, ALICE, 't4'), { keptBy: 'companion' }))
  })

  it('another writer can do nothing', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'users', ALICE, 'folioTraces', 't1'), trace('t1')) })
    await assertFails(getDoc(traceRef(BOB, ALICE, 't1')))
    await assertFails(setDoc(traceRef(BOB, ALICE, 't2'), trace('t2')))
    await assertFails(updateDoc(traceRef(BOB, ALICE, 't1'), { title: 'mine' }))
    await assertFails(deleteDoc(traceRef(BOB, ALICE, 't1')))
    await assertFails(setDoc(entryRef(BOB, ALICE, 't1', 'e1'), entry('e1')))
  })
})

describe('entries', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'users', ALICE, 'folioTraces', 't1'), trace('t1')) })
  })

  it('can be added and deleted, but not edited', async () => {
    const ref = entryRef(ALICE, ALICE, 't1', 'e1')
    await assertSucceeds(setDoc(ref, entry('e1')))
    await assertSucceeds(getDoc(ref))
    await assertFails(updateDoc(ref, { text: 'Changed.' }))
    await assertFails(setDoc(ref, entry('e1', 'Overwritten.')))
    await assertSucceeds(deleteDoc(ref))
  })

  it('must be the writer\'s, non-empty, bounded and well-formed', async () => {
    await assertFails(setDoc(entryRef(ALICE, ALICE, 't1', 'e1'), entry('e2')))
    await assertFails(setDoc(entryRef(ALICE, ALICE, 't1', 'e1'), { ...entry('e1'), author: 'companion' }))
    await assertFails(setDoc(entryRef(ALICE, ALICE, 't1', 'e1'), entry('e1', '')))
    await assertFails(setDoc(entryRef(ALICE, ALICE, 't1', 'e1'), entry('e1', 'x'.repeat(20001))))
    await assertFails(setDoc(entryRef(ALICE, ALICE, 't1', 'e1'), { ...entry('e1'), mood: 'sad' }))
  })

  it('the generic owner rule doesn\'t reopen writes on the nested path', async () => {
    await assertSucceeds(setDoc(entryRef(ALICE, ALICE, 't1', 'e1'), entry('e1')))
    // An update would have been allowed by the generic rule if it weren't carved out.
    await assertFails(setDoc(entryRef(ALICE, ALICE, 't1', 'e1'), { ...entry('e1'), text: 'Edited.' }, { merge: true }))
    await assertFails(setDoc(doc(db(ALICE), 'users', ALICE, 'folioTraces', 't1', 'other', 'x'), { anything: true }))
  })
})
