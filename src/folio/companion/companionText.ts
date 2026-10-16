import { Mark, mergeAttributes } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { isHistoryTransaction } from '@tiptap/pm/history'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TR_INTEGRITY, TR_LOAD, TR_RESTORE, TR_VISIBLE_EDIT } from '../page/foldView'
import { UNDERSIDE } from '../page/schema'

// The companion's own words on the page (involvement §2, rule 5): the between
// it writes at level 5, a starter it begins, an opening line. They're real
// document text (saved by C2, carried into traces), marked so the page, the
// floor, Reading view and export show whose they are.
//
// The mark records exactly what the companion wrote (`original`). A run of
// marked text is the companion's only while its text is still exactly that:
// however a change arrives (ProseMirror's own input, a DOM-read change on
// Android, an IME composition, autocorrect), changed words are the writer's.
// The take-over plugin then removes the mark from any run that no longer
// matches, so the ink follows; the safety helpers below never depend on it.

export const COMPANION_TEXT = 'companionText'
/** Meta on the companion's own transactions: never a take-over. */
export const TR_COMPANION = 'folio:companion'

export type CompanionTextKind = 'between' | 'starter' | 'opening'

export const CompanionText = Mark.create({
  name: COMPANION_TEXT,
  inclusive: false,
  addAttributes() {
    return {
      kind: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-companion') || null, renderHTML: (a: { kind?: string | null }) => ({ 'data-companion': a.kind ?? '' }) },
      original: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-companion]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'folio-companion-text' }), 0]
  },
})

// ------------------------------------------------------------ runs

interface InlineLike { text?: string; type?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }

function markOf(c: InlineLike): { original: string | null } | null {
  const m = c.marks?.find((x) => x.type === COMPANION_TEXT)
  return m ? { original: typeof m.attrs?.original === 'string' ? m.attrs.original : null } : null
}

/**
 * Split inline content into pieces: a "companion" piece is a contiguous run of
 * marked text whose joined text is exactly what the companion wrote; every
 * other piece is the writer's (including marked text that was changed).
 */
function pieces(content: InlineLike[]): { text: string; companion: boolean }[] {
  const out: { text: string; companion: boolean }[] = []
  let run: { text: string; original: string | null } | null = null
  const flush = () => {
    if (run) out.push({ text: run.text, companion: run.original !== null && run.text === run.original })
    run = null
  }
  for (const c of content) {
    const text = c.type === 'hardBreak' ? '\n' : c.text ?? ''
    const m = c.type === 'text' || c.text !== undefined ? markOf(c) : null
    if (m) {
      if (run && run.original === m.original) run.text += text
      else { flush(); run = { text, original: m.original } }
    } else {
      flush()
      out.push({ text, companion: false })
    }
  }
  flush()
  return out
}

function inlineOf(p: PMNode): InlineLike[] {
  const out: InlineLike[] = []
  p.forEach((child) => {
    out.push({
      type: child.isText ? 'text' : child.type.name,
      text: child.isText ? child.text ?? '' : undefined,
      marks: child.marks.map((m) => ({ type: m.type.name, attrs: m.attrs as Record<string, unknown> })),
    })
  })
  return out
}

/** The writer's words in inline content: the companion's unchanged runs left out. */
export function writerOnlyOf(content: InlineLike[] | undefined): string {
  return pieces(content ?? []).filter((x) => !x.companion).map((x) => x.text).join('')
}

/**
 * What the safety checks read from inline content (involvement §2, rule 6):
 * nothing when only the companion wrote it; all of it, the companion's words
 * included, as soon as the writer wrote anything there. A writer finishing the
 * companion's half-sentence is checked as one sentence.
 */
export function safetyTextOf(content: InlineLike[] | undefined): string {
  const ps = pieces(content ?? [])
  const writer = ps.filter((x) => !x.companion).map((x) => x.text).join('')
  return writer.trim() === '' && ps.some((x) => x.companion) ? '' : ps.map((x) => x.text).join('')
}

/** A paragraph's writer-only words (what the companion may read as the writer's). */
export function writerText(p: PMNode): string {
  return writerOnlyOf(inlineOf(p))
}

/** A paragraph's text as the safety checks read it. */
export function safetyText(p: PMNode): string {
  return safetyTextOf(inlineOf(p))
}

/** Inline content (JSON, as in a trace) as the safety checks read it. */
export function safetyTextJSON(content: JSONContent[] | undefined): string {
  return safetyTextOf(content as InlineLike[] | undefined)
}

export function isCompanionText(node: PMNode): boolean {
  return node.isText && node.marks.some((m) => m.type.name === COMPANION_TEXT)
}

// ------------------------------------------------------------ the take-over

export const takeOverKey = new PluginKey('folioCompanionTakeOver')

