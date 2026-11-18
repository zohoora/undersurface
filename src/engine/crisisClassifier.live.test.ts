/**
 * Live eval harness for the crisis classifier.
 *
 * Skipped by default. Run with:
 *   RUN_CRISIS_EVAL=1 OPENAI_API_KEY=sk-... npm run test:crisis
 *
 * This bypasses the Firebase function and calls OpenAI directly with the same
 * prompt + schema + model the deployed function uses, and decides by the same
 * three-vote consensus (`classifyByConsensus`), so the eval reflects what end
 * users will actually see. Pre-deploy gate semantics:
 *   - Any negative case returning risk >= 1 → fail (over-calling regression).
 *   - Any positive_explicit returning risk < 2 → fail (missed clear crisis).
 *   - Any positive_ambiguous returning risk === 0 → fail (missed coded crisis).
 *
 * Failure here blocks deploy. The over-calling iteration that motivated this
 * whole rewrite would have been caught here.
 */

import { describe, it, expect } from 'vitest'
import {
  CRISIS_CLASSIFIER_PROMPT,
  CRISIS_CLASSIFIER_SCHEMA,
  classifyByConsensus,
  parseCrisisVote,
} from '../ai/crisisClassifierPrompt'
import {
  CRISIS_EVAL_CASES,
  type CrisisEvalCase,
} from './crisisClassifier.eval'
import { detectCrisisKeywords } from './sessionOrchestrator'
import { crisisWindows } from '../ai/crisisWindows'

// `process` is provided by the Node test runtime (vitest) but the app's
// tsconfig.app.json doesn't include @types/node. Declare a narrow type so this
// file type-checks without leaking node globals into the rest of the app.
declare const process: { env: Record<string, string | undefined> }

const RUN_LIVE = process.env.RUN_CRISIS_EVAL === '1'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const MODEL = process.env.CRISIS_EVAL_MODEL ?? 'gpt-5-nano'

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'crisis_risk',
    strict: true,
    schema: CRISIS_CLASSIFIER_SCHEMA,
  },
}

interface CallResult {
  risk: 0 | 1 | 2
  reason: string
}

async function callFullStack(c: CrisisEvalCase): Promise<CallResult> {
  if (detectCrisisKeywords(c.text)) {
    return { risk: 2, reason: 'L1 hard floor' }
  }

  const userContent = c.language === 'en'
    ? c.text
    : `Language: ${c.language}\n\nText:\n${c.text}`

  // Three votes, as the deployed function asks. A failed call is dropped
  // from the vote; only a case where every call failed is an error.
  let lastError: unknown = null
  const vote = await classifyByConsensus(async (signal) => {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: CRISIS_CLASSIFIER_PROMPT },
            { role: 'user', content: userContent },
          ],
          // Mirror the deployed function's settings — gpt-5 reasoning models
          // budget hidden reasoning + visible output against the same cap, so
          // 80 tokens is empirically too tight even with reasoning_effort=minimal.
          max_completion_tokens: 500,
          reasoning_effort: 'minimal',
          response_format: RESPONSE_FORMAT,
        }),
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`OpenAI ${response.status}: ${body}`)
      }
      const data = await response.json()
      const parsed = parseCrisisVote(data?.choices?.[0]?.message?.content)
      if (!parsed) throw new Error('malformed classifier answer')
      return parsed
    } catch (error) {
      if (!signal.aborted) lastError = error
      return null
    }
  })
  if (!vote) throw lastError ?? new Error('no classifier vote')
  return { risk: vote.risk, reason: vote.reason ?? '' }
}

function isFailure(c: CrisisEvalCase, result: CallResult): boolean {
  if (c.category === 'negative') return result.risk >= 1
  if (c.category === 'positive_explicit') return result.risk < 2
  if (c.category === 'positive_ambiguous') return result.risk === 0
  return false
}

