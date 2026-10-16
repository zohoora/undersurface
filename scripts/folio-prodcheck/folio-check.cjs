// Production check: Folio works end to end for the test account (build plan
// §6). Writes, lifts, writes beneath, closes, reloads, checks the words and the
// closed fold survived, checks a safety call ran, checks shore and "I'm okay"
// on a line the safety floor matches, then deletes the test page.
// Prints statuses only; the password comes from the Keychain at run time.
const device = require('./device.cjs')
const { execFileSync } = require('child_process')

const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()

;(async () => {
  const browser = await device.launch()
  const context = await device.newContext(browser, { serviceWorkers: 'block' })
  const page = await context.newPage()
  const calls = []
  page.on('request', (req) => {
    if (req.url().includes('/api/chat') && req.method() === 'POST') {
      try { req._task = JSON.parse(req.postData() || '{}').task || 'chat' } catch { req._task = '?' }
    }
  })
  page.on('response', (res) => { const r = res.request(); if (r._task) calls.push(`${r._task}:${res.status()}`) })
  page.on('dialog', (d) => d.accept())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))

  const out = { signIn: false, folio: false, saved: false, lifted: false, closedHidden: false, persisted: false, closedAfterReload: false, safetyCall: false, shore: false, okayQuiet: false, deleted: false }
  const { mod } = device.keys()
  const editor = page.locator('.folio-page .ProseMirror[contenteditable="true"]')
  const status = page.locator('.folio-status')
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/(session\/[0-9a-f-]{36}|folio\/)/, { timeout: 45000 })
    await device.settle(page)
    out.signIn = true

    await page.goto(`${BASE}/folio/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/folio\/p\//, { timeout: 30000 })
    await editor.waitFor({ timeout: 30000 })
    out.folio = true

    await editor.click()
    await page.keyboard.type('We drove back late. The heater only worked on one side.')
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })
    out.saved = true

    // Lift the second sentence with the keyboard, write beneath it.
    await page.keyboard.press('End')
    for (let i = 0; i < 'The heater only worked on one side.'.length; i++) await page.keyboard.press('Shift+ArrowLeft')
    await device.lift(page)
    await page.keyboard.type('I felt cold the whole way.')
    out.lifted = (await page.locator('.folio-underside--open').count()) === 1
    await page.keyboard.press('Escape')
    out.closedHidden = !(await page.locator('.folio-page').innerText()).includes('I felt cold the whole way.')
    await page.waitForTimeout(2500)
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })
    const url = page.url()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await editor.waitFor({ timeout: 30000 })
    const text = await page.locator('.folio-page').innerText()
    out.persisted = text.includes('We drove back late.')
    out.closedAfterReload = !text.includes('I felt cold the whole way.')
    await page.locator('button.folio-crease').first().click()
    out.persisted = out.persisted && (await page.locator('.folio-page').innerText()).includes('I felt cold the whole way.')
    out.safetyCall = calls.some((c) => c === 'crisis_check:200')

    // Shore: a line the deterministic floor matches. Then "I'm okay".
    await editor.click()
    await page.keyboard.press(`${mod}+End`)
    await device.enter(page)
    await page.keyboard.type('Tonight I will kill myself.')
    await page.locator('.folio-shore-line').waitFor({ timeout: 15000 })
    out.shore = (await page.locator('.folio-root[data-shore="true"]').count()) === 1
    await page.getByRole('button', { name: "I'm okay" }).first().click()
    await page.waitForTimeout(300)
    out.okayQuiet = (await page.locator('.folio-root[data-quiet="true"]').count()) === 1 && (await page.locator('.folio-shore-line').count()) === 0

    // Clean up: delete the test page.
    await page.waitForTimeout(2500)
    await page.locator('button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Delete page' }).click()
    { const d = page.getByRole('dialog'); await d.waitFor({ timeout: 10000 }); const both = d.getByRole('button', { name: 'Delete the page and what was kept from it' }); if (await both.count()) await both.click(); else await d.getByRole('button', { name: 'Delete' }).last().click() }
    await page.waitForURL(/\/folio\/pages/, { timeout: 15000 })
    out.deleted = !(await page.locator('.folio-list').innerText()).includes('We drove back late.')
    out.page = url.replace(BASE, '')
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 220)
  } finally {
    out.calls = calls
    out.pageErrors = errors
    console.log(JSON.stringify(out))
    await browser.close()
  }
  const ok = ['signIn', 'folio', 'saved', 'lifted', 'closedHidden', 'persisted', 'closedAfterReload', 'safetyCall', 'shore', 'okayQuiet', 'deleted'].every((k) => out[k])
  process.exit(ok ? 0 : 1)
})()
