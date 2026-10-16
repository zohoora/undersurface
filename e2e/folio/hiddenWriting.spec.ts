import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Folio C1 in real browser engines (build plan step 2, S1's automated
// matrix): Chromium, WebKit and Firefox, desktop and phone emulation. Real
// devices, screen readers and IME keyboards are the owner's checklist.

type Json = Record<string, unknown>

const p = (text: string, pid: string, fold?: string): Json => (text
  ? { type: 'paragraph', attrs: { pid }, content: [{ type: 'text', text, ...(fold ? { marks: [{ type: 'fold', attrs: { foldId: fold } }] } : {}) }] }
  : { type: 'paragraph', attrs: { pid } })
const u = (foldId: string, beneath: Json[]): Json => ({ type: 'underside', attrs: { foldId, gap: 0 }, content: [{ type: 'beneath', content: beneath }] })
const doc = (...content: Json[]): Json => ({ type: 'doc', content })

const HIDDEN = 'I felt absent the whole time.'
const DINNER = doc(
  p('Before.', 'p1'),
  p('It was nice to see everyone.', 'p2', 'f1'),
  u('f1', [p(HIDDEN, 'p3')]),
  p('After.', 'p4'),
)

async function setup(page: Page, content: Json = DINNER) {
  await page.goto('/e2e/harness/folio-editor.html')
  await page.waitForSelector('body[data-ready="true"]')
  await page.evaluate((c) => (window as never as { folio: { load: (c: unknown) => void } }).folio.load(c), content)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => {
    const api = (window as never as { folio: Record<string, (...x: unknown[]) => unknown> }).folio
    return api[n as string](...(a as unknown[]))
  }, [name, args] as const) as Promise<T>
}

const mod = (page: Page) => (page.context().browser()?.browserType().name() === 'webkit' || process.platform === 'darwin' ? 'Meta' : 'Control')

