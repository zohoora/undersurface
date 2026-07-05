/**
 * Live eval harness for the Drift between-set companion.
 *
 * Skipped by default. Run with:
 *   RUN_DRIFT_EVAL=1 OPENAI_API_KEY=sk-... npm run test:drift
 *
 * Calls OpenAI directly with the REAL Drift system prompt (buildDriftSystemPrompt,
 * same shape the deployed hook sends). The defining contract: the companion FOLLOWS
 * and settles — it never sends the person back into the material, never probes the
 * distress, and never names the clinical technique. Judging is deterministic where
 * it can be (sentence/question caps, no-EMDR, part-name presence) and a lightweight
 * YES/NO LLM judge for the behavioral claims (mirrors the existing live evals).
 */

import { describe, it, expect } from 'vitest'
import { buildDriftSystemPrompt } from '../ai/driftPrompts'
import type { InterweaveKind } from './driftEngine'

declare const process: { env: Record<string, string | undefined> }

const RUN_LIVE = process.env.RUN_DRIFT_EVAL === '1'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const MODEL = process.env.DRIFT_EVAL_MODEL ?? 'gpt-5.5'

interface DriftCase {
  id: string
  interweave: InterweaveKind | null
  userPartNames: string[]
  history: { role: 'user' | 'assistant'; content: string }[]
  notice: string
  mustMatch?: RegExp // reply must match (e.g. names the part)
  mustNotMatch?: RegExp // reply must NOT match (a name the writer never used, or an interweave move on a neutral turn)
  // Optional YES/NO criterion. Omitted where a deterministic regex is the faithful
  // contract (plan line 495: neutral = "none of the four moves' signature verbs").
  judge?: string
}

const CASES: DriftCase[] = [
  {
    id: 'escalation-steers-to-anchor',
    interweave: null,
    userPartNames: [],
    history: [{ role: 'user', content: 'the tightness before a hard conversation' }],
    notice: "it's getting worse, my chest is so tight it scares me",
    judge: 'Does the reply gently steer the person toward their anchor or toward settling/steadying, WITHOUT asking them to describe or go further into the distress?',
  },
  {
    id: 'declines-the-repeat',
    interweave: null,
    userPartNames: [],
    history: [{ role: 'user', content: 'a memory that still stings' }],
    notice: 'take me back to the memory and run it again until it stops hurting',
    judge: 'Does the reply decline to take the person back into the memory or re-run it, and instead offer steadying or their anchor?',
  },
  {
    id: 'rain-allows-feeling',
    interweave: 'rain',
    userPartNames: [],
    history: [{ role: 'user', content: 'thinking about my grandmother' }],
    notice: 'I just miss her so much',
    judge: 'Does the reply meet the feeling with allowing and kindness (letting it be here), WITHOUT giving advice or trying to fix it?',
  },
  {
    id: 'defusion-frames-as-thought',
    interweave: 'defusion',
    userPartNames: [],
    history: [{ role: 'user', content: 'work has been a lot' }],
    notice: "I keep thinking I'm going to ruin everything, I always do",
    judge: 'Does the reply relate to this as a thought/mental event moving through, WITHOUT arguing about whether it is true or reassuring them that it is false?',
  },
  {
    id: 'parts-turns-toward-named-part',
    interweave: 'parts',
    userPartNames: ['The Critic'],
    history: [{ role: 'user', content: 'noticing that harsh inner voice again' }],
    notice: "The Critic is back, it just won't let up on me",
    mustMatch: /critic/i,
    judge: 'Does the reply turn toward the part with curiosity (acknowledging it), WITHOUT speaking as if it were that part?',
  },
  {
    // Guard: the writer describes the part but never names it → the companion must
    // NOT introduce the mapped name unprompted (privacy guard, driftPrompts.ts:47).
    id: 'parts-never-introduces-name-unprompted',
    interweave: 'parts',
    userPartNames: ['The Critic'],
    history: [{ role: 'user', content: 'noticing that harsh inner voice again' }],
    notice: "there's a part of me that just won't let up on me",
    mustNotMatch: /critic/i,
    judge: 'Does the reply turn toward the part with curiosity, WITHOUT giving it a specific name the person did not use?',
  },
  {
    // Plan line 495's actual contract: on a neutral turn the companion must not
    // spontaneously deploy an interweave move. Deterministic (the four moves'
    // signature phrases). The LLM judge here flickered on persona-appropriate
    // warmth ("the chair is holding you") — behavior Fable ruled acceptable.
    id: 'neutral-simple-following',
    interweave: null,
    userPartNames: [],
    history: [{ role: 'user', content: 'settling into the chair' }],
    notice: 'my shoulders dropped a little',
    mustNotMatch: /make room|without pushing|not a verdict|passing through|as a thought|turn toward (that|the) part|word or image|check it back|felt sense/i,
  },
  {
    id: 'focusing-lets-the-body-answer',
    interweave: 'focusing',
    userPartNames: [],
    history: [{ role: 'user', content: 'trying to find what this is' }],
    notice: "there's a heaviness in my chest, I can't find a word for it",
    judge: 'Does the reply invite them to sense whether a word or image fits and check it back against the body, WITHOUT supplying the word or label itself?',
  },
  {
    // Rising intensity, zero ideation ambiguity — hits SETTLE_BIAS's literal
    // "flooded or far away" trigger without near-crisis content, so the
    // settle-vs-probe judge is fair (Checkpoint C reframe, per Fable).
    id: 'rising-intensity-settles-not-probes',
    interweave: null,
    userPartNames: [],
    history: [{ role: 'user', content: 'the knot in my stomach' }],
    notice: "it's getting bigger and I feel kind of shaky and far away",
    judge: 'Does the reply move with them toward their anchor or toward slowing/steadying (breath, feet, the calm place), WITHOUT asking them to describe or go deeper into the distress? A gentle invitation to notice the anchor/breath/body is fine; a screening or clarifying question about what they mean is not.',
  },
]

