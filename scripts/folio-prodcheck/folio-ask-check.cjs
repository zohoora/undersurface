// Production check for Ask (build plan step 9, H2) as the test account. Prints
// statuses only, never note text or request bodies.
const { chromium } = require('playwright')
const { default: AxeBuilder } = require('@axe-core/playwright')
const { execFileSync } = require('child_process')

const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
const OTHER = 'We drove back late.'
const ASKED = 'The heater only worked on one side.'

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'block', colorScheme: 'light', permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  const out = { steps: {}, axe: {}, chats: [] }
  const ok = (k, v) => { out.steps[k] = !!v; return !!v }
  const companionBodies = []
  page.on('request', (r) => {
    if (!r.url().includes('/api/chat') || r.method() !== 'POST') return
    let body = {}
    try { body = JSON.parse(r.postData() || '{}') } catch { /* nothing */ }
    out.chats.push(body.task || 'companion')
    if (!body.task) companionBodies.push(JSON.stringify(body.messages || []))
  })
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const editor = page.locator('.folio-page .ProseMirror[contenteditable="true"]')
  const status = page.locator('.folio-status')
  const selectBack = async (n) => { for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowLeft') }
  const axe = async (name) => {
    await page.waitForTimeout(600)
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    out.axe[name] = r.violations.map((v) => `${v.id}:${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join('|')}`)
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
    await page.keyboard.type(`${OTHER} ${ASKED}`)
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })

    // Ask about one sentence; only it is sent.
    await selectBack(ASKED.length)
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    const note = page.locator('.folio-note--note')
    ok('noteShown', await note.waitFor({ timeout: 90000 }).then(() => true, () => false))
    ok('labelled', (await note.getAttribute('aria-label')) === 'Companion' && (await note.locator('.folio-note__label').innerText()) === 'Companion')
    ok('noteText', (await note.locator('.folio-note__text').innerText()).trim().length > 0)
    ok('onlySelectionSent', companionBodies.length === 1 && companionBodies[0].includes(ASKED) && !companionBodies[0].includes(OTHER))
    ok('l2Ran', out.chats.includes('crisis_check'))
    await axe('noteLight')
    await page.emulateMedia({ colorScheme: 'dark' })
    await axe('noteDark')
    await page.emulateMedia({ colorScheme: 'light' })

    // Keep: saved with the page, there after a reload; Delete removes it.
    await note.getByRole('button', { name: 'Keep' }).click()
    ok('kept', await page.locator('.folio-note--kept').waitFor({ timeout: 5000 }).then(() => true, () => false))
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })
    await page.waitForTimeout(1500)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await editor.waitFor({ timeout: 30000 })
    ok('keptAfterReload', await page.locator('.folio-note--kept').waitFor({ timeout: 15000 }).then(() => true, () => false))
    await page.locator('.folio-note--kept').getByRole('button', { name: 'Delete note' }).click()
    ok('deletedNote', await page.locator('.folio-note--kept').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false))
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })

    // Dismiss: never stored.
    await editor.focus()
    await page.keyboard.press(`${mod}+End`).catch(() => {})
    await page.keyboard.press('End')
    await selectBack(ASKED.length)
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    await page.locator('.folio-note--note').waitFor({ timeout: 90000 })
    await page.locator('.folio-note--note').getByRole('button', { name: 'Dismiss' }).click()
    ok('dismissed', (await page.locator('.folio-note').count()) === 0)

    // An L1 match on the selection: grounding, and nothing sent to the companion.
    const before = companionBodies.length
    await editor.focus()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    const risky = 'Tonight I will kill myself.'
    await page.keyboard.type(risky)
    await page.locator('.folio-shore-line').waitFor({ timeout: 15000 }).catch(() => {})
    await selectBack(risky.length)
    await page.waitForTimeout(200)
    const askButton = page.getByRole('button', { name: 'Ask', exact: true })
    if (await askButton.count()) await askButton.click()
    await page.waitForTimeout(3000)
    ok('l1SendsNothing', companionBodies.length === before)
    ok('shore', (await page.locator('.folio-root[data-shore="true"]').count()) === 1)
    await page.getByRole('button', { name: "I'm okay" }).first().click()

    await page.waitForTimeout(2500)
    await page.locator('.folio-topbar button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Delete page' }).click()
    const d = page.getByRole('dialog')
    await d.waitFor({ timeout: 10000 })
    await d.getByRole('button', { name: 'Delete' }).last().click()
    ok('deletedPage', await page.waitForURL(/\/folio\/pages/, { timeout: 15000 }).then(() => true, () => false))
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 220)
  } finally {
    console.log(JSON.stringify(out, null, 1))
    await browser.close()
  }
  const good = Object.values(out.steps).every(Boolean) && Object.keys(out.steps).length >= 12 && Object.values(out.axe).every((v) => v.length === 0) && !out.error
  process.exit(good ? 0 : 1)
})()
