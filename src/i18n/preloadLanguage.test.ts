import { describe, expect, it, vi } from 'vitest'
import { preloadLanguage } from './index'

describe('preloadLanguage (TECH_ISSUES #14)', () => {
  it('swallows a failed locale chunk instead of leaving an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loaders = {
      './translations/de.ts': () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    }
    await expect(preloadLanguage('de', loaders)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"de"'), expect.any(TypeError))
    warn.mockRestore()
  })

  it('is a no-op for English and unknown languages', async () => {
    await expect(preloadLanguage('en', {})).resolves.toBeUndefined()
    await expect(preloadLanguage('xx', {})).resolves.toBeUndefined()
  })
})
