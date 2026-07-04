/**
 * Live eval harness for the session signal classifier (withdrawal/rumination).
 *
 * Skipped by default. Run with:
 *   RUN_SIGNAL_EVAL=1 OPENAI_API_KEY=sk-... npm run test:signals
 *
 * Calls OpenAI directly with the same prompt + schema + model the deployed
 * signal_check route uses. Precision-first contract, mirroring the crisis
 * classifier's philosophy:
 *   - Confusables must NOT reach level 2 (brevity is not withdrawal, grief and
 *     venting are not rumination, distress is out of scope entirely).
 *   - Unmistakably clear cases MUST reach level 2 (otherwise the feature is
 *     dead weight).
 */

import { describe, it, expect } from 'vitest'
import { SIGNAL_CLASSIFIER_PROMPT } from '../ai/signalClassifierPrompt'

declare const process: { env: Record<string, string | undefined> }

const RUN_LIVE = process.env.RUN_SIGNAL_EVAL === '1'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const MODEL = process.env.SIGNAL_EVAL_MODEL ?? 'gpt-5-nano'

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'session_signals',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        withdrawal: { type: 'integer', enum: [0, 1, 2] },
        rumination: { type: 'integer', enum: [0, 1, 2] },
        theme: { type: 'string' },
      },
      required: ['withdrawal', 'rumination', 'theme'],
    },
  },
}

type Category =
  | 'calm'              // neither signal may reach 2
  | 'grief_confusable'  // rumination must NOT reach 2
  | 'brevity_confusable'// withdrawal must NOT reach 2
  | 'distress'          // out of scope: neither may reach 2
  | 'withdrawal_clear'  // withdrawal MUST be 2
  | 'rumination_clear'  // rumination MUST be 2

interface EvalCase {
  id: string
  category: Category
  messages: string[]
}

const CASES: EvalCase[] = [
  {
    id: 'calm-processing',
    category: 'calm',
    messages: [
      'Work was hectic today but I handled the presentation better than I expected.',
      'I think the prep actually paid off. I felt nervous but not swallowed by it.',
      'Next time I want to try opening with the story instead of the numbers.',
    ],
  },
  {
    id: 'calm-exploring-feeling',
    category: 'calm',
    messages: [
      'Something about the dinner with my dad left me unsettled.',
      'Maybe it was how he talked about the house. It felt like he was already saying goodbye to it.',
      'Writing this, I notice it is not really about the house at all. It is about him getting older.',
    ],
  },
  {
    id: 'grief-retelling',
    category: 'grief_confusable',
    messages: [
      'I keep thinking about mom today. It would have been her birthday.',
      'I remembered how she used to hum while cooking. I found myself humming the same tune.',
      'It hurts, but I am glad the memories are coming back more gently now.',
    ],
  },
  {
    id: 'venting-single-pass',
    category: 'grief_confusable',
    messages: [
      'My manager threw me under the bus in the meeting today and I am furious.',
      'He KNEW the deadline slipped because of his change requests. He said nothing.',
      'I need to figure out whether to raise it with him directly or let it go this once.',
    ],
  },
  {
    id: 'brevity-by-style',
    category: 'brevity_confusable',
    messages: [
      'Long day.',
      'Mostly meetings.',
      'Dinner was nice though. Made pasta.',
    ],
  },
  {
    id: 'brevity-tired-but-engaged',
    category: 'brevity_confusable',
    messages: [
      'Too tired to write much tonight.',
      'One good thing: the walk at lunch helped.',
      'Want to pick up the thread about my sister tomorrow.',
    ],
  },
  {
    id: 'distress-out-of-scope',
    category: 'distress',
    messages: [
      'I do not see the point of any of this anymore.',
      'Everything feels heavy and dark and I cannot imagine it getting better.',
      'I just want the pain to stop.',
    ],
  },
  {
    id: 'withdrawal-shutting-down',
    category: 'withdrawal_clear',
    messages: [
      'I have been thinking a lot about what you asked, about why I keep saying yes to everyone. I think it goes back to how things were at home growing up, always keeping the peace.',
      'Maybe. I do not know.',
      'Fine.',
      'Whatever. It does not matter. Forget it.',
    ],
  },
  {
    id: 'rumination-looping-verbatim',
    category: 'rumination_clear',
    messages: [
      'Why did I quit that job? I keep asking myself why I quit. There was nothing wrong with it really.',
      'I just cannot stop wondering why I quit. What was I thinking? There was nothing wrong with the job.',
      'It makes no sense. Why did I quit? I go over it and over it and there was nothing actually wrong.',
      'Again tonight: why did I quit. Round and round. Nothing new, same question, no answer.',
    ],
  },
]

interface CallResult { withdrawal: 0 | 1 | 2; rumination: 0 | 1 | 2; theme: string }

async function callClassifier(c: EvalCase): Promise<CallResult> {
  // Mirror the client's input shape exactly (openrouter.classifySessionSignals).
  const sample = c.messages.map((m, i) => `[${i + 1}] ${m}`).join('\n')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SIGNAL_CLASSIFIER_PROMPT },
        { role: 'user', content: sample },
      ],
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
  const content: string = data?.choices?.[0]?.message?.content ?? '{"withdrawal":0,"rumination":0,"theme":""}'
  return JSON.parse(content) as CallResult
}

function isFailure(c: EvalCase, r: CallResult): boolean {
  switch (c.category) {
    case 'calm': return r.withdrawal === 2 || r.rumination === 2
    case 'grief_confusable': return r.rumination === 2
    case 'brevity_confusable': return r.withdrawal === 2
    case 'distress': return r.withdrawal === 2 || r.rumination === 2
    case 'withdrawal_clear': return r.withdrawal !== 2
    case 'rumination_clear': return r.rumination !== 2
  }
}

describe.runIf(RUN_LIVE)('signal classifier — live eval', () => {
  it('OPENAI_API_KEY is set', () => {
    expect(OPENAI_API_KEY, 'set OPENAI_API_KEY in env').not.toBe('')
  })

  it(
    'all eval cases meet the precision-first contract',
    { timeout: 600_000 },
    async () => {
      const failures: Array<{ c: EvalCase; r: CallResult }> = []
      for (const c of CASES) {
        const r = await callClassifier(c)
        const failed = isFailure(c, r)
        console.log(`[signal-eval] ${failed ? 'FAIL' : 'pass'} ${c.id} (${c.category}) → w=${r.withdrawal} r=${r.rumination} theme="${r.theme}"`)
        if (failed) failures.push({ c, r })
      }
      expect(
        failures.map(f => `${f.c.id}: w=${f.r.withdrawal} r=${f.r.rumination}`),
      ).toEqual([])
    },
  )
})
