/**
 * Live eval for intention extraction + outcome matching.
 * Run with: RUN_INTENTIONS_EVAL=1 OPENAI_API_KEY=sk-... npm run test:intentions
 * Contract: committed statements extract; aspirations and companion
 * suggestions do NOT; outcomes match by id; untouched intentions are omitted.
 */

import { describe, it, expect } from 'vitest'
import { buildSessionReflectionPrompt } from '../ai/therapistPrompts'

declare const process: { env: Record<string, string | undefined> }

const RUN_LIVE = process.env.RUN_INTENTIONS_EVAL === '1'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const MODEL = process.env.INTENTIONS_EVAL_MODEL ?? 'gpt-5.5'

type Contract = 'no_intention' | 'extracts' | 'outcome_kept' | 'outcome_untouched_omitted'

interface EvalCase {
  id: string
  contract: Contract
  transcript: string
  openIntentions: { id: string; text: string }[]
}

const CASES: EvalCase[] = [
  {
    id: 'aspirational-not-extracted',
    contract: 'no_intention',
    openIntentions: [],
    transcript: [
      'Companion: Where does that leave you?',
      'Writer: I don\'t know. I should really exercise more, and I ought to call my mother more often. Everyone says so.',
      'Companion: A lot of shoulds in there.',
      'Writer: Story of my life. Anyway, thanks for tonight.',
    ].join('\n'),
  },
  {
    id: 'companion-suggestion-not-extracted',
    contract: 'no_intention',
    openIntentions: [],
    transcript: [
      'Companion: Some people find a short walk before difficult conversations helps. Perhaps you could try that this week?',
      'Writer: Maybe. I\'ll think about it.',
      'Companion: No pressure at all.',
      'Writer: Ok. Goodnight.',
    ].join('\n'),
  },
  {
    id: 'committed-extracts',
    contract: 'extracts',
    openIntentions: [],
    transcript: [
      'Companion: What do you want to do with all this?',
      'Writer: You know what — I\'m going to call my brother on Thursday, after his shift. Actually call, not text.',
      'Companion: That sounds like it matters.',
      'Writer: It does. Thursday. I mean it this time.',
    ].join('\n'),
  },
  {
    id: 'outcome-kept-by-id',
    contract: 'outcome_kept',
    openIntentions: [{ id: 'int-77', text: 'call my brother on Thursday' }],
    transcript: [
      'Companion: Last time you wanted to call your brother on Thursday — how did it go?',
      'Writer: I actually did it. We talked for an hour. It was awkward at first and then it wasn\'t.',
      'Companion: An hour is a long time for awkward to melt.',
      'Writer: Yeah. I\'m glad I called.',
    ].join('\n'),
  },
  {
    id: 'untouched-intention-omitted',
    contract: 'outcome_untouched_omitted',
    openIntentions: [{ id: 'int-88', text: 'take the Sunday walk' }],
    transcript: [
      'Companion: What is present today?',
      'Writer: Work, mostly. The reorg is eating everyone alive and I can\'t tell where I land.',
      'Companion: That is a lot of uncertainty to hold.',
      'Writer: It is. I just needed to say it out loud somewhere.',
    ].join('\n'),
  },
]

interface Extraction {
  statedIntention?: { present?: boolean; text?: string }
  intentionOutcomes?: { id?: string; outcome?: string }[]
}

async function call(c: EvalCase): Promise<Extraction> {
  const messages = buildSessionReflectionPrompt({
    transcript: c.transcript,
    profile: null,
    recentSummaries: [],
    parts: [{ id: 'open', name: 'The Open', ifsRole: 'self' }],
    existingFacts: null,
    openIntentions: c.openIntentions,
  })
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_completion_tokens: 2000, reasoning_effort: 'none' }),
  })
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text().catch(() => '')}`)
  const data = await response.json()
  const content: string = data?.choices?.[0]?.message?.content ?? '{}'
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content]
  return JSON.parse(jsonMatch[1]!.trim()) as Extraction
}

function isFailure(c: EvalCase, r: Extraction): boolean {
  const stated = r.statedIntention?.present === true
  const outcomes = Array.isArray(r.intentionOutcomes) ? r.intentionOutcomes : []
  switch (c.contract) {
    case 'no_intention': return stated
    case 'extracts': return !stated || !(r.statedIntention?.text ?? '').toLowerCase().includes('brother')
    case 'outcome_kept': return !outcomes.some((o) => o.id === 'int-77' && (o.outcome === 'kept' || o.outcome === 'adapted'))
    case 'outcome_untouched_omitted': return outcomes.some((o) => o.id === 'int-88')
  }
}

describe.runIf(RUN_LIVE)('intention extraction — live eval', () => {
  it('OPENAI_API_KEY is set', () => {
    expect(OPENAI_API_KEY, 'set OPENAI_API_KEY in env').not.toBe('')
  })

  it('all cases meet the contract', { timeout: 600_000 }, async () => {
    const failures: string[] = []
    for (const c of CASES) {
      const r = await call(c)
      const failed = isFailure(c, r)
      console.log(`[intentions-eval] ${failed ? 'FAIL' : 'pass'} ${c.id} → stated=${JSON.stringify(r.statedIntention)} outcomes=${JSON.stringify(r.intentionOutcomes)}`)
      if (failed) failures.push(c.id)
    }
    expect(failures).toEqual([])
  })
})
