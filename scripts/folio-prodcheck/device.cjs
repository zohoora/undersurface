// The browser a production check runs in. Unset: desktop Chrome. DEVICE=pixel
// runs Chrome as a Pixel 7, DEVICE=iphone runs WebKit (Safari's engine) as an
// iPhone 14: each device's screen, touch, coarse pointer and user agent.
// Emulation, not a real phone: real iOS editing, Android keyboards and IMEs
// are the owner's device checks (folio-build-plan §8 A–B).
const { chromium, webkit, devices } = require('playwright')

// `platform` is what the real phone reports. Emulation keeps the host's
// navigator.platform ("MacIntel" on a Mac), which splits the editor's Mod key
// between Mac and Android rules; the real value keeps them in agreement.
const PHONES = {
  pixel: { engine: chromium, descriptor: devices['Pixel 7'], platform: 'Linux armv81', mod: 'Control', docEnd: 'Control+End' },
  iphone: { engine: webkit, descriptor: devices['iPhone 14'], platform: 'iPhone', mod: 'Meta', docEnd: 'Meta+ArrowDown' },
}

function phone() {
  const name = process.env.DEVICE
  if (!name) return null
  const p = PHONES[name]
  if (!p) throw new Error(`DEVICE must be one of: ${Object.keys(PHONES).join(', ')}`)
  return p
}

/** Launch the device's engine. Chromium-only launch options are dropped on WebKit. */
function launch(options = {}) {
  const p = phone()
  if (p && p.engine === webkit) return webkit.launch()
  return chromium.launch(options)
}

/** Context options: the device's, then the check's own (permissions WebKit lacks are dropped). */
function contextOptions(extra = {}) {
  const p = phone()
  const merged = { ...(p ? p.descriptor : {}), ...extra }
  if (p && p.engine === webkit && merged.permissions) {
    merged.permissions = merged.permissions.filter((x) => !x.startsWith('clipboard-'))
  }
  return merged
}

/** A new context for the device, its platform reported as the real phone's. */
async function newContext(browser, extra = {}) {
  const p = phone()
  const context = await browser.newContext(contextOptions(extra))
  if (p) await context.addInitScript((platform) => { Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform }) }, p.platform)
  return context
}

/** The editor's Mod key and end-of-document keys on this device. */
function keys() {
  const p = phone()
  if (p) return { mod: p.mod, docEnd: p.docEnd }
  const mac = process.platform === 'darwin'
  return { mod: mac ? 'Meta' : 'Control', docEnd: mac ? 'Meta+ArrowDown' : 'Control+End' }
}

/**
 * Lift as this device's writer does. Desktop: the shortcut. A phone: select
 * the line (when `line` is given, the caret is at its end) and tap Lift in
 * the bottom bar. Android Chrome never runs the Enter chord: ProseMirror lets
 * the browser handle Enter and reads the DOM change (folio-spikes.md, S2).
 */
async function lift(page, line) {
  if (!phone()) { await page.keyboard.press(`${keys().mod}+Shift+Enter`); return }
  if (line) for (let i = 0; i < line.length; i++) await page.keyboard.press('Shift+ArrowLeft')
  const button = page.locator('.folio-touchbar').getByRole('button', { name: 'Write beneath', exact: true })
  await button.waitFor({ timeout: 5000 })
  await button.tap()
}

/** Open or close the fold at the caret: the shortcut on desktop, the crease on a phone. */
async function toggleFold(page) {
  if (!phone()) { await page.keyboard.press(`${keys().mod}+Shift+Enter`); return }
  await page.locator('button.folio-crease').first().tap()
}

/**
 * After sign-in, wait until the address stops changing. The app can redirect
 * to the day's active session a moment after the first session URL, and
 * WebKit lets that late redirect interrupt the check's next page.goto.
 */
async function settle(page, quietMs = 2000, maxMs = 15000) {
  const start = Date.now()
  let last = page.url()
  let since = Date.now()
  while (Date.now() - start < maxMs) {
    await page.waitForTimeout(250)
    if (page.url() !== last) { last = page.url(); since = Date.now() }
    else if (Date.now() - since >= quietMs) return
  }
}

/**
 * Enter, then a person's pause on a phone: on iOS ProseMirror waits for the
 * browser's own Enter before splitting the paragraph, and a script that types
 * at once can land its text first (CLAUDE.md, Folio gotchas).
 */
async function enter(page) {
  await page.keyboard.press('Enter')
  if (phone()) await page.waitForTimeout(300)
}

module.exports = { enter, settle, launch, contextOptions, newContext, keys, lift, toggleFold, isPhone: () => phone() !== null, deviceName: () => process.env.DEVICE || 'desktop' }
