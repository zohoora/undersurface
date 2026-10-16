// Production check: Sessions still works for a signed-in writer.
// Signs in as the Folio test account (password read from the macOS Keychain,
// never printed), completes onboarding if shown, opens a Session, sends one
// Talk message and waits for a successful streamed /api/chat reply.
// Prints only statuses, never credentials or message content beyond the probe.
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')

const EMAIL = 'folio-test@undersurface.me'
const BASE = process.env.BASE_URL || 'https://undersurface.me'

function password() {
  return execFileSync('security', ['find-generic-password', '-s', 'undersurface-folio-test', '-a', EMAIL, '-w'], { encoding: 'utf8' }).trim()
}

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  const chatCalls = []
  page.on('request', (req) => {
    if (req.url().includes('/api/chat') && req.method() === 'POST') {
      let task = 'chat'
      try { task = JSON.parse(req.postData() || '{}').task || 'chat' } catch { /* not JSON */ }
      req._task = task
    }
  })
  page.on('response', async (res) => {
    const req = res.request()
    if (req.url().includes('/api/chat') && req.method() === 'POST') {
      chatCalls.push({ task: req._task, status: res.status() })
    }
  })

  const result = { signIn: false, onboarding: 'skipped', session: false, talkReply: false, classifier: null }
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 200)))
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Either onboarding or the session shell appears.
    const composer = page.locator('.ProseMirror[contenteditable="true"]').last()
    const onboarding = page.getByText('Welcome to UnderSurface')
    await Promise.race([
      composer.waitFor({ timeout: 45000 }),
      onboarding.waitFor({ timeout: 45000 }),
    ])
    result.signIn = true
    if (await onboarding.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Continue' }).click()
      for (const box of await page.locator('input[type="checkbox"]').all()) await box.check()
      await page.getByRole('button', { name: /begin/i }).click()
      result.onboarding = 'completed'
    }
    await page.waitForURL(/\/(session|folio)\//, { timeout: 45000 })
    // Always a fresh session, so earlier checks' sessions can't interfere.
    if (process.env.FRESH !== '0') await page.goto(`${BASE}/session/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/session\//, { timeout: 45000 })
    await composer.waitFor({ timeout: 45000 })
    result.session = true

    // Let the opener (a chat call on a new session) finish before sending.
    const inflight = new Set()
    page.on('request', (req) => { if (req.url().includes('/api/chat')) inflight.add(req) })
    page.on('requestfinished', (req) => inflight.delete(req))
    page.on('requestfailed', (req) => inflight.delete(req))
    for (let quiet = 0, i = 0; quiet < 6 && i < 120; i++) { await page.waitForTimeout(500); quiet = inflight.size === 0 ? quiet + 1 : 0 }
    const before = chatCalls.length
    await composer.click()
    await page.keyboard.type('This is an automated check. Please reply with one short sentence.')
    await page.keyboard.press('Enter')
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const after = chatCalls.slice(before)
      const reply = after.find((c) => c.task === 'chat')
      const classifier = after.find((c) => c.task === 'crisis_check')
      if (classifier) result.classifier = classifier.status
      if (reply && classifier) { result.talkReply = reply.status === 200; break }
      if (reply && Date.now() > deadline - 60000) { result.talkReply = reply.status === 200; break }
      await page.waitForTimeout(1000)
    }
  } catch (err) {
    result.error = String(err && err.message || err).split('\n')[0].slice(0, 200)
  } finally {
    result.chatCalls = chatCalls.map((c) => `${c.task}:${c.status}`)
    result.consoleErrors = consoleErrors.slice(0, 8)
    result.url = page.url()
    console.log(JSON.stringify(result))
    await browser.close()
  }
  process.exit(result.signIn && result.session && result.talkReply && result.classifier === 200 ? 0 : 1)
})()
