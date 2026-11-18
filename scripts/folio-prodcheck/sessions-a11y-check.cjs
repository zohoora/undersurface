// Production check: the signed-in Sessions shell is axe-clean (WCAG 2.2 AA +
// best practice) on both papers, by day and by night (the palette follows the
// writer-local hour), with a Talk exchange on screen so the "end session"
// control is enabled; then the Journal surface, the open sidebar and the
// settings sheet. Test account only (password from the macOS Keychain,
// never printed); prints each violation with axe's reason.
// Added 2026-11-18 after this scan found the in-session cards' ghost text at
// 2.4-3.1:1, no landmarks, and a 2.1:1 end-session control.
const device = require('./device.cjs')
const { default: AxeBuilder } = require('@axe-core/playwright')
const { execFileSync } = require('child_process')

const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
// Two writer-local hours for whatever time the check runs: Toronto and Tokyo
// are 13-14 hours apart, so one of them is always in a night band.
const ZONES = ['America/Toronto', 'Asia/Tokyo']
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()

;(async () => {
  const browser = await device.launch()
  const problems = []
  for (const colorScheme of ['light', 'dark']) {
    for (const timezoneId of ZONES) {
      const label = `${colorScheme}/${timezoneId}`
      const context = await device.newContext(browser, { serviceWorkers: 'block', colorScheme, timezoneId })
      const page = await context.newPage()
      try {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' })
        await page.getByPlaceholder('Email').fill(EMAIL)
        await page.getByPlaceholder('Password').fill(password())
        await page.getByRole('button', { name: 'Sign in', exact: true }).click()
        await page.waitForURL(/\/(session|folio)\//, { timeout: 45000 })
        await page.goto(`${BASE}/session/new`, { waitUntil: 'domcontentloaded' })
        const composer = page.locator('.ProseMirror[contenteditable="true"]').last()
        await composer.waitFor({ timeout: 45000 })
        await page.waitForTimeout(9000) // the opener streams in
        await composer.click()
        await page.keyboard.type('This is an automated accessibility check. One short sentence back, please.')
        await page.keyboard.press('Enter')
        await page.locator('.session-end-btn:not([disabled])').waitFor({ timeout: 60000 })
        await page.waitForTimeout(12000) // the reply streams in and its fades settle
        const scan = async (view) => {
          await page.waitForTimeout(1500)
          const result = await new AxeBuilder({ page }).withTags(TAGS).analyze()
          for (const v of result.violations) for (const n of v.nodes) {
            const why = (n.failureSummary || '').replace(/\s+/g, ' ').trim()
            problems.push(`${label} ${view}: ${v.id} ${n.target.join(' ')} (${why})`)
          }
          console.log(`${label} ${view}: ${result.violations.length} rule(s) violated`)
        }
        await scan('talk')
        await page.getByRole('button', { name: 'Journal', exact: true }).click()
        await scan('journal')
        await page.getByRole('button', { name: 'Talk', exact: true }).click()
        await page.getByRole('button', { name: 'Expand navigation' }).click()
        await scan('sidebar open')
        await page.getByRole('button', { name: 'Open settings' }).click()
        await scan('settings sheet')
      } catch (err) {
        problems.push(`${label}: ${String(err && err.message || err).split('\n')[0].slice(0, 200)}`)
      }
      await context.close()
    }
  }
  await browser.close()
  if (problems.length) console.log(problems.join('\n'))
  process.exit(problems.length ? 1 : 0)
})()
