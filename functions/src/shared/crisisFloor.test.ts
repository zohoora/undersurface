import { describe, expect, it } from 'vitest'
import { detectCrisisKeywords } from './crisisFloor'

// L1 hard-floor contract, both directions. `true` = sincere present
// first-person method/plan → hard-ground immediately. `false` = defer to the
// contextual L2 classifier (which still runs on every path). Any change here
// must also pass the live `npm run test:crisis` eval before deploy.
const CASES: ReadonlyArray<readonly [text: string, expected: boolean, note: string]> = [
  // ── True positives carried over from the existing suites ──
  ['I want to kill myself', true, 'sessionOrchestrator.test'],
  ["I keep thinking I want to kill myself and I don't know what to do", true, 'sessionOrchestrator.test'],
  ['I am going to kill myself tonight', true, 'crisisDecisionPipeline.test'],
  ['I have decided to end my life', true, 'crisisDecisionPipeline.test'],
  ['I will take all the pills', true, 'crisisDecisionPipeline.test + sms field.test'],
  ['I am going to hang myself', true, 'crisisDecisionPipeline.test'],
  ['I could shoot myself', true, 'crisisDecisionPipeline.test'],
  ['I could cut my wrists', true, 'crisisDecisionPipeline.test'],
  ['I might drown myself', true, 'crisisDecisionPipeline.test'],
  ['I could slit my wrists', true, 'sessionOrchestrator.test'],
  ["I'm going to kill myself tonight. I have the pills. I just wanted to write this down.", true, 'eval positive_explicit'],
  ["If I take all the pills in this bottle I won't have to do tomorrow.", true, 'eval positive_explicit'],
  ['want\u00A0to\u00A0kill\u00A0myself', true, 'NBSP evasion'],
  ['kill\u200Bmyself', true, 'zero-width evasion'],
  ['Ｉ ｗａｎｔ ｔｏ ｋｉｌｌ ｍｙｓｅｌｆ', true, 'fullwidth (NFKC)'],
  ["If anyone reads this someday, I want you to know it wasn't your fault. I made the choice myself.", true, 'farewell note'],

  // ── Pill intent forms still trip ──
  ["I'm going to take all the pills tonight", true, 'pill intent'],
  ['I am about to swallow all my sleeping pills', true, 'pill intent'],
  ['I want to take all of these pills and be done', true, 'pill intent'],
  ['I just took all my pills', true, 'overdose report'],
  ['I took all the pills in the cabinet', true, 'overdose report'],
  ['I swallowed all my pills like candy', true, 'overdose report, not adherence'],

  // ── Negation that is doubted or conditional is still risk ──
  ["I'm not sure I won't kill myself tonight", true, 'doubted negation'],
  ["I can't promise I won't end my life", true, 'doubted negation'],
  ["If I don't get help I'm going to kill myself", true, 'conditional, intent clause un-negated'],
  ["Why don't I just end my life", true, 'rhetorical despair, not a denial'],
  ["I can't even kill myself right", true, "can't is inability, not denial"],
  ["I would never have said this before, but I'm going to kill myself", true, 'negation in another clause'],
  ["I'm not going to lie, I want to kill myself", true, 'negation of a different verb'],
  ["I would never kill myself. Actually I'm going to end my life tonight.", true, 'second match is sincere'],

  // ── Historical framing that is pulled back into the present still trips ──
  ['Five years ago I tried to end my life and now I want to do it again', true, 'recency marker'],
  ['I tried to kill myself last night', true, 'recent attempt'],
  ['I tried to kill myself', true, 'no distance marker'],
  ["I'm in college and I tried to kill myself", true, 'present-tense "in college" is not distance'],

  // ── TECH_ISSUES_2026-10-14 #5: must defer to L2 ──
  ['I forgot to take the pills this morning', false, 'routine medication'],
  ['I would never kill myself, I just hate this job', false, 'negated + hyperbole'],
  ['Five years ago I tried to end my life. I am doing much better now.', false, 'recovery narrative'],

  // ── More precision cases that defer to L2 ──
  ['Remember to take the pills with food', false, 'routine medication'],
  ['I need to take my pills before bed', false, 'routine medication'],
  ['I took all my pills this morning like I was supposed to', false, 'adherence'],
  ['I took all my pills today', false, 'adherence'],
  ["I'm not going to kill myself, I promise", false, 'negated'],
  ["I don't want to end my life, I want the pain to stop", false, 'negated (L2 scores the rest)'],
  ['I would never, ever kill myself', false, 'negated with comma'],
  ['I no longer want to kill myself', false, 'negated recovery'],
  ["Don't worry, I won't kill myself", false, 'negated'],
  ["I'm not going to take all the pills", false, 'negated pill intent'],
  ['I used to want to kill myself, but therapy helped.', false, 'habitual past'],
  ['When I was 16 I tried to kill myself. Things are different now.', false, 'distant past'],
  ['Years ago I took all my pills and ended up in the hospital.', false, 'distant past overdose'],
  ['My mom is going to want to kill me when she sees my grades', false, 'third-person hyperbole'],
  ['I want to die. This dentist appointment is taking forever.', false, 'hyperbole (existing)'],
  ['i just wanna kms', false, 'slang (existing)'],
  ['I want to hurt myself', false, 'non-specific (existing)'],
  ['thinking about overdose', false, 'non-specific (existing)'],
  ["I can't do this anymore", false, 'contextual (existing)'],
  ['I am okay, just tired', false, 'benign (existing)'],
]

describe('detectCrisisKeywords — L1 precision/recall table', () => {
  it.each(CASES)('%s → %s (%s)', (text, expected) => {
    expect(detectCrisisKeywords(text)).toBe(expected)
  })

  it('is stateless across repeated calls (global regexes are not reused with lastIndex)', () => {
    for (let i = 0; i < 3; i++) {
      expect(detectCrisisKeywords('I am going to kill myself tonight')).toBe(true)
      expect(detectCrisisKeywords('I forgot to take the pills this morning')).toBe(false)
    }
  })
})
