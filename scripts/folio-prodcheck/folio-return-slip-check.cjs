// Production check of the Return slip itself (H3), approved by the owner on
// 2026-10-16 (folio-build-plan §8.G). As the test account: clear the
// lastGroundingAt the other checks set (so Recent is off and the keep isn't
// "near a grounding"), keep a fold, opt in twice, then backdate that trace's
// keptAt by 15 days with the owner's credentials (keptAt is immutable to the
// client). A fresh visit must show the slip once and stamp lastReturnShownAt;
// Open goes to the trace; the next visit must not show it (60 days' rest).
// Cleans up: setting off, page and trace deleted. Needs the owner's gcloud.
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const admin = require('./admin-rest.cjs')

const EMAIL = admin.EMAIL
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()
const DAY = 24 * 60 * 60 * 1000

;(async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage()
  page.on('dialog', (d) => d.accept())
  const out = { steps: {} }
  const ok = (k, v) => { out.steps[k] = !!v; return !!v }
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const editor = page.locator('.folio-page .ProseMirror[contenteditable="true"]')
  const slip = page.locator('section.folio-slip').filter({ hasText: 'From what you kept' })
  let uid = null
  let traceId = null
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
  const trace = async () => (await admin.getDoc(`users/${uid}/folioTraces/${traceId}`)).fields || {}
  try {
    uid = (await admin.testAccount()).uid
    // 1. The checks' own grounding stamp, cleared (owner-approved, test account only).
    await admin.patchDoc(`users/${uid}/companionPreferences/current`, {}, ['lastGroundingAt'])
    ok('groundingCleared', !(await admin.getDoc(`users/${uid}/companionPreferences/current`)).fields?.lastGroundingAt)

    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/(session|folio)/, { timeout: 45000 })

    // 2. Keep a fold, outside Recent.
    await page.goto(`${BASE}/folio/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/folio\/p\//, { timeout: 30000 })
    await editor.waitFor({ timeout: 30000 })
    await editor.focus()
    await page.keyboard.type('The pear tree flowered early that year.')
    await page.keyboard.press(`${mod}+Shift+Enter`)
    await page.keyboard.type('We ate outside until October.')
    await page.locator('.folio-status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })
    await page.locator('button[data-folio-keep]').click()
    await page.locator('.folio-notice').filter({ hasText: 'Kept.' }).waitFor({ timeout: 5000 })
    await page.waitForTimeout(1500)

    // 3. Both opt-ins.
    ok('settingOn', await setting(true))
    await page.getByRole('button', { name: 'Kept', exact: true }).click()
    await page.locator('.folio-floor__open').first().click()
    await page.waitForURL(/\/folio\/kept\/[A-Za-z0-9_-]+$/, { timeout: 15000 })
    traceId = page.url().split('/').pop()
    const sw = page.getByRole('checkbox', { name: 'May come back on its own' })
    await sw.waitFor({ timeout: 5000 })
    if (!(await sw.isChecked())) await sw.click()
    await page.waitForTimeout(2500)
    const before = await trace()
    ok('eligibleStored', before.returnEligible?.booleanValue === true)
    ok('notGroundedNearKeep', before.groundedNearKeep?.booleanValue !== true)

    // 4. Backdate keptAt by 15 days, keeping the stored type. Leave Folio
    // first: an open Folio would pick the trace up live within this visit
    // (and, on its own trace page, stamp it without a slip).
    await page.goto('about:blank')
    const keptType = Object.keys(before.keptAt || {})[0]
    const backdated = Number(Object.values(before.keptAt)[0]) - 15 * DAY
    await admin.patchDoc(`users/${uid}/folioTraces/${traceId}`, { keptAt: { [keptType]: keptType === 'integerValue' ? String(backdated) : backdated } }, ['keptAt'])
    ok('backdated', Number(Object.values((await trace()).keptAt)[0]) === backdated)

    // 5. A fresh visit shows the slip once and stamps it.
    await page.goto(`${BASE}/folio/pages`, { waitUntil: 'domcontentloaded' })
    ok('slipShown', await slip.waitFor({ timeout: 20000 }).then(() => true, () => false))
    ok('slipNamesTrace', (await slip.textContent() || '').includes('The pear tree flowered early that year.'))
    await page.waitForTimeout(2500)
    ok('stamped', typeof Object.values((await trace()).lastReturnShownAt || {})[0] !== 'undefined')
    await slip.getByRole('button', { name: 'Open', exact: true }).click()
    ok('openGoesToTrace', await page.waitForURL(new RegExp(`/folio/kept/${traceId}$`), { timeout: 10000 }).then(() => true, () => false))

    // 6. The next visit rests it (60 days).
    await page.goto(`${BASE}/folio/pages`, { waitUntil: 'domcontentloaded' })
    await page.locator('.folio-topbar').waitFor({ timeout: 20000 })
    await page.waitForTimeout(4000)
    ok('restsNextVisit', (await slip.count()) === 0)

    // 7. Clean up.
    ok('settingBackOff', await setting(false))
    await page.goto(`${BASE}/folio/kept/${traceId}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.folio-composition').waitFor({ timeout: 15000 })
    await page.locator('.folio-trace__actions button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Go to the page' }).click()
    await page.waitForURL(/\/folio\/p\//, { timeout: 15000 })
    await editor.waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    await page.locator('.folio-topbar button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Delete page' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete the page and what was kept from it' }).click()
    ok('cleaned', await page.waitForURL(/\/folio\/pages/, { timeout: 15000 }).then(() => true, () => false))
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 220)
  } finally {
    console.log(JSON.stringify(out, null, 1))
    await browser.close()
  }
  process.exit(Object.values(out.steps).every(Boolean) && Object.keys(out.steps).length >= 12 && !out.error ? 0 : 1)
})()
