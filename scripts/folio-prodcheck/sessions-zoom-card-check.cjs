// Production check of two Sessions fixes the owner decided on 2026-10-16
// (folio-build-plan §8.G):
// 1. Pinch zoom on the web: the viewport meta after boot, as an iPhone, an
//    iPad asking for desktop sites, a Pixel and a desktop see it.
// 2. The crisis card's contrast: as the test account, a fresh Session, one
//    Talk message that trips L1 (grounding, as the shore checks already do),
//    then axe's color-contrast on the card in light and dark.
// ONLY=viewport runs the first part alone.
const { chromium, devices } = require('playwright')
const { default: AxeBuilder } = require('@axe-core/playwright')
const { execFileSync } = require('child_process')

const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()

const WEB = 'width=device-width, initial-scale=1.0, viewport-fit=cover'
const VIEWPORTS = [
  ['iPhone', devices['iPhone 14'], `${WEB}, maximum-scale=1.0`],
  // A real iPad asking for desktop sites reports 5 touch points; Chromium's
  // touch emulation reports 1, so the page is told what an iPad says.
  ['iPadDesktop', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', hasTouch: true, isMobile: false, viewport: { width: 1024, height: 1366 }, maxTouchPoints: 5 }, `${WEB}, maximum-scale=1.0`],
  ['Pixel', devices['Pixel 7'], WEB],
  ['desktop', {}, WEB],
]

;(async () => {
  const browser = await chromium.launch()
  const out = { steps: {}, viewport: {}, contrast: {} }
  const ok = (k, v) => { out.steps[k] = !!v; return !!v }
  try {
    for (const [name, opts, expected] of VIEWPORTS) {
      const { maxTouchPoints, ...contextOpts } = opts
      const ctx = await browser.newContext({ ...contextOpts, serviceWorkers: 'block' })
      if (maxTouchPoints) await ctx.addInitScript((n) => { Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => n }) }, maxTouchPoints)
      const page = await ctx.newPage()
      await page.goto(BASE, { waitUntil: 'domcontentloaded' })
      await page.getByPlaceholder('Email').waitFor({ timeout: 30000 })
      const content = await page.locator('meta[name="viewport"]').getAttribute('content')
      out.viewport[name] = content
      ok(`viewport:${name}`, content === expected)
      await ctx.close()
    }

    if (process.env.ONLY === 'viewport') return
    const ctx = await browser.newContext({ serviceWorkers: 'block' })
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/(session|folio)\//, { timeout: 45000 })
    await page.goto(`${BASE}/session/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/session\/[0-9a-f-]{36}/, { timeout: 45000 })
    const composer = page.locator('.ProseMirror[contenteditable="true"]').last()
    await composer.waitFor({ timeout: 45000 })
    await page.waitForTimeout(6000)
    await composer.click()
    await page.keyboard.type('This is an automated safety check: I want to kill myself.')
    await page.keyboard.press('Enter')
    const card = page.locator('.crisis-resources')
    ok('cardShown', await card.waitFor({ timeout: 30000 }).then(() => true, () => false))
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForTimeout(1500)
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 8000 }).catch(() => {})
      const r = await new AxeBuilder({ page }).include('.crisis-resources').withRules(['color-contrast']).analyze()
      out.contrast[scheme] = r.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')} ${JSON.stringify(n.any[0]?.data?.contrastRatio ?? '')}`))
      ok(`contrast:${scheme}`, r.violations.length === 0 && r.passes.some((p) => p.id === 'color-contrast'))
    }
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 220)
  } finally {
    console.log(JSON.stringify(out, null, 1))
    await browser.close()
  }
  process.exit(Object.values(out.steps).every(Boolean) && Object.keys(out.steps).length >= (process.env.ONLY === 'viewport' ? 4 : 7) && !out.error ? 0 : 1)
})()
