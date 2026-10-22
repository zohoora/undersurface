import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// The first moment (docs/vision/2026-10-22-folio-first-moment.md) in every
// browser of the matrix: the corner after the sentence the caret rests at,
// the lift it makes, the controls in their order of use, dragging the
// beneath's corner, the first-fold line and the companion's signed question;
// axe on both papers with all of them showing.

type Json = Record<string, unknown>
const p = (text: string, pid: string, fold?: string): Json => (text
  ? { type: 'paragraph', attrs: { pid }, content: [{ type: 'text', text, ...(fold ? { marks: [{ type: 'fold', attrs: { foldId: fold } }] } : {}) }] }
  : { type: 'paragraph', attrs: { pid } })
const doc = (...content: Json[]): Json => ({ type: 'doc', content })

async function setup(page: Page, query = '', content?: Json) {
  await page.goto(`/e2e/harness/folio-page.html${query}`)
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

async function writeAndRest(page: Page, text: string) {
  await call(page, 'focusEnd')
  await page.keyboard.type(text)
  await expect(page.locator('[data-folio-corner]')).toBeVisible({ timeout: 4000 })
}

test('the corner comes after a pause and writes beneath exactly its sentence', async ({ page }) => {
  await setup(page, '', doc(p('', 'p1')))
  await writeAndRest(page, 'We drove back late. The heater only worked on one side.')
  const corner = page.locator('[data-folio-corner]')
  await expect(corner).toHaveAccessibleName('Write beneath this line')
  await expect(corner).toContainText('write beneath this')
  // It never moves a character: the line's text is the writer's alone.
  await expect(page.locator('.folio-page .ProseMirror p').first()).toHaveText('We drove back late. The heater only worked on one side.write beneath this')
  await page.keyboard.type(' More')
  await expect(corner).toHaveCount(0)
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect(page.locator('[data-folio-corner]')).toBeVisible({ timeout: 4000 })
  await page.locator('[data-folio-corner]').click()
  await expect(page.locator('.folio-fold')).toHaveText('The heater only worked on one side.')
  await expect(page.locator('.folio-underside--open')).toHaveCount(1)
  expect(await call<string>(page, 'caretLine')).toBe('beneath:')
  await expect(page.locator('.folio-underside__controls button:visible')).toHaveText(['Cancel'])
  await page.keyboard.type('I felt cold the whole way.')
  await expect(page.locator('.folio-underside__controls button:visible')).toHaveText(['Fold away', 'Keep a copy', 'Read it alone', 'Move apart', 'Move closer'])
  await expect(page.locator('[data-folio-apart="closer"]')).toHaveAttribute('aria-disabled', 'true')
  expect(await call<string[]>(page, 'announcements')).toContain('Writing beneath the line.')
})

test('the corner comes where the pointer rests on a written line', async ({ page, isMobile }) => {
  test.skip(isMobile, 'hover is for a fine pointer')
  await setup(page, '', doc(p('We drove back late. The heater only worked on one side.', 'p1'), p('After.', 'p2')))
  await call(page, 'focusEnd')
  const line = page.locator('.folio-page .ProseMirror p').first()
  await line.hover({ position: { x: 40, y: 10 } })
  // The caret rests in "After." too, so wait for the corner on the hovered line.
  const corner = line.locator('[data-folio-corner]')
  await expect(corner).toBeVisible({ timeout: 3000 })
  // Move the mouse onto it as a person would (WebKit's actionability check
  // stalls on a button anchored in a zero-width inline; click() is fine).
  const box = await corner.boundingBox()
  if (!box) throw new Error('no corner')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
  await expect(page.locator('.folio-corner-preview')).toHaveText('The heater only worked on one side.')
})

test('after Enter, the corner offers the paragraph just finished', async ({ page }) => {
  await setup(page, '', doc(p('', 'p1')))
  await call(page, 'focusEnd')
  await page.keyboard.type('We drove back late.')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-folio-corner]')).toBeVisible({ timeout: 4000 })
  await expect(page.locator('.folio-page .ProseMirror p').first()).toContainText('write beneath this')
})

test("the corner isn't there when the guides are off", async ({ page }) => {
  await setup(page, '?guides=off', doc(p('', 'p1')))
  await call(page, 'focusEnd')
  await page.keyboard.type('We drove back late.')
  await page.waitForTimeout(900)
  await expect(page.locator('[data-folio-corner]')).toHaveCount(0)
})