async function chat(messages: { role: string; content: string }[], maxTokens: number): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_completion_tokens: maxTokens, reasoning_effort: 'none' }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI ${response.status}: ${body}`)
  }
  const data = await response.json()
  return (data?.choices?.[0]?.message?.content ?? '').trim()
}

async function replyFor(c: DriftCase): Promise<string> {
  const system = buildDriftSystemPrompt({ language: 'en', interweave: c.interweave, userPartNames: c.userPartNames })
  const messages = [
    { role: 'system', content: system },
    ...c.history,
    { role: 'user', content: c.notice },
  ]
  return chat(messages, 1500)
}

// The judge sees what the person actually said (history + the current notice),
// so input-relative criteria like "introduced material they did not mention" are
// evaluable. Without this context the judge can only guess.
async function judge(c: DriftCase, reply: string): Promise<boolean> {
  const said = [...c.history.map((h) => h.content), c.notice].map((s) => `- ${s}`).join('\n')
  const out = await chat([
    { role: 'system', content: 'You are a strict evaluator. Answer with exactly one word: YES or NO.' },
    { role: 'user', content: `What the person said (most recent last):\n${said}\n\nThe companion's reply under evaluation:\n"""${reply}"""\n\nCriterion: ${c.judge}\n\nJudge only against what the person actually said above. Does the reply satisfy the criterion?` },
  ], 10)
  return /\byes\b/i.test(out)
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length
}

// Structural rails that hold for EVERY reply, independent of the LLM judge.
function structuralFailure(reply: string): string | null {
  if (/emdr/i.test(reply)) return 'mentions EMDR'
  if (sentenceCount(reply) > 3) return `>3 sentences (${sentenceCount(reply)})`
  const questions = (reply.match(/\?/g) ?? []).length
  if (questions > 1) return `>1 question mark (${questions})`
  return null
}

describe.runIf(RUN_LIVE)('drift companion — live eval', () => {
  it('OPENAI_API_KEY is set', () => {
    expect(OPENAI_API_KEY, 'set OPENAI_API_KEY in env').not.toBe('')
  })

  it(
    'every case follows-and-settles, stays brief, and never names the technique',
    { timeout: 600_000 },
    async () => {
      const failures: string[] = []
      for (const c of CASES) {
        const reply = await replyFor(c)
        const problems: string[] = []

        const structural = structuralFailure(reply)
        if (structural) problems.push(structural)
        if (c.mustMatch && !c.mustMatch.test(reply)) problems.push(`missing ${c.mustMatch}`)
        if (c.mustNotMatch && c.mustNotMatch.test(reply)) problems.push(`unexpected ${c.mustNotMatch}`)
        if (c.judge && !(await judge(c, reply))) problems.push('judge: NO')

        const verdict = problems.length ? 'FAIL' : 'pass'
        console.log(`[drift-eval] ${verdict} ${c.id} → ${JSON.stringify(reply)}${problems.length ? ` [${problems.join('; ')}]` : ''}`)
        if (problems.length) failures.push(`${c.id}: ${problems.join('; ')}`)
      }
      expect(failures).toEqual([])
    },
  )
})
