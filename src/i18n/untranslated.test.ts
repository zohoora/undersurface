import { describe, expect, it } from 'vitest'
import en from './translations/en'

// The merged locale objects the app renders. English fallbacks are spread into
// every locale as a safety net, so a missing translation shows up here as a
// value identical to English rather than as a missing key.
const localeModules = import.meta.glob<{ default: Record<string, string> }>(
  ['./translations/*.ts', '!./translations/sessionCopy.ts', '!./translations/en.ts'],
  { eager: true },
)
const locales = Object.entries(localeModules).map(
  ([path, mod]) => [path.replace(/^.*\/([a-z]+)\.ts$/, '$1'), mod.default] as const,
)

const english: Record<string, string> = en

// A locale may show the English value only where English is also the right
// text in that language. Keep every entry narrow (named locales) and give the
// reason, so a real gap can never hide behind the allowlist.
const ALLOWED_IDENTICAL: Record<string, { locales: 'all' | readonly string[]; reason: string }> = {
  'session.bottomBar.realTalk': { locales: 'all', reason: 'Real Talk is a product mode name, kept in English in every locale' },
  'crisis.findHelpline': { locales: 'all', reason: 'a domain name (findahelpline.com)' },
  'emotion.neutral': { locales: ['de', 'es'], reason: '"neutral" is also the German and Spanish word' },
  'sessions.title': { locales: ['fr'], reason: '"Sessions" is also the French word' },
  'session.bottomBar.journal': { locales: ['fr'], reason: '"Journal" is also the French word' },
  'export.journal': { locales: ['fr'], reason: '"Journal" is also the French word' },
  'export.intention': { locales: ['fr'], reason: '"Intention" is also the French word' },
  'export.conversations': { locales: ['fr'], reason: '"Conversations" is also the French word' },
  'export.date': { locales: ['fr'], reason: '"Date" is also the French word' },
  'login.email': { locales: ['id', 'it', 'vi'], reason: '"Email" is the standard UI term in Indonesian, Italian and Vietnamese' },
  'login.password': { locales: ['it'], reason: '"Password" is the standard Italian UI term' },
  'settings.account': { locales: ['it', 'nl'], reason: '"Account" is the standard Italian and Dutch UI term' },
  'settings.data': { locales: ['id'], reason: '"Data" is also the Indonesian word' },
  'login.disclaimer': { locales: ['nl'], reason: '"Disclaimer" is the usual Dutch term' },
  'policy.disclaimerNav': { locales: ['nl'], reason: '"Disclaimer" is the usual Dutch term' },
  'export.context': { locales: ['nl'], reason: '"Context" is also the Dutch word' },
  'export.room.transcript': { locales: ['nl'], reason: '"Transcript" is also the Dutch word' },
  'export.no': { locales: ['es', 'it'], reason: '"no" is also the Spanish and Italian word' },
  'fieldMosaic.rate.nothing': { locales: ['es', 'it'], reason: '"no" is also the Spanish and Italian word' },
  'ps.alliance.direct': { locales: ['fr', 'nl'], reason: '"Direct" is also the French and Dutch word' },
  'room.sound.none': { locales: ['fr'], reason: '"silence" is also the French word' },
}

function isAllowed(key: string, lang: string): boolean {
  const allowed = ALLOWED_IDENTICAL[key]
  return !!allowed && (allowed.locales === 'all' || allowed.locales.includes(lang))
}

describe('no English left in non-English locales', () => {
  it('checks all 16 non-English locales', () => {
    expect(locales).toHaveLength(16)
  })

  for (const [lang, strings] of locales) {
    it(`${lang} has no value identical to English outside the allowlist`, () => {
      const untranslated = Object.keys(english).filter(key => strings[key] === english[key] && !isAllowed(key, lang))
      expect(untranslated).toEqual([])
    })
  }

  it('has no stale allowlist entries', () => {
    const byLang = Object.fromEntries(locales)
    const stale = Object.entries(ALLOWED_IDENTICAL).flatMap(([key, { locales: allowedIn }]) => {
      if (!(key in english)) return [`${key}: not an English key`]
      const langs = allowedIn === 'all' ? Object.keys(byLang) : allowedIn
      return langs
        .filter(lang => byLang[lang]?.[key] !== english[key])
        .map(lang => `${key}: ${lang} is translated, drop it from the allowlist`)
    })
    expect(stale).toEqual([])
  })
})
