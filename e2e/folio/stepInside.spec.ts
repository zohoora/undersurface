import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Step inside (build plan §4, H1), keyboard only, with the real editor, hook,
// dialog and the app's CSS: Mod+Alt+Enter enters; focus is trapped inside;
// standing distance changes; Escape restores the exact selection; "Back and
// write" ends in the beneath; shore closes the space at once; axe on both papers.

async function setup(page: Page, query = '') {
  await page.goto(`/e2e/harness/folio-inside.html${query}`)
  await page.waitForSelector('body[data-ready="true"]', { state: 'attached' })
  await page.waitForSelector('.ProseMirror')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => {
    const api = (window as never as { folio: Record<string, (...x: unknown[]) => unknown> }).folio
    return api[n as string](...(a as unknown[]))
  }, [name, args] as const) as Promise<T>
}

test.describe('Step inside, keyboard only', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard paths are desktop; touch uses the button')

  test('enter, stand closer, leave to the page and back to write', async ({ page, browserName }) => {
    await setup(page)
    const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'))
    const start = await call<number>(page, 'posOf', 'nice')
    await call(page, 'setSelection', start, start + 4)
    await page.keyboard.press(`${mod}+Alt+Enter`)
    const dialog = page.getByRole('dialog', { name: 'It was nice to see everyone., inside' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('I felt absent the whole time.')
    // Focus moved inside, and Tab stays inside. (WebKit doesn't Tab to
    // buttons by default; its trap is covered by the other engines.)
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
    for (let i = 0; i < (browserName === 'webkit' ? 0 : 8); i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
    }
    // Stand closer by keyboard.
    await dialog.getByRole('button', { name: 'Stand closer' }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog.locator('.folio-inside__stage')).toHaveAttribute('style', /--folio-stand: 1\.3/)
    // Escape: back to the page, the exact selection restored.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await call(page, 'selection')).toMatchObject({ from: start, to: start + 4 })
    await expect.poll(() => call<boolean>(page, 'editorFocused')).toBe(true)

    // Again, and Back and write: the caret ends in the beneath.
    await page.keyboard.press(`${mod}+Alt+Enter`)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Back and write' }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => call(page, 'selection')).toMatchObject({ where: 'beneath' })
    await expect.poll(() => call<boolean>(page, 'editorFocused')).toBe(true)
    await page.keyboard.type(' And then home.')
    expect(await call<string>(page, 'beneathText')).toBe('I felt absent the whole time. And then home.')
    expect(await call<string[]>(page, 'leaves')).toEqual(['page', 'write'])
  })

  test('shore closes the space at once', async ({ page }) => {
    await setup(page)
    const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'))
    await call(page, 'setSelection', await call<number>(page, 'posOf', 'nice'), await call<number>(page, 'posOf', 'nice'))
    await page.keyboard.press(`${mod}+Alt+Enter`)
    await expect(page.getByRole('dialog')).toBeVisible()
    await call(page, 'shore')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press(`${mod}+Alt+Enter`)
    await page.waitForTimeout(200)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`axe inside, ${theme} paper, with the sound controls`, async ({ page }) => {
      await setup(page, `?theme=${theme}&sound=1`)
      await page.locator('[data-folio-step-inside]').click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.waitForTimeout(400)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze()
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    })
  }
})
