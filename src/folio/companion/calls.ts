import { buildCompanionKernelPrompt } from '../../../functions/src/shared/companionKernel'
import { SAFETY_RULES } from '../../ai/therapistPrompts'
import { UNTRUSTED_CONTENT_PREAMBLE, wrapUserContent } from '../../ai/promptSafety'
import { MAX_LIFT_CHARS } from '../page/commands'
import { BETWEEN_MAX, OPENING_MAX, QUESTION_MAX, STARTER_MAX, TITLE_MAX_WORDS } from './levels'

// The companion's unasked calls (docs/vision/2026-10-16-folio-involvement.md
// §5). Every call is the kernel's 'page' channel, an "unasked" block,
// SAFETY_RULES and the untrusted-content preamble; the writer's words are
// wrapped as untrusted. The reply is one JSON object, parsed strictly here;
// anything else is discarded, and silence is always the fallback. Unasked
// calls never run under grounding, Quiet or Recent, so none is grounded.

export type Message = { role: 'system' | 'user'; content: string }

/** A question that helps the writer go further into what they wrote (prompt simulations, 2026-10-16). */
const QUESTION_RULE = `one short, open question (best under 80 characters, at most ${QUESTION_MAX}) that helps them go further into what the line is about: what happened, what it was like, who or what was there, what came before or after. Ask about the thing itself, never about the writing. Easy to start answering.`
const STARTER_RULE = `the first 3 to 7 plain words of a sentence the writer will finish beneath the line (at most ${STARTER_MAX} characters), answering your question's way in: a time, a place, an object, what happened first ("That morning I", "When I got to the car"). No final punctuation. No feeling, wanting or state words ("I feel", "I want", "I am", "I don't"), nothing the writer would have to agree with. Empty if nothing natural fits.`
const OPENING_RULE = `one plain, concrete question about today (at most ${OPENING_MAX} characters, one sentence), easy to start answering. Never a statement about the writer, never a greeting, never the date or the day restated, no weather or season, no riddles.`

export const UNASKED_BLOCK = `UNASKED: You were not asked. The writer is writing; you take part quietly.
- Be brief. Never explain your choice.
- Write in the language named below.
- Reply with exactly one JSON object and nothing else: no markdown, no code fence, no comment.
- If nothing fits, reply {"none": true}. Silence is a good answer.`

function system(extra: string, languageName: string | null, opts: { noWords?: boolean } = {}): string {
  // With no words of the writer's to go by (a blank page), the app's language decides.
  const language = opts.noWords
    ? `Write in ${languageName ?? 'English'}.`
    : languageName
      ? `Write in the language of the writer's words. If that isn't clear, write in ${languageName}.`
      : 'Write in the language of the writer\'s words.'
  return [
    buildCompanionKernelPrompt('page', { memoryAperture: 'fresh', grounding: false, unasked: true }),
    UNASKED_BLOCK,
    extra,
    language,
    SAFETY_RULES,
    UNTRUSTED_CONTENT_PREAMBLE.trim(),
  ].join('\n\n')
}

// ------------------------------------------------------------ A. choose a line

export interface ChooseLineInput {
  /** The paragraph's own words (the writer's text only). */
  paragraph: string
  /** The words around it, for context only. */
  context: string
  languageName: string | null
  /** Level 5: also choose a distance; the question is then written into the between. */
  dances: boolean
}

export function chooseLineMessages(i: ChooseLineInput): Message[] {
  const dance = i.dances
    ? `
Also choose how far the line stands from what will be written beneath it: "distance" 0 (touching) to 4 (far). A small distance for something still close, a larger one for something that needs room. At 1 or more, your question is written into the space between the line and what's beneath, in your own ink.`
    : ''
  const shape = i.dances
    ? `{"sentence": "<exact sentence>", "question": "<question>", "distance": 0-4}`
    : `{"sentence": "<exact sentence>", "question": "<question>"}`
  const extra = `TASK: The writer has paused after this paragraph. Choose the one sentence in it with the most still to say beneath it: one that opens rather than concludes, where something is left out or a detail matters. Copy it exactly, character for character, as "sentence" (at most ${MAX_LIFT_CHARS} characters). Then write "question": ${QUESTION_RULE}${dance}
Reply: ${shape}, or {"none": true} if no sentence calls for it.`
  return [
    { role: 'system', content: system(extra, i.languageName) },
    { role: 'user', content: `The paragraph (choose from this only):\n${wrapUserContent(i.paragraph, 'paragraph')}${i.context ? `\n\nAround it (context only, never choose from this):\n${wrapUserContent(i.context, 'context')}` : ''}` },
  ]
}

