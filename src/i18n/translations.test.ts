import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TRANSLATIONS_DIR = join(__dirname, 'translations')

// Keys added when a feature ships and must propagate to every language.
// Missing keys silently fall back to English — visible to users as untranslated
// labels — so we treat coverage as a required check, not a nice-to-have.
const REQUIRED_KEYS = [
  'choice.journal.title',
  'choice.journal.tagline',
  'choice.journal.desc',
  'choice.journal.aria',
  'choice.conversation.title',
  'choice.conversation.tagline',
  'choice.conversation.desc',
  'choice.conversation.aria',
  'choice.realtalk.title',
  'choice.realtalk.tagline',
  'choice.realtalk.desc',
  'choice.realtalk.aria',
  'session.mode.realTalk',
  'session.bottomBar.talk',
  'session.bottomBar.journal',
  'session.bottomBar.speak',
  'session.bottomBar.realTalk',
  'session.bottomBar.journalDisabled',
  'session.bottomBar.speakDisabled',
] as const

const languageFiles = readdirSync(TRANSLATIONS_DIR)
  .filter(f => f.endsWith('.ts') && !f.includes('.test.'))
  .map(f => f.replace(/\.ts$/, ''))

describe('translations coverage', () => {
  it('finds the expected set of language files', () => {
    expect(languageFiles.length).toBeGreaterThanOrEqual(17)
    expect(languageFiles).toContain('en')
  })

  // One test per language so a missing key surfaces with the language name in
  // the failure list — easier to triage than a single combined failure.
  for (const lang of languageFiles) {
    describe(`${lang}.ts`, () => {
      it(`has all ${REQUIRED_KEYS.length} required keys`, async () => {
        const mod = await import(`./translations/${lang}.ts`)
        const strings = mod.default as Record<string, string>

        const missing = REQUIRED_KEYS.filter(key => !(key in strings))
        expect(missing).toEqual([])
      })

      it('Real Talk strings are non-empty (no untranslated stubs)', async () => {
        const mod = await import(`./translations/${lang}.ts`)
        const strings = mod.default as Record<string, string>

        const realTalkKeys = REQUIRED_KEYS.filter(k => k.includes('realtalk') || k === 'session.mode.realTalk')
        for (const key of realTalkKeys) {
          expect(strings[key]?.length, `${key} in ${lang}`).toBeGreaterThan(0)
        }
      })
    })
  }
})
