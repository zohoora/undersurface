import { describe, expect, it } from 'vitest'

const localeModules = import.meta.glob<{ default: Record<string, string> }>(
  ['./translations/*.ts', '!./translations/sessionCopy.ts'],
  { eager: true },
)
const locales = Object.entries(localeModules).map(
  ([path, mod]) => [path.replace(/^.*\/([a-z]+)\.ts$/, '$1'), mod.default] as const,
)

function policyText(strings: Record<string, string>): string {
  return Object.entries(strings)
    .filter(([key]) => key.startsWith('policy.'))
    .map(([, value]) => value)
    .join('\n')
}

describe('privacy policy processor disclosure', () => {
  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17)
  })

  for (const [lang, strings] of locales) {
    it(`${lang} names the real processors and never OpenRouter`, () => {
      const text = policyText(strings)
      expect(text).not.toMatch(/openrouter/i)
      expect(text).toContain('OpenAI')
      expect(text).toContain('Twilio')
      expect(strings['policy.providersBody']).toContain('Sentry')
    })

    it(`${lang} discloses Folio: what is stored, the safety checks, the 72-hour reach and the device store`, () => {
      expect(strings['policy.whatWeStoreBody']).toContain('Folio')
      expect(strings['policy.howAiWorksBody']).toContain('Folio')
      expect(strings['policy.howAiWorksBody']).toContain('72')
      expect(strings['policy.devicePreferencesBody']).toContain('Folio')
    })
  }
})
