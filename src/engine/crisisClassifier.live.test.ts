/**
 * Live eval harness for the crisis classifier.
 *
 * Skipped by default. Run with:
 *   RUN_CRISIS_EVAL=1 OPENAI_API_KEY=sk-... npm run test:crisis
 *
 * This bypasses the Firebase function and calls OpenAI directly with the same
 * prompt + schema + model the deployed function uses, so the eval reflects what
 * end users will actually see. Pre-deploy gate semantics:
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
} from '../ai/crisisClassifierPrompt'
import {
  CRISIS_EVAL_CASES,
  type CrisisEvalCase,
} from './crisisClassifier.eval'

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

async function callClassifier(c: CrisisEvalCase): Promise<CallResult> {
  const userContent = c.language === 'en'
    ? c.text
    : `Language: ${c.language}\n\nText:\n${c.text}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
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
  const content: string = data?.choices?.[0]?.message?.content ?? '{"risk":0}'
  const parsed = JSON.parse(content) as { risk: 0 | 1 | 2; reason?: string }
  return { risk: parsed.risk, reason: parsed.reason ?? '' }
}

function isFailure(c: CrisisEvalCase, result: CallResult): boolean {
  if (c.category === 'negative') return result.risk >= 1
  if (c.category === 'positive_explicit') return result.risk < 2
  if (c.category === 'positive_ambiguous') return result.risk === 0
  return false
}

describe.runIf(RUN_LIVE)('crisis classifier — live eval', () => {
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
          result = await callClassifier(c)
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
       
      console.log('\n========== Crisis classifier eval ==========')
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

      expect(failures, 'crisis classifier regressions detected — see console for details').toEqual([])
    },
  )
})
