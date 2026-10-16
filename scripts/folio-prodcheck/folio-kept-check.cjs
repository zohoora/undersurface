// Production check for Folio's Phase 2 (build plan step 7) as the test
// account: Keep, Undo, Come back; the floor; Add with undo; Name it; a
// corrected copy; the come-back slip (its date moved into the past through
// the REST API with the account's own token, which the rules allow); Not now;
// Lift into today's page; Go to the page; the delete-page dialog with kept
// things; axe on each new screen. Prints statuses only; cleans up after itself.
const { chromium } = require('playwright')
const { default: AxeBuilder } = require('@axe-core/playwright')
const { execFileSync } = require('child_process')

const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const PROJECT = 'undersurfaceme'
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
const MARK = 'We drove back late.'
const LINE = 'The heater only worked on one side.'

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'block', colorScheme: 'light' })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  const out = { steps: {}, axe: {} }
  const ok = (k, v) => { out.steps[k] = !!v; return !!v }
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const editor = page.locator('.folio-page .ProseMirror[contenteditable="true"]').first()
  const status = page.locator('.folio-status')
  const notice = page.locator('.folio-notice')
  const settle = () => page.waitForTimeout(250)
  const axe = async (name) => {
    await page.waitForTimeout(600)
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {})
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    out.axe[name] = r.violations.map((v) => `${v.id}:${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join('|')}`)
  }
  const auth = () => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb')
    req.onsuccess = () => {
      const tx = req.result.transaction('firebaseLocalStorage', 'readonly')
      const all = tx.objectStore('firebaseLocalStorage').getAll()
      all.onsuccess = () => {
        const user = all.result.map((r) => r.value).find((v) => v && v.stsTokenManager)
        resolve(user ? { uid: user.uid, token: user.stsTokenManager.accessToken } : null)
      }
    }
    req.onerror = () => resolve(null)
  }))
  const patchTrace = async (traceId, fields) => {
    const a = await auth()
    const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join('&')
    const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? { nullValue: null } : { integerValue: String(v) }])) }
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${a.uid}/folioTraces/${traceId}?${mask}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return res.status
  }
  const openMenuItem = async (name) => {
    await page.locator('.folio-trace__actions button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name }).click()
  }
  const traceIdFromUrl = () => (page.url().match(/\/folio\/kept\/([A-Za-z0-9_-]+)/) || [])[1]

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/(session|folio)/, { timeout: 45000 })
    ok('signIn', true)

    // A page with a lifted line and writing beneath it.
    await page.goto(`${BASE}/folio/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/folio\/p\//, { timeout: 30000 })
    await editor.waitFor({ timeout: 30000 })
    const pageUrl = page.url()
    await editor.focus()
    await page.keyboard.type(MARK)
    await page.keyboard.press('Enter')
    await page.keyboard.type(LINE)
    await settle()
    await page.keyboard.press(`${mod}+Shift+Enter`)
    await page.keyboard.type('I felt cold the whole way.')
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })

    // Keep, then Come back to this · Tomorrow.
    await page.locator('button[data-folio-keep]').click()
    ok('kept', await notice.filter({ hasText: 'Kept.' }).isVisible())
    await notice.getByRole('button', { name: 'Come back to this…' }).click()
    await notice.getByRole('button', { name: 'Tomorrow' }).click()
    ok('comeBackSet', await notice.filter({ hasText: /Coming back/ }).waitFor({ timeout: 5000 }).then(() => true, () => false))

    // Keep again, then Undo: the second trace goes.
    await page.locator('button[data-folio-keep]').click()
    await notice.filter({ hasText: 'Kept.' }).waitFor({ timeout: 5000 })
    await notice.getByRole('button', { name: 'Undo' }).click()
    await page.waitForTimeout(1500)

    // The floor: one trace, with its come-back date.
    await page.getByRole('button', { name: 'Kept', exact: true }).click()
    await page.waitForURL(/\/folio\/kept$/, { timeout: 15000 })
    await page.locator('.folio-floor__trace').first().waitFor({ timeout: 15000 })
    ok('floorOne', (await page.locator('.folio-floor__trace').count()) === 1)
    ok('floorComingBack', (await page.locator('.folio-floor__meta').first().innerText()).includes('Coming back'))
    await axe('floor')

    // A trace: composition, Add with undo, Name it.
    await page.locator('.folio-floor__open').first().click()
    await page.waitForURL(/\/folio\/kept\/[A-Za-z0-9_-]+$/, { timeout: 15000 })
    const originalId = traceIdFromUrl()
    ok('composition', (await page.locator('.folio-composition__beneath').innerText()).includes('I felt cold the whole way.'))
    await page.locator('.folio-entry__input').fill('Added by the check.')
    await page.locator('.folio-entry--new button[type="submit"]').click()
    await page.locator('.folio-entry__text', { hasText: 'Added by the check.' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Undo' }).click()
    ok('addUndo', await page.locator('.folio-entry__text', { hasText: 'Added by the check.' }).waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false))
    await page.locator('.folio-entry__input').fill('A second look.')
    await page.locator('.folio-entry--new button[type="submit"]').click()
    ok('added', await page.locator('.folio-entry__text', { hasText: 'A second look.' }).waitFor({ timeout: 10000 }).then(() => true, () => false))
    await openMenuItem('Name it')
    await page.locator('.folio-trace__name input').fill('the drive')
    await page.getByRole('button', { name: 'Save name' }).click()
    ok('named', await page.getByRole('heading', { name: 'the drive' }).waitFor({ timeout: 10000 }).then(() => true, () => false))
    await axe('trace')

    // A corrected copy: a new trace; the original stays.
    await openMenuItem('Make a corrected copy')
    const copyEditor = page.locator('.folio-correction .ProseMirror')
    await copyEditor.waitFor({ timeout: 10000 })
    await page.locator('.folio-correction .folio-underside__content p', { hasText: 'I felt cold the whole way.' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Mostly my feet.')
    await page.getByRole('button', { name: 'Keep the corrected copy' }).click()
    await page.waitForFunction((id) => !location.pathname.endsWith(id), originalId, { timeout: 15000 })
    const copyId = traceIdFromUrl()
    ok('corrected', (await page.locator('.folio-composition__beneath').innerText()).includes('Mostly my feet.') && (await page.locator('.folio-trace__meta', { hasText: 'Corrected from' }).count()) === 1)
    ok('earlierWording', (await page.getByRole('button', { name: 'Earlier wording' }).count()) === 1)

    // A due come-back: move the original's date into the past (its own fields only).
    out.patch1 = await patchTrace(originalId, { comeBackAt: Date.now() - 60_000, comeBackSetAt: Date.now() - 86_400_000, lastComeBackShownAt: null })
    await page.goto(`${BASE}/folio/kept`, { waitUntil: 'domcontentloaded' })
    await page.locator('.folio-floor').waitFor({ timeout: 15000 })
    await page.waitForTimeout(2500)
    out.recent = (await page.locator('.folio-floor__waiting').count()) === 1
    if (out.recent) {
      // Recent (a grounding activation in the last 72 h): no slip; the trace waits, with Open.
      await page.goto(`${BASE}/folio/pages`, { waitUntil: 'domcontentloaded' })
      await page.locator('.folio-list').waitFor({ timeout: 15000 })
      await page.waitForTimeout(2500)
      ok('slipHeldByRecent', (await page.locator('.folio-slip').count()) === 0)
      await page.goto(`${BASE}/folio/kept`, { waitUntil: 'domcontentloaded' })
      const waiting = page.locator('.folio-floor__waiting')
      await waiting.waitFor({ timeout: 15000 })
      await axe('waiting')
      await waiting.getByRole('button', { name: 'Open' }).first().click()
      ok('waitingOpen', await page.waitForURL(new RegExp(`/folio/kept/${originalId}$`), { timeout: 15000 }).then(() => true, () => false))
      await page.locator('.folio-composition').waitFor({ timeout: 15000 })
      await page.waitForTimeout(3000) // a person reads it
      await page.getByRole('button', { name: 'Kept', exact: true }).click()
      await page.locator('.folio-floor').waitFor({ timeout: 15000 })
      await page.waitForTimeout(2500)
      ok('openClearsDate', (await page.locator('.folio-floor__waiting').count()) === 0)
    } else {
      await page.goto(`${BASE}/folio/pages`, { waitUntil: 'domcontentloaded' })
      const slip = page.locator('.folio-slip')
      ok('slip', await slip.waitFor({ timeout: 15000 }).then(() => true, () => false) && (await slip.innerText()).includes('You asked to come back to this'))
      await axe('slip')
      await slip.getByRole('button', { name: 'Not now' }).click()
      ok('notNow', await slip.waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.folio-list').waitFor({ timeout: 15000 })
      await page.waitForTimeout(2500)
      ok('notNowHolds', (await page.locator('.folio-slip').count()) === 0)
    }

    // Lift into today's page, from the trace.
    await page.goto(`${BASE}/folio/kept/${originalId}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.folio-composition').waitFor({ timeout: 15000 })
    await openMenuItem("Lift into today's page")
    await page.waitForURL((u) => u.toString() === pageUrl, { timeout: 15000 })
    await page.locator('.folio-underside__from').waitFor({ timeout: 15000 })
    const lines = await page.locator('.folio-page .ProseMirror > p').allInnerTexts()
    ok('liftToday', lines.filter((t) => t.includes(LINE)).length === 2)
    await page.keyboard.type('Written today, beneath it.')
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })
    ok('liftTodayWrite', (await page.locator('.folio-page').innerText()).includes('Written today, beneath it.'))

    // Go to the page from the trace: the fold opens.
    await page.goto(`${BASE}/folio/kept/${copyId}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.folio-composition').waitFor({ timeout: 15000 })
    await openMenuItem('Go to the page')
    await page.waitForURL((u) => u.toString() === pageUrl, { timeout: 15000 })
    ok('goToPage', await page.locator('.folio-underside--open', { hasText: 'I felt cold the whole way.' }).waitFor({ timeout: 15000 }).then(() => true, () => false))

    // Delete the page and what was kept from it.
    await page.waitForTimeout(1500)
    await page.locator('.folio-topbar button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Delete page' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 10000 })
    await dialog.getByText(/Kept from this page: 2/).waitFor({ timeout: 10000 })
    ok('deleteDialog', true)
    await axe('deleteDialog')
    await dialog.getByRole('button', { name: 'Delete the page and what was kept from it' }).click()
    await page.waitForURL(/\/folio\/pages/, { timeout: 15000 })
    await page.goto(`${BASE}/folio/kept`, { waitUntil: 'domcontentloaded' })
    await page.locator('.folio-floor').waitFor({ timeout: 15000 })
    await page.waitForTimeout(2000)
    ok('allGone', (await page.locator('.folio-floor__trace').count()) === 0 && !(await page.locator('.folio-floor').innerText()).includes('the drive'))
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 240)
  } finally {
    // Clean up anything the check left: traces first, then pages.
    try {
      for (let i = 0; i < 6; i++) {
        await page.goto(`${BASE}/folio/kept`, { waitUntil: 'domcontentloaded' })
        await page.locator('.folio-floor').waitFor({ timeout: 15000 })
        await page.waitForTimeout(1500)
        const left = page.locator('.folio-floor__open')
        if ((await left.count()) === 0) break
        await left.first().click()
        await page.locator('.folio-trace__actions').waitFor({ timeout: 10000 })
        await openMenuItem('Delete')
        await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).last().click()
        await page.waitForURL(/\/folio\/kept$/, { timeout: 10000 })
        out.cleanedTraces = (out.cleanedTraces || 0) + 1
      }
      for (let i = 0; i < 4; i++) {
        await page.goto(`${BASE}/folio/pages`, { waitUntil: 'domcontentloaded' })
        await page.locator('.folio-list').waitFor({ timeout: 15000 })
        const left = page.locator('.folio-list li .folio-list__open', { hasText: MARK })
        if ((await left.count()) === 0) break
        await left.first().click()
        await editor.waitFor({ timeout: 15000 })
        await page.waitForTimeout(1000)
        await page.locator('.folio-topbar button[aria-haspopup="menu"]').click()
        await page.getByRole('menuitem', { name: 'Delete page' }).click()
        const d = page.getByRole('dialog')
        await d.waitFor({ timeout: 10000 })
        const both = d.getByRole('button', { name: 'Delete the page and what was kept from it' })
        if (await both.count()) await both.click()
        else await d.getByRole('button', { name: 'Delete' }).last().click()
        await page.waitForURL(/\/folio\/pages/, { timeout: 15000 })
        out.cleanedPages = (out.cleanedPages || 0) + 1
      }
    } catch (err) { out.cleanupError = String(err && err.message || err).split('\n')[0].slice(0, 160) }
    out.pageErrors = errors
    console.log(JSON.stringify(out, null, 1))
    await browser.close()
  }
  const stepsOk = Object.values(out.steps).every(Boolean) && Object.keys(out.steps).length >= 19
  const axeOk = Object.values(out.axe).every((v) => v.length === 0)
  process.exit(stepsOk && axeOk && !out.error ? 0 : 1)
})()
