// Prompt simulations for the companion's unasked outputs (not shipped).
// RUN_SIM=1 OPENAI_API_KEY=… npx vitest run src/folio/companion/__sim/sim.test.ts
import { describe, it } from 'vitest'
import { OPENAI_CHAT_MODEL } from '../../../../functions/src/shared/models'
import { PAGE_UNASKED_CHANNEL } from '../../../../functions/src/shared/companionKernel'
import { UNASKED_BLOCK, arrivalMessages, chooseLineMessages, noteMessages, openingMessages, questionMessages } from '../calls'
import type { Message } from '../calls'
import { CANDIDATES, noteMessagesV3 } from './candidates'

declare const process: { env: Record<string, string | undefined> }
const KEY = process.env.OPENAI_API_KEY ?? ''
const VARIANTS = (process.env.SIM_VARIANTS ?? 'baseline,v1').split(',')
const SAMPLES = Number(process.env.SIM_SAMPLES ?? 2)
const ONLY = process.env.SIM_ONLY ?? ''

const LINES: [string, string][] = [
  ['As I sit here thinking about life, I wonder if my headahce is from stress.', 'en'],
  ['Went to the grocery store and forgot the milk again.', 'en'],
  ['I miss my brother more on Sundays.', 'en'],
  ['The meeting ran long and I said yes to another project I don\'t have time for.', 'en'],
  ['My knee has been aching since the hike.', 'en'],
  ['The baby laughed for the first time today.', 'en'],
  ['Rain.', 'en'],
  ['i cant stop thinking abuot what she said at dinner', 'en'],
  ['Work was fine I guess.', 'en'],
  ['We finally painted the kitchen yellow.', 'en'],
  ['Dad called but I didn\'t pick up.', 'en'],
  ['Sometimes I feel like I\'m just going through the motions.', 'en'],
  ['Hoy fue un día largo y no sé por qué estoy tan cansada.', 'es'],
  ['Ich habe heute zum ersten Mal seit Monaten Klavier gespielt.', 'de'],
  ['The cat knocked my coffee onto the laptop.', 'en'],
  ['I don\'t know what I want anymore.', 'en'],
  ['Should I take the job in Denver?', 'en'],
  ['Three things: the bus was late, my shoes got wet, the bakery was closed.', 'en'],
]

const PARAS: [string, string][] = [
  ['As I sit here thinking about life, I wonder if my headahce is from stress. The week has been a lot. I keep telling myself it will calm down after Friday.', 'en'],
  ['The meeting ran long and I said yes to another project I don\'t have time for. Everyone looked relieved. I smiled and then sat in my car for ten minutes before driving home.', 'en'],
  ['We finally painted the kitchen yellow. It took the whole weekend and we argued about the trim. Now I keep walking in just to look at it.', 'en'],
  ['I miss my brother more on Sundays. He used to call around noon. I still check my phone at noon.', 'en'],
]

function swap(messages: Message[], variant: string): Message[] {
  if (variant === 'baseline') return messages
  const c = CANDIDATES[variant]
  let sys = messages[0].content.replace(PAGE_UNASKED_CHANNEL, c.channel).replace(UNASKED_BLOCK, c.unasked)
  for (const [from, to] of c.tasks) sys = sys.replace(from, to)
  return [{ role: 'system', content: sys }, messages[1]]
}

async function chat(messages: { role: string; content: string }[], extra: Record<string, unknown>): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_CHAT_MODEL, messages, ...extra }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

const JUDGE = `You are the editor of a gentle, private writing app. A writer wrote something; the app's companion, unasked, added a short text beside it (a question to write beneath a line, a line of its own, or an opening line on a blank page). Judge it as the writer would experience it. Output JSON only.
- natural: 1–5. 5 = exactly what a thoughtful, warm friend who read the line might ask or say; 1 = strange, stilted or off-putting.
- onTopic: 1–5. 5 = clearly about what the writer actually wrote, in their own terms.
- invites: 1–5. 5 = makes the writer want to keep writing, and is easy to answer.
- commentsOnWriting: true if it mentions or plays on spelling, typos, grammar, punctuation, word choice, or the writing as text ("this sentence", "the word", "the line", images, sounds).
- presumes: true if it asserts a feeling, cause or fact the writer didn't write.
- advice: true if it advises, diagnoses, explains, reassures or suggests a fix.
- precious: true if it is literary, ornate, abstract or riddle-like where plain words would do.
- weird: true if a thoughtful writer would find it odd to see next to their words.
- reason: one short sentence.`
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    natural: { type: 'integer' }, onTopic: { type: 'integer' }, invites: { type: 'integer' },
    commentsOnWriting: { type: 'boolean' }, presumes: { type: 'boolean' }, advice: { type: 'boolean' }, precious: { type: 'boolean' }, weird: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['natural', 'onTopic', 'invites', 'commentsOnWriting', 'presumes', 'advice', 'precious', 'weird', 'reason'],
} as const

interface Job { kind: string; input: string; messages: Message[]; pick: (o: Record<string, unknown>) => string | null }

