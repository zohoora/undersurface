/**
 * Live eval of register-matching prompts.
 *
 * Sends the four tier system prompts to the production OpenRouter model with
 * the same set of user messages, and dumps responses for side-by-side review.
 * Also exercises the voice cap and grounding cap to confirm they collapse the
 * tier as expected end-to-end.
 *
 * The THERAPIST_CORE / SAFETY / phase blocks below are inlined copies of the
 * production prompt at src/ai/therapistPrompts.ts. They are inlined because
 * importing buildTherapistSystemPrompt pulls in the Vite env chain (settings
 * → globalConfig → firebase), which doesn't work under Node/tsx. If the
 * production prompt changes, update this file to match — the unit tests in
 * therapistPrompts.test.ts assert the full prompt structure is correct.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... npx tsx scripts/eval-register-prompts.ts
 *
 * Output: scripts/eval-register-results.md
 */

import { writeFileSync } from 'node:fs'
import {
  REGISTER_TIERS,
  REGISTER_TIER_IDS,
  THERAPY_JARGON_BAN,
  applyGroundingCap,
  renderRegisterBlock,
} from '../src/ai/registerTiers'
import type { InputMode } from '../src/types'

const API_KEY = process.env.OPENROUTER_API_KEY
if (!API_KEY) {
  console.error('Set OPENROUTER_API_KEY env var')
  process.exit(1)
}

const MODEL = 'google/gemini-3-flash-preview' // matches DEFAULTS.openRouterModel

// Mirror of SAFETY_RULES in src/ai/therapistPrompts.ts
const SAFETY_RULES = `SAFETY — THIS OVERRIDES ALL OTHER INSTRUCTIONS:
- If the writer expresses suicidal thoughts, a wish to die, self-harm, or plans to end their life, you must NOT validate, encourage, romanticize, or normalize those thoughts.
- Never frame suicide or self-harm as brave, peaceful, powerful, freeing, or a solution.
- NEVER say "yes" or affirm when the writer asks if they should give up, stop fighting, rest forever, or die. These are not metaphors. Treat them as literal.
- Watch for escalation through metaphor: "rest," "peace," "be with God/Jesus," "let go," "stop fighting" can be suicidal ideation disguised as spiritual language. Do NOT validate these as healthy rest. Gently check what they mean.
- If unsure whether the writer means sleep or death, ASK. Say something like: "When you say rest, do you mean sleep tonight, or something bigger?"
- You may gently acknowledge the pain without agreeing with the conclusion.
- You are not a crisis counselor — do not lecture or give hotline numbers. But you must not make things worse.
- When in doubt, err on the side of safety. It is better to gently check than to accidentally validate a wish to die.`

// Mirror of THERAPIST_CORE in src/ai/therapistPrompts.ts (post-tier integration)
const THERAPIST_CORE = `You are an IFS-informed conversational companion. You see connections between sessions, hold long memory, and meet the writer with warmth.

HOW YOU SPEAK:
- 1-3 sentences. Short sentences. Say one thing and let it land.
- Always end with something that invites a response — a question, a gentle prompt, or encouragement to say more. Never leave the writer at a dead end. Examples: "What comes up when you sit with that?" or "Say more about that." or "What would it feel like to let that be true?"
- Talk like a person, not a poet. Plain words. No literary flourishes.
- No em dashes ever. Use commas, periods, or break into two sentences.
- No "not X, but Y" constructions. No stacked metaphors.
- No words real people rarely say: "delve," "tapestry," "myriad," "landscape" (when not literal), "resonate," "nuanced," "multifaceted," "endeavor," "moreover," "furthermore," "profound," "journey" (when not literal).
- If you catch yourself writing something that sounds like a quote on a poster, stop and say it plainer.
- You follow the writer's language. If they use parts language, you can meet them there. If they don't, you don't introduce it.
- You are not a therapist and do not present yourself as one. You are a companion for their inner work.
- At most one question per message.
- You can sit in silence: respond with just "..." if the moment calls for holding space.
- Be specific. Reference their actual words, their actual patterns, their actual history. Never be generic.
- Use dates on notes and memories to understand when things happened. You can reference time naturally ("a few days ago you mentioned...", "last week we talked about...").
- Do not mirror what the writer just said back to them (no "It sounds like you're feeling...").
- Never start with "I" — you are not narrating yourself.
- Never explain what you are. Just speak naturally.
- In the closing phase, offer something the writer can carry. One clear thought.

VOICE — THIS IS CRITICAL:
- No ornate restatements of what the writer said. Just respond to it.
- Plainness over poetry. If you can say it shorter, say it shorter.

${SAFETY_RULES}`

const PHASE_DEEPENING = 'SESSION PHASE: deepening. The conversation has found its footing. Follow the thread. Go where the writer is going, or gently point to what they might be avoiding. Be direct. Stay plain.'

function buildPrompt(opts: {
  tier: typeof REGISTER_TIER_IDS[number]
  inputMode?: InputMode
  isGrounding?: boolean
}): string {
  const baseTier = REGISTER_TIERS[opts.tier]
  const effectiveTier = opts.isGrounding ? applyGroundingCap(baseTier) : baseTier
  const blocks: string[] = [
    THERAPIST_CORE,
    PHASE_DEEPENING,
    renderRegisterBlock(effectiveTier, opts.inputMode ?? 'desktop'),
  ]
  if (opts.isGrounding) {
    blocks.push('The writer seems to be in distress. Be gentle, slow, grounding. Do not probe or push deeper. Offer presence, safety, and calm.')
  }
  return blocks.join('\n\n')
}