test('dragging the beneath\'s corner moves it apart and back, a stop at a time', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a mouse drag; touch uses the same pointer events')
  await setup(page, '', doc(
    p('It was nice to see everyone.', 'p1', 'f1'),
    { type: 'underside', attrs: { foldId: 'f1', gap: 0 }, content: [{ type: 'beneath', content: [p('I felt absent.', 'p2')] }] },
  ))
  await page.locator('button.folio-crease').click()
  const grip = page.locator('[data-folio-grip]')
  await expect(grip).toHaveCount(1)
  await page.waitForTimeout(500)
  const box = await grip.boundingBox()
  if (!box) throw new Error('no grip')
  const lh = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.folio-page .ProseMirror') as Element).lineHeight))
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + lh * 3.2, { steps: 10 })
  await page.mouse.up()
  expect(await call<number>(page, 'gap', 'f1')).toBe(2)
  await expect(page.locator('[data-folio-between]')).toHaveCount(1)
  expect(await call<string[]>(page, 'announcements')).toContain('Moved apart: apart, 3 of 5')
  // The beneath glides to its new place (320 ms); take hold of it once it's there.
  await page.waitForTimeout(500)
  const again = await grip.boundingBox()
  if (!again) throw new Error('no grip')
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2)
  await page.mouse.down()
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2 - lh * 3.2, { steps: 10 })
  await page.mouse.up()
  expect(await call<number>(page, 'gap', 'f1')).toBe(0)
})

test('the first-fold line sits beside the crease and opens the fold when pressed', async ({ page }) => {
  await setup(page, '', doc(
    p('It was nice to see everyone.', 'p1', 'f1'),
    { type: 'underside', attrs: { foldId: 'f1', gap: 0 }, content: [{ type: 'beneath', content: [p('I felt absent.', 'p2')] }] },
    p('After.', 'p3'),
  ))
  await expect(page.locator('.folio-fold--closed')).toHaveText('It was nice to see everyone.')
  await call(page, 'foldHint', 'f1')
  const hint = page.locator('[data-folio-fold-hint]')
  await expect(hint).toBeVisible()
  await expect(hint).toHaveText('folded here · open')
  // Beside the crease, or just under it where the column ends (a phone).
  const crease = await page.locator('button.folio-crease').boundingBox()
  const at = await hint.boundingBox()
  expect(crease && at && Math.abs((at.y + at.height / 2) - (crease.y + crease.height / 2))).toBeLessThan(48)
  await hint.click()
  await expect(page.locator('.folio-underside--open')).toHaveCount(1)
  await expect(page.locator('[data-folio-beneath]')).toContainText('I felt absent.')
})

test("the companion's question is signed", async ({ page }) => {
  await setup(page, '', doc(
    p('It was nice to see everyone.', 'p1', 'f1'),
    { type: 'underside', attrs: { foldId: 'f1', gap: 0 }, content: [{ type: 'beneath', content: [p('', 'p2')] }] },
  ))
  await page.locator('button.folio-crease').click()
  await call(page, 'ghost', 'p2', 'Who was there?')
  const ghost = page.locator('p.folio-ghost')
  await expect(ghost).toHaveAttribute('data-ghost', 'Who was there?')
  await expect(ghost).toHaveAttribute('data-ghost-who', 'the companion')
  // Chromium and WebKit resolve attr() in the computed value; Firefox reports it as written.
  const content = await page.evaluate(() => getComputedStyle(document.querySelector('p.folio-ghost') as Element, '::before').content)
  expect(content.includes('the companion') || content.includes('attr(data-ghost-who)')).toBe(true)
})

for (const theme of ['light', 'dark'] as const) {
  test(`axe: ${theme} paper with the corner, the controls, the first-fold line and a signed question`, async ({ page }) => {
    await setup(page, `?theme=${theme}`, doc(
      p('Before the drive.', 'p0', 'f0'),
      { type: 'underside', attrs: { foldId: 'f0', gap: 0 }, content: [{ type: 'beneath', content: [p('Closed words.', 'p00')] }] },
      p('It was nice to see everyone.', 'p1', 'f1'),
      { type: 'underside', attrs: { foldId: 'f1', gap: 0 }, content: [{ type: 'beneath', content: [p('', 'p2')] }] },
      p('', 'p3'),
    ))
    await page.locator('button.folio-crease').nth(1).click()
    await writeAndRest(page, 'We drove back late.')
    // Neither moves the caret or the text, so the corner stays.
    await call(page, 'ghost', 'p2', 'Who was there?')
    await call(page, 'foldHint', 'f0')
    await expect(page.locator('[data-folio-corner]')).toBeVisible()
    await page.waitForTimeout(500)
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
    expect(summary).toEqual([])
  })
}
