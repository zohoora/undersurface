// Production check for Return's settings (build plan step 10, H3) as the test
// account: the Folio setting, a trace's own switch (stored as returnEligible),
// both hidden while the setting is off; then everything turned back off and
// deleted. The slip itself needs a trace kept 14+ days ago (keptAt is
// immutable), so it is covered by unit tests, not here.
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')

const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()

;(async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage()
  page.on('dialog', (d) => d.accept())
  const out = { steps: {} }
  const ok = (k, v) => { out.steps[k] = !!v; return !!v }
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const editor = page.locator('.folio-page .ProseMirror[contenteditable="true"]')
  const auth = () => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb')
    req.onsuccess = () => {
      const all = req.result.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll()
      all.onsuccess = () => { const u = all.result.map((r) => r.value).find((v) => v && v.stsTokenManager); resolve(u ? { uid: u.uid, token: u.stsTokenManager.accessToken } : null) }
    }
  }))
  const readTrace = async (id) => {
    const a = await auth()
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/undersurfaceme/databases/(default)/documents/users/${a.uid}/folioTraces/${id}`, { headers: { Authorization: `Bearer ${a.token}` } })
    return res.json()
  }
  const setting = async (on) => {
    await page.locator('.folio-topbar button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Folio settings' }).click()
    const box = page.getByRole('dialog').getByRole('checkbox', { name: 'Let kept things come back on their own' })
    await box.waitFor({ timeout: 5000 })
    if ((await box.isChecked()) !== on) await box.click()
    await page.waitForTimeout(800)
    const now = await box.isChecked()
    await page.getByRole('dialog').getByRole('button', { name: 'Close settings' }).click()
    return now === on
  }
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/(session|folio)/, { timeout: 45000 })
    await page.goto(`${BASE}/folio/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/folio\/p\//, { timeout: 30000 })
    await editor.waitFor({ timeout: 30000 })
    await editor.focus()
    await page.keyboard.type('The heater only worked on one side.')
    await page.keyboard.press(`${mod}+Shift+Enter`)
    await page.keyboard.type('I felt cold the whole way.')
    await page.locator('.folio-status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })
    await page.locator('button[data-folio-keep]').click()
    await page.locator('.folio-notice').filter({ hasText: 'Kept.' }).waitFor({ timeout: 5000 })
    await page.waitForTimeout(1500)

    // Setting off: no per-trace switch.
    ok('settingOff', await setting(false))
    await page.getByRole('button', { name: 'Kept', exact: true }).click()
    await page.locator('.folio-floor__open').first().click()
    await page.waitForURL(/\/folio\/kept\/[A-Za-z0-9_-]+$/, { timeout: 15000 })
    const traceId = page.url().split('/').pop()
    await page.locator('.folio-composition').waitFor({ timeout: 15000 })
    ok('noSwitchWhileOff', (await page.getByRole('checkbox', { name: 'May come back on its own' }).count()) === 0)

    // Setting on: the trace's own switch appears and is stored.
    ok('settingOn', await setting(true))
    const sw = page.getByRole('checkbox', { name: 'May come back on its own' })
    ok('switchShown', await sw.waitFor({ timeout: 5000 }).then(() => true, () => false))
    await sw.click()
    await page.waitForTimeout(2500)
    const stored = await readTrace(traceId)
    ok('storedEligible', stored.fields?.returnEligible?.booleanValue === true)
    await sw.click()
    await page.waitForTimeout(2500)
    ok('storedOff', (await readTrace(traceId)).fields?.returnEligible?.booleanValue === false)

    // Back to off, and clean up.
    ok('settingBackOff', await setting(false))
    await page.locator('.folio-trace__actions button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Go to the page' }).click()
    await page.waitForURL(/\/folio\/p\//, { timeout: 15000 })
    await editor.waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    await page.locator('.folio-topbar button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Delete page' }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('button', { name: 'Delete the page and what was kept from it' }).click()
    ok('cleaned', await page.waitForURL(/\/folio\/pages/, { timeout: 15000 }).then(() => true, () => false))
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 220)
  } finally {
    console.log(JSON.stringify(out, null, 1))
    await browser.close()
  }
  process.exit(Object.values(out.steps).every(Boolean) && Object.keys(out.steps).length >= 8 && !out.error ? 0 : 1)
})()
