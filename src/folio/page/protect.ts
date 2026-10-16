import { Plugin, PluginKey, NodeSelection, TextSelection, Selection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { isHistoryTransaction } from '@tiptap/pm/history'
import { BENEATH, BETWEEN, FOLD, UNDERSIDE, foldIdsInParagraph, newId } from './schema'
import {
  TR_INTEGRITY, TR_LOAD, TR_RESTORE, TR_VISIBLE_EDIT,
  closedRanges, fenceActive, foldViewKey, getFoldView, openFolds,
} from './foldView'
import type { FoldViewMeta } from './foldView'

// C1 layers 2, 3 and 4 (draft 4 §5.1).
//   Layer 2: input guards — every deletion binding (K4), key repeat (K1),
//            fences (K2), the pre-input collapse, native cut, paste, drop.
//   Layer 3: the history guard — refuse an undo/redo that would change a
//            closed underside; open it instead (deferred), announce.
//   Layer 4: the safety net — restore a closed underside changed by any
//            transaction that isn't a visible edit, a load, integrity or history.

export interface ProtectOptions {
  onAnnounce?: (message: string) => void
  /** A protection event kept closed writing (the "Remove it too · Undo" notice). */
  onProtected?: (foldIds: string[]) => void
  onDiagnostic?: (code: 'folio.hidden.restored' | 'folio.history.refused') => void
  strings: () => { protectedOpened: string; undoOpened: string }
  now?: () => number
}

const nowOf = (o: ProtectOptions) => (o.now ?? Date.now)()

export function isExempt(tr: Transaction): boolean {
  return !!(tr.getMeta(TR_VISIBLE_EDIT) || tr.getMeta(TR_LOAD) || tr.getMeta(TR_INTEGRITY) || tr.getMeta(TR_RESTORE) || isHistoryTransaction(tr))
}

function undersideById(doc: PMNode): Map<string, { node: PMNode; pos: number }> {
  const map = new Map<string, { node: PMNode; pos: number }>()
  doc.forEach((node, offset) => {
    const id = node.attrs.foldId as string | null
    if (node.type.name === UNDERSIDE && id && !map.has(id)) map.set(id, { node, pos: offset })
  })
  return map
}

/** Closed undersides of `before` that `after` removed or whose content changed. */
export function closedChanges(before: PMNode, after: PMNode, open: ReadonlySet<string>): { foldId: string; node: PMNode; pos: number; missing: boolean }[] {
  const now = undersideById(after)
  const out: { foldId: string; node: PMNode; pos: number; missing: boolean }[] = []
  for (const r of closedRanges(before, open)) {
    if (!r.foldId) continue
    const found = now.get(r.foldId)
    if (!found) out.push({ foldId: r.foldId, node: r.node, pos: r.from, missing: true })
    else if (!found.node.content.eq(r.node.content)) out.push({ foldId: r.foldId, node: r.node, pos: r.from, missing: false })
  }
  return out
}

/** Position just after the top-level block containing `pos`. */
function afterTopBlock(doc: PMNode, pos: number): number {
  const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  if ($p.depth === 0) return $p.pos
  return $p.after(1)
}

// ---------------------------------------------------------------- layer 4

export function hiddenWritingPlugin(options: ProtectOptions): Plugin {
  return new Plugin({
    key: new PluginKey('folioHiddenWriting'),
    appendTransaction(trs, oldState, newState) {
      const offending = trs.filter((tr) => tr.docChanged && !isExempt(tr))
      if (offending.length === 0) return null
      const changes = closedChanges(oldState.doc, newState.doc, getFoldView(oldState).open)
      if (changes.length === 0) return null
      const tr = newState.tr
      const now = undersideById(newState.doc)
      // Content changed in place: put the old content back.
      for (const c of changes.filter((x) => !x.missing)) {
        const found = now.get(c.foldId)
        if (!found) continue
        const pos = tr.mapping.map(found.pos)
        const node = tr.doc.nodeAt(pos)
        if (node) tr.replaceWith(pos + 1, pos + node.nodeSize - 1, c.node.content)
      }
      // Removed: re-insert after the block where it was.
      for (const c of changes.filter((x) => x.missing)) {
        let mapped = c.pos
        for (const t of trs) mapped = t.mapping.map(mapped, -1)
        tr.insert(afterTopBlock(tr.doc, tr.mapping.map(mapped, -1)), c.node)
      }
      const ids = changes.map((c) => c.foldId)
      openFolds(tr, ids, { key: null, at: nowOf(options) })
      tr.setMeta(TR_RESTORE, true)
      options.onDiagnostic?.('folio.hidden.restored')
      options.onAnnounce?.(options.strings().protectedOpened)
      options.onProtected?.(ids)
      return tr
    },
  })
}

// ---------------------------------------------------------------- layer 3

export function historyGuardPlugin(options: ProtectOptions): Plugin {
  let view: EditorView | null = null
  return new Plugin({
    key: new PluginKey('folioHistoryGuard'),
    view(v) { view = v; return { destroy() { view = null } } },
    filterTransaction(tr, state) {
      if (!tr.docChanged || !isHistoryTransaction(tr)) return true
      const changes = closedChanges(state.doc, tr.doc, getFoldView(state).open)
      if (changes.length === 0) return true
      const ids = changes.map((c) => c.foldId)
      options.onDiagnostic?.('folio.history.refused')
      // filterTransaction runs inside the dispatch it filters; a nested
      // dispatch here would be overwritten, so the open is deferred.
      queueMicrotask(() => {
        if (!view) return
        const t = openFolds(view.state.tr, ids).setMeta('addToHistory', false).scrollIntoView()
        view.dispatch(t)
        options.onAnnounce?.(options.strings().undoOpened)
      })
      return false
    },
  })
}

// ---------------------------------------------------------------- visible delete

/** Closed undersides wholly inside [from, to). */
function closedInside(state: EditorState, from: number, to: number) {
  return closedRanges(state.doc, getFoldView(state).open).filter((r) => r.from >= from && r.to <= to)
}

export function rangeHasClosed(state: EditorState, from: number, to: number): boolean {
  return closedInside(state, from, to).length > 0
}

export function rangeHasFenced(state: EditorState, from: number, to: number, now: number): boolean {
  const { fences } = getFoldView(state)
  let hit = false
  state.doc.forEach((node, offset) => {
    if (node.type.name !== UNDERSIDE) return
    const id = node.attrs.foldId as string
    if (offset < to && offset + node.nodeSize > from && fenceActive(fences.get(id), now)) hit = true
  })
  return hit
}

/**
 * Delete only the visible content of [from, to). Every closed underside in
 * the range is kept, moved to the deletion point, opened and fenced; the
 * caret ends outside it. Tagged `folio:visibleEdit`.
 */
export function visibleDelete(
  state: EditorState,
  from: number,
  to: number,
  opts: { key: string | null; at: number; insert?: Slice | string },
): { tr: Transaction; kept: string[] } {
  const kept = closedInside(state, from, to)
  const tr = state.tr.setMeta(TR_VISIBLE_EDIT, true)
  // A range that is exactly one closed underside deletes nothing visible.
  if (kept.length === 1 && kept[0].from === from && kept[0].to === to && opts.insert === undefined) {
    openFolds(tr, [kept[0].foldId], { key: opts.key, at: opts.at })
    tr.setSelection(Selection.near(tr.doc.resolve(from), -1))
    return { tr, kept: [kept[0].foldId] }
  }
  tr.delete(from, to)
  let caret = tr.mapping.map(from, -1)
  if (opts.insert !== undefined) {
    const $c = tr.doc.resolve(caret)
    if (typeof opts.insert === 'string') {
      if ($c.parent.inlineContent) {
        tr.insertText(opts.insert, caret)
        caret += opts.insert.length
      }
    } else {
      tr.replaceRange(caret, caret, opts.insert)
      caret = tr.mapping.map(caret, 1)
    }
  }
  if (kept.length > 0) {
    const insertAt = afterTopBlock(tr.doc, caret)
    tr.insert(insertAt, kept.map((k) => k.node))
    openFolds(tr, kept.map((k) => k.foldId), { key: opts.key, at: opts.at })
  }
  const $c = tr.doc.resolve(Math.min(caret, tr.doc.content.size))
  tr.setSelection($c.parent.inlineContent ? TextSelection.create(tr.doc, $c.pos) : Selection.near($c, -1))
  return { tr, kept: kept.map((k) => k.foldId) }
}

// ---------------------------------------------------------------- layer 2

const BACKWARD = new Set(['Backspace'])
const FORWARD = new Set(['Delete'])

/** K4: every deletion binding in prosemirror-commands' pc and mac keymaps. */
export function deletionDirection(event: KeyboardEvent): -1 | 1 | null {
  const { key, ctrlKey, altKey, metaKey } = event
  if (BACKWARD.has(key)) return -1
  if (FORWARD.has(key)) return event.shiftKey && !ctrlKey && !altKey && !metaKey ? null : 1
  if (ctrlKey && !altKey && !metaKey && key.toLowerCase() === 'h') return -1
  if (ctrlKey && !altKey && !metaKey && key.toLowerCase() === 'd') return 1
  if (altKey && !ctrlKey && !metaKey && key.toLowerCase() === 'd') return 1
  return null
}

function isShiftDeleteCut(event: KeyboardEvent): boolean {
  return event.key === 'Delete' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
}

function underside(node: PMNode | null | undefined): boolean {
  return !!node && node.type.name === UNDERSIDE
}

function isClosedId(state: EditorState, id: string | null): boolean {
  return !!id && !getFoldView(state).open.has(id)
}

function announceProtected(options: ProtectOptions, kept: string[]) {
  if (kept.length === 0) return
  options.onAnnounce?.(options.strings().protectedOpened)
  options.onProtected?.(kept)
}

/**
 * The deletion rules for one press in direction `dir`. Returns true when the
 * press was handled (or deliberately swallowed).
 */
export function handleDeletion(view: EditorView, dir: -1 | 1, repeat: boolean, key: string | null, options: ProtectOptions): boolean {
  const state = view.state
  const sel = state.selection
  const now = nowOf(options)

  // A whole underside selected (the first press at an edge selected it).
  if (sel instanceof NodeSelection && underside(sel.node)) {
    const id = sel.node.attrs.foldId as string | null
    if (repeat || rangeHasFenced(state, sel.from, sel.to, now)) return true // K1, K2
    if (isClosedId(state, id)) {
      const { tr, kept } = visibleDelete(state, sel.from, sel.to, { key, at: now })
      view.dispatch(tr.scrollIntoView())
      announceProtected(options, kept)
      return true
    }
    return false // an open underside is visible writing
  }

  if (!sel.empty) {
    if (rangeHasClosed(state, sel.from, sel.to)) {
      if (repeat) return true // K1
      const { tr, kept } = visibleDelete(state, sel.from, sel.to, { key, at: now })
      view.dispatch(tr.scrollIntoView())
      announceProtected(options, kept)
      return true
    }
    return rangeHasFenced(state, sel.from, sel.to, now) // K2
  }

  const $c = sel.$from
  const para = $c.parent
  if (para.type.name !== 'paragraph') return false
  const atStart = $c.parentOffset === 0
  const atEnd = $c.parentOffset === para.content.size

  // Inside an underside: Backspace at the start of the between or the beneath,
  // or Delete at the end of either, moves the caret across and deletes nothing.
  if ($c.depth >= 3) {
    const passage = $c.node($c.depth - 1)
    const passageIndex = $c.index($c.depth - 1)
    const isPassage = passage.type.name === BETWEEN || passage.type.name === BENEATH
    if (isPassage && dir < 0 && atStart && passageIndex === 0) {
      if (repeat) return true
      const passageStart = $c.before($c.depth - 1)
      const target = Selection.findFrom(state.doc.resolve(passageStart), -1, true)
      if (target) view.dispatch(state.tr.setSelection(target).scrollIntoView())
      return true
    }
    if (isPassage && dir > 0 && atEnd && passageIndex === passage.childCount - 1) {
      if (repeat) return true
      const passageEnd = $c.after($c.depth - 1)
      const target = Selection.findFrom(state.doc.resolve(passageEnd), 1, true)
      if (target) view.dispatch(state.tr.setSelection(target).scrollIntoView())
      return true
    }
    return false
  }

  // Top-level paragraph beside an underside.
  if ($c.depth !== 1) return false
  const index = $c.index(0)
  const neighbour = dir < 0 ? (index > 0 ? state.doc.child(index - 1) : null) : (index + 1 < state.doc.childCount ? state.doc.child(index + 1) : null)
  const atEdge = dir < 0 ? atStart : atEnd
  if (!atEdge || !underside(neighbour)) return false
  const nb = neighbour as PMNode
  const nbPos = dir < 0 ? $c.before(1) - nb.nodeSize : $c.after(1)
  if (repeat) return true // K1: key repeat never selects, enters or deletes an underside
  if (rangeHasFenced(state, nbPos, nbPos + nb.nodeSize, now)) return true // K2
  const closed = isClosedId(state, nb.attrs.foldId as string | null)
  if (para.content.size === 0 && closed) {
    // B4: remove the empty paragraph and select the underside; the caret
    // never enters the closed beneath.
    const tr = state.tr.setMeta(TR_VISIBLE_EDIT, true)
    const paraPos = $c.before(1)
    tr.delete(paraPos, paraPos + para.nodeSize)
    const uPos = tr.mapping.map(nbPos)
    tr.setSelection(NodeSelection.create(tr.doc, uPos))
    view.dispatch(tr.scrollIntoView())
    return true
  }
  // First press: select the whole underside (crease shown as selected).
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, nbPos)).scrollIntoView())
  return true
}

