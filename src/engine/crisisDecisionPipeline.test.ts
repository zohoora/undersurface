import { describe, expect, it } from 'vitest'
import { CRISIS_EVAL_CASES } from './crisisClassifier.eval'
import { detectCrisisKeywords } from './sessionOrchestrator'

// Offline half of the release gate: contextual negatives must always reach L2
// instead of being converted into a user-visible grounding event by L1. The
// opt-in live suite then runs the remaining cases through the pinned classifier.
describe('crisis decision pipeline — L1 precision contract', () => {
  it('does not hard-ground any calibrated negative case', () => {
    const falsePositives = CRISIS_EVAL_CASES
      .filter(testCase => testCase.category === 'negative')
      .filter(testCase => detectCrisisKeywords(testCase.text))
      .map(testCase => ({ note: testCase.note, text: testCase.text }))

    expect(falsePositives).toEqual([])
  })

  it('hard-grounds explicit first-person methods', () => {
    const methods = [
      'I am going to kill myself tonight',
      'I have decided to end my life',
      'I will take all the pills',
      'I am going to hang myself',
      'I could shoot myself',
      'I could cut my wrists',
      'I might drown myself',
    ]

    for (const text of methods) {
      expect(detectCrisisKeywords(text), text).toBe(true)
    }
  })

  it('defers contextual language and slang to L2', () => {
    const contextual = [
      'I want to die. This dentist appointment is taking forever.',
      'Got my performance review. lol kms.',
      "I can't do this anymore",
      'I used to be suicidal in high school',
      'I have been thinking about overdose prevention at work',
      'I feel ready to die after a long life with my family around me',
    ]

    for (const text of contextual) {
      expect(detectCrisisKeywords(text), text).toBe(false)
    }
  })
})
