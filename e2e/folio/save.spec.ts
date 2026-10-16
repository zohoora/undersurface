import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// S4's browser outcomes (build plan step 2): the persistent multi-tab cache,
// IndexedDB, Web Locks and BroadcastChannel, against the Firestore emulator.

test.skip(({ isMobile }) => isMobile, 'tabs and reloads are desktop scenarios')

const id = () => `p${Math.random().toString(36).slice(2, 10)}`

async function harness(page: Page) {
  await page.goto('/e2e/harness/folio-save.html')
  await page.waitForSelector('body[data-ready="true"]', { state: 'attached' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = <T = any>(page: Page, name: string, ...args: unknown[]): Promise<T> => page.evaluate(([n, a]) => {
  const api = (window as never as { folioSave: Record<string, (...x: unknown[]) => unknown> }).folioSave
  return api[n as string](...(a as unknown[]))
}, [name, args] as const) as Promise<T>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const st = (page: Page) => call<any>(page, 'state')

test('10. a reload with the SDK\'s own queue, while offline: no false conflict, the latest words win', async ({ page }) => {
  const pid = id()
  await harness(page)
  await call(page, 'open', pid)
  await expect.poll(async () => (await st(page)).ready, { timeout: 15_000 }).toBe(true)
  await call(page, 'edit', 'base')
  await expect.poll(async () => (await st(page)).status, { timeout: 15_000 }).toBe('saved')
  await call(page, 'offline')
  await call(page, 'edit', 'offline 1')
  await call(page, 'edit', 'offline 2')
  expect((await st(page)).status).toBe('savedLocal')

  await page.reload()
  await page.waitForSelector('body[data-ready="true"]', { state: 'attached' })
  await call(page, 'open', pid, { offline: true })
  await expect.poll(async () => (await st(page)).ready, { timeout: 15_000 }).toBe(true)
  expect((await st(page)).latest).toBe('offline 2')
  await call(page, 'edit', 'after the reload')
  expect((await st(page)).status).toBe('savedLocal')
  await call(page, 'online')
  await expect.poll(async () => (await st(page)).status, { timeout: 15_000 }).toBe('saved')
  expect(await call(page, 'server', pid)).toBe('after the reload')
  expect((await st(page)).copies).toEqual([])
})

test('11. two tabs: the second waits, never touches the first\'s entry, and Edit here hands over without loss', async ({ context }) => {
  const pid = id()
  const one = await context.newPage()
  await harness(one)
  await call(one, 'open', pid)
  await expect.poll(async () => (await st(one)).ready, { timeout: 15_000 }).toBe(true)
  await call(one, 'edit', 'tab one')
  await expect.poll(async () => (await st(one)).status, { timeout: 15_000 }).toBe('saved')

  const two = await context.newPage()
  await harness(two)
  await call(two, 'open', pid)
  await two.waitForTimeout(500)
  expect((await st(two)).holder).toBe(false)

  await call(one, 'offline')
  await call(one, 'edit', 'tab one, unsent')
  await two.waitForTimeout(300)
  expect((await call<{ editorId: string; doc: string }[]>(two, 'pending')).map((e) => e.doc)).toContain('tab one, unsent')
  await call(one, 'online')
  await expect.poll(async () => (await st(one)).status, { timeout: 15_000 }).toBe('saved')

  await call(one, 'edit', 'tab one, last words')
  expect(await call<boolean>(two, 'editHere')).toBe(true)
  await expect.poll(async () => (await st(two)).ready, { timeout: 10_000 }).toBe(true)
  await expect.poll(async () => call(two, 'server', pid), { timeout: 10_000 }).toBe('tab one, last words')
  expect((await st(one)).holder).toBe(false)
  expect((await st(two)).copies).toEqual([])
  expect((await st(one)).copies).toEqual([])
})

test('11. when the editing tab closes, the waiting tab takes over and adopts its unsent words', async ({ context }) => {
  const pid = id()
  const one = await context.newPage()
  await harness(one)
  await call(one, 'open', pid)
  await expect.poll(async () => (await st(one)).ready, { timeout: 15_000 }).toBe(true)
  await call(one, 'edit', 'saved words')
  await expect.poll(async () => (await st(one)).status, { timeout: 15_000 }).toBe('saved')

  const two = await context.newPage()
  await harness(two)
  await call(two, 'open', pid)
  await call(one, 'offline')
  await call(one, 'edit', 'unsent when the tab closed')
  await one.close()
  await expect.poll(async () => (await st(two)).ready, { timeout: 10_000 }).toBe(true)
  await expect.poll(async () => call(two, 'server', pid), { timeout: 15_000 }).toBe('unsent when the tab closed')
  expect((await st(two)).copies).toEqual([])
})

test('12. a network cut around a write never makes a conflict copy', async ({ page }) => {
  const pid = id()
  await harness(page)
  await call(page, 'open', pid)
  await expect.poll(async () => (await st(page)).ready, { timeout: 15_000 }).toBe(true)
  for (let i = 0; i < 8; i++) {
    await call(page, 'edit', `round ${i}`)
    await page.waitForTimeout(i * 7)
    await call(page, 'offline')
    await call(page, 'online')
  }
  await expect.poll(async () => (await st(page)).status, { timeout: 20_000, message: JSON.stringify(await st(page)) }).toBe('saved')
  expect(await call(page, 'server', pid)).toBe('round 7')
  expect((await st(page)).copies).toEqual([])
})
