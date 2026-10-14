import { describe, expect, it } from 'vitest'
import { sessionCopy } from './translations/sessionCopy'

// The final, merged locale objects (base + fallbacks + sessionCopy), which is
// what the app actually renders.
const localeModules = import.meta.glob<{ default: Record<string, string> }>(
  ['./translations/*.ts', '!./translations/sessionCopy.ts'],
  { eager: true },
)
const locales = Object.fromEntries(
  Object.entries(localeModules).map(([path, mod]) => [path.replace(/^.*\/([a-z]+)\.ts$/, '$1'), mod.default]),
)

const REQUIRED = [
  'login.tagline',
  'onboarding.step1.body',
  'onboarding.step2.title',
  'onboarding.step3.body',
  'onboarding.step3.begin',
  'app.subtitle',
  'landing.headline',
  'landing.feature1',
  'landing.feature2',
  'landing.feature3',
  'landing.cta',
  'biometric.camera.title',
  'biometric.camera.body',
  'biometric.camera.permission',
  'biometric.data.permission',
  'biometric.polar.title',
  'biometric.polar.body',
  'biometric.polar.permission',
  'biometric.notNow',
  'biometric.enable',
  'biometric.connect',
  'ps.alliance.title',
] as const

describe('session-first and biometric copy', () => {
  it('has a complete, non-empty surface in all 17 locales', () => {
    expect(Object.keys(sessionCopy)).toHaveLength(17)
    expect(Object.keys(locales)).toHaveLength(17)
    for (const [locale, copy] of Object.entries(locales)) {
      for (const key of REQUIRED) {
        expect(copy[key], `${key} in ${locale}`).toBeTruthy()
      }
    }
  })

  it('does not describe the product as a diary in English', () => {
    const copy = Object.values(sessionCopy.en).join(' ')
    expect(copy).not.toMatch(/\bdiary\b/i)
    expect(copy).toMatch(/session/i)
  })
})
