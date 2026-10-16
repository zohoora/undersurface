import { describe, expect, it } from 'vitest'
import { folioEnglish } from '../i18n/translations/folio/copy'

// The honesty rules for Folio's copy (draft 4 §3.12, §5.6): no word implies
// secrecy, forgetting or permanence. Whole words, case-insensitive, with an
// allowlist for the link text "Privacy Policy".

const BANNED = ['private', 'secret', 'hidden', 'forget', 'vanish', 'only you', 'permanent', 'forever', 'sealed']
const WARN = ['nobody', 'no one', 'safe', 'always', 'never']
const ALLOWED: Record<string, string[]> = { 'folio.privacyPolicy': ['private'] }

function words(text: string, list: string[]): string[] {
  return list.filter((w) => new RegExp(`\\b${w.replace(' ', '\\s+')}\\b`, 'i').test(text))
}

describe('Folio copy', () => {
  for (const [key, text] of Object.entries(folioEnglish)) {
    it(`${key} uses no banned word`, () => {
      const found = words(text, BANNED).filter((w) => !(ALLOWED[key] ?? []).includes(w))
      expect(found).toEqual([])
    })
  }

  it('lists warning words for a person to read', () => {
    const flagged = Object.entries(folioEnglish).filter(([, text]) => words(text, WARN).length > 0).map(([k]) => k)
    // Reported, not failed: each needs a human eye on what it promises.
    if (flagged.length > 0) console.warn('[folio copy] warning words in:', flagged.join(', '))
    expect(Array.isArray(flagged)).toBe(true)
  })

  it('the first-visit line neither overstates nor understates the safety checks', () => {
    const line = folioEnglish['folio.firstVisit']
    expect(line).not.toMatch(/\beverything\b/i)
    expect(line).not.toMatch(/short excerpts/i)
    expect(line).toMatch(/AI service/)
    expect(line).toMatch(/doesn't read them/)
  })
})
