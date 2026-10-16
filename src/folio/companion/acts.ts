import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { BENEATH, BETWEEN, FOLD, UNDERSIDE, newId } from '../page/schema'
import type { Gap } from '../page/schema'
import { MAX_LIFT_CHARS } from '../page/commands'
import { TR_VISIBLE_EDIT, foldViewKey, openFolds } from '../page/foldView'
import type { FoldViewMeta } from '../page/foldView'
import { COMPANION_TEXT, TR_COMPANION } from './companionText'
import type { CompanionTextKind } from './companionText'
import { sentenceRange } from './presence'

// The companion's acts on the page (involvement §2), built from the same
// pieces the writer's commands use, so integrity (I1–I9) and saving (C2)
// treat them as ordinary edits. Three differences, all deliberate: a lift in
// the middle of writing never moves the caret or scrolls (the writer's hands
// stay where they are); every transaction carries TR_COMPANION, so the
// companion's own words aren't "taken over" by it; and none enters the undo
// history (Mod+Z stays the writer's; the act's notice undoes it).

export interface CompanionLift { tr: Transaction; foldId: string; beneathPid: string; betweenPid: string | null }

/** A paragraph of the companion's words, marked with exactly what it wrote. */
function companionParagraph(schema: Schema, text: string, kind: CompanionTextKind): PMNode {
  const t = text.trim()
  return schema.nodes.paragraph.create({ pid: newId() }, t ? schema.text(t, [schema.marks[COMPANION_TEXT].create({ kind, original: t })]) : null)
}

function underside(schema: Schema, attrs: Record<string, unknown>, opts: { gap: Gap; between: string; betweenAllowed: boolean; beneath: PMNode }): { node: PMNode; betweenPid: string | null } {
  const children: PMNode[] = []
  let betweenPid: string | null = null
  if (opts.gap > 0 && opts.betweenAllowed) {
    const p = opts.between.trim() ? companionParagraph(schema, opts.between, 'between') : schema.nodes.paragraph.create({ pid: newId() })
    betweenPid = String(p.attrs.pid)
    children.push(schema.nodes[BETWEEN].create(null, p))
  }
  children.push(schema.nodes[BENEATH].create(null, opts.beneath))
  return { node: schema.nodes[UNDERSIDE].create({ ...attrs, gap: opts.gap }, children), betweenPid }
}

/**
 * Lift `sentence` in paragraph `pid` for the writer: the fold opens, the caret
 * and the scroll stay where they are. Null when the sentence is gone, lifted
 * or too long (a stale offer is dropped, never applied late).
 */
export function companionLift(state: EditorState, req: {
  pid: string
  sentence: string
  gap?: Gap
  between?: string
  switches: { between: boolean; distance: boolean }
  now?: number
}): CompanionLift | null {
  const range = sentenceRange(state.doc, req.pid, req.sentence)
  if (!range || req.sentence.length > MAX_LIFT_CHARS) return null
  const $from = state.doc.resolve(range.from)
  if ($from.depth !== 1) return null // page paragraphs only
  const { schema } = state
  const foldId = newId()
  const beneath = schema.nodes.paragraph.create({ pid: newId() })
  const gap = (req.switches.distance ? req.gap ?? 0 : 0) as Gap
  const u = underside(schema, { foldId, loose: false, surfaceSnapshot: req.sentence, createdAt: req.now ?? Date.now(), liftedBy: 'companion' }, {
    gap, between: req.between ?? '', betweenAllowed: req.switches.between, beneath,
  })
  const tr = state.tr.setMeta(TR_VISIBLE_EDIT, true).setMeta(TR_COMPANION, true).setMeta('addToHistory', false)
  tr.addMark(range.from, range.to, schema.marks[FOLD].create({ foldId }))
  const para = $from.before(1)
  tr.insert(para + $from.node(1).nodeSize, u.node)
  openFolds(tr, [foldId])
  return { tr, foldId, beneathPid: String(beneath.attrs.pid), betweenPid: u.betweenPid }
}