/** Enter at the end of a lifted line: new paragraph after its undersides (B17). */
export function handleEnter(view: EditorView): boolean {
  const state = view.state
  const sel = state.selection
  if (!sel.empty || sel.$from.depth !== 1) return false
  const $c = sel.$from
  const para = $c.parent
  if (para.type.name !== 'paragraph' || $c.parentOffset !== para.content.size) return false
  const ids = new Set(foldIdsInParagraph(para))
  if (ids.size === 0) return false
  let end = $c.after(1)
  let index = $c.index(0) + 1
  while (index < state.doc.childCount) {
    const next = state.doc.child(index)
    if (next.type.name !== UNDERSIDE || !ids.has(next.attrs.foldId as string)) break
    end += next.nodeSize
    index++
  }
  if (end === $c.after(1)) return false
  const paragraph = state.schema.nodes.paragraph.create({ pid: newId() })
  const tr = state.tr.insert(end, paragraph)
  tr.setSelection(TextSelection.create(tr.doc, end + 1))
  view.dispatch(tr.scrollIntoView())
  return true
}

/**
 * Copy: keep only visible content (closed undersides dropped, open ones
 * unwrapped into paragraphs, between then beneath). Paste (`open` null):
 * unwrap every underside, so nothing pasted is lost. Fold marks are always
 * stripped; pids are dropped on paste so pasted text gets new ones.
 */
