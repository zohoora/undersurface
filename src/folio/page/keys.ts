import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { FOLD, UNDERSIDE, foldRange } from './schema'
import type { Gap } from './schema'
import { getFoldView, toggleFold } from './foldView'
import { apart, findUnderside, isEmptyUnderside, lift, unlift } from './commands'
import type { FolioStrings } from './strings'

// S5's key table (draft 4 §3.10; build plan step 2). Chosen to avoid:
// Ctrl+Alt+arrows (some Windows graphics drivers rotate the screen),
// Cmd+Opt+J / K (Chrome's and Firefox's consoles on a Mac), and Option+letter
// (types accented characters on a Mac). Every action also has a visible
// control; real-device and screen-reader checks are on the owner's checklist.
export const FOLIO_KEYS = {
  liftOrToggle: 'Mod-Shift-Enter',
  closeOrUnlift: 'Escape',
  closer: 'Mod-Alt-[',
  farther: 'Mod-Alt-]',
  nextFold: 'Mod-Alt-.',
  previousFold: 'Mod-Alt-,',
  stepInside: 'Mod-Alt-Enter',
} as const

export interface KeyDeps {
  strings: () => FolioStrings
  onAnnounce?: (message: string) => void
  switches: () => { between: boolean; distance: boolean }
  onStepInside?: (foldId: string) => void
  locale?: () => string | undefined
}

/** Where the caret is relative to folds: on a lifted line, or inside an underside. */
export function foldAtCaret(state: EditorState): { foldId: string; where: 'line' | 'underside'; pos: number } | null {
  const $c = state.selection.$from
  if ($c.depth >= 1) {
    const top = $c.node(1)
    if (top.type.name === UNDERSIDE) return { foldId: String(top.attrs.foldId), where: 'underside', pos: $c.before(1) }
  }
  if ($c.parent.type.name === 'paragraph' && $c.depth === 1) {
    const marks = [...($c.nodeBefore?.marks ?? []), ...($c.nodeAfter?.marks ?? [])]
    const fold = marks.find((m) => m.type.name === FOLD)
    if (fold) return { foldId: String(fold.attrs.foldId), where: 'line', pos: $c.before(1) }
  }
  return null
}

function caretToLineEnd(view: EditorView, foldId: string): void {
  const { state } = view
  let target: number | null = null
  state.doc.forEach((node, offset) => {
    if (target !== null || node.type.name !== 'paragraph') return
    const r = foldRange(node, offset, foldId)
    if (r) target = r.to
  })
  if (target !== null) view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)).setMeta('addToHistory', false))
}

export function folioKeyHandlers(deps: KeyDeps): Record<string, (view: EditorView) => boolean> {
  const announce = (m: string) => deps.onAnnounce?.(m)
  return {
    [FOLIO_KEYS.liftOrToggle]: (view) => {
      const at = foldAtCaret(view.state)
      if (at) {
        const open = getFoldView(view.state).open.has(at.foldId)
        view.dispatch(toggleFold(view.state, at.foldId))
        if (open) caretToLineEnd(view, at.foldId)
        return true
      }
      const r = lift(view.state, { locale: deps.locale?.() })
      if (!r.ok) {
        if (r.reason === 'alreadyLifted') announce(deps.strings().alreadyLifted)
        return r.reason !== 'notInPage'
      }
      view.dispatch(r.tr)
      announce(deps.strings().lifted)
      return true
    },
    [FOLIO_KEYS.closeOrUnlift]: (view) => {
      const at = foldAtCaret(view.state)
      if (!at || at.where !== 'underside') return false
      const u = findUnderside(view.state.doc, at.foldId)
      if (u && isEmptyUnderside(u.node)) {
        const r = unlift(view.state, at.foldId)
        if (r.ok) { view.dispatch(r.tr); announce(deps.strings().unlifted) }
        return true
      }
      view.dispatch(toggleFold(view.state, at.foldId))
      caretToLineEnd(view, at.foldId)
      return true
    },
    [FOLIO_KEYS.closer]: (view) => apartKey(view, -1, deps),
    [FOLIO_KEYS.farther]: (view) => apartKey(view, 1, deps),
    [FOLIO_KEYS.nextFold]: (view) => moveToFold(view, 1, deps),
    [FOLIO_KEYS.previousFold]: (view) => moveToFold(view, -1, deps),
    [FOLIO_KEYS.stepInside]: (view) => {
      const at = foldAtCaret(view.state)
      if (!at || !deps.onStepInside) return false
      deps.onStepInside(at.foldId)
      return true
    },
  }
}

function apartKey(view: EditorView, dir: -1 | 1, deps: KeyDeps): boolean {
  const at = foldAtCaret(view.state)
  if (!at || at.where !== 'underside') return false
  const r = apart(view.state, at.foldId, dir, deps.switches())
  if (!r.ok) {
    if (r.reason === 'blocked' && dir < 0) deps.onAnnounce?.(deps.strings().closerBlocked)
    return true
  }
  view.dispatch(r.tr)
  const s = deps.strings()
  deps.onAnnounce?.(dir > 0 ? s.farther(r.gap as Gap) : s.closer(r.gap as Gap))
  return true
}

/** The discovery path for screen readers (§3.10): move to the next or previous lifted line. */
function moveToFold(view: EditorView, dir: -1 | 1, deps: KeyDeps): boolean {
  const { state } = view
  const head = state.selection.head
  const lines: { foldId: string; to: number; text: string }[] = []
  state.doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph') return
    const seen = new Set<string>()
    node.forEach((child) => {
      const m = child.marks.find((x) => x.type.name === FOLD)
      const id = m?.attrs.foldId as string | undefined
      if (!id || seen.has(id)) return
      seen.add(id)
      const r = foldRange(node, offset, id)
      if (r) lines.push({ foldId: id, to: r.to, text: state.doc.textBetween(r.from, r.to) })
    })
  })
  const target = dir > 0 ? lines.find((l) => l.to > head) : [...lines].reverse().find((l) => l.to < head)
  if (!target) return true
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target.to)).scrollIntoView().setMeta('addToHistory', false))
  deps.onAnnounce?.(deps.strings().foldFound(target.text, getFoldView(view.state).open.has(target.foldId)))
  return true
}
