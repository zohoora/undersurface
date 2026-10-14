import { afterEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ language: 'en' }))
vi.mock('../store/settings', () => ({ getSettings: () => settings }))

const { connectionBannerCopy, removeConnectionBanner, showConnectionBanner } = await import('./connectionBanner')

afterEach(() => {
  removeConnectionBanner()
  settings.language = 'en'
})

describe('connection banner (TECH_ISSUES #34)', () => {
  it('speaks the stored language, falling back to English', () => {
    expect(connectionBannerCopy('de').action).toBe('Seite neu laden')
    expect(connectionBannerCopy('ja').message).toBe('接続が中断されました。')
    expect(connectionBannerCopy('xx').message).toBe('Connection interrupted.')
    settings.language = 'fr'
    expect(connectionBannerCopy().message).toBe('Connexion interrompue.')
  })

  it('renders once with theme variables (no hardcoded theme hex) and can be removed', () => {
    settings.language = 'es'
    showConnectionBanner()
    showConnectionBanner()
    const banners = document.querySelectorAll('#idb-lost-banner')
    expect(banners).toHaveLength(1)
    const banner = banners[0] as HTMLElement
    expect(banner.textContent).toContain('Conexión interrumpida.')
    expect(banner.getAttribute('style')).toContain('var(--bg-primary')
    expect(banner.getAttribute('style')).toContain('var(--text-primary')
    removeConnectionBanner()
    expect(document.getElementById('idb-lost-banner')).toBeNull()
  })
})
