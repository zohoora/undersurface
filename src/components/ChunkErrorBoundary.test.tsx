import React, { Suspense } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('../i18n', () => ({ t: (key: string) => key }))

const { ChunkErrorBoundary } = await import('./ChunkErrorBoundary')
const { lazyWithRetry } = await import('../utils/lazyWithRetry')

void React

const chunkError = () => new TypeError('Failed to fetch dynamically imported module')

describe('ChunkErrorBoundary + lazyWithRetry', () => {
  let reload: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.sessionStorage.clear()
    reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      configurable: true,
      writable: true,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  function renderLazy(chunkName: string, factory: () => Promise<{ default: () => React.ReactElement }>) {
    const Lazy = lazyWithRetry(factory, chunkName)
    return render(
      <div>
        <p>crisis resources stay visible</p>
        <ChunkErrorBoundary area="test" messageKey="surface.error.body">
          <Suspense fallback={<p>loading</p>}>
            <Lazy />
          </Suspense>
        </ChunkErrorBoundary>
      </div>,
    )
  }

  it('shows a calm inline message, never a reload loop, when a chunk is really gone', async () => {
    const factory = vi.fn().mockRejectedValue(chunkError())

    // First mount: retry once, then the single guarded reload.
    renderLazy('test-chunk', factory)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 3000 })
    cleanup()

    // The page "came back" inside the guard window and the chunk still fails:
    // the error reaches the boundary instead of reloading again.
    renderLazy('test-chunk', factory)
    expect(await screen.findByText('surface.error.body', {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText('crisis resources stay visible')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'app.tryAgain' })).toBeTruthy()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('without sessionStorage it never reloads and still renders the message', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    const blocked = () => { throw new Error('blocked') }
    Object.defineProperty(window, 'sessionStorage', {
      value: { getItem: blocked, setItem: blocked, removeItem: blocked, clear: () => {} },
      configurable: true,
    })
    try {
      renderLazy('blocked-storage', vi.fn().mockRejectedValue(chunkError()))
      expect(await screen.findByText('surface.error.body', {}, { timeout: 3000 })).toBeTruthy()
      expect(reload).not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original)
    }
  })

  it('retries only on a deliberate tap', async () => {
    window.sessionStorage.setItem('undersurface:chunk-reload:tap-chunk', String(Date.now()))
    renderLazy('tap-chunk', vi.fn().mockRejectedValue(chunkError()))
    const retry = await screen.findByRole('button', { name: 'app.tryAgain' }, { timeout: 3000 })
    expect(reload).not.toHaveBeenCalled()
    retry.click()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('lazy loading call sites', () => {
  it('loads crisis resources eagerly so they render offline', async () => {
    const app = (await import('../App?raw')).default
    expect(app).toMatch(/^import \{ CrisisResources \} from '\.\/components\/CrisisResources'$/m)
    expect(app).not.toMatch(/import\(['"]\.\/components\/CrisisResources['"]\)/)
    expect(app).toContain('<CrisisResources visible={isGrounding} />')
  })

  it('uses only the shared guarded loader (no unguarded reload-on-failure lazies)', async () => {
    const sources = [
      (await import('../App?raw')).default,
      (await import('./Sidebar/SettingsPanel?raw')).default,
      (await import('./Sidebar/EntriesList?raw')).default,
    ]
    for (const source of sources) {
      expect(source).not.toMatch(/function lazyWithRetry/)
      expect(source).not.toMatch(/\blazy\(\s*\(\)\s*=>/)
      expect(source).toMatch(/lazyWithRetry\(\(\) => import\(/)
    }
  })
})