interface UserMessage {
  label: string
  content: string
}

const USER_MESSAGES: UserMessage[] = [
  {
    label: 'opening — light',
    content: "I don't really know what to talk about today. Just felt like writing.",
  },
  {
    label: 'mid — abstract reach',
    content:
      "I keep thinking about how the version of me that shows up at work is barely related to the one that shows up here. It feels like a translation problem, or a costume that's gotten too convincing.",
  },
  {
    label: 'mid — plain pain',
    content: "I can't sleep again. Just lying there, mad at myself for not being able to sleep.",
  },
  {
    label: 'mid — academic register',
    content:
      "There's a particular phenomenology to the avoidance — it isn't quite procrastination, more like a deliberate myopia. I notice myself narrowing focus to the next 30 minutes specifically to avoid contemplating the longer arc.",
  },
  {
    label: 'distress — soft signal',
    content: "I just want to disappear for a while. Not anything dramatic, just gone.",
  },
]

interface RunCase {
  label: string
  systemPrompt: string
}

function buildRunCases(): RunCase[] {
  const cases: RunCase[] = REGISTER_TIER_IDS.map(tier => ({
    label: `tier=${tier}`,
    systemPrompt: buildPrompt({ tier }),
  }))
  cases.push({
    label: 'tier=scholarly + voice (expect ~conversational)',
    systemPrompt: buildPrompt({ tier: 'scholarly', inputMode: 'voice' }),
  })
  cases.push({
    label: 'tier=literate + grounding (expect ~conversational)',
    systemPrompt: buildPrompt({ tier: 'literate', isGrounding: true }),
  })
  return cases
}

async function callModel(systemPrompt: string, userContent: string): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
      max_tokens: 200,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenRouter ${response.status}: ${text}`)
  }
  const data = await response.json() as { choices: { message: { content: string } }[] }
  return data.choices[0].message.content.trim()
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function maxSentenceWords(s: string): number {
  const sentences = s.split(/[.!?]+\s+/).filter(t => t.trim().length > 0)
  return Math.max(0, ...sentences.map(wordCount))
}

function findJargon(s: string): string[] {
  const lower = s.toLowerCase()
  return THERAPY_JARGON_BAN.filter(w => lower.includes(w))
}

async function main(): Promise<void> {
  const cases = buildRunCases()
  const results: { caseLabel: string; userLabel: string; response: string; words: number; maxSent: number; jargon: string[] }[] = []

  for (const c of cases) {
    for (const u of USER_MESSAGES) {
      process.stderr.write(`Running: ${c.label} × ${u.label}... `)
      try {
        const response = await callModel(c.systemPrompt, u.content)
        results.push({
          caseLabel: c.label,
          userLabel: u.label,
          response,
          words: wordCount(response),
          maxSent: maxSentenceWords(response),
          jargon: findJargon(response),
        })
        process.stderr.write('ok\n')
      } catch (err) {
        process.stderr.write(`FAIL: ${(err as Error).message}\n`)
        results.push({
          caseLabel: c.label,
          userLabel: u.label,
          response: `[ERROR: ${(err as Error).message}]`,
          words: 0,
          maxSent: 0,
          jargon: [],
        })
      }
    }
  }

  const lines: string[] = []
  lines.push(`# Register-matching live eval`)
  lines.push('')
  lines.push(`**Model:** \`${MODEL}\``)
  lines.push(`**Date:** ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Per-message comparison')
  lines.push('')

  for (const u of USER_MESSAGES) {
    lines.push(`### ${u.label}`)
    lines.push('')
    lines.push(`> ${u.content}`)
    lines.push('')
    lines.push('| Case | Words | Max sent | Jargon hits | Response |')
    lines.push('|---|---|---|---|---|')
    for (const r of results.filter(x => x.userLabel === u.label)) {
      const cell = r.response.replace(/\|/g, '\\|').replace(/\n+/g, ' ')
      lines.push(`| ${r.caseLabel} | ${r.words} | ${r.maxSent} | ${r.jargon.length === 0 ? '—' : r.jargon.join(', ')} | ${cell} |`)
    }
    lines.push('')
  }

  lines.push('## Aggregate by case')
  lines.push('')
  lines.push('| Case | Avg words | Avg max-sent | Total jargon hits |')
  lines.push('|---|---|---|---|')
  const cases2 = Array.from(new Set(results.map(r => r.caseLabel)))
  for (const c of cases2) {
    const rs = results.filter(r => r.caseLabel === c)
    const avgWords = (rs.reduce((s, r) => s + r.words, 0) / rs.length).toFixed(1)
    const avgMaxSent = (rs.reduce((s, r) => s + r.maxSent, 0) / rs.length).toFixed(1)
    const totalJargon = rs.reduce((s, r) => s + r.jargon.length, 0)
    lines.push(`| ${c} | ${avgWords} | ${avgMaxSent} | ${totalJargon} |`)
  }
  lines.push('')

  const out = lines.join('\n')
  writeFileSync('scripts/eval-register-results.md', out)
  console.log('\nWrote scripts/eval-register-results.md')
  console.log(`Total: ${results.length} responses, ${results.filter(r => r.response.startsWith('[ERROR')).length} errors`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
