import { describe, it, expect } from 'vitest'
import en from '../../../i18n/translations/en'

// Every user-visible Drift string. Safety copy is scripted (fixed i18n), never
// LLM output — so these keys must all exist and honor the naming constraints.
const REQUIRED_DRIFT_KEYS = [
  'drift.card.title',
  'drift.card.subtitle',
  'drift.arrive.title',
  'drift.arrive.body',
  'drift.arrive.notTherapy',
  'drift.arrive.begin',
  'drift.arrive.voice',
  'drift.anchor.title',
  'drift.anchor.body',
  'drift.anchor.calmPlace',
  'drift.anchor.feet',
  'drift.anchor.confirm',
  'drift.choose.title',
  'drift.choose.hint',
  'drift.choose.placeholder',
  'drift.baseline.prompt',
  'drift.set.hint',
  'drift.set.butterflyHint',
  'drift.set.skip',
  'drift.notice.prompt',
  'drift.notice.softer',
  'drift.notice.same',
  'drift.notice.stronger',
  'drift.settle.line',
  'drift.settleClose',
  'drift.closure.anchor',
  'drift.closure.container',
  'drift.closure.orient',
  'drift.closure.done',
  'drift.abort.handoff',
  'drift.closed.settled',
  'drift.closed.eased',
]

const dict = en as Record<string, string>

function driftEntries(): [string, string][] {
  return Object.entries(dict).filter(([k]) => k.startsWith('drift.'))
}

describe('drift copy (en)', () => {
  it('defines every drift.* key with a non-empty value', () => {
    for (const key of REQUIRED_DRIFT_KEYS) {
      expect(dict[key], `missing or empty: ${key}`).toBeTruthy()
    }
  })

  it('never uses the string "EMDR" in any drift.* value', () => {
    for (const [key, value] of driftEntries()) {
      expect(value, key).not.toMatch(/emdr/i)
    }
  })

  it('has no numeric distress scale in any drift.* value', () => {
    for (const [key, value] of driftEntries()) {
      expect(value, key).not.toMatch(/\b\d+\s*(to|–|-)\s*\d+\b/)
    }
  })

  it('frames the practice as not therapy in the arrive step', () => {
    expect(dict['drift.arrive.notTherapy']).toMatch(/not therapy/i)
  })
})
