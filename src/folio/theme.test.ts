import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Folio tells the browser which paper it's on, so native controls (the
// settings checkboxes, text fields, scrollbars) aren't drawn light on the dark
// paper. Both ways into dark — the system's, and the app's own theme — say so.

const CSS = readFileSync(resolve(__dirname, 'folio.css'), 'utf8')

function block(selector: string): string {
  const at = CSS.indexOf(`${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('Folio color-scheme', () => {
  it('is light on the light paper', () => {
    expect(block('.folio-root')).toMatch(/color-scheme:\s*light;/)
  })

  it('is dark when the system is dark (unless the app says light)', () => {
    expect(block('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) .folio-root')).toMatch(/color-scheme:\s*dark;/)
  })

  it('is dark when the app theme is dark', () => {
    expect(block(':root[data-theme="dark"] .folio-root')).toMatch(/color-scheme:\s*dark;/)
  })
})
