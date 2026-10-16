import type { Node as PMNode } from '@tiptap/pm/model'
import { BENEATH, BETWEEN, FOLD, UNDERSIDE } from '../page/schema'

// C4's units and samples (draft 4 §5.4). A unit is a paragraph with at least
// one visible character, on the page or in a between or a beneath, read in
// the order Reading view uses (the document order: each underside follows its
// paragraph). Closed undersides are included: safety covers all writing,
// seen or not.

export const SAMPLE_MAX = 1000
export const ANCHOR_MAX = 240
export const OVERLAP = 150
/**
 * Below this many word-like segments a sample isn't sent to L2. Measured in
 * words, not characters: the Journal's 20-character floor
 * (partOrchestrator.ts:202) skips complete crisis statements in Japanese or
 * Chinese ("もう死にたい。本当に。今夜やる。" is 16 characters), which the
 * live eval caught. Intl.Segmenter splits CJK text into words.
 */
export const SAMPLE_FLOOR_WORDS = 2
const SAMPLE_FLOOR_CHARS = 20

type WordSegmenter = { segment: (t: string) => Iterable<{ isWordLike?: boolean }> }

let wordSegmenter: WordSegmenter | null | undefined
function segmenter(): WordSegmenter | null {
  if (wordSegmenter !== undefined) return wordSegmenter
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => WordSegmenter }).Segmenter
  try {
    wordSegmenter = Seg ? new Seg(undefined, { granularity: 'word' }) : null
  } catch {
    wordSegmenter = null
  }
  return wordSegmenter
}

/** True when a sample is too slight to send to L2 (L1 still runs on it). */
export function belowFloor(sample: string): boolean {
  const text = sample.trim()
  if (text === '') return true
  const seg = segmenter()
  if (!seg) return text.length < SAMPLE_FLOOR_CHARS
  let words = 0
  for (const s of seg.segment(text)) {
    if (s.isWordLike && ++words >= SAMPLE_FLOOR_WORDS) return false
  }
  return true
}

export interface SafetyUnit {
  pid: string
  text: string
  kind: 'page' | 'between' | 'beneath'
  /** The lifted line, for units in an underside. */
  line?: string
  foldId?: string
}

function paragraphText(p: PMNode): string {
  return p.textBetween(0, p.content.size, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : ''))
}

function liftedLines(doc: PMNode): Map<string, string> {
  const lines = new Map<string, string>()
  doc.forEach((node) => {
    if (node.type.name !== 'paragraph') return
    const parts = new Map<string, string>()
    node.forEach((child) => {
      const mark = child.marks.find((m) => m.type.name === FOLD)
      const id = mark?.attrs.foldId as string | undefined
      if (id && child.text) parts.set(id, (parts.get(id) ?? '') + child.text)
    })
    for (const [id, text] of parts) if (!lines.has(id)) lines.set(id, text)
  })
  return lines
}

export function readingOrderUnits(doc: PMNode): SafetyUnit[] {
  const lines = liftedLines(doc)
  const units: SafetyUnit[] = []
  doc.forEach((node) => {
    if (node.type.name === 'paragraph') {
      const text = paragraphText(node)
      if (text.trim() !== '') units.push({ pid: String(node.attrs.pid ?? ''), text, kind: 'page' })
      return
    }
    if (node.type.name !== UNDERSIDE) return
    const foldId = String(node.attrs.foldId ?? '')
    const line = lines.get(foldId) ?? String(node.attrs.surfaceSnapshot ?? '')
    node.forEach((passage) => {
      const kind = passage.type.name === BETWEEN ? 'between' : passage.type.name === BENEATH ? 'beneath' : null
      if (!kind) return
      passage.forEach((p) => {
        const text = paragraphText(p)
        if (text.trim() !== '') units.push({ pid: String(p.attrs.pid ?? ''), text, kind, line, foldId })
      })
    })
  })
  return units
}

/** At most 240 characters, with the middle trimmed. Also the form that's hashed. */
export function trimAnchor(line: string): string {
  if (line.length <= ANCHOR_MAX) return line
  const half = Math.floor((ANCHOR_MAX - 1) / 2)
  return `${line.slice(0, half)}…${line.slice(line.length - (ANCHOR_MAX - 1 - half))}`
}

/**
 * The samples for unit `i`: windows of at most 1,000 characters that contain
 * the whole unit, filled first with the text before it (as the Journal's
 * `slice(-1000)` does) and then with the text after it. A unit in an
 * underside always starts with its lifted line. A unit longer than the
 * budget is split into overlapping windows, each with the anchor.
 */
export function samplesFor(units: SafetyUnit[], i: number): string[] {
  const unit = units[i]
  const anchor = unit.line ? `${trimAnchor(unit.line)}\n\n` : ''
  const budget = SAMPLE_MAX - anchor.length
  if (unit.text.length > budget) {
    const step = budget - OVERLAP
    const out: string[] = []
    for (let s = 0; s < unit.text.length; s += step) {
      out.push(anchor + unit.text.slice(s, s + budget))
      if (s + budget >= unit.text.length) break
    }
    return out
  }
  let room = budget - unit.text.length
  let before = ''
  for (let j = i - 1; j >= 0 && room > 0; j--) {
    const piece = `${units[j].text}\n\n`
    const take = piece.length <= room ? piece : piece.slice(piece.length - room)
    before = take + before
    room -= take.length
  }
  let after = ''
  for (let j = i + 1; j < units.length && room > 0; j++) {
    const piece = `\n\n${units[j].text}`
    const take = piece.length <= room ? piece : piece.slice(0, room)
    after += take
    room -= take.length
  }
  return [anchor + before + unit.text + after]
}

/**
 * L1's inputs for unit `i` (draft 4 §5.4, B13): the unit alone, then each
 * adjacent pair, so a sentence split by Enter is still matched. The trigger
 * is the unit when it matches alone, otherwise the pair.
 */
export function l1Inputs(units: SafetyUnit[], i: number): { trigger: string; text: string }[] {
  const u = units[i]
  const out = [{ trigger: u.pid, text: u.text }]
  if (i > 0) out.push({ trigger: `${units[i - 1].pid}|${u.pid}`, text: `${units[i - 1].text}\n${u.text}` })
  if (i + 1 < units.length) out.push({ trigger: `${u.pid}|${units[i + 1].pid}`, text: `${u.text}\n${units[i + 1].text}` })
  return out
}
