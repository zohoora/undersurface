import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const entries = readFileSync(resolve(__dirname, 'Sidebar/EntriesList.tsx'), 'utf8')
const settings = readFileSync(resolve(__dirname, 'Sidebar/SettingsPanel.tsx'), 'utf8')
const login = readFileSync(resolve(__dirname, 'LoginScreen.tsx'), 'utf8')
const sessionBar = readFileSync(resolve(__dirname, 'Session/SessionBottomBar.tsx'), 'utf8')
const css = readFileSync(resolve(__dirname, '../styles/atmosphere.css'), 'utf8')

describe('Quiet Room responsive shell', () => {
  it('uses explicit navigation state rather than a hover-only drawer', () => {
    expect(entries).toContain("className={`entries-sidebar ${isOpen ? 'open' : ''}`}")
    expect(entries).toContain('aria-expanded={isOpen}')
    expect(css).not.toMatch(/\.entries-sidebar:hover,\s*\n\.entries-sidebar:focus-within/)
  })

  it('renders session history as keyboard-operable buttons and bounds the initial list', () => {
    expect(entries).toContain('sidebarItems.slice(0, visibleCount)')
    expect(entries).toMatch(/<button\s+type="button"\s+key=\{item\.id\}/)
    expect(entries).toContain("setVisibleCount(count => count + 30)")
  })

  it('renders settings in a body-level dialog sheet, separate from history', () => {
    expect(settings).toContain('createPortal')
    expect(settings).toContain('className="settings-sheet"')
    expect(settings).toContain('role="dialog"')
    expect(css).toContain('.settings-sheet-backdrop')
  })

  it('uses a session-first landing preview rather than the diary parts carousel', () => {
    expect(login).toContain('landing-session-preview')
    expect(login).toContain("t['landing.previewCompanion']")
    expect(login).not.toContain('The Tender One')
    expect(login).not.toContain('useDemoCarousel')
  })

  it('moves secondary session modes into an options menu and anchors mobile controls', () => {
    expect(sessionBar).toContain('session-options-menu')
    expect(sessionBar).toContain('session-options-mobile')
    expect(css).toMatch(/@media \(max-width: 768px\)[\s\S]*\.session-bottom-bar \{[\s\S]*position: fixed/)
    expect(css).toMatch(/\.session-input-row \{[\s\S]*position: fixed/)
  })
})
