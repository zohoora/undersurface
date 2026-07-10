import { describe, expect, it } from 'vitest'
import { CRISIS_EVAL_NEGATIVES } from '../../../src/engine/crisisClassifier.eval'
import { detectCrisisKeywords } from '../shared/crisisFloor'
import {
  normalizePhone,
  parseSmsBody,
  renderTwiml,
  sanitizeSmsReply,
} from './field'
import { generateSmsLinkCode, hashSmsValue } from './linking'

describe('SMS field grammar', () => {
  it('parses linking and field modes without confusing ordinary text', () => {
    expect(parseSmsBody('LINK AB23XY')).toEqual({ kind: 'link', code: 'AB23XY' })
    expect(parseSmsBody('link 000000')).toEqual({ kind: 'invalid_link' })
    expect(parseSmsBody('SAVE: meeting dread')).toEqual({ kind: 'capture', text: 'meeting dread' })
    expect(parseSmsBody('DEEP I keep circling this')).toEqual({
      kind: 'message', mode: 'deep', text: 'I keep circling this',
    })
    expect(parseSmsBody('A small thing happened')).toEqual({
      kind: 'message', mode: 'exchange', text: 'A small thing happened',
    })
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

  it('strips app-only markup and bounds normal versus deep replies', () => {
    expect(sanitizeSmsReply('<<RISK:0>>\n**Try** [Journal](#switch:journal).', 'exchange'))
      .toBe('Try Journal.')
    expect(sanitizeSmsReply('word '.repeat(400), 'exchange').length).toBeLessThanOrEqual(480)
    expect(sanitizeSmsReply('word '.repeat(400), 'deep').length).toBeLessThanOrEqual(1200)
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