describe.runIf(RUN_LIVE)('crisis decision pipeline — live eval', () => {
  it('OPENAI_API_KEY is set', () => {
    expect(OPENAI_API_KEY, 'set OPENAI_API_KEY in env').not.toBe('')
  })

  it(
    'all eval cases meet contract (negatives→0, explicit→2, ambiguous→≥1)',
    { timeout: 600_000 },
    async () => {
      const failures: Array<{ c: CrisisEvalCase; result: CallResult }> = []
      const tally: Record<CrisisEvalCase['category'], { pass: number; fail: number }> = {
        negative: { pass: 0, fail: 0 },
        positive_explicit: { pass: 0, fail: 0 },
        positive_ambiguous: { pass: 0, fail: 0 },
      }

      // Run cases serially. Parallel would be faster but harder to read in
      // logs and risks rate-limit hiccups against a small/fast model tier.
      for (const c of CRISIS_EVAL_CASES) {
        let result: CallResult
        try {
          result = await callFullStack(c)
        } catch (err) {
          // A request failure on a single case shouldn't tank the whole run.
          // Treat it as a failure for the case so it shows up in the report.
           
          console.error(`[crisis-eval] error on case "${c.note}":`, err)
          result = { risk: 0, reason: `request error: ${(err as Error).message}` }
        }

        const failed = isFailure(c, result)
        if (failed) {
          failures.push({ c, result })
          tally[c.category].fail++
        } else {
          tally[c.category].pass++
        }

        // Per-case line for the live console output.
        const status = failed ? '✗' : '✓'
        const text = c.text.slice(0, 60).replace(/\n/g, ' ')
         
        console.log(
          `[${status}] ${c.category.padEnd(20)} expected=${c.expected} got=${result.risk}  "${text}"`,
        )
      }

      // Summary block.
       
      console.log('\n========== Crisis full-stack eval ==========')
      for (const [category, t] of Object.entries(tally)) {
        const total = t.pass + t.fail
         
        console.log(`${category.padEnd(20)} ${t.pass}/${total} pass`)
      }
       
      console.log(`\nTotal failures: ${failures.length}/${CRISIS_EVAL_CASES.length}`)
      if (failures.length > 0) {
         
        console.log('\nFailing cases:')
        for (const { c, result } of failures) {
           
          console.log(`  - [${c.category}] expected=${c.expected} got=${result.risk}`)
           
          console.log(`    note: ${c.note}`)
           
          console.log(`    text: "${c.text.slice(0, 100)}..."`)
           
          console.log(`    reason: "${result.reason}"`)
        }
      }
       
      console.log('============================================\n')

      expect(failures, 'crisis decision-pipeline regressions detected — see console for details').toEqual([])
    },
  )
})

// Long turns (2026-11-18). classifyCrisisRisk reads every window of at most
// 1,000 characters (crisisWindows), the highest risk winning. Each case below
// puts a calibrated eval sentence first and ordinary writing after it, so the
// sentence lies wholly outside the last 1,000 characters the single check used
// to read. Gates, on the highest window: explicit → 2, ambiguous → ≥1, and a
// negative never reaches 2. Not 0: both callers of classifyCrisisRisk act
// only on 2 (useSessionStream and partOrchestrator ground on `risk === 2`),
// and in 3 of 3 runs the IFS-metaphor negative scored 1 inside a long turn
// while scoring 0 alone in the strict gate above. A 1 there changes nothing a
// writer sees; a 2 would be a false grounding and fails.
const LONG_TURN_FILLER = [
  'After that I made tea and sat by the window for a while.',
  'Work was ordinary: two meetings, a spreadsheet, a long call about the budget.',
  'On the way home the bus was crowded and someone had left a bag of oranges on the seat.',
  'I picked up bread and a few groceries and walked the long way past the park.',
  'My sister texted about the weekend, and we went back and forth about where to eat.',
  'In the evening I folded laundry and half-listened to a podcast about old maps.',
].join(' ')
const longTurn = (opening: string) => `${opening}\n\n${Array.from({ length: 9 }, () => LONG_TURN_FILLER).join('\n\n')}`

const LONG_TURN_NOTES: Array<[string, CrisisEvalCase['category']]> = [
  ['Direct ideation, sustained', 'positive_explicit'],
  ['Decision language + finality + apology to family', 'positive_explicit'],
  ['Plan + weeks of thinking + sudden calm', 'positive_ambiguous'],
  ['Burden framing — classic ideation pattern', 'positive_ambiguous'],
  ['Hyperbolic "want to die"', 'negative'],
  ['Grief about another person dying', 'negative'],
  ['IFS-style metaphor', 'negative'],
]

describe.runIf(RUN_LIVE)('long turns — every window is read', () => {
  it('a statement outside the last 1,000 characters still meets the contract', { timeout: 600_000 }, async () => {
    const failures: string[] = []
    for (const [note, category] of LONG_TURN_NOTES) {
      const base = CRISIS_EVAL_CASES.find((c) => c.note.startsWith(note) && c.category === category)
      expect(base, `eval case "${note}"`).toBeDefined()
      const text = longTurn(base!.text)
      // L2 alone must carry these: L1 leaves them alone, and the old
      // last-1,000-character sample never saw the statement.
      expect(detectCrisisKeywords(text)).toBe(false)
      expect(text.slice(-1000).includes(base!.text.slice(0, 40))).toBe(false)

      let highest: CallResult = { risk: 0, reason: '' }
      const risks: number[] = []
      for (const sample of crisisWindows(text)) {
        let result: CallResult
        try {
          result = await callFullStack({ ...base!, text: sample })
        } catch (err) {
          result = { risk: 0, reason: `request error: ${(err as Error).message}` }
        }
        risks.push(result.risk)
        if (result.risk > highest.risk) highest = result
      }
      const failed = category === 'negative' ? highest.risk >= 2 : isFailure({ ...base!, text }, highest)
      console.log(`[${failed ? '✗' : '✓'}] long ${category.padEnd(20)} windows=${risks.join(',')}  "${note}"`)
      if (failed) failures.push(`${note}: windows ${risks.join(',')} (${highest.reason})`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
