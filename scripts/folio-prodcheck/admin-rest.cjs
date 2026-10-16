// Owner-credentialed REST helpers for the checks that need more than the test
// account can do itself (folio-build-plan §8.G, approved 2026-10-16): the
// test account's `folio` claim, a backdated `keptAt` on one of its traces, and
// the `folioEnabled` flag. Authorized by the owner's signed-in gcloud
// (`gcloud auth print-access-token`); never used on any other account.
const { execFileSync } = require('child_process')

const PROJECT = 'undersurfaceme'
const EMAIL = 'folio-test@undersurface.me'
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
const IDT = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`

let cached = null
function token() {
  if (!cached) cached = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
  return cached
}

async function call(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT, ...(init.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${url.replace(DOCS, '').replace(IDT, '')} → ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  return body
}

/** The test account's uid and custom claims. */
async function testAccount() {
  const j = await call(`${IDT}/accounts:lookup`, { method: 'POST', body: JSON.stringify({ email: [EMAIL] }) })
  const user = (j.users || [])[0]
  if (!user || user.email !== EMAIL) throw new Error('test account not found')
  return { uid: user.localId, claims: user.customAttributes ? JSON.parse(user.customAttributes) : {} }
}

/** Replace the test account's custom claims (only ever {} or {folio: true}). */
async function setTestClaims(claims) {
  const keys = Object.keys(claims)
  if (keys.some((k) => k !== 'folio')) throw new Error('only the folio claim may be set')
  const { uid } = await testAccount()
  await call(`${IDT}/accounts:update`, { method: 'POST', body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) }) })
  return (await testAccount()).claims
}

async function getDoc(path) {
  return call(`${DOCS}/${path}`)
}

/** Patch only the named fields (a field named in `mask` but absent from `fields` is deleted). */
async function patchDoc(path, fields, mask) {
  const q = mask.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&')
  return call(`${DOCS}/${path}?${q}`, { method: 'PATCH', body: JSON.stringify({ fields }) })
}

module.exports = { EMAIL, PROJECT, testAccount, setTestClaims, getDoc, patchDoc }