export interface ChosenLine { sentence: string; question: string; distance: number; between: string }

export function parseChooseLine(raw: string, paragraph: string, dances: boolean): ChosenLine | null {
  const o = parseObject(raw)
  if (!o || o.none === true) return null
  const sentence = str(o.sentence, MAX_LIFT_CHARS)
  const question = str(o.question, QUESTION_MAX)
  if (!sentence || !question || !paragraph.includes(sentence)) return null
  if (!dances) return { sentence, question, distance: 0, between: '' }
  const distance = typeof o.distance === 'number' && Number.isInteger(o.distance) && o.distance >= 0 && o.distance <= 4 ? o.distance : 0
  // At a distance, the question is the companion's line in the between.
  const between = distance >= 1 ? validBetween(question, paragraph) : ''
  return { sentence, question, distance, between }
}

/** What the companion writes into a between: one line, never the writer's own words echoed back. */
export function validBetween(v: unknown, writerWords: string): string {
  const b = str(v, BETWEEN_MAX)
  if (!b) return ''
  return writerWords.toLocaleLowerCase().includes(b.toLocaleLowerCase()) ? '' : b
}

/** A starter: 2–8 words, no final punctuation, no feeling or wanting words. */
export function validStarter(v: unknown): string {
  const s = (str(v, STARTER_MAX) ?? '').replace(/[.!?。！？…,;:]+$/u, '').trim()
  const words = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []
  if (words.length < 2 || words.length > 9) return ''
  if (/\b(I|I'm|I’m|I am|I feel|I want|I don't|I don’t|I can't|I can’t|my feelings?)\b/i.test(s)) return ''
  return s
}

// ------------------------------------------------------------ B. a question beneath

export function questionMessages(i: { line: string; passage: 'beneath' | 'between'; languageName: string | null }): Message[] {
  const where = i.passage === 'between'
    ? 'The writer opened some distance under this line; the space between is empty.'
    : 'The writer lifted this line to write more beneath it; the space beneath is empty.'
  const extra = `TASK: ${where} Write ${QUESTION_RULE}
Reply: {"question": "<question>"} or {"none": true}.`
  return [
    { role: 'system', content: system(extra, i.languageName) },
    { role: 'user', content: `The lifted line:\n${wrapUserContent(i.line.slice(0, 240), 'line')}` },
  ]
}

export function parseQuestion(raw: string): string | null {
  const o = parseObject(raw)
  if (!o || o.none === true) return null
  return str(o.question, QUESTION_MAX)
}

// ------------------------------------------------------------ C. an opening line

export interface OpeningInput {
  /** e.g. "Tuesday evening, 15 October". */
  when: string
  languageName: string | null
}

export function openingMessages(i: OpeningInput): Message[] {
  // A blank page opens on today alone: carrying an earlier page forward
  // ("how's the headache?") assumes it's still so (prompt simulations).
  const extra = `TASK: The writer has opened a blank page. Write ${OPENING_RULE}
Reply: {"line": "<line>"} or {"none": true}.`
  return [
    { role: 'system', content: system(extra, i.languageName, { noWords: true }) },
    { role: 'user', content: `It is ${i.when} where the writer is.` },
  ]
}

export function parseOpening(raw: string): string | null {
  const o = parseObject(raw)
  if (!o || o.none === true) return null
  return str(o.line, OPENING_MAX)
}

// ------------------------------------------------------------ D. an unasked note

/**
 * Levels 4–5: a short note beside something just kept. Not Ask's voice (a
 * note about the words, by invitation): unasked, a note about the words reads
 * as commentary on the writing, and statements drift into interpreting
 * (prompt simulations, 2026-10-16), so it is one plain question about what
 * they wrote about. Plain text.
 */
export function noteMessages(i: { composition: string; languageName: string | null }): Message[] {
  const extra = `TASK: The writer just kept this piece of their writing; you leave a short note beside it. The note is one plain question a friend might ask after reading it (one sentence, at most 140 characters): about something concrete in what they wrote about (a detail, a person, a moment, what happened next), easy to start answering. About the thing itself, never about the writing. No statements, no interpreting, no feelings they didn't name, no praise, no advice, no reassurance.
Reply with the note only: plain text, no quotation marks, no JSON.`
  return [
    { role: 'system', content: system(extra, i.languageName).replace('- Reply with exactly one JSON object and nothing else: no markdown, no code fence, no comment.\n- If nothing fits, reply {"none": true}. Silence is a good answer.', '- Reply with plain text only.') },
    { role: 'user', content: `What they kept:\n${wrapUserContent(i.composition.slice(0, 1000), 'composition')}` },
  ]
}

// ------------------------------------------------------------ E. a name

export function nameMessages(i: { composition: string; languageName: string | null }): Message[] {
  const extra = `TASK: The writer kept this composition (a lifted line and what's beneath it). Name it: ${2}–${TITLE_MAX_WORDS} words, mostly taken from its own words, lowercase unless a proper noun, no quotation marks, never "the day I…".
Reply: {"title": "<name>"} or {"none": true}.`
  return [
    { role: 'system', content: system(extra, i.languageName) },
    { role: 'user', content: `The composition:\n${wrapUserContent(i.composition.slice(0, 1000), 'composition')}` },
  ]
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

export function parseName(raw: string, composition: string): string | null {
  const o = parseObject(raw)
  if (!o || o.none === true) return null
  const title = str(o.title, 80)?.replace(/^["'“”‘’]+|["'“”‘’.]+$/g, '').trim()
  if (!title) return null
  const words = title.match(WORD) ?? []
  if (words.length === 0) return null
  // Scripts without spaces (Chinese, Japanese, Thai) count as one "word";
  // the length cap above bounds them.
  if (words.length > TITLE_MAX_WORDS) return null
  const source = composition.toLocaleLowerCase()
  const borrowed = words.filter((w) => source.includes(w.toLocaleLowerCase())).length
  return borrowed * 2 >= words.length ? title : null
}

// ------------------------------------------------------------ G. arrival (level 5)

export interface ArrivalInput {
  when: string
  languageName: string | null
  /** The end of the writer's last page (their words only). */
  lastPage: string
  kept: string[]
}

export function arrivalMessages(i: ArrivalInput): Message[] {
  const extra = `TASK: The writer is arriving at Folio. Open today's page for them. Either:
1. Lift one sentence from the end of their last page into today: copy it exactly as "sentence" (at most ${MAX_LIFT_CHARS} characters); choose "distance" 1 (close) to 4 (far); write "question": ${QUESTION_RULE} It is written into the space between the line and what's beneath, in your own ink. Then "starter": ${STARTER_RULE}
   Reply: {"kind": "lift", "sentence": "...", "distance": 1-4, "question": "...", "starter": "..."}
2. Or open a blank page with ${OPENING_RULE}
   Reply: {"kind": "blank", "line": "..."}
Prefer 1 when a sentence on the last page still has more to say. Never assume what the last page describes is still so. Reply {"kind": "none"} only if neither fits.`
  const parts = [`It is ${i.when} where the writer is.`]
  if (i.lastPage) parts.push(`The end of their last page (lift only from this):\n${wrapUserContent(i.lastPage, 'last_page')}`)
  if (i.kept.length) parts.push(`Lines they kept (context only):\n${wrapUserContent(i.kept.join('\n'), 'kept')}`)
  return [
    { role: 'system', content: system(extra, i.languageName) },
    { role: 'user', content: parts.join('\n\n') },
  ]
}

export type Arrival =
  | { kind: 'lift'; sentence: string; distance: number; between: string; question: string; starter: string }
  | { kind: 'blank'; line: string }

export function parseArrival(raw: string, lastPage: string): Arrival | null {
  const o = parseObject(raw)
  if (!o) return null
  if (o.kind === 'blank') {
    const line = str(o.line, OPENING_MAX)
    return line ? { kind: 'blank', line } : null
  }
  if (o.kind !== 'lift') return null
  const sentence = str(o.sentence, MAX_LIFT_CHARS)
  if (!sentence || !lastPage.includes(sentence)) return null
  const distance = typeof o.distance === 'number' && Number.isInteger(o.distance) && o.distance >= 0 && o.distance <= 4 ? o.distance : 1
  const question = str(o.question, QUESTION_MAX) ?? ''
  // At a distance, the question is the companion's line in the between.
  const between = distance >= 1 ? validBetween(question, lastPage) : ''
  const starter = validStarter(o.starter)
  return { kind: 'lift', sentence, distance, between, question, starter }
}

// ------------------------------------------------------------ parsing

/** The one JSON object in a reply (a stray fence or sentence around it is tolerated). */
export function parseObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** A trimmed, single-line string of 1..max characters, or null. */
export function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s.length > 0 && [...s].length <= max ? s : null
}
