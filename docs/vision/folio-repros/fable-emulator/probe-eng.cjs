// Fable engineering review of Folio draft 3.1: Firestore emulator probe of the
// §6.6 rules as written, and of rejection events the §5.2 classification table
// does not name. Memory cache in Node (no IndexedDB), like Appendix I.
// Run from this directory (holds firebase.json on port 8094):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
//   NODE_PATH=<repo>/node_modules npx firebase emulators:exec --only firestore --project demo-folio-fable "node probe-eng.cjs"
const fs = require('fs')
const path = require('path')
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing')
const sdkVersion = require('firebase/package.json').version

const page = (id, revId, parentRevId, doc, extra = {}) => ({ id, revId, parentRevId, doc, safety: { checked: [] }, ...extra })
const settle = (p, ms = 8000) => Promise.race([
  p.then(() => 'ok', (e) => 'rejected:' + (e && e.code)),
  new Promise((r) => setTimeout(() => r('hung'), ms)),
])
const results = []
const check = (name, actual, expected) => { results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected }) }

async function main() {
  const env = await initializeTestEnvironment({
    projectId: 'demo-folio-fable',
    firestore: { host: '127.0.0.1', port: 8094, rules: fs.readFileSync(path.join(__dirname, 'folio-eng.rules'), 'utf8') },
  })
  const A = env.authenticatedContext('alice').firestore()
  const B = env.authenticatedContext('alice').firestore()
  const M = env.authenticatedContext('mallory').firestore()
  const refA = (id) => A.doc(`users/alice/folioPages/${id}`)
  const refB = (id) => B.doc(`users/alice/folioPages/${id}`)
  const server = async (id) => (await refB(id).get({ source: 'server' })).data()

  // R1. Rules compile and the basic chain works with the 3.1 shape (safety.checked present).
  check('R1 create with parentRevId null + safety.checked []', await settle(refA('p1').set(page('p1', 'r1', null, 'A'))), 'ok')
  check('R1 create WITHOUT parentRevId key is rejected', await settle(refA('p1b').set({ id: 'p1b', revId: 'r1', doc: 'A', safety: { checked: [] } })), 'rejected:permission-denied')
  check('R1 create WITHOUT safety map is rejected (rule reads a missing field)', await settle(refA('p1c').set({ id: 'p1c', revId: 'r1', parentRevId: null, doc: 'A' })), 'rejected:permission-denied')
  check('R1 update with matching parent accepted', await settle(refA('p1').set(page('p1', 'r2', 'r1', 'AB'))), 'ok')
  check('R1 update with null parent rejected', await settle(refA('p1').set(page('p1', 'r3', null, 'ABC'))), 'rejected:permission-denied')
  check('R1 update reusing the same revId rejected', await settle(refA('p1').set(page('p1', 'r2', 'r2', 'ABX'))), 'rejected:permission-denied')
  check('R1 other user cannot read', await settle(M.doc('users/alice/folioPages/p1').get()), 'rejected:permission-denied')
  check('R1 generic owner rule does not reopen folioPages (merge write of a stray field)', await settle(refA('p1').set({ stray: 1 }, { merge: true })), 'rejected:permission-denied')

  // R2. The checked-set backstop.
  const keys = (n) => Array.from({ length: n }, (_, i) => (i.toString(16).padStart(16, '0')))
  check('R2 safety.checked with 12000 keys accepted', await settle(refA('p2').set(page('p2', 'r1', null, 'A', { safety: { checked: keys(12000) } }))), 'ok')
  check('R2 safety.checked with 12001 keys rejected', await settle(refA('p2b').set(page('p2b', 'r1', null, 'A', { safety: { checked: keys(12001) } }))), 'rejected:permission-denied')

  // R3. OWN WRITE ALREADY LANDED: a write that was committed is re-sent (a resumed stream, a
  //     replayed queue, any at-least-once delivery). The resend is rejected with the SAME code as
  //     a conflict, and the server's revId is the rejected write's OWN revId, not its parent.
  //     §5.2's table has no row for this; row 2 ("revId differs from the parent") would call it a conflict.
  await refA('p3').set(page('p3', 'r1', null, 'A'))
  check('R3 first send of r2 accepted', await settle(refA('p3').set(page('p3', 'r2', 'r1', 'AB'))), 'ok')
  check('R3 resend of the identical r2 write rejected', await settle(refA('p3').set(page('p3', 'r2', 'r1', 'AB'))), 'rejected:permission-denied')
  const s3 = await server('p3')
  check('R3 server revId equals the rejected write\'s own revId (not its parent)', s3.revId, 'r2')
  check('R3 §5.2 row 2 would classify this as a conflict (server revId != rejected parent)', s3.revId !== 'r1', true)

  // R4. One conflict, several rejection events: an offline chain of three writes behind a remote
  //     write produces three rejections. A classifier that runs per rejection makes three copies.
  await refA('p4').set(page('p4', 'r1', null, 'A'))
  await A.disableNetwork()
  const c2 = settle(refA('p4').set(page('p4', 'r2', 'r1', 'A1')))
  const c3 = settle(refA('p4').set(page('p4', 'r3', 'r2', 'A12')))
  const c4 = settle(refA('p4').set(page('p4', 'r4', 'r3', 'A123')))
  await refB('p4').set(page('p4', 'r9', 'r1', 'B'))
  await A.enableNetwork()
  const outcomes = [await c2, await c3, await c4]
  check('R4 three rejection events for one conflict', outcomes, ['rejected:permission-denied', 'rejected:permission-denied', 'rejected:permission-denied'])
  check('R4 server at r9', (await server('p4')).revId, 'r9')

  // R5. getDocFromServer while offline: error code (the table's "can't be read" row).
  await A.disableNetwork()
  check('R5 get({source:server}) while offline', await settle(refA('p4').get({ source: 'server' })), 'rejected:unavailable')
  await A.enableNetwork()

  // R6. A document over Firestore's 1 MiB limit whose `doc` string passes the 950,000 rule cap:
  //     which error code comes back? (A classifier that only knows permission-denied must handle it.)
  await refA('p6').set(page('p6', 'r1', null, 'A'))
  const bigDoc = 'x'.repeat(940_000)
  const pad = 'y'.repeat(200_000)
  check('R6 >1 MiB document with matching parent: error code', await settle(refA('p6').set(page('p6', 'r2', 'r1', bigDoc, { pad })), 20000), 'rejected:invalid-argument')
  check('R6 server unchanged at r1', (await server('p6')).revId, 'r1')

  // R7. Traces: kept fields immutable, allowed fields mutable, entries append/delete only.
  const trA = (id) => A.doc(`users/alice/folioTraces/${id}`)
  const trace = { id: 't1', keptAt: 1, source: { pageId: 'p1', foldId: 'f1', revId: 'r1' }, surface: 'line', gap: 2, beneath: 'b', author: 'writer', groundedNearKeep: false, safety: { checked: [] }, schemaVersion: 2 }
  check('R7 create trace', await settle(trA('t1').set(trace)), 'ok')
  check('R7 update title allowed', await settle(trA('t1').update({ title: 'the soup' })), 'ok')
  check('R7 update safety.checked allowed', await settle(trA('t1').update({ 'safety.checked': ['abcd'] })), 'ok')
  check('R7 update beneath rejected', await settle(trA('t1').update({ beneath: 'changed' })), 'rejected:permission-denied')
  check('R7 update title AND beneath together rejected', await settle(trA('t1').update({ title: 'x', beneath: 'changed' })), 'rejected:permission-denied')
  check('R7 full set() of the same trace with one kept field changed rejected', await settle(trA('t1').set({ ...trace, title: 'the soup', surface: 'other' })), 'rejected:permission-denied')
  check('R7 gap 5 rejected on create', await settle(trA('t2').set({ ...trace, id: 't2', gap: 5 })), 'rejected:permission-denied')
  const enA = (t, e) => A.doc(`users/alice/folioTraces/${t}/entries/${e}`)
  check('R7 entry create', await settle(enA('t1', 'e1').set({ id: 'e1', addedAt: 1, text: 'later', author: 'writer' })), 'ok')
  check('R7 entry update rejected (no update rule, generic rule carved out)', await settle(enA('t1', 'e1').update({ text: 'edited' })), 'rejected:permission-denied')
  check('R7 entry delete', await settle(enA('t1', 'e1').delete()), 'ok')
  check('R7 entry under a trace via generic path does not reopen writes (set with merge)', await settle(enA('t1', 'e2').set({ text: 'x' }, { merge: true })), 'rejected:permission-denied')

  // R8. Delete then recreate by the same client is allowed (the rules can't tell "recreated" from "new").
  await refA('p8').set(page('p8', 'r1', null, 'A'))
  await refB('p8').delete()
  check('R8 after a remote delete, a create with parentRevId null succeeds (recreation is a client discipline, not a rule)', await settle(refA('p8').set(page('p8', 'r1', null, 'A'))), 'ok')

  await env.cleanup()
  console.log(`firebase JS SDK ${sdkVersion}`)
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  (got ${JSON.stringify(r.actual)}, expected ${JSON.stringify(r.expected)})`}`)
  process.exit(results.every((r) => r.pass) ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(2) })
