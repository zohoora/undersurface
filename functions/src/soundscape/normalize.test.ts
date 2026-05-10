import { describe, it, expect } from 'vitest'
import { normalize, hashPrompt, promptHash, isValidPrompt } from './normalize'

describe('normalize', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalize('  rain  ')).toBe('rain')
  })
  it('collapses internal whitespace runs', () => {
    expect(normalize('rain   on  tin\troof')).toBe('rain on tin roof')
  })
  it('lowercases', () => {
    expect(normalize('Rain ON Tin Roof')).toBe('rain on tin roof')
  })
  it('preserves punctuation (semantic difference)', () => {
    expect(normalize('rain, distant thunder')).toBe('rain, distant thunder')
  })
  it('NFC-normalizes diacritics so visually identical strings hash the same', () => {
    // 'café' encoded two ways: composed (NFC) vs decomposed (NFD).
    const composed = 'é' // é as one codepoint
    const decomposed = 'é' // e + combining acute
    expect(normalize(`caf${composed}`)).toBe(normalize(`caf${decomposed}`))
  })
  it('idempotent', () => {
    const once = normalize('  Rain   On Tin Roof  ')
    expect(normalize(once)).toBe(once)
  })
})

describe('hashPrompt', () => {
  it('produces a 64-char hex sha256', () => {
    const h = hashPrompt('rain on tin roof')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
  it('is deterministic', () => {
    expect(hashPrompt('rain')).toBe(hashPrompt('rain'))
  })
  it('different inputs give different hashes', () => {
    expect(hashPrompt('rain')).not.toBe(hashPrompt('rains'))
  })
})

describe('promptHash', () => {
  it('combines normalize + hash so equivalent prompts collide', () => {
    expect(promptHash('  RAIN  on Tin Roof  ')).toBe(promptHash('rain on tin roof'))
  })
})

describe('isValidPrompt', () => {
  it('accepts a normal prompt', () => {
    expect(isValidPrompt('rain on a tin roof')).toEqual({ ok: true })
  })
  it('rejects empty', () => {
    expect(isValidPrompt('')).toMatchObject({ ok: false })
  })
  it('rejects pure whitespace', () => {
    expect(isValidPrompt('   \t  ')).toMatchObject({ ok: false, reason: 'empty' })
  })
  it('rejects strings with no alphanumeric content', () => {
    expect(isValidPrompt('!!!  ???')).toMatchObject({ ok: false, reason: 'no_alphanumeric' })
  })
  it('rejects too-long prompts', () => {
    expect(isValidPrompt('a'.repeat(201))).toMatchObject({ ok: false, reason: 'too_long' })
  })
  it('accepts max-length prompt', () => {
    expect(isValidPrompt('a'.repeat(200))).toEqual({ ok: true })
  })
  it('rejects URLs', () => {
    expect(isValidPrompt('go to https://evil.com please')).toMatchObject({ ok: false, reason: 'url' })
  })
  it('rejects emails', () => {
    expect(isValidPrompt('email me at foo@bar.com')).toMatchObject({ ok: false, reason: 'email' })
  })
})
