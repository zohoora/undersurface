// Production check of who can open Folio (build plan §3.2), approved by the
// owner on 2026-10-16 (folio-build-plan §8.G). Run it with the test account's
// `folio` claim removed (see admin-rest.cjs):
//   EXPECT=bounced: `folioEnabled` off → every /folio path lands outside Folio
//                   and nothing Folio-related is written;
//   EXPECT=open:    `folioEnabled` on  → any writer opens Folio.
// Signs in fresh, so the ID token carries the claims as they are now.
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const admin = require('./admin-rest.cjs')

const EMAIL = admin.EMAIL
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const EXPECT = process.env.EXPECT
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()
const PATHS = ['/folio', '/folio/new', '/folio/pages', '/folio/kept', '/folio/p/zzzzzzzzzzzz', '/folio/kept/zzzzzzzzzzzz']

async function folioDocs(uid) {
  const counts = {}
  for (const col of ['folioPages', 'folioTraces', 'folioPreferences']) {
    const j = await fetch(`https://firestore.googleapis.com/v1/projects/${admin.PROJECT}/databases/(default)/documents/users/${uid}/${col}?pageSize=50`, {
      headers: { Authorization: `Bearer ${execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()}`, 'x-goog-user-project': admin.PROJECT },
    }).then((r) => r.json())
    counts[col] = (j.documents || []).map((d) => d.name.split('/').pop()).sort().join(',')
  }
  return counts
}

;(async () => {
  if (EXPECT !== 'bounced' && EXPECT !== 'open') throw new Error('set EXPECT=bounced or EXPECT=open')
  const out = { expect: EXPECT, steps: {}, landed: {} }
  const ok = (k, v) => { out.steps[k] = !!v; return !!v }
  const acct = await admin.testAccount()
  ok('claimRemoved', acct.claims.folio !== true)
  const flag = (await admin.getDoc('appConfig/global')).fields?.features?.mapValue?.fields?.folioEnabled?.booleanValue === true
  ok('flagAsExpected', flag === (EXPECT === 'open'))
  const before = await folioDocs(acct.uid)

  const browser = await chromium.launch()
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage()
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/(session|folio)/, { timeout: 45000 })
    for (const path of PATHS) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
      if (EXPECT === 'bounced') {
        await page.waitForURL((u) => !u.pathname.startsWith('/folio'), { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(1500)
      } else {
        await page.locator('.folio-root').waitFor({ timeout: 20000 }).catch(() => {})
      }
      const landed = new URL(page.url()).pathname
      const inFolio = landed.startsWith('/folio') && (await page.locator('.folio-root').count()) > 0
      out.landed[path] = landed.replace(/[0-9a-f-]{36}$/, '<id>')
      ok(`${path}`, EXPECT === 'bounced' ? !inFolio : inFolio)
    }
    if (EXPECT === 'bounced') {
      const after = await folioDocs(acct.uid)
      ok('nothingWritten', JSON.stringify(after) === JSON.stringify(before))
    }
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 220)
  } finally {
    console.log(JSON.stringify(out, null, 1))
    await browser.close()
  }
  process.exit(Object.values(out.steps).every(Boolean) && !out.error ? 0 : 1)
})().catch((err) => { console.error(String(err.message || err)); process.exit(1) })
