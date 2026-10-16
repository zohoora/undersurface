// Production check for Step inside (build plan step 8, H1) as the test account:
// enter from an open fold, axe on both papers, stand closer, choose Forest and
// see the track load from the bucket with CORS (the Web Audio path), leave to
// the page and back to write, then delete the page. Statuses only.
const device = require('./device.cjs')
const { default: AxeBuilder } = require('@axe-core/playwright')
const { execFileSync } = require('child_process')

const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

;(async () => {
  const browser = await device.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await device.newContext(browser, { serviceWorkers: 'block', colorScheme: 'light' })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  const out = { steps: {}, axe: {}, audio: [] }
  const ok = (k, v) => { out.steps[k] = !!v; return !!v }
  // A media element in CORS mode sends Origin (added by the network stack, so
  // read allHeaders); the volume-only fallback would request without it.
  // Media elements routinely abort and re-request ranges (ERR_ABORTED).
  page.on('request', async (r) => { if (r.url().includes('seed-audio')) { const h = await r.allHeaders().catch(() => ({})); out.audio.push(`${r.url().split('/').pop()}:req:${h.origin ? 'cors' : 'no-cors'}`) } })
  page.on('response', async (r) => { if (r.url().includes('seed-audio')) { const h = await r.allHeaders().catch(() => ({})); out.audio.push(`${r.url().split('/').pop()}:${r.status()}:acao=${h['access-control-allow-origin'] ? 'yes' : 'no'}`) } })
  page.on('requestfailed', (r) => { if (r.url().includes('seed-audio')) out.audio.push(`${r.url().split('/').pop()}:failed:${r.failure()?.errorText}`) })
  const { mod } = device.keys()
  const editor = page.locator('.folio-page .ProseMirror[contenteditable="true"]')
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
    await page.waitForURL(/\/(session\/[0-9a-f-]{36}|folio\/)/, { timeout: 45000 })
    await device.settle(page)
    await page.goto(`${BASE}/folio/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/folio\/p\//, { timeout: 30000 })
    await editor.waitFor({ timeout: 30000 })
    await editor.focus()
    await page.keyboard.type('We drove back late.')
    await device.enter(page)
    await page.keyboard.type('The heater only worked on one side.')
    await page.waitForTimeout(250)
    await device.lift(page, 'The heater only worked on one side.')
    await page.keyboard.type('I felt cold the whole way.')
    await page.locator('.folio-status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })

    await page.locator('[data-folio-step-inside]').click()
    const dialog = page.getByRole('dialog', { name: /The heater only worked on one side\., inside/ })
    ok('entered', await dialog.waitFor({ timeout: 10000 }).then(() => true, () => false))
    ok('reads', (await dialog.innerText()).includes('I felt cold the whole way.'))
    await axe('insideLight')
    await page.emulateMedia({ colorScheme: 'dark' })
    await axe('insideDark')
    await page.emulateMedia({ colorScheme: 'light' })
    await dialog.getByRole('button', { name: 'Stand closer' }).click()
    ok('closer', /--folio-stand: 1\.3/.test(await dialog.locator('.folio-inside__stage').getAttribute('style')))
    await dialog.getByRole('button', { name: 'Forest' }).click()
    await page.waitForTimeout(4000)
    ok('forestCors', out.audio.some((a) => a === 'forest.mp3:req:cors') && out.audio.some((a) => /^forest\.mp3:20[06]:acao=yes$/.test(a)) && !out.audio.some((a) => a === 'forest.mp3:req:no-cors') && !out.audio.some((a) => /failed:(?!net::ERR_ABORTED)/.test(a)))
    ok('pressed', (await dialog.getByRole('button', { name: 'Forest' }).getAttribute('aria-pressed')) === 'true')

    await page.keyboard.press('Escape')
    ok('leftToPage', await dialog.waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false))
    await page.locator('[data-folio-step-inside]').click()
    await dialog.waitFor({ timeout: 10000 })
    ok('rememberedForest', (await dialog.getByRole('button', { name: 'Forest' }).getAttribute('aria-pressed')) === 'true')
    await dialog.getByRole('button', { name: 'Silence' }).click()
    await dialog.getByRole('button', { name: 'Back and write' }).click()
    await dialog.waitFor({ state: 'detached', timeout: 5000 })
    await page.waitForTimeout(200)
    await page.keyboard.type(' Mostly my feet.')
    await page.locator('.folio-status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })
    ok('wroteBeneath', (await page.locator('.folio-underside--open').innerText()).includes('I felt cold the whole way. Mostly my feet.'))

    await page.waitForTimeout(1500)
    await page.locator('.folio-topbar button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Delete page' }).click()
    const d = page.getByRole('dialog')
    await d.waitFor({ timeout: 10000 })
    await d.getByRole('button', { name: 'Delete' }).last().click()
    ok('deleted', await page.waitForURL(/\/folio\/pages/, { timeout: 15000 }).then(() => true, () => false))
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 220)
  } finally {
    console.log(JSON.stringify(out, null, 1))
    await browser.close()
  }
  const good = Object.values(out.steps).every(Boolean) && Object.keys(out.steps).length >= 9 && Object.values(out.axe).every((v) => v.length === 0) && !out.error
  process.exit(good ? 0 : 1)
})()