export function visibleSlice(slice: Slice, open: ReadonlySet<string> | null, keepPids: boolean): Slice {
  const schema = slice.content.firstChild?.type.schema
  if (!schema) return slice
  const foldType = schema.marks[FOLD]
  const mapFragment = (fragment: Fragment): Fragment => {
    const out: PMNode[] = []
    fragment.forEach((node) => {
      if (node.type.name === UNDERSIDE) {
        const id = node.attrs.foldId as string | null
        if (open && (!id || !open.has(id))) return // closed: not copied
        node.forEach((passage) => passage.forEach((p) => out.push(cleanNode(p))))
        return
      }
      if (node.type.name === BETWEEN || node.type.name === BENEATH) {
        node.forEach((p) => out.push(cleanNode(p)))
        return
      }
      out.push(cleanNode(node))
    })
    return Fragment.from(out)
  }
  const cleanNode = (node: PMNode): PMNode => {
    // Fold marks and the companion's mark never travel through the clipboard:
    // pasted words are the writer's.
    if (node.isText) return node.mark(node.marks.filter((m) => m.type !== foldType && m.type.name !== 'companionText'))
    const attrs = node.type.name === 'paragraph' && !keepPids ? { ...node.attrs, pid: null } : node.attrs
    return node.type.create(attrs, mapFragment(node.content), node.marks)
  }
  const content = mapFragment(slice.content)
  const openStart = content.childCount === slice.content.childCount ? slice.openStart : 0
  const openEnd = content.childCount === slice.content.childCount ? slice.openEnd : 0
  try {
    return new Slice(content, Math.min(openStart, 1), Math.min(openEnd, 1))
  } catch {
    return new Slice(content, 0, 0)
  }
}