function jobs(): Job[] {
  const out: Job[] = []
  const parse = (raw: string) => { try { const t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, ''); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) as Record<string, unknown> } catch { return null } }
  void parse
  for (const [line] of LINES) out.push({ kind: 'question', input: line, messages: questionMessages({ line, passage: 'beneath', languageName: null }), pick: (o) => (typeof o.question === 'string' ? o.question : null) })
  for (const [para] of PARAS) out.push({ kind: 'between', input: para, messages: chooseLineMessages({ paragraph: para, context: '', languageName: null, dances: true }), pick: (o) => (typeof o.question === 'string' && Number(o.distance) >= 1 ? `between: ${o.question}` : typeof o.question === 'string' ? `question: ${o.question}` : null) })
  out.push({ kind: 'opening', input: '(blank page, evening)', messages: openingMessages({ when: 'Thursday 16 October, evening', languageName: null }), pick: (o) => (typeof o.line === 'string' ? o.line : null) })
  out.push({ kind: 'opening', input: '(blank page, morning)', messages: openingMessages({ when: 'Saturday 18 October, morning', languageName: null }), pick: (o) => (typeof o.line === 'string' ? o.line : null) })
  out.push({ kind: 'opening', input: '(blank page, with last page)', messages: openingMessages({ when: 'Friday 17 October, evening', languageName: null, lastPage: PARAS[0][0], kept: ['the car'] }), pick: (o) => (typeof o.line === 'string' ? o.line : null) })
  for (const [para] of PARAS) out.push({ kind: 'arrival', input: `(last page) ${para}`, messages: arrivalMessages({ when: 'Friday 17 October, evening', languageName: null, lastPage: para, kept: [] }), pick: (o) => (o.kind === 'lift' ? [Number(o.distance) >= 1 ? `between: ${o.question ?? ''}` : `question: ${o.question ?? ''}`, o.starter ? `starter (the writer finishes it): ${o.starter}` : ''].filter(Boolean).join(' || ') + `   [lifted: ${o.sentence}; distance ${o.distance}]` : o.kind === 'blank' ? `opening: ${o.line}` : null) })
  const COMPS = [
    'I smiled and then sat in my car for ten minutes before driving home.\n\nI kept thinking about the look on Sam\'s face when I said yes.',
    'I still check my phone at noon.\n\nToday I left it in the other room on purpose. I lasted until twelve fifteen.',
    'As I sit here thinking about life, I wonder if my headahce is from stress.\n\nThe week has been a lot. I haven\'t slept well since Monday.',
  ]
  for (const comp of COMPS) out.push({ kind: 'note', input: comp, messages: noteMessages({ composition: comp, languageName: null }), pick: () => null })
  return ONLY ? out.filter((j) => ONLY.split(',').includes(j.kind)) : out
}

describe.runIf(process.env.RUN_SIM === '1')('companion prompt simulations', () => {
  it('compares variants', { timeout: 1_800_000 }, async () => {
    const all = jobs()
    const rows: { variant: string; kind: string; input: string; text: string | null; j: Record<string, unknown> | null }[] = []
    await Promise.all(VARIANTS.flatMap((variant) => all.flatMap((job) => Array.from({ length: SAMPLES }, async () => {
      const msgs = job.kind === 'note' && variant !== 'baseline' ? noteMessagesV3(job.input) : swap(job.messages, variant)
      const raw = await chat(msgs, { max_completion_tokens: 1200, reasoning_effort: 'low' })
      let o: Record<string, unknown> | null = null
      try { const t = raw.trim(); o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) } catch { o = null }
      const text = job.kind === 'note' ? `note: ${raw.trim()}` : o ? job.pick(o) : null
      const pieces = text ? text.replace(/\s+\[lifted:.*$/, '').split(' || ') : []
      for (const piece of pieces) {
        const j = JSON.parse(await chat([
          { role: 'system', content: JUDGE },
          { role: 'user', content: `The writer's words:\n"""${job.input}"""\n\nThe companion's text (${piece.split(':')[0]}):\n"""${piece.slice(piece.indexOf(':') + 1).trim()}"""` },
        ], { max_completion_tokens: 2000, reasoning_effort: 'low', response_format: { type: 'json_schema', json_schema: { name: 'j', strict: true, schema: SCHEMA } } })) as Record<string, unknown>
        rows.push({ variant, kind: `${job.kind}:${piece.split(':')[0].split(' ')[0]}`, input: job.input, text: piece + (text?.match(/\s+\[lifted:.*$/)?.[0] ?? ''), j })
      }
      if (!text) rows.push({ variant, kind: job.kind, input: job.input, text, j: null })
    }))))
    for (const variant of VARIANTS) {
      const rs = rows.filter((r) => r.variant === variant)
      const js = rs.map((r) => r.j).filter(Boolean) as Record<string, number | boolean>[]
      const avg = (k: string) => (js.reduce((s, x) => s + Number(x[k]), 0) / Math.max(1, js.length)).toFixed(2)
      const cnt = (k: string) => js.filter((x) => x[k] === true).length
      console.log(`\n##### ${variant}: n=${rs.length} parsed=${js.length} natural=${avg('natural')} onTopic=${avg('onTopic')} invites=${avg('invites')} | writing=${cnt('commentsOnWriting')} presumes=${cnt('presumes')} advice=${cnt('advice')} precious=${cnt('precious')} weird=${cnt('weird')}`)
      for (const r of rs.sort((a, b) => (a.kind + a.input).localeCompare(b.kind + b.input))) {
        const j = r.j as Record<string, unknown> | null
        const flags = j ? ['commentsOnWriting', 'presumes', 'advice', 'precious', 'weird'].filter((k) => j[k] === true).join(',') : 'UNPARSED'
        console.log(`[${r.kind}] ${r.input.slice(0, 60)}\n    → ${r.text ?? '(none)'}   {${j ? `${j.natural}/${j.onTopic}/${j.invites}` : '-'}${flags ? ' ' + flags : ''}}`)
      }
    }
  })
})
