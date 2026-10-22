import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { BENEATH, BETWEEN, FOLD, MAX_GAP, UNDERSIDE, newId } from './schema'
import type { Gap } from './schema'
import { TR_VISIBLE_EDIT, foldViewKey, getFoldView, openFolds } from './foldView'
import type { FoldViewMeta } from './foldView'

// Lift, Unlift and Apart (draft 4 §3.5, §3.6). Each returns a transaction or
// a reason it can't run; the caller dispatches and announces.

export const MAX_LIFT_CHARS = 400

export type CommandResult = { ok: true; tr: Transaction; foldId: string } | { ok: false; reason: 'empty' | 'tooLong' | 'notInPage' | 'alreadyLifted' | 'notFound' | 'notEmpty' | 'blocked' | 'atLimit' }

/** The sentence around `offset` in `text`, by Intl.Segmenter; the whole text without it. */
export function sentenceAround(text: string, offset: number, locale?: string): { from: number; to: number } {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (t: string) => Iterable<{ segment: string; index: number }> } }).Segmenter
  if (!Seg) return trimRange(text, 0, text.length)
  try {
    const segmenter = new Seg(locale, { granularity: 'sentence' })
    for (const s of segmenter.segment(text)) {
      const end = s.index + s.segment.length
      if (offset >= s.index && (offset < end || end === text.length)) return trimRange(text, s.index, end)
    }
  } catch {
    // fall through
  }
  return trimRange(text, 0, text.length)
}

function trimRange(text: string, from: number, to: number): { from: number; to: number } {
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  return { from, to }
}

function topParagraphAt(state: EditorState, pos: number): { node: PMNode; pos: number } | null {
  const $p = state.doc.resolve(pos)
  if ($p.depth !== 1 || $p.parent.type.name !== 'paragraph') return null
  return { node: $p.parent, pos: $p.before(1) }
}

function rangeHasFold(state: EditorState, from: number, to: number): boolean {
  let has = false
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && node.marks.some((m) => m.type.name === FOLD)) has = true
  })
  return has
}

/**
 * Lift the selection, or with no selection the sentence around the caret, or
 * with `range` exactly that range (the corner: the sentence it showed).
 */
export function lift(state: EditorState, opts: { locale?: string; now?: number; range?: { from: number; to: number } } = {}): CommandResult {
  const sel = opts.range ?? state.selection
  const para = topParagraphAt(state, sel.from)
  const empty = sel.from === sel.to
  if (!para || (!empty && topParagraphAt(state, sel.to)?.pos !== para.pos)) return { ok: false, reason: 'notInPage' }
  let from = sel.from
  let to = sel.to
  if (empty) {
    const text = para.node.textContent
    if (text.trim() === '') return { ok: false, reason: 'empty' }
    const r = sentenceAround(text, sel.from - para.pos - 1, opts.locale)
    from = para.pos + 1 + r.from
    to = para.pos + 1 + r.to
  }
  const text = state.doc.textBetween(from, to, '\n')
  if (text.trim().length === 0) return { ok: false, reason: 'empty' }
  if (text.length > MAX_LIFT_CHARS) return { ok: false, reason: 'tooLong' }
  if (rangeHasFold(state, from, to)) return { ok: false, reason: 'alreadyLifted' }

  const foldId = newId()
  const { schema } = state
  const tr = state.tr.setMeta(TR_VISIBLE_EDIT, true)
  tr.addMark(from, to, schema.marks[FOLD].create({ foldId }))
  const underside = schema.nodes[UNDERSIDE].create(
    { foldId, gap: 0, loose: false, surfaceSnapshot: text, createdAt: opts.now ?? Date.now() },
    schema.nodes[BENEATH].create(null, schema.nodes.paragraph.create({ pid: newId() })),
  )
  const insertAt = para.pos + para.node.nodeSize
  tr.insert(insertAt, underside)
  // underside(1) beneath(1) paragraph(1): the caret waits in the beneath.
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 3))
  openFolds(tr, [foldId])
  return { ok: true, tr: tr.scrollIntoView(), foldId }
}

export function findUnderside(doc: PMNode, foldId: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  doc.forEach((node, offset) => {
    if (!found && node.type.name === UNDERSIDE && node.attrs.foldId === foldId) found = { node, pos: offset }
  })
  return found
}

export function isEmptyUnderside(node: PMNode): boolean {
  return node.textContent.trim() === ''
}

/** Unlift: remove an empty underside and its mark as one undo step. */
export function unlift(state: EditorState, foldId: string): CommandResult {
  const u = findUnderside(state.doc, foldId)
  if (!u) return { ok: false, reason: 'notFound' }
  if (!isEmptyUnderside(u.node)) return { ok: false, reason: 'notEmpty' }
  const tr = state.tr.setMeta(TR_VISIBLE_EDIT, true)
  tr.delete(u.pos, u.pos + u.node.nodeSize)
  tr.doc.forEach((node, offset) => {
    if (node.type.name === 'paragraph') tr.removeMark(offset, offset + node.nodeSize, state.schema.marks[FOLD].create({ foldId }))
  })
  const caret = Math.max(1, Math.min(u.pos - 1, tr.doc.content.size - 1))
  tr.setSelection(TextSelection.near(tr.doc.resolve(caret), -1))
  tr.setMeta(foldViewKey, { type: 'close', ids: [foldId] } satisfies FoldViewMeta)
  return { ok: true, tr, foldId }
}

/**
 * Apart: move one stop closer (-1) or farther (+1). The between exists from
 * stop 1 upward when `between` is allowed; Closer never hides between text.
 */
export function apart(state: EditorState, foldId: string, dir: -1 | 1, switches: { between: boolean; distance: boolean }): CommandResult & { gap?: Gap } {
  if (!switches.distance) return { ok: false, reason: 'blocked' }
  const u = findUnderside(state.doc, foldId)
  if (!u) return { ok: false, reason: 'notFound' }
  if (!getFoldView(state).open.has(foldId)) return { ok: false, reason: 'blocked' }
  const gap = Number(u.node.attrs.gap) as Gap
  const next = (gap + dir) as Gap
  if (next < 0 || next > MAX_GAP) return { ok: false, reason: 'atLimit' }
  const between = u.node.firstChild?.type.name === BETWEEN ? u.node.firstChild : null
  if (next === 0 && between && between.textContent.trim() !== '') return { ok: false, reason: 'blocked' }
  const { schema } = state
  const tr = state.tr.setMeta(TR_VISIBLE_EDIT, true)
  tr.setNodeMarkup(u.pos, undefined, { ...u.node.attrs, gap: next })
  if (next === 0 && between) tr.delete(u.pos + 1, u.pos + 1 + between.nodeSize)
  if (gap === 0 && next > 0 && !between && switches.between) {
    tr.insert(u.pos + 1, schema.nodes[BETWEEN].create(null, schema.nodes.paragraph.create({ pid: newId() })))
  }
  return { ok: true, tr, foldId, gap: next }
}
