// Production accessibility check for Folio (build plan step 6): axe on the
// real app's rendered pixels (pages list; a page with a fold open and a
// between; light and dark paper; shore) and the keyboard-only path (lift,
// distance, between, close, find by the discovery keys, reopen). Prints
// statuses and violation ids only; the password comes from the Keychain.
const device = require('./device.cjs')
const { default: AxeBuilder } = require('@axe-core/playwright')
const { execFileSync } = require('child_process')

const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'
const password = () => execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

;(async () => {
  const browser = await device.launch()
  const context = await device.newContext(browser, { serviceWorkers: 'block', colorScheme: 'light' })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  const out = { signIn: false, axe: {}, keyboard: {}, deleted: false }
  const { mod } = device.keys()
  // The end of the document: Cmd+Down on a Mac, Ctrl+End elsewhere.
  const { docEnd } = device.keys()
  const editor = page.locator('.folio-page .ProseMirror[contenteditable="true"]')
  const status = page.locator('.folio-status')
  const live = page.locator('.folio-root > .folio-visually-hidden[role="status"]')
  // The live region is cleared, then set on the next frame.
  const said = async () => { await page.waitForTimeout(200); return live.innerText() }
  const axe = async (name) => {
    await page.waitForTimeout(800)
    // Measure at rest: finite animations (fades, the card's entrance) done.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {})
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    out.axe[name] = r.violations.map((v) => `${v.id}(${v.impact}):${v.nodes.slice(0, 3).map((n) => n.target.join(' ') + (v.id === 'color-contrast' ? ` [${(n.any[0] && n.any[0].data && JSON.stringify(n.any[0].data)) || ''}]` : '')).join('|')}`)
  }
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/(session\/[0-9a-f-]{36}|folio\/)/, { timeout: 45000 })
    await device.settle(page)
    out.signIn = true

    await page.goto(`${BASE}/folio/pages`, { waitUntil: 'domcontentloaded' })
    await page.locator('.folio-root').waitFor({ timeout: 30000 })
    await axe('pagesLight')

    await page.goto(`${BASE}/folio/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/folio\/p\//, { timeout: 30000 })
    await editor.waitFor({ timeout: 30000 })
    await axe('blankLight')

    // Keyboard only from here: write, lift, distance, between.
    await editor.focus()
    await page.keyboard.type('We drove back late.')
    await device.enter(page)
    await page.keyboard.type('The heater only worked on one side.')
    await device.lift(page, 'The heater only worked on one side.')
    out.keyboard.lifted = (await said()) === 'Lifted. Writing beneath.'
    await page.keyboard.type('I felt cold the whole way.')
    // Distance: the keys on a desktop; on a phone, the Farther button.
    if (device.isPhone()) {
      const farther = page.getByRole('button', { name: 'Farther', exact: true }).first()
      await farther.tap(); await farther.tap()
    } else {
      await page.keyboard.press(`${mod}+Alt+BracketRight`)
      await page.keyboard.press(`${mod}+Alt+BracketRight`)
    }
    out.keyboard.farther = (await said()) === 'Farther: apart, 3 of 5'
    // Between: arrow up from the beneath; on a phone, tap it.
    if (device.isPhone()) await page.locator('[data-folio-between]').tap()
    else await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(150)
    await page.keyboard.type('The radio.')
    out.keyboard.between = (await page.locator('[data-folio-between]').innerText()).includes('The radio.')
    await status.filter({ hasText: /^Saved$/ }).waitFor({ timeout: 20000 })
    await axe('foldOpenLight')

    // Close: Escape on a desktop; on a phone, the crease.
    if (device.isPhone()) await device.toggleFold(page)
    else await page.keyboard.press('Escape')
    out.keyboard.closed = !(await page.locator('.folio-page').innerText()).includes('I felt cold')
    // Finding a fold by key is a hardware-keyboard path; phones skip it (as CI does).
    if (device.isPhone()) {
      out.keyboard.found = 'n/a on touch'
    } else {
      await page.keyboard.press(docEnd)
      await page.waitForTimeout(150) // a person's pause; the editor reads the caret on selectionchange
      await page.keyboard.press(`${mod}+Alt+Comma`)
      out.keyboard.foundSaid = await said()
      out.keyboard.found = out.keyboard.foundSaid === "Writing beneath 'The heater only worked on one side.', closed"
    }
    await device.toggleFold(page)
    out.keyboard.reopened = (await page.locator('.folio-page').innerText()).includes('I felt cold the whole way.')
    await axe('foldOpenSettledLight')

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForTimeout(400)
    out.dark = await page.evaluate(() => document.documentElement.dataset.theme)
    await axe('foldOpenDark')

    // Shore (dark, then light): a line the deterministic floor matches.
    await editor.focus()
    await page.keyboard.press(docEnd)
    await device.enter(page)
    await page.keyboard.type('Tonight I will kill myself.')
    await page.locator('.folio-shore-line').waitFor({ timeout: 15000 })
    await axe('shoreDark')
    await page.emulateMedia({ colorScheme: 'light' })
    await axe('shoreLight')
    await page.getByRole('button', { name: "I'm okay" }).first().click()
    await axe('quietLight')

    await page.waitForTimeout(2500)
    await page.locator('button[aria-haspopup="menu"]').click()
    await axe('menuLight')
    await page.getByRole('menuitem', { name: 'Reading view' }).click()
    await page.locator('.folio-reading').waitFor({ timeout: 15000 })
    await axe('readingLight')
    await page.emulateMedia({ colorScheme: 'dark' })
    await axe('readingDark')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.locator('button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Back to writing' }).click()
    await editor.waitFor({ timeout: 15000 })
    await page.locator('button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Folio settings' }).click()
    await page.getByRole('dialog').waitFor({ timeout: 5000 })
    await axe('settingsLight')
    await page.getByRole('dialog').getByRole('button').last().click()
    await page.locator('button[aria-haspopup="menu"]').click()
    await page.getByRole('menuitem', { name: 'Delete page' }).click()
    { const d = page.getByRole('dialog'); await d.waitFor({ timeout: 10000 }); const both = d.getByRole('button', { name: 'Delete the page and what was kept from it' }); if (await both.count()) await both.click(); else await d.getByRole('button', { name: 'Delete' }).last().click() }
    await page.waitForURL(/\/folio\/pages/, { timeout: 15000 })
    out.deleted = !(await page.locator('.folio-list').innerText().catch(() => '')).includes('We drove back late.')
  } catch (err) {
    out.error = String(err && err.message || err).split('\n')[0].slice(0, 220)
  } finally {
    // Remove any page this check left behind (the test account's own pages only).
    try {
      for (let i = 0; i < 5; i++) {
        await page.goto(`${BASE}/folio/pages`, { waitUntil: 'domcontentloaded' })
        await page.locator('.folio-list').waitFor({ timeout: 15000 })
        const left = page.locator('.folio-list li .folio-list__open', { hasText: 'We drove back late.' })
        if ((await left.count()) === 0) break
        await left.first().click()
        await editor.waitFor({ timeout: 15000 })
        await page.waitForTimeout(1000)
        await page.locator('button[aria-haspopup="menu"]').click()
        await page.getByRole('menuitem', { name: 'Delete page' }).click()
    { const d = page.getByRole('dialog'); await d.waitFor({ timeout: 10000 }); const both = d.getByRole('button', { name: 'Delete the page and what was kept from it' }); if (await both.count()) await both.click(); else await d.getByRole('button', { name: 'Delete' }).last().click() }
        await page.waitForURL(/\/folio\/pages/, { timeout: 15000 })
        out.cleanedUp = (out.cleanedUp || 0) + 1
      }
    } catch (err) { out.cleanupError = String(err && err.message || err).split('\n')[0].slice(0, 160) }
    console.log(JSON.stringify(out, null, 1))
    await browser.close()
  }
  const axeClean = Object.values(out.axe).every((v) => v.length === 0)
  const keysOk = ['lifted', 'farther', 'between', 'closed', 'found', 'reopened'].every((k) => out.keyboard[k])
  process.exit(out.signIn && axeClean && keysOk && out.deleted && !out.error ? 0 : 1)
})()