test.describe('hidden writing in a real browser', () => {
  test('a closed underside has no text in the DOM; opening shows it', async ({ page }) => {
    await setup(page)
    await expect(page.locator('.ProseMirror')).not.toContainText('I felt absent')
    await page.locator('button.folio-crease').click()
    await expect(page.locator('.ProseMirror')).toContainText('I felt absent')
  })

  test('Backspace selects first; a held key never deletes; a fresh press keeps and opens it', async ({ page }) => {
    await setup(page)
    await call(page, 'setCaret', await call<number>(page, 'posOf', 'After.'))
    await page.keyboard.press('Backspace')
    expect((await call(page, 'selection')).kind).toBe('node')
    await page.keyboard.down('Backspace')
    await page.keyboard.down('Backspace') // repeat: true
    await page.keyboard.down('Backspace')
    await page.keyboard.up('Backspace')
    expect(await call(page, 'undersideText', 'f1')).toBe(HIDDEN)
    await page.keyboard.press('Backspace')
    expect(await call(page, 'undersideText', 'f1')).toBe(HIDDEN)
    expect(await call(page, 'openIds')).toContain('f1')
  })

  test('Backspace in an empty paragraph after a closed fold never puts typing into it', async ({ page }) => {
    await setup(page, doc(p('It was nice.', 'a', 'f1'), u('f1', [p('Hidden words.', 'b')]), p('', 'c')))
    await page.locator('.ProseMirror p').last().click()
    await page.keyboard.press('Backspace')
    await page.keyboard.type('xyz')
    expect(await call(page, 'undersideText', 'f1')).toBe('Hidden words.')
  })

  test('deleting a selection across a closed fold keeps the fold, opened and loose', async ({ page }) => {
    await setup(page)
    await call(page, 'setSelection', await call<number>(page, 'posOf', 'Before.'), (await call<number>(page, 'posOf', 'After.')) + 3)
    await page.keyboard.press('Backspace')
    expect(await call(page, 'undersideText', 'f1')).toBe(HIDDEN)
    expect(await call(page, 'openIds')).toContain('f1')
    expect(await call<string[]>(page, 'topLevel')).toContain('u:f1:loose')
    expect(await call<string[]>(page, 'diagnostics')).not.toContain('folio.hidden.restored')
  })

  test('typing over a selection across a closed fold replaces only the visible text', async ({ page }) => {
    await setup(page)
    await call(page, 'setSelection', (await call<number>(page, 'posOf', 'everyone.')) + 2, (await call<number>(page, 'posOf', 'After.')) + 2)
    await page.keyboard.type('Z')
    expect(await call(page, 'undersideText', 'f1')).toBe(HIDDEN)
    expect((await call<string[]>(page, 'topLevel'))[1]).toBe('p:It was nice to see evZter.')
  })

  test('cut from the keyboard across a closed fold keeps it', async ({ page }) => {
    await setup(page)
    await call(page, 'setSelection', await call<number>(page, 'posOf', 'Before.'), (await call<number>(page, 'posOf', 'After.')) + 6)
    await page.keyboard.press(`${mod(page)}+x`)
    expect(await call(page, 'undersideText', 'f1')).toBe(HIDDEN)
    expect(await call<string[]>(page, 'diagnostics')).not.toContain('folio.hidden.restored')
    expect((await call<string[]>(page, 'topLevel')).join('|')).not.toContain('Before.') // the cut happened
  })

  test('undo of a closed change opens the fold first; the next undo applies', async ({ page }) => {
    await setup(page)
    await call(page, 'open', ['f1'])
    await call(page, 'setCaret', (await call<number>(page, 'posOf', 'time.')) + 5)
    await page.keyboard.type(' Really.')
    await call(page, 'close', ['f1'])
    await page.keyboard.press(`${mod(page)}+z`)
    await expect.poll(() => call(page, 'openIds')).toContain('f1')
    expect(await call(page, 'undersideText', 'f1')).toContain('Really')
    await page.keyboard.press(`${mod(page)}+z`)
    await expect.poll(() => call(page, 'undersideText', 'f1')).toBe(HIDDEN)
  })

  test('the browser\'s Edit-menu undo (beforeinput historyUndo) is guarded too', async ({ page }) => {
    await setup(page)
    await call(page, 'open', ['f1'])
    await call(page, 'setCaret', (await call<number>(page, 'posOf', 'time.')) + 5)
    await page.keyboard.type('!')
    await call(page, 'close', ['f1'])
    await page.evaluate(() => {
      document.querySelector('.ProseMirror')?.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }))
    })
    await expect.poll(() => call(page, 'openIds')).toContain('f1')
    expect(await call(page, 'undersideText', 'f1')).toContain('!')
  })

  test('an Android-style deleteContentBackward beside a closed fold selects, never deletes', async ({ page }) => {
    await setup(page)
    await call(page, 'setCaret', await call<number>(page, 'posOf', 'After.'))
    await page.evaluate(() => {
      document.querySelector('.ProseMirror')?.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }))
    })
    expect((await call(page, 'selection')).kind).toBe('node')
    expect(await call(page, 'undersideText', 'f1')).toBe(HIDDEN)
  })

  test('Enter at the end of a lifted line writes after its underside', async ({ page }) => {
    await setup(page)
    await call(page, 'open', ['f1'])
    await call(page, 'setCaret', (await call<number>(page, 'posOf', 'everyone.')) + 'everyone.'.length)
    await page.keyboard.press('Enter')
    await page.keyboard.type('Next.')
    expect(await call<string[]>(page, 'topLevel')).toEqual(['p:Before.', 'p:It was nice to see everyone.', 'u:f1', 'p:Next.', 'p:After.'])
  })

  test('lift from a selection opens a beneath to write in', async ({ page }) => {
    await setup(page, doc(p('We drove back late.', 'a')))
    await call(page, 'setSelection', 1, 1 + 'We drove back late.'.length)
    const id = await call<string>(page, 'lift')
    await page.keyboard.type('The heater only worked on one side.')
    expect(await call(page, 'undersideText', id)).toBe('The heater only worked on one side.')
  })

  test('no accessibility violations with a fold open and closed', async ({ page }) => {
    await setup(page)
    const closed = await new AxeBuilder({ page }).include('#editor').analyze()
    expect(closed.violations.map((v) => v.id)).toEqual([])
    await call(page, 'open', ['f1'])
    const open = await new AxeBuilder({ page }).include('#editor').analyze()
    expect(open.violations.map((v) => v.id)).toEqual([])
  })
})

test.describe('IME composition (Chromium, through CDP)', () => {
  test('composition over a selection holding a closed fold starts on a caret and never reaches it', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP IME is Chromium-only')
    await setup(page)
    await call(page, 'setSelection', (await call<number>(page, 'posOf', 'everyone.')) + 2, (await call<number>(page, 'posOf', 'After.')) + 2)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.insertText', { text: '仮名' })
    expect(await call(page, 'undersideText', 'f1')).toBe(HIDDEN)
    await expect(page.locator('.ProseMirror')).toContainText('仮名')
  })

  test('composition right after a lifted line leaves the fold intact', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP IME is Chromium-only')
    await setup(page)
    await call(page, 'setCaret', (await call<number>(page, 'posOf', 'everyone.')) + 'everyone.'.length)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '한글' })
    expect(await call(page, 'undersideText', 'f1')).toBe(HIDDEN)
    expect(await call<string[]>(page, 'topLevel')).toEqual(['p:Before.', 'p:It was nice to see everyone.한글', 'u:f1', 'p:After.'])
  })
})
