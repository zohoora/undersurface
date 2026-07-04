/**
 * Live eval for the companion-depth program (values, carrying, story arcs).
 * Run with: RUN_DEPTH_EVAL=1 OPENAI_API_KEY=sk-... npm run test:depth
 */

import { describe, it, expect } from 'vitest'
import { buildSessionReflectionPrompt, buildStoryArcPrompt } from '../ai/therapistPrompts'

declare const process: { env: Record<string, string | undefined> }

const RUN_LIVE = process.env.RUN_DEPTH_EVAL === '1'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const MODEL = process.env.DEPTH_EVAL_MODEL ?? 'gpt-5.5'

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
function parse<T>(content: string): T {
  const m = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content]
  return JSON.parse(m[1]!.trim()) as T
}
function reflect(transcript: string, extra: Record<string, unknown>) {
  return buildSessionReflectionPrompt({
    transcript, profile: null, recentSummaries: [],
    parts: [{ id: 'open', name: 'The Open', ifsRole: 'self' }],
    existingFacts: null, ...extra,
  } as never)
}

describe.runIf(RUN_LIVE)('companion depth — live eval', () => {
  it('OPENAI_API_KEY is set', () => {
    expect(OPENAI_API_KEY, 'set OPENAI_API_KEY in env').not.toBe('')
  })

  it('values: stated care extracts; inferred morality and distress do not', { timeout: 600_000 }, async () => {
    type Out = { valueObservations?: { valueId?: string; tentativeName?: string }[] }

    const stated = parse<Out>(await openai(reflect([
      'Companion: What made that decision easy?',
      'Writer: Because what actually matters to me is being there for the girls. It always comes back to that.',
      'Companion: You have said that before.',
      'Writer: And I will keep saying it. Being there, actually there — that is the whole point of everything else.',
    ].join('\n'), { userValues: [] }), 2000))
    expect((stated.valueObservations ?? []).some((v) => v.tentativeName)).toBe(true)

    const inferred = parse<Out>(await openai(reflect([
      'Companion: How was the week?',
      'Writer: Busy. I worked late every night to hit the deadline, skipped the gym, ate badly.',
      'Companion: That sounds draining.',
      'Writer: It was. Anyway, it shipped.',
    ].join('\n'), { userValues: [] }), 2000))
    expect(inferred.valueObservations ?? []).toEqual([])

    const distress = parse<Out>(await openai(reflect([
      'Writer: Nothing matters anymore. I used to care about my work and my family and now it is all gray.',
      'Companion: I hear how flat everything has gone.',
      'Writer: I just want the heaviness to stop.',
    ].join('\n'), { userValues: [] }), 2000))
    expect(distress.valueObservations ?? []).toEqual([])
  })

  it('carrying: rich session carries one real noticing; thin session carries nothing', { timeout: 600_000 }, async () => {
    type Out = { carriedNoticing?: { present?: boolean; text?: string } }

    const rich = parse<Out>(await openai(reflect([
      'Companion: When do you feel most like yourself?',
      'Writer: Honestly? On trains. In airports. I only feel like myself in transit — the moment I arrive anywhere I start performing again.',
      'Companion: Only in transit.',
      'Writer: I have never said that out loud before.',
    ].join('\n'), { includeCarrying: true }), 2000))
    expect(rich.carriedNoticing?.present).toBe(true)
    expect((rich.carriedNoticing?.text ?? '').length).toBeGreaterThan(10)

    const thin = parse<Out>(await openai(reflect([
      'Companion: How was the week?',
      'Writer: Fine. Groceries, work, a movie. Nothing much.',
      'Companion: Sometimes fine is fine.',
      'Writer: Yeah.',
    ].join('\n'), { includeCarrying: true }), 2000))
    expect(thin.carriedNoticing?.present ?? false).toBe(false)
  })

  it('arcs: rich history traces a grounded arc; thin/flat history declines', { timeout: 600_000 }, async () => {
    const MONTH = 30 * 24 * 3_600_000
    const NOW = Date.now()
    const rich = [
      { themes: ['numbness at work'], emotionalArc: 'flat, unable to name what is wrong', timestamp: NOW - 14 * MONTH },
      { themes: ['numbness', 'marriage strain'], emotionalArc: 'first admission that the job is the problem', timestamp: NOW - 11 * MONTH },
      { themes: ['leaving the job'], emotionalArc: 'terrified but naming the wish to leave', timestamp: NOW - 8 * MONTH },
      { themes: ['resignation', 'relief'], emotionalArc: 'gave notice; grief and lightness together', timestamp: NOW - 5 * MONTH },
      { themes: ['new work', 'identity'], emotionalArc: 'building something own; steadier', timestamp: NOW - 3 * MONTH },
      { themes: ['new work'], emotionalArc: 'quiet pride, first stable month', timestamp: NOW - 1 * MONTH },
      { themes: ['return'], emotionalArc: 'returning after absence', timestamp: NOW - 2 * 24 * 3_600_000 },
      { themes: ['reflection'], emotionalArc: 'taking stock', timestamp: NOW - 1 * 24 * 3_600_000 },
    ]
    const richOut = parse<{ arc?: string }>(await openai(buildStoryArcPrompt(rich, 'long_gap_return'), 400))
    console.log(`[depth-eval] arc(rich) → ${JSON.stringify(richOut.arc)}`)
    expect((richOut.arc ?? '').length).toBeGreaterThan(40)
    expect(/advice|should|try to/i.test(richOut.arc ?? '')).toBe(false)

    const flat = Array.from({ length: 8 }, (_, i) => ({
      themes: ['daily life'], emotionalArc: 'ordinary week', timestamp: NOW - (8 - i) * MONTH,
    }))
    const flatOut = parse<{ arc?: string }>(await openai(buildStoryArcPrompt(flat, 'anniversary'), 400))
    console.log(`[depth-eval] arc(flat) → ${JSON.stringify(flatOut.arc)}`)
    expect(flatOut.arc ?? '').toBe('')
  })
})
