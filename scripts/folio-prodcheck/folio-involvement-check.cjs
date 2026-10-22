// Production check of companion involvement (docs/vision/2026-10-16-folio-involvement.md)
// as the test account:
//   level 3: the opening ghost on a blank page; a ghost question beneath the
//            writer's own lift;
//   level 4: a mark beside a rested line, then the companion's own lift of it
//            with the caret left where it was, and Undo;
//   level 5: arrival from the last page (the companion's words marked as its
//            own), the writer continuing, saved and still there after a reload;
//   the settings slider: axe in light and dark.
// Owner-credentialed: Recent holds the companion back for 72 h after a
// grounding, and the other checks start shore, so the test account's
// `lastGroundingAt` is cleared first through admin-rest.cjs (only that field,
// only this account). Leaves the account at level 1 with no pages from this run.
const device = require('./device.cjs')
const admin = require('./admin-rest.cjs')
const { default: AxeBuilder } = require('@axe-core/playwright')
const { execFileSync } = require('child_process')

const EMAIL = admin.EMAIL
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const PROJECT = admin.PROJECT
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()

;(async () => {
  const started = Date.now()
  const out = { steps: {}, seen: {}, axe: {} }
  const ok = (k, v) => { out.steps[k] = !!v; return !!v }

  // Recent would hold every unasked behavior: clear what the other checks set.
  const acct = await admin.testAccount()
  await admin.patchDoc(`users/${acct.uid}/companionPreferences/current`, {}, ['lastGroundingAt']).catch(() => {})

  const browser = await device.launch()
  const context = await device.newContext(browser, { serviceWorkers: 'block', colorScheme: 'light' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  const { mod } = device.keys()
  const editor = page.locator('.folio-page .ProseMirror[contenteditable="true"]').first()
  const status = page.locator('.folio-status')
  const notice = page.locator('.folio-notice')
  const auth = () => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb')
    req.onsuccess = () => {
      const all = req.result.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll()
      all.onsuccess = () => {
        const user = all.result.map((r) => r.value).find((v) => v && v.stsTokenManager)
        resolve(user ? { uid: user.uid, token: user.stsTokenManager.accessToken } : null)
      }
    }
    req.onerror = () => resolve(null)
  }))
  const rest = async (method, path, body) => {
    const a = await auth()
    const res = await fetch(`${DOCS}/users/${a.uid}/${path}`, { method, headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return res.ok ? res.json().catch(() => ({})) : null
  }
  const setLevel = (n) => rest('PATCH', 'folioPreferences/current?updateMask.fieldPaths=involvement', { fields: { involvement: { integerValue: String(n) } } })
  const newPage = async () => {
    await page.goto(`${BASE}/folio/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/folio\/p\//, { timeout: 30000 })
    await editor.waitFor({ timeout: 30000 })
  }
  // The caret's paragraph (WebKit may anchor the selection on the paragraph element itself).
  const caretText = () => page.evaluate(() => {
    const n = window.getSelection()?.anchorNode
    const el = n ? (n.nodeType === 1 ? n : n.parentElement) : null
    return el?.closest('p')?.textContent ?? ''
  })
  const axe = async (name) => {
    await page.waitForTimeout(500)
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    out.axe[name] = r.violations.map((v) => `${v.id}:${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join('|')}`)
    return r.violations.length === 0
  }

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/(session\/[0-9a-f-]{36}|folio\/)/, { timeout: 45000 })
    await device.settle(page)
    ok('signIn', true)

    // ---- level 3
    ok('level3Set', await setLevel(3))
    await newPage()
    const opening = page.locator('.folio-page p.folio-ghost')
    ok('l3OpeningGhost', await opening.waitFor({ timeout: 40000 }).then(() => true, () => false))
    out.seen.opening = await opening.getAttribute('data-ghost').catch(() => null)
    await editor.focus()
    await page.keyboard.type('We drove back late. The heater only worked on one side.')
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 }).catch(() => {})
    await device.lift(page, 'The heater only worked on one side.')
    const beneathGhost = page.locator('.folio-underside--open p.folio-ghost')
    ok('l3GhostBeneath', await beneathGhost.waitFor({ timeout: 60000 }).then(() => true, () => false))
    out.seen.question = await beneathGhost.getAttribute('data-ghost').catch(() => null)
    ok('l3Axe', await axe('level3'))

    // ---- level 4
    ok('level4Set', await setLevel(4))
    await newPage()
    await editor.focus()
    await page.keyboard.type('We drove back late. I kept checking the mirror as if someone was behind us.')
    await device.enter(page)
    await page.keyboard.type('The road was empty.')
    const mark = page.locator('button.folio-mark')
    ok('l4Mark', await mark.waitFor({ timeout: 90000 }).then(() => true, () => false))
    out.seen.marked = await page.locator('.folio-marked').first().innerText().catch(() => null)
    ok('l4MarkAxe', await axe('mark'))
    const lifted = notice.filter({ hasText: 'The companion opened the space beneath a line.' })
    ok('l4Lifted', await lifted.waitFor({ timeout: 90000 }).then(() => true, () => false))
    out.seen.caretAfterLift = await caretText()
    out.seen.activeIsEditor = await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))
    ok('l4CaretStayed', (await caretText()).includes('The road was empty.'))
    ok('l4OneFold', (await page.locator('.folio-underside--open').count()) === 1)
    await lifted.getByRole('button', { name: 'Undo' }).click()
    await page.waitForTimeout(800)
    ok('l4Undone', (await page.locator('.folio-page [data-fold-id]').count()) === 0)
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 }).catch(() => {})

    // ---- level 5: arrival from the last page
    ok('level5Set', await setLevel(5))
    await newPage()
    const arrived = notice.filter({ hasText: /The companion (brought back a line from|began the page)/ })
    ok('l5Arrived', await arrived.waitFor({ timeout: 60000 }).then(() => true, () => false))
    out.seen.arrival = await arrived.innerText().catch(() => null)
    out.seen.companionText = await page.locator('.folio-page .folio-companion-text').allInnerTexts().catch(() => [])
    ok('l5CompanionText', out.seen.companionText.length >= 1)
    // The caret waits where the companion left it: the writer continues. (On a
    // phone the companion doesn't raise the keyboard; the writer's tap does.)
    if (device.isPhone()) await editor.focus()
    await page.keyboard.type(' the seat was cold.')
    out.seen.statusAfterTyping = await status.innerText().catch(() => null)
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 30000 }).catch(() => {})
    out.seen.statusSaved = await status.innerText().catch(() => null)
    out.seen.afterTyping = (await page.locator('.folio-page').innerText()).slice(0, 300)
    const url = page.url()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await editor.waitFor({ timeout: 30000 })
    await page.waitForTimeout(2500)
    const text = await page.locator('.folio-page').innerText()
    out.seen.afterReload = text.slice(0, 300)
    out.seen.companionAfterReload = await page.locator('.folio-page .folio-companion-text').count()
    ok('l5Persisted', text.includes('the seat was cold.') && (await page.locator('.folio-page .folio-companion-text').count()) >= 1)
    ok('l5Axe', await axe('level5'))

    // ---- the slider
    await page.locator('button[aria-haspopup="menu"]').first().click()
    await page.getByRole('menuitem', { name: 'Folio settings' }).click()
    const slider = page.locator('#folio-involvement')
    ok('slider', await slider.waitFor({ timeout: 5000 }).then(() => true, () => false))
    ok('sliderAt5', (await slider.inputValue()) === '5')
    ok('sliderAxeLight', await axe('sliderLight'))
    await page.emulateMedia({ colorScheme: 'dark' })
    ok('sliderAxeDark', await axe('sliderDark'))
    await page.emulateMedia({ colorScheme: 'light' })
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 220)
    out.url = page.url()
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }).catch(() => {})
  } finally {
    // Back to level 1; this run's pages go.
    try {
      await setLevel(1)
      const list = await rest('GET', 'folioPages?pageSize=50')
      let deleted = 0
      for (const d of (list && list.documents) || []) {
        const created = Number(d.fields?.createdAt?.integerValue ?? 0)
        if (created >= started - 60_000) { await rest('DELETE', `folioPages/${d.name.split('/').pop()}`); deleted++ }
      }
      out.cleanedPages = deleted
    } catch (e) { out.cleanup = String(e.message || e).slice(0, 120) }
    out.pageErrors = errors.slice(0, 5)
    console.log(JSON.stringify(out, null, 1))
    await browser.close()
  }
  process.exit(Object.values(out.steps).every(Boolean) && !out.error ? 0 : 1)
})().catch((err) => { console.error(String(err.message || err)); process.exit(1) })
