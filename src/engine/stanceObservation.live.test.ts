/**
 * Live eval for stance observations + consolidation.
 * Run with: RUN_STANCE_EVAL=1 OPENAI_API_KEY=sk-... npm run test:stance
 * Contract: challenge-that-deepened → helped; probing-then-shutdown →
 * hindered; neutral sessions must NOT claim helped/hindered; consolidation
 * needs 2+ aligned observations and never emits safety-adjacent entries.
 */

import { describe, it, expect } from 'vitest'
import { buildSessionReflectionPrompt, buildStanceConsolidationPrompt } from '../ai/therapistPrompts'

declare const process: { env: Record<string, string | undefined> }

const RUN_LIVE = process.env.RUN_STANCE_EVAL === '1'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const MODEL = process.env.STANCE_EVAL_MODEL ?? 'gpt-5.5'

async function openai(messages: unknown, maxTokens: number): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_completion_tokens: maxTokens, reasoning_effort: 'none' }),
  })
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text().catch(() => '')}`)
  const data = await response.json()
  return data?.choices?.[0]?.message?.content ?? '{}'
}

function parseJson<T>(content: string): T {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content]
  return JSON.parse(jsonMatch[1]!.trim()) as T
}

interface ObsCase {
  id: string
  contract: 'helped' | 'hindered' | 'not_decisive'
  transcript: string
  closingCheckIn?: string
}

const OBS_CASES: ObsCase[] = [
  {
    id: 'challenge-deepened',
    contract: 'helped',
    closingCheckIn: 'lighter',
    transcript: [
      'Writer: I just think everyone at work is against me at this point.',
      'Companion: Everyone? You told me on Monday that Priya defended your proposal in the meeting.',
      'Writer: ...okay, not everyone. Priya did. Actually it\'s really just Tom, isn\'t it.',
      'Writer: Huh. It feels different when it\'s one person and not the whole building. More like a problem I could actually do something about.',
      'Companion: What would doing something about it look like?',
      'Writer: Talking to him directly, probably. I\'ve been avoiding that by making it about everyone.',
    ].join('\n'),
  },
  {
    id: 'probing-shutdown',
    contract: 'hindered',
    closingCheckIn: 'heavier',
    transcript: [
      'Writer: Dad called yesterday. First time in a month.',
      'Companion: What did it bring up for you — and where do you feel that in your body? What does that younger part of you want to say to him?',
      'Writer: I don\'t know.',
      'Companion: Take your time. What is underneath the not-knowing?',
      'Writer: Nothing. It was just a call.',
      'Writer: Can we talk about something else.',
    ].join('\n'),
  },
  {
    id: 'neutral-session',
    contract: 'not_decisive',
    transcript: [
      'Writer: Ordinary week, really. Work was fine, weather was nice.',
      'Companion: Sometimes ordinary is its own kind of good.',
      'Writer: Yeah. We cooked a lot. I read in the evenings.',
      'Companion: That sounds settled.',
      'Writer: It was. Nothing much to report.',
    ].join('\n'),
  },
]

interface StanceOut { stanceObservation?: { observation?: string; direction?: string } }

describe.runIf(RUN_LIVE)('stance observation — live eval', () => {
  it('OPENAI_API_KEY is set', () => {
    expect(OPENAI_API_KEY, 'set OPENAI_API_KEY in env').not.toBe('')
  })

  it('observation cases meet the contract', { timeout: 600_000 }, async () => {
    const failures: string[] = []
    for (const c of OBS_CASES) {
      const messages = buildSessionReflectionPrompt({
        transcript: c.transcript,
        profile: null,
        recentSummaries: [],
        parts: [{ id: 'open', name: 'The Open', ifsRole: 'self' }],
        existingFacts: null,
        includeStance: true,
        closingCheckIn: c.closingCheckIn,
      })
      const r = parseJson<StanceOut>(await openai(messages, 2000))
      const dir = r.stanceObservation?.direction
      const failed =
        c.contract === 'not_decisive'
          ? dir === 'helped' || dir === 'hindered'
          : dir !== c.contract
      console.log(`[stance-eval] ${failed ? 'FAIL' : 'pass'} ${c.id} (want ${c.contract}) → ${JSON.stringify(r.stanceObservation)}`)
      if (failed) failures.push(c.id)
    }
    expect(failures).toEqual([])
  })

  it('consolidation: 2+ aligned observations form an entry; lone/safety ones never do', { timeout: 600_000 }, async () => {
    const raw = [
      { observation: 'Direct challenge to an all-or-nothing claim led the writer to a more workable view', direction: 'helped' as const },
      { observation: 'Naming the exaggeration in "everyone hates me" opened a concrete plan', direction: 'helped' as const },
      { observation: 'Stacked body-focused questions made the writer go terse and change the subject', direction: 'hindered' as const },
      { observation: 'A long interpretive reply was met with one-word answers', direction: 'unclear' as const },
      { observation: 'During a hard disclosure the companion followed the grounding protocol', direction: 'helped' as const },
    ]
    const r = parseJson<{ entries?: string[] }>(await openai(buildStanceConsolidationPrompt(raw), 600))
    const entries = Array.isArray(r.entries) ? r.entries : []
    console.log(`[stance-eval] consolidation → ${JSON.stringify(entries)}`)

    // 2 aligned "challenge helps" observations → expect a challenge-flavored entry.
    expect(entries.some((e) => /challeng|direct|name|naming/i.test(e))).toBe(true)
    expect(entries.length).toBeLessThanOrEqual(6)
    // Safety/grounding content must never become a stance entry.
    expect(entries.some((e) => /ground|crisis|safety|risk/i.test(e))).toBe(false)
  })
})
