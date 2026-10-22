import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Folio's automated accessibility acceptance (build plan step 6; draft 4
// §3.10): axe on rendered pixels with the app's real styles, on both papers
// and in shore; visible focus; target sizes; and the six scripted tasks,
// keyboard only. Screen readers with the curtain on are the owner's checklist.

type Json = Record<string, unknown>

const p = (text: string, pid: string, fold?: string): Json => (text
  ? { type: 'paragraph', attrs: { pid }, content: [{ type: 'text', text, ...(fold ? { marks: [{ type: 'fold', attrs: { foldId: fold } }] } : {}) }] }
  : { type: 'paragraph', attrs: { pid } })
const doc = (...content: Json[]): Json => ({ type: 'doc', content })

const COMPOSED = doc(
  p('Before.', 'p1'),
  p('It was nice to see everyone.', 'p2', 'f1'),
  { type: 'underside', attrs: { foldId: 'f1', gap: 2 }, content: [
    { type: 'between', content: [p('The drive home.', 'p3')] },
    { type: 'beneath', content: [p('I felt absent the whole time.', 'p4')] },
  ] },
  p('The soup was cold.', 'p5', 'f2'),
  { type: 'underside', attrs: { foldId: 'f2', gap: 0 }, content: [{ type: 'beneath', content: [p('Closed words.', 'p6')] }] },
  p('After.', 'p7'),
)

async function setup(page: Page, query: string, content?: Json) {
  await page.goto(`/e2e/harness/folio-page.html${query}`)
  // The body has no height (Folio's root is fixed), so wait for attachment.
  await page.waitForSelector('body[data-ready="true"]', { state: 'attached' })
  if (content) await page.evaluate((c) => (window as never as { folio: { load: (c: unknown) => void } }).folio.load(c), content)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => {
    const api = (window as never as { folio: Record<string, (...x: unknown[]) => unknown> }).folio
    return api[n as string](...(a as unknown[]))
  }, [name, args] as const) as Promise<T>
}

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

for (const theme of ['light', 'dark'] as const) {
  for (const presentation of ['normal', 'shore'] as const) {
    test(`axe: ${theme} paper, ${presentation}, a fold open with a between and one closed`, async ({ page }) => {
      await setup(page, `?theme=${theme}&presentation=${presentation}`, COMPOSED)
      await page.locator('button.folio-crease').first().click()
      await expect(page.locator('[data-folio-between]')).toContainText('The drive home.')
      // Let the settle transition finish so contrast is read at rest.
      await page.waitForTimeout(700)
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
      const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
      expect(summary).toEqual([])
    })
  }
}

// A wash with nothing on it is a line-shaped blur, which reads as text hidden
// from the writer (a writer's report, 2026-10-16): an empty passage is bare
// paper until the first word. axe can't see this: there is no text to measure.
for (const theme of ['light', 'dark'] as const) {
  test(`${theme} paper: an empty beneath has no wash until the first word`, async ({ page }) => {
    await setup(page, `?theme=${theme}`, doc(
      p('It was nice to see everyone.', 'p1', 'f1'),
      { type: 'underside', attrs: { foldId: 'f1', gap: 0 }, content: [{ type: 'beneath', content: [p('', 'p2')] }] },
      p('The soup was cold.', 'p3', 'f2'),
      { type: 'underside', attrs: { foldId: 'f2', gap: 0 }, content: [{ type: 'beneath', content: [p('Closed words.', 'p4')] }] },
    ))
    await page.locator('button.folio-crease').nth(0).click()
    await page.locator('button.folio-crease').nth(1).click()
    const beneath = page.locator('.folio-underside--open [data-folio-beneath]')
    await expect(beneath).toHaveCount(2)
    const wash = (i: number) => beneath.nth(i).evaluate((el) => getComputedStyle(el, '::before').opacity)
    await expect.poll(() => wash(0)).toBe('0')
    await expect.poll(() => wash(1)).toBe('1')
    await beneath.nth(0).locator('p').click()
    await page.waitForTimeout(200)
    await page.keyboard.type('Now.')
    await expect(beneath.nth(0)).toContainText('Now.')
    await expect.poll(() => wash(0)).toBe('1')
  })
}

test('focus is visible on the crease, the underside controls and the top bar', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard focus is a desktop path')
  await setup(page, '?theme=light', COMPOSED)
  await page.locator('button.folio-crease').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.folio-underside__controls button').first()).toBeVisible()
  // WebKit doesn't Tab to buttons by default, so each control is focused
  // directly after a key press (keyboard modality) and its ring measured.
  const targets = page.locator('button.folio-crease, .folio-underside__controls button, .folio-topbar button')
  const n = await targets.count()
  expect(n).toBeGreaterThanOrEqual(6)
  for (let i = 0; i < n; i++) {
    await targets.nth(i).focus()
    const ring = await targets.nth(i).evaluate((el) => {
      const s = getComputedStyle(el)
      return { label: el.getAttribute('aria-label') ?? el.textContent, style: s.outlineStyle, width: parseFloat(s.outlineWidth) }
    })
    expect(ring.style, `${ring.label}`).not.toBe('none')
    expect(ring.width, `${ring.label}`).toBeGreaterThanOrEqual(2)
  }
})

