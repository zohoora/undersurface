import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CrisisResources } from './CrisisResources'

describe('CrisisResources', () => {
  it('Sessions: dismissing hides it, with no callback required', () => {
    render(<CrisisResources visible />)
    const close = screen.getAllByRole('button')[0]
    fireEvent.click(close)
    expect(document.querySelector('.crisis-resources')).toBeNull()
  })

  it('Folio: tells the page when dismissed, and a new token re-shows it', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<CrisisResources visible showToken={1} onDismiss={onDismiss} />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.crisis-resources')).toBeNull()
    rerender(<CrisisResources visible showToken={2} onDismiss={onDismiss} />)
    expect(document.querySelector('.crisis-resources')).not.toBeNull()
  })

  it('its text and link colors reach 4.5:1 on the card in both themes (folio-build-plan §8.G)', () => {
    const css = readFileSync(resolve(__dirname, '../styles/atmosphere.css'), 'utf8')
    const block = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)))
    const token = (b: string, name: string) => b.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1] ?? ''
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
    for (const b of [block(':root'), block('[data-theme="dark"]')]) {
      const surface = token(b, '--surface-primary')
      for (const name of ['--crisis-link', '--text-secondary', '--text-primary']) {
        expect(ratio(token(b, name), surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    render(<CrisisResources visible />)
    const links = Array.from(document.querySelectorAll<HTMLElement>('.crisis-resources a'))
    expect(links.length).toBeGreaterThan(0)
    expect(links.map((a) => a.style.color)).toEqual(links.map(() => 'var(--crisis-link)'))
  })

  it('uses no ghost text: every line reaches 4.5:1 (folio-build-plan §8.G)', () => {
    render(<CrisisResources visible />)
    const card = document.querySelector('.crisis-resources') as HTMLElement
    const colors = [card, ...Array.from(card.querySelectorAll<HTMLElement>('*'))].map((el) => el.style.color).filter(Boolean)
    expect(colors.length).toBeGreaterThan(0)
    expect(colors.filter((c) => c.includes('--text-ghost'))).toEqual([])
  })
})
