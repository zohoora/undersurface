import { describe, expect, it } from 'vitest'
import {
  UNASKED_BLOCK, arrivalMessages, chooseLineMessages, parseArrival, parseChooseLine, parseName, parseObject,
  parseOpening, parseQuestion, str,
} from './calls'
import { effectiveLevel, limitsOf, powersOf } from './levels'

const PARA = 'We drove back late. I kept checking the mirror as if someone was behind us. The heater only worked on one side.'

describe('the companion\'s replies are parsed strictly; anything else is silence', () => {
  it('reads one JSON object, tolerating a fence or a stray sentence', () => {
    expect(parseObject('{"a": 1}')).toEqual({ a: 1 })
    expect(parseObject('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(parseObject('Sure! {"a": 1}')).toEqual({ a: 1 })
    expect(parseObject('no json here')).toBeNull()
    expect(parseObject('[1, 2]')).toBeNull()
    expect(parseObject('{broken')).toBeNull()
  })

  it('a chosen line must be an exact sentence of the paragraph', () => {
    expect(parseChooseLine('{"sentence": "I kept checking the mirror as if someone was behind us.", "question": "Who did you expect?"}', PARA, false))
      .toEqual({ sentence: 'I kept checking the mirror as if someone was behind us.', question: 'Who did you expect?', distance: 0, between: '' })
    // Paraphrased, or from elsewhere: dropped.
    expect(parseChooseLine('{"sentence": "I checked the mirror.", "question": "Why?"}', PARA, false)).toBeNull()
    expect(parseChooseLine('{"none": true}', PARA, false)).toBeNull()
    expect(parseChooseLine('{"sentence": "The heater only worked on one side."}', PARA, false)).toBeNull()
    expect(parseChooseLine(`{"sentence": "We drove back late.", "question": "${'x'.repeat(121)}"}`, PARA, false)).toBeNull()
  })

  it('level 5 adds a distance and the between; a between needs a distance', () => {
    const r = parseChooseLine('{"sentence": "We drove back late.", "question": "How late?", "distance": 2, "between": "The dashboard clock, a minute fast."}', PARA, true)
    expect(r).toEqual({ sentence: 'We drove back late.', question: 'How late?', distance: 2, between: 'The dashboard clock, a minute fast.' })
    expect(parseChooseLine('{"sentence": "We drove back late.", "question": "How late?", "distance": 0, "between": "Text."}', PARA, true)?.between).toBe('')
    expect(parseChooseLine('{"sentence": "We drove back late.", "question": "How late?", "distance": 9}', PARA, true)?.distance).toBe(0)
    // Below level 5 the distance and between are ignored.
    expect(parseChooseLine('{"sentence": "We drove back late.", "question": "How late?", "distance": 3, "between": "x"}', PARA, false)).toMatchObject({ distance: 0, between: '' })
  })

  it('questions and opening lines are bounded single lines', () => {
    expect(parseQuestion('{"question": "What was on the\\nother side?"}')).toBe('What was on the other side?')
    expect(parseQuestion('{"none": true}')).toBeNull()
    expect(parseOpening('{"line": "What did today sound like?"}')).toBe('What did today sound like?')
    expect(parseOpening(`{"line": "${'y'.repeat(121)}"}`)).toBeNull()
    expect(str('   ', 10)).toBeNull()
  })

  it('a name takes at least half its words from the composition, at most five', () => {
    const comp = 'I kept checking the mirror.\n\nNobody. That\'s the point.'
    expect(parseName('{"title": "the mirror"}', comp)).toBe('the mirror')
    expect(parseName('{"title": "\\"the mirror.\\""}', comp)).toBe('the mirror')
    expect(parseName('{"title": "a lonely evening drive"}', comp)).toBeNull()
    expect(parseName('{"title": "the mirror the mirror the mirror"}', comp)).toBeNull()
  })

  it('an arrival lifts only a sentence from the last page, or opens with a line', () => {
    const last = 'The heater only worked on one side. She had the window down anyway.'
    expect(parseArrival('{"kind": "lift", "sentence": "The heater only worked on one side.", "distance": 1, "between": "Warm air, then the window.", "question": "What was on the other side?", "starter": "On her side it was."}', last))
      .toEqual({ kind: 'lift', sentence: 'The heater only worked on one side.', distance: 1, between: 'Warm air, then the window.', question: 'What was on the other side?', starter: 'On her side it was' })
    expect(parseArrival('{"kind": "lift", "sentence": "Something else entirely."}', last)).toBeNull()
    expect(parseArrival('{"kind": "blank", "line": "What did the morning keep?"}', last)).toEqual({ kind: 'blank', line: 'What did the morning keep?' })
    expect(parseArrival('{"kind": "none"}', last)).toBeNull()
  })

  it('every unasked prompt carries the page voice, the unasked rules, safety and the untrusted wrapper', () => {
    const [system, user] = chooseLineMessages({ paragraph: PARA, context: '', languageName: null, dances: true })
    expect(system.content).toContain('CURRENT CHANNEL: a Folio page, unasked.')
    expect(system.content).not.toContain('by invitation')
    expect(system.content).toContain(UNASKED_BLOCK)
    expect(system.content).toContain('SAFETY')
    expect(system.content).toContain('"distance"')
    expect(user.content).toContain(PARA)
    const [sys2] = arrivalMessages({ when: 'Tuesday 15 October, evening', languageName: 'Deutsch', lastPage: 'x', kept: [] })
    expect(sys2.content).toContain('Deutsch')
  })
})

describe('levels', () => {
  it('each level includes the one below', () => {
    expect(powersOf(1)).toEqual({ marks: false, ghosts: false, prefill: false, arranges: false, notesPerVisit: 0, dances: false })
    expect(powersOf(2).marks && !powersOf(2).ghosts).toBe(true)
    expect(powersOf(3).ghosts && powersOf(3).prefill && !powersOf(3).arranges).toBe(true)
    expect(powersOf(4).arranges && powersOf(4).notesPerVisit === 1 && !powersOf(4).dances).toBe(true)
    expect(powersOf(5).dances && powersOf(5).notesPerVisit === 2).toBe(true)
    expect(limitsOf(1).callsPerVisit).toBe(0)
    expect(limitsOf(5).liftsPerVisit).toBeGreaterThan(limitsOf(4).liftsPerVisit)
  })

  it('defaults: writers who were here before stay at 1, new writers start at 3; the switch off is 1', () => {
    expect(effectiveLevel(undefined, { switchOn: true, firstVisitSeenAt: 1 })).toBe(1)
    expect(effectiveLevel(undefined, { switchOn: true, firstVisitSeenAt: null })).toBe(3)
    expect(effectiveLevel(5, { switchOn: true })).toBe(5)
    expect(effectiveLevel(5, { switchOn: false })).toBe(1)
    expect(effectiveLevel(7, { switchOn: true, firstVisitSeenAt: 1 })).toBe(1)
  })
})