test('controls are at least 44 px on touch screens and their text at least 12 px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch targets')
  await setup(page, '?theme=light', COMPOSED)
  await page.locator('button.folio-crease').first().click()
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.folio-root button')].map((b) => {
    const r = b.getBoundingClientRect()
    return { text: b.textContent?.trim(), h: r.height, w: r.width, font: parseFloat(getComputedStyle(b).fontSize) }
  }))
  for (const s of sizes) {
    expect(s.h, `${s.text} height`).toBeGreaterThanOrEqual(44)
    expect(s.w, `${s.text} width`).toBeGreaterThanOrEqual(44)
    expect(s.font, `${s.text} font`).toBeGreaterThanOrEqual(12)
  }
})

test.describe('the six scripted tasks, keyboard only (§3.10)', () => {
  test('write, lift, distance and between, close and find, unlift, recover', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile && browserName === 'chromium', 'Android: Lift is a touch control, not an Enter chord')
    await setup(page, '?theme=light', doc(p('', 'p0')))
    const mod = await page.evaluate(() => (/Mac|iP(hone|[oa]d)/.test(navigator.platform) ? 'Meta' : 'Control'))
    const said = async () => (await call<string[]>(page, 'announcements')).at(-1)
    // On iOS, ProseMirror lets the browser handle Enter and applies its own
    // handler on the DOM change that follows; wait for it before typing on.
    const enter = async () => {
      const n = (await call<string[]>(page, 'topLevel')).length
      await page.keyboard.press('Enter')
      await expect.poll(async () => (await call<string[]>(page, 'topLevel')).length).toBe(n + 1)
    }
    await call(page, 'focusEnd')

    // 1. Write a paragraph.
    await page.keyboard.type('Before.')
    await enter()
    await page.keyboard.type('It was nice to see everyone.')
    await enter()
    await page.keyboard.type('After.')
    expect(await call<string[]>(page, 'topLevel')).toEqual(['p:Before.', 'p:It was nice to see everyone.', 'p:After.'])

    // 2. Lift a line and write beneath it.
    await page.keyboard.press('ArrowUp')
    // ProseMirror reads the browser's selection on selectionchange.
    await expect.poll(() => call(page, 'caretLine')).toBe('page:It was nice to see everyone.')
    await page.keyboard.press(`${mod}+Shift+Enter`)
    expect(await said()).toBe('Writing beneath the line.')
    await page.keyboard.type('I felt absent the whole time.')
    expect(await call(page, 'undersides')).toEqual([{ foldId: expect.any(String), between: null, beneath: 'I felt absent the whole time.' }])

    // 3. Set the distance and write between.
    await page.keyboard.press(`${mod}+Alt+BracketRight`)
    await page.keyboard.press(`${mod}+Alt+BracketRight`)
    expect(await said()).toBe('Moved apart: apart, 3 of 5')
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => call(page, 'caretLine')).toBe('between:')
    await page.keyboard.type('The drive home.')
    expect((await call(page, 'undersides'))[0]).toMatchObject({ between: 'The drive home.', beneath: 'I felt absent the whole time.' })

    // 4. Close the fold, find it again and reopen it.
    await page.keyboard.press('Escape')
    expect(await call<string[]>(page, 'openIds')).toEqual([])
    await expect(page.locator('.ProseMirror')).not.toContainText('I felt absent')
    await call(page, 'focusEnd')
    await page.keyboard.press(`${mod}+Alt+Comma`)
    expect(await said()).toBe("Writing beneath 'It was nice to see everyone.', closed")
    await page.keyboard.press(`${mod}+Shift+Enter`)
    await expect(page.locator('.ProseMirror')).toContainText('I felt absent the whole time.')
    await page.keyboard.press(`${mod}+Shift+Enter`)
    expect(await call<string[]>(page, 'openIds')).toEqual([])

    // 5. Unlift an empty fold.
    await call(page, 'focusEnd')
    await page.keyboard.press(`${mod}+Shift+Enter`)
    expect((await call<unknown[]>(page, 'undersides')).length).toBe(2)
    await page.keyboard.press('Escape')
    expect(await said()).toBe('Cancelled.')
    expect((await call<unknown[]>(page, 'undersides')).length).toBe(1)

    // 6. Recover from a delete across a closed fold.
    // Extend the selection to the start with the browser's own key, not
    // Mod+A: an emulated iPhone on Linux reports an iPhone user agent but a
    // Linux platform, so TipTap's Mac keymap (Ctrl+A: line start) and
    // ProseMirror's Mod (Ctrl) disagree there. Real devices agree.
    await call(page, 'focusEnd')
    const mac = await page.evaluate(() => /Mac/.test(navigator.platform))
    await page.keyboard.press(mac ? 'Meta+Shift+ArrowUp' : 'Control+Shift+Home')
    await expect.poll(() => call<string>(page, 'selection')).toMatch(/^(text|all):1-/)
    await page.keyboard.press('Backspace')
    const afterDelete = await call<{ beneath: string }[]>(page, 'undersides')
    expect(afterDelete[0].beneath).toBe('I felt absent the whole time.')
    await expect(page.locator('.folio-notice')).toContainText('Writing beneath a line was kept')
    // One undo restores the page; the fold stays as it was kept.
    await page.keyboard.press(`${mod}+Z`)
    expect(await call<string[]>(page, 'topLevel')).toEqual(['p:Before.', 'p:It was nice to see everyone.', expect.stringMatching(/^u:.+:2$/), 'p:After.'])
    expect((await call(page, 'undersides'))[0]).toMatchObject({ between: 'The drive home.', beneath: 'I felt absent the whole time.' })
    expect(await call<boolean>(page, 'editorFocused')).toBe(true)
  })
})
