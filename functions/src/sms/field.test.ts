import { describe, expect, it } from 'vitest'
import { CRISIS_EVAL_NEGATIVES } from '../../../src/engine/crisisClassifier.eval'
import { detectCrisisKeywords } from '../shared/crisisFloor'
import {
  SMS_HELP,
  normalizePhone,
  parseSmsBody,
  renderTwiml,
  sanitizeSmsFieldNote,
  sanitizeSmsReply,
} from './field'
import { generateSmsLinkCode, hashSmsValue } from './linking'

describe('SMS field grammar', () => {
  it('keeps only account controls and treats former content commands naturally', () => {
    expect(parseSmsBody('LINK AB23XY')).toEqual({ kind: 'link', code: 'AB23XY' })
    expect(parseSmsBody('link 000000')).toEqual({ kind: 'invalid_link' })
    expect(parseSmsBody('SAVE: meeting dread')).toEqual({ kind: 'message', text: 'SAVE: meeting dread' })
    expect(parseSmsBody('DEEP I keep circling this')).toEqual({ kind: 'message', text: 'DEEP I keep circling this' })
    expect(parseSmsBody('OPEN')).toEqual({ kind: 'message', text: 'OPEN' })
    expect(parseSmsBody('A small thing happened')).toEqual({
      kind: 'message', text: 'A small thing happened',
    })
    expect(parseSmsBody('HELP')).toEqual({ kind: 'help' })
    expect(parseSmsBody('STOP')).toEqual({ kind: 'opt_out' })
  })

  it('accepts only normalized E.164 provider phone numbers', () => {
    expect(normalizePhone('+12897780589')).toBe('+12897780589')
    expect(normalizePhone('(289) 778-0589')).toBeNull()
    expect(normalizePhone('+0123')).toBeNull()
  })

  it('escapes deterministic TwiML replies', () => {
    expect(renderTwiml('A < B & "quoted"')).toContain('A &lt; B &amp; &quot;quoted&quot;')
    expect(renderTwiml()).toContain('<Response></Response>')
  })

  it('describes natural SMS behavior without content commands', () => {
    expect(SMS_HELP).toContain('Text naturally')
    expect(SMS_HELP).not.toMatch(/SAVE:|DEEP:|\bOPEN\b/)
  })

  it('strips app-only markup and keeps a generous SMS backstop', () => {
    expect(sanitizeSmsReply('<<RISK:0>>\n**Try** [Journal](#switch:journal).'))
      .toBe('Try Journal.')
    expect(sanitizeSmsReply('word '.repeat(400)).length).toBeLessThanOrEqual(1200)
    expect(sanitizeSmsFieldNote('**Decision:** stay home\n\nthis Friday')).toBe('Decision: stay home this Friday')
    expect(sanitizeSmsFieldNote('x'.repeat(500))).toHaveLength(320)
  })

  it('generates unambiguous six-character codes from supplied entropy', () => {
    const code = generateSmsLinkCode(new Uint8Array([0, 1, 2, 3, 4, 5]))
    expect(code).toBe('ABCDEF')
    expect(hashSmsValue(code)).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('SMS crisis floor parity', () => {
  it('does not hard-ground any calibrated contextual negative', () => {
    const falsePositives = CRISIS_EVAL_NEGATIVES
      .filter(testCase => detectCrisisKeywords(testCase.text))
      .map(testCase => testCase.text)
    expect(falsePositives).toEqual([])
  })

  it('hard-grounds explicit first-person methods', () => {
    expect(detectCrisisKeywords('I am going to kill myself tonight')).toBe(true)
    expect(detectCrisisKeywords('I will take all the pills')).toBe(true)
  })
})
