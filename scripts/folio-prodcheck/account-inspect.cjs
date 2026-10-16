// Counts the test account's Folio pages and kept things (expected: 0 after
// the checks). Prints counts only.
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()
;(async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage()
  await page.goto(BASE); await page.getByPlaceholder('Email').fill(EMAIL); await page.getByPlaceholder('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(/\/(session\/[0-9a-f-]{36}|folio\/)/, { timeout: 45000 })
  const a = await page.evaluate(() => new Promise((resolve) => { const r = indexedDB.open('firebaseLocalStorageDb'); r.onsuccess = () => { const all = r.result.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll(); all.onsuccess = () => { const u = all.result.map((x) => x.value).find((v) => v && v.stsTokenManager); resolve({ uid: u.uid, token: u.stsTokenManager.accessToken }) } } }))
  for (const col of ['folioTraces', 'folioPages']) {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/undersurfaceme/databases/(default)/documents/users/${a.uid}/${col}?pageSize=50`, { headers: { Authorization: `Bearer ${a.token}` } })
    const j = await res.json()
    console.log(`${col}: ${(j.documents || []).length} (HTTP ${res.status})`)
  }
  await browser.close()
})()