export function slicePlainText(slice: Slice): string {
  const blocks: string[] = []
  slice.content.forEach((node) => blocks.push(node.textBetween(0, node.content.size, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : ''))))
  return blocks.join('\n\n')
}

export function inputGuardPlugin(options: ProtectOptions): Plugin {
  const keyupMeta = (view: EditorView, key: string) => {
    if (getFoldView(view.state).fences.size === 0) return
    view.dispatch(view.state.tr.setMeta(foldViewKey, { type: 'keyup', key } satisfies FoldViewMeta).setMeta('addToHistory', false))
  }
  const liftFences = (view: EditorView) => {
    if (getFoldView(view.state).fences.size === 0) return
    view.dispatch(view.state.tr.setMeta(foldViewKey, { type: 'liftFences' } satisfies FoldViewMeta).setMeta('addToHistory', false))
  }
  const collapseIfHidden = (view: EditorView, insert?: string): boolean => {
    const { from, to, empty } = view.state.selection
    if (empty || !rangeHasClosed(view.state, from, to)) return false
    const { tr, kept } = visibleDelete(view.state, from, to, { key: null, at: nowOf(options), insert })
    view.dispatch(tr.scrollIntoView())
    announceProtected(options, kept)
    return true
  }

  return new Plugin({
    key: new PluginKey('folioInputGuard'),
    props: {
      handleKeyDown(view, event) {
        if (isShiftDeleteCut(event)) return false // the browser fires `cut`
        const dir = deletionDirection(event)
        if (dir !== null) return handleDeletion(view, dir, event.repeat, event.key, options)
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) return handleEnter(view)
        // Pre-input collapse for printable keys over a selection holding a closed fold.
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) return collapseIfHidden(view, event.key)
        return false
      },
      handleTextInput(view, from, to, text) {
        if (from === to || !rangeHasClosed(view.state, from, to)) return false
        const { tr, kept } = visibleDelete(view.state, from, to, { key: null, at: nowOf(options), insert: text })
        view.dispatch(tr)
        announceProtected(options, kept)
        return true
      },
      handlePaste(view, _event, slice) {
        const { from, to, empty } = view.state.selection
        if (empty || !rangeHasClosed(view.state, from, to)) return false
        const { tr, kept } = visibleDelete(view.state, from, to, { key: null, at: nowOf(options), insert: slice })
        view.dispatch(tr.scrollIntoView())
        announceProtected(options, kept)
        return true
      },
      handleDrop(view, event, slice, moved) {
        if (!moved) return false
        const { from, to } = view.state.selection
        if (!rangeHasClosed(view.state, from, to)) return false
        const coords = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })
        const { tr, kept } = visibleDelete(view.state, from, to, { key: null, at: nowOf(options) })
        const target = coords ? tr.mapping.map(coords.pos) : tr.selection.from
        const cleaned = visibleSlice(slice, getFoldView(view.state).open, false)
        tr.replaceRange(target, target, cleaned)
        view.dispatch(tr.scrollIntoView())
        announceProtected(options, kept)
        event.preventDefault()
        return true
      },
      handleDOMEvents: {
        keyup(view, event) { keyupMeta(view, event.key); return false },
        blur(view) { liftFences(view); return false },
        beforeinput(view, event) {
          const e = event as InputEvent
          const t = e.inputType
          if (t === 'deleteContentBackward' || t === 'deleteContentForward' || t === 'deleteWordBackward' || t === 'deleteWordForward' || t === 'deleteSoftLineBackward' || t === 'deleteHardLineBackward') {
            const dir: -1 | 1 = t.endsWith('Forward') ? 1 : -1
            if (handleDeletion(view, dir, false, null, options)) { e.preventDefault(); return true }
            return false
          }
          if (t === 'insertText' || t === 'insertReplacementText' || t === 'insertFromPaste' || t === 'insertFromDrop' || t === 'insertParagraph' || t === 'insertLineBreak') {
            if (collapseIfHidden(view, t === 'insertText' ? (e.data ?? undefined) : undefined)) {
              if (t === 'insertText' || t === 'insertParagraph' || t === 'insertLineBreak') e.preventDefault()
              return t === 'insertText'
            }
          }
          return false
        },
        compositionstart(view) {
          // The selection must be a caret before composition begins; a
          // composition can't be cancelled, so collapse synchronously.
          collapseIfHidden(view)
          return false
        },
        cut(view, event) {
          const e = event as ClipboardEvent
          const { from, to, empty } = view.state.selection
          if (empty || !rangeHasClosed(view.state, from, to)) return false
          const data = e.clipboardData
          if (data) {
            const { dom, text } = view.serializeForClipboard(view.state.selection.content())
            data.clearData()
            data.setData('text/html', dom.innerHTML)
            data.setData('text/plain', text)
          }
          e.preventDefault()
          const { tr, kept } = visibleDelete(view.state, from, to, { key: null, at: nowOf(options) })
          view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'cut'))
          announceProtected(options, kept)
          return true
        },
      },
      transformCopied(slice, view) {
        return visibleSlice(slice, getFoldView(view.state).open, true)
      },
      clipboardTextSerializer(slice) {
        return slicePlainText(slice)
      },
      transformPasted(slice, view) {
        void view
        return visibleSlice(slice, null, false)
      },
    },
  })
}