function exempt(tr: Transaction): boolean {
  return !!(tr.getMeta(TR_COMPANION) || tr.getMeta(TR_LOAD) || tr.getMeta(TR_INTEGRITY) || tr.getMeta(TR_RESTORE)
    || tr.getMeta(takeOverKey) || isHistoryTransaction(tr))
}

/** Changed marked runs in the given textblocks, as ranges to unmark. */
function changedRuns(doc: PMNode, blockPositions: Iterable<number>): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  for (const at of blockPositions) {
    const block = doc.nodeAt(at)
    if (!block || !block.isTextblock) continue
    let run: { from: number; to: number; text: string; original: string | null } | null = null
    const flush = () => {
      if (run && (run.original === null || run.text !== run.original)) out.push({ from: run.from, to: run.to })
      run = null
    }
    block.forEach((child, offset) => {
      const from = at + 1 + offset
      const m = child.isText ? child.marks.find((x) => x.type.name === COMPANION_TEXT) : null
      if (!m) { flush(); return }
      const original = typeof m.attrs.original === 'string' ? m.attrs.original : null
      if (run && run.to === from && run.original === original) { run.to = from + child.nodeSize; run.text += child.text ?? '' }
      else { flush(); run = { from, to: from + child.nodeSize, text: child.text ?? '', original } }
    })
    flush()
  }
  return out
}

/** Textblocks a set of transactions touched, by position in `doc`. */
function touchedBlocks(trs: readonly Transaction[], doc: PMNode): Set<number> {
  const blocks = new Set<number>()
  trs.forEach((t, i) => {
    if (!t.docChanged || exempt(t)) return
    const later = trs.slice(i + 1).reduce((m, x) => { m.appendMapping(x.mapping); return m }, t.mapping.slice(t.mapping.maps.length))
    t.mapping.maps.forEach((map, j) => {
      const rest = t.mapping.slice(j + 1)
      map.forEach((_os, _oe, ns, ne) => {
        for (const p of [ns, ne]) {
          const pos = later.map(rest.map(p, -1), -1)
          const clamped = Math.max(0, Math.min(pos, doc.content.size))
          const $p = doc.resolve(clamped)
          if ($p.parent.isTextblock) blocks.add($p.before($p.depth))
        }
      })
    })
  })
  return blocks
}

/** A companion-lifted underside left loose with nothing of the writer's in it is removed. */
function strayUndersides(doc: PMNode): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  doc.forEach((node, offset) => {
    if (node.type.name !== UNDERSIDE || node.attrs.loose !== true || node.attrs.liftedBy !== 'companion') return
    let writer = ''
    node.descendants((n) => { if (n.isTextblock) { writer += writerText(n); return false } return true })
    if (writer.trim() === '') out.push({ from: offset, to: offset + node.nodeSize })
  })
  return out
}

function takeOverTr(state: EditorState, blocks: Iterable<number>): Transaction | null {
  const markType = state.schema.marks[COMPANION_TEXT]
  const runs = changedRuns(state.doc, blocks)
  if (runs.length === 0) return null
  const tr = state.tr
  for (const r of runs) tr.removeMark(r.from, r.to, markType)
  return tr.setMeta(takeOverKey, true)
}

/**
 * Changed companion words become the writer's (the mark is removed from the
 * whole run), whatever path the change came by. Never during an IME
 * composition (changing marks there would break it): the runs touched are
 * taken over when it ends.
 */
export function takeOverPlugin(): Plugin {
  let composing = false
  const afterComposition = (view: EditorView) => {
    composing = false
    setTimeout(() => {
      if (view.isDestroyed) return
      const $c = view.state.selection.$from
      const tr = takeOverTr(view.state, [$c.before($c.depth)])
      if (tr) view.dispatch(tr.setMeta('addToHistory', false))
    }, 0)
    return false
  }
  return new Plugin({
    key: takeOverKey,
    props: {
      handleDOMEvents: {
        compositionstart: () => { composing = true; return false },
        compositionend: (view) => afterComposition(view),
      },
    },
    appendTransaction(trs, _old, newState) {
      if (composing) return null
      // Integrity's own fixes (a line deleted makes its underside loose) can
      // leave a stray companion underside; loads and history never touch it.
      const anyChange = trs.some((t) => t.docChanged && !t.getMeta(TR_LOAD) && !t.getMeta(takeOverKey) && !isHistoryTransaction(t))
      if (!anyChange) return null
      const writerChange = trs.some((t) => t.docChanged && !exempt(t))
      const tr = writerChange ? takeOverTr(newState, touchedBlocks(trs, newState.doc)) : null
      const stray = strayUndersides((tr ?? newState.tr).doc)
      if (stray.length === 0) return tr
      const out = tr ?? newState.tr.setMeta(takeOverKey, true)
      for (const s of stray.reverse()) out.delete(s.from, s.to)
      return out.setMeta(TR_VISIBLE_EDIT, true)
    },
  })
}
