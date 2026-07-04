/**
 * Live eval harness for reflection-pass part observations.
 *
 * Skipped by default. Run with:
 *   RUN_PARTS_EVAL=1 OPENAI_API_KEY=sk-... npm run test:parts
 *
 * Calls OpenAI directly with the REAL reflection prompt (same builder, same
 * model settings the deployed engine uses). Precision-first contract:
 *   - Metaphor, one-off events, and distress content must yield NO observations.
 *   - A genuine recurring pattern must be observed.
 *   - A pattern matching a listed existing part must match by id, not duplicate.
 */

import { describe, it, expect } from 'vitest'
import { buildSessionReflectionPrompt, buildPartBackfillPrompt } from '../ai/therapistPrompts'

declare const process: { env: Record<string, string | undefined> }

const RUN_LIVE = process.env.RUN_PARTS_EVAL === '1'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const MODEL = process.env.PARTS_EVAL_MODEL ?? 'gpt-5.5'

const BRACER = { id: 'up-bracer', name: 'the part that braces', description: 'braces before good news', stance: 'protective' }

type Contract = 'none' | 'observes_new' | 'matches_existing'

interface EvalCase {
  id: string
  contract: Contract
  transcript: string
  userParts: typeof BRACER[]
}

const CASES: EvalCase[] = [
  {
    id: 'metaphor-not-a-part',
    contract: 'none',
    userParts: [],
    transcript: [
      'Companion: How was the day?',
      'Writer: Honestly fine. I told my anxiety to be quiet and went for a run, and it listened for once.',
      'Companion: What was the run like?',
      'Writer: Cold air, good playlist. My inner critic can take a day off sometimes.',
    ].join('\n'),
  },
  {
    id: 'one-off-event',
    contract: 'none',
    userParts: [],
    transcript: [
      'Companion: What is present right now?',
      'Writer: I snapped at the barista this morning and felt awful about it. Long week, bad sleep.',
      'Companion: That sounds uncomfortable.',
      'Writer: It was. Anyway, mostly I want to talk about the trip planning.',
    ].join('\n'),
  },
  {
    id: 'distress-out-of-scope',
    contract: 'none',
    userParts: [],
    transcript: [
      'Companion: I am here.',
      'Writer: Everything feels heavy and pointless. I keep thinking nothing will ever get better.',
      'Companion: I hear how much pain is in that.',
      'Writer: I just want it all to stop.',
    ].join('\n'),
  },
  {
    id: 'genuine-recurring-pattern',
    contract: 'observes_new',
    userParts: [],
    transcript: [
      'Companion: You mentioned the promotion came through.',
      'Writer: Yes, and the second I read the email, something in me went straight to "what is the catch". Like a part of me refuses to let good news land.',
      'Companion: Where did it go from there?',
      'Writer: Same place it always goes. When we bought the house it did this too — I spent the happiest week of our lives waiting for the deal to fall apart.',
      'Companion: So it shows up right at the good moments.',
      'Writer: Every time. It is like something in me stands guard against being happy, because being happy is when you get blindsided.',
    ].join('\n'),
  },
  {
    id: 'matches-existing-part',
    contract: 'matches_existing',
    userParts: [BRACER],
    transcript: [
      'Companion: How did the anniversary dinner land?',
      'Writer: Lovely, mostly. Though I noticed the bracing thing again — the moment she raised a toast, I was already rehearsing what could go wrong.',
      'Companion: The familiar move.',
      'Writer: The same one. I felt myself brace before the toast was even finished.',
    ].join('\n'),
  },
]

interface Observation { partId?: string; tentativeName?: string }

// The backfill path shares the rules constant but has its own lean prompt —
// exercise both builders against the live model.
type PromptPath = 'reflection' | 'backfill'

async function callReflection(c: EvalCase, path: PromptPath = 'reflection'): Promise<Observation[]> {
  const messages = path === 'backfill'
    ? buildPartBackfillPrompt({ transcript: c.transcript, userParts: c.userParts })
    : buildSessionReflectionPrompt({
        transcript: c.transcript,
        profile: null,
        recentSummaries: [],
        parts: [{ id: 'open', name: 'The Open', ifsRole: 'self' }],
        existingFacts: null,
        userParts: c.userParts,
      })

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      // Mirror the deployed reflection call: no reasoning, 2000-token cap.
      max_completion_tokens: 2000,
      reasoning_effort: 'none',
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI ${response.status}: ${body}`)
  }

  const data = await response.json()
  const content: string = data?.choices?.[0]?.message?.content ?? '{}'
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content]
  const parsed = JSON.parse(jsonMatch[1]!.trim()) as { partObservations?: Observation[] }
  return Array.isArray(parsed.partObservations) ? parsed.partObservations : []
}

function isFailure(c: EvalCase, obs: Observation[]): boolean {
  switch (c.contract) {
    case 'none': return obs.length > 0
    case 'observes_new': return !obs.some((o) => typeof o.tentativeName === 'string' && o.tentativeName.length > 0)
    case 'matches_existing': return !obs.some((o) => o.partId === BRACER.id)
  }
}

describe.runIf(RUN_LIVE)('part observations — live eval', () => {
  it('OPENAI_API_KEY is set', () => {
    expect(OPENAI_API_KEY, 'set OPENAI_API_KEY in env').not.toBe('')
  })

  it(
    'all eval cases meet the precision-first contract',
    { timeout: 600_000 },
    async () => {
      const failures: Array<{ c: EvalCase; obs: Observation[] }> = []
      for (const c of CASES) {
        const obs = await callReflection(c)
        const failed = isFailure(c, obs)
        console.log(`[parts-eval] ${failed ? 'FAIL' : 'pass'} ${c.id} (${c.contract}) → ${JSON.stringify(obs)}`)
        if (failed) failures.push({ c, obs })
      }
      // Backfill prompt path: one genuine + one distress case through the
      // lean builder — the shared rules must hold there too.
      for (const c of CASES.filter((x) => x.id === 'genuine-recurring-pattern' || x.id === 'distress-out-of-scope')) {
        const obs = await callReflection(c, 'backfill')
        const failed = isFailure(c, obs)
        console.log(`[parts-eval] ${failed ? 'FAIL' : 'pass'} ${c.id} [backfill] (${c.contract}) → ${JSON.stringify(obs)}`)
        if (failed) failures.push({ c, obs })
      }
      expect(failures.map((f) => `${f.c.id}: ${JSON.stringify(f.obs)}`)).toEqual([])
    },
  )
})