function blankPage(doc: PMNode): boolean {
  const first = doc.firstChild
  return doc.childCount === 1 && !!first && first.type.name === 'paragraph' && first.content.size === 0
}

/**
 * Level 5's arrival on a blank page: one of the writer's own sentences from
 * their last page, lifted, with the companion's between and a starter the
 * writer continues; the caret waits after the starter. "from ‹date›" shows
 * where the line came from.
 */
export function arrivalLift(state: EditorState, req: {
  sentence: string
  gap: Gap
  between: string
  starter: string
  fromPageId: string
  fromAt: number
  switches: { between: boolean; distance: boolean }
  now?: number
}): CompanionLift | null {
  if (!blankPage(state.doc) || !req.sentence.trim() || req.sentence.length > MAX_LIFT_CHARS) return null
  const { schema } = state
  const foldId = newId()
  const line = schema.nodes.paragraph.create({ pid: newId() }, schema.text(req.sentence, [schema.marks[FOLD].create({ foldId })]))
  const starter = req.starter.trim()
  const beneath = starter ? companionParagraph(schema, starter, 'starter') : schema.nodes.paragraph.create({ pid: newId() })
  const gap = (req.switches.distance ? req.gap : 0) as Gap
  const u = underside(schema, {
    foldId, loose: false, surfaceSnapshot: req.sentence, createdAt: req.now ?? Date.now(),
    liftedBy: 'companion', fromPageId: req.fromPageId, fromKeptAt: req.fromAt,
  }, { gap, between: req.between, betweenAllowed: req.switches.between, beneath })
  const tr = state.tr.setMeta(TR_VISIBLE_EDIT, true).setMeta(TR_COMPANION, true).setMeta('addToHistory', false)
  tr.replaceWith(0, state.doc.content.size, Fragment.from([line, u.node]))
  // The caret after the starter (a space to continue it), in the beneath.
  let caret = 0
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph' && String(node.attrs.pid) === String(beneath.attrs.pid)) caret = pos + node.nodeSize - 1
    return true
  })
  if (caret > 0) {
    if (starter) { tr.insertText(' ', caret); caret += 1 }
    tr.setSelection(TextSelection.create(tr.doc, caret))
    // The space is the writer's: their continuation starts there.
    tr.setStoredMarks([])
  }
  openFolds(tr, [foldId])
  return { tr: tr.scrollIntoView(), foldId, beneathPid: String(beneath.attrs.pid), betweenPid: u.betweenPid }
}

/** Level 5's arrival with nothing to lift: the companion's opening line, the caret on the next line. */
export function arrivalOpening(state: EditorState, line: string): Transaction | null {
  if (!blankPage(state.doc) || !line.trim()) return null
  const { schema } = state
  const open = companionParagraph(schema, line, 'opening')
  const next = schema.nodes.paragraph.create({ pid: newId() })
  const tr = state.tr.setMeta(TR_VISIBLE_EDIT, true).setMeta(TR_COMPANION, true).setMeta('addToHistory', false)
  tr.replaceWith(0, state.doc.content.size, Fragment.from([open, next]))
  tr.setSelection(TextSelection.create(tr.doc, open.nodeSize + 1))
  return tr.scrollIntoView()
}

/** Close an open fold (level 5, after a companion keep). The words stay; only the view changes. */
export function closeFold(state: EditorState, foldId: string): Transaction {
  return state.tr.setMeta(foldViewKey, { type: 'close', ids: [foldId] } satisfies FoldViewMeta).setMeta('addToHistory', false).setMeta(TR_COMPANION, true)
}

/** The first paragraph's pid of an underside's beneath (or between). */
export function passagePid(doc: PMNode, foldId: string, passage: 'beneath' | 'between'): string | null {
  let pid: string | null = null
  doc.forEach((node) => {
    if (pid || node.type.name !== UNDERSIDE || node.attrs.foldId !== foldId) return
    node.forEach((child) => {
      if (!pid && child.type.name === (passage === 'beneath' ? BENEATH : BETWEEN)) pid = String(child.firstChild?.attrs.pid ?? '') || null
    })
  })
  return pid
}
