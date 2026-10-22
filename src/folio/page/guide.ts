import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { FOLD, UNDERSIDE, foldRange } from './schema'
import { MAX_LIFT_CHARS, sentenceAround } from './commands'
import { TR_LOAD, foldViewKey, getFoldView } from './foldView'
import type { FoldViewMeta } from './foldView'
import { COMPANION_TEXT } from '../companion/companionText'
import { presence, sentenceRange } from '../companion/presence'

// The first moment (docs/vision/2026-10-22-folio-first-moment.md §3.1, §3.4):
// - The corner: when the caret rests in a written paragraph (or on the empty
//   line just after one), or the pointer rests on one, a folded corner after
//   its last sentence, "write beneath". Pressing it lifts that sentence. It
//   sits at the paragraph's end, so it covers no text, and goes at the next
//   key, click or selection.
// - The first fold: once, after the writer folds something away, beside the
//   crease, "folded here · open".
// Both are decorations: never in the document, the history or a save.

export const guideKey = new PluginKey<GuideState>('folioGuide')

/** The caret has rested this long after a finished sentence… */
export const CORNER_REST_MS = 1200
/** …or this long mid-sentence (a pause to think shouldn't flash anything). */
export const CORNER_REST_UNFINISHED_MS = 3000

export interface Corner {
  from: number
  to: number
}

export interface GuideState {
  corner: Corner | null
  /** The pointer is on the corner: the sentence it would lift is underlined. */
  preview: boolean
  /** The first-fold line, under this fold's line. */
  foldHint: string | null
}

export type GuideMeta =
  | { type: 'corner'; corner: Corner }
  | { type: 'clearCorner' }
  | { type: 'preview'; on: boolean }
  | { type: 'foldHint'; foldId: string }
  | { type: 'clearFoldHint' }

export interface GuideOptions {
  /** The switch, this tab holding the page, Normal paper, room on the page. */
  enabled: () => boolean
  /** The writer has lifted often enough that the corner's words show only on hover. */
  learned: () => boolean
  labels: () => { corner: string; cornerLabel: string; foldHint: string }
  /** The key that lifts, for the tooltip (absent on touch screens). */
  shortcut?: () => string | null
  /** Lift exactly this range (the host checks the page isn't full, and announces). */
  onLift: (corner: Corner) => void
  locale?: () => string | undefined
  /** For tests. */
  restMs?: { finished: number; unfinished: number }
  hoverMs?: { over: number; leave: number }
}

const TERMINAL = /[.!?…。！？؟।॥]["'”’)\]»]*$/u

function hasFold(state: EditorState, from: number, to: number): boolean {
  let found = false
  state.doc.nodesBetween(from, to, (n) => { if (n.isText && n.marks.some((m) => m.type.name === FOLD)) found = true })
  return found
}

/** Every character in the range is the companion's own (level 5's lines): not the writer's to lift. */
function onlyCompanion(state: EditorState, from: number, to: number): boolean {
  let writer = false
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isText) return
    const start = Math.max(from, pos)
    const end = Math.min(to, pos + n.nodeSize)
    if (end > start && !n.marks.some((m) => m.type.name === COMPANION_TEXT)) writer = true
  })
  return !writer
}

/**
 * The corner of the page paragraph at `paraPos`: its last sentence (the
 * corner sits at the paragraph's end, where it covers no text), written by
 * the writer, not lifted, not the companion's mark, at most 400 characters.
 */
export function cornerOfParagraph(state: EditorState, paraPos: number, locale?: string): (Corner & { finished: boolean }) | null {
  const para = state.doc.nodeAt(paraPos)
  if (!para || para.type.name !== 'paragraph' || state.doc.resolve(paraPos).depth !== 0) return null
  const text = para.textContent
  if (text.trim().length < 2) return null
  // The paragraph's text must map one-to-one onto positions (no inline nodes).
  if (para.content.size !== text.length) return null
  const start = paraPos + 1
  const end = text.trimEnd().length
  const r = sentenceAround(text, Math.max(0, end - 1), locale)
  if (r.to <= r.from) return null
  const sentence = text.slice(r.from, r.to)
  if (sentence.trim().length < 2 || sentence.length > MAX_LIFT_CHARS) return null
  const from = start + r.from
  const to = start + r.to
  if (hasFold(state, from, to) || onlyCompanion(state, from, to)) return null
  const mark = presence(state).mark
  if (mark) {
    const m = sentenceRange(state.doc, mark.pid, mark.sentence)
    if (m && m.from < to && m.to > from) return null
  }
  return { from, to, finished: TERMINAL.test(sentence) }
}

/**
 * The corner for the caret where it rests: the paragraph it's in, or, on a
 * fresh empty line, the paragraph just finished above it (Enter is a pause).
 */
export function cornerFor(state: EditorState, locale?: string): (Corner & { finished: boolean }) | null {
  const sel = state.selection
  if (!sel.empty) return null
  const $c = sel.$from
  if ($c.depth !== 1 || $c.parent.type.name !== 'paragraph') return null
  if ($c.parent.content.size === 0) {
    const index = $c.index(0)
    if (index === 0) return null
    const above = state.doc.child(index - 1)
    if (above.type.name !== 'paragraph') return null
    const c = cornerOfParagraph(state, $c.before(1) - above.nodeSize, locale)
    return c ? { ...c, finished: true } : null
  }
  return cornerOfParagraph(state, $c.before(1), locale)
}

/** The top-level paragraph under a point on the page, if any. */
function paragraphAtPoint(view: EditorView, x: number, y: number): number | null {
  const at = view.posAtCoords({ left: x, top: y })
  if (!at) return null
  const $p = view.state.doc.resolve(at.pos)
  if ($p.depth < 1) return null
  const top = $p.node(1)
  if (top.type.name !== 'paragraph') return null
  return $p.before(1)
}

function foldHintAt(state: EditorState, foldId: string): number | null {
  let at: number | null = null
  state.doc.forEach((node, offset) => {
    if (at !== null || node.type.name !== UNDERSIDE || node.attrs.foldId !== foldId) return
    at = offset
  })
  return at
}

function lineOf(state: EditorState, foldId: string): { from: number; to: number } | null {
  let out: { from: number; to: number } | null = null
  state.doc.forEach((node, offset) => {
    if (!out && node.type.name === 'paragraph') out = foldRange(node, offset, foldId)
  })
  return out
}

/** The pointer rests on a line this long before its corner shows. */
export const CORNER_HOVER_MS = 350
/** …and the corner stays this long after the pointer leaves the line. */
export const CORNER_HOVER_LEAVE_MS = 700

export function guidePlugin(options: GuideOptions): Plugin<GuideState> {
  const rest = options.restMs ?? { finished: CORNER_REST_MS, unfinished: CORNER_REST_UNFINISHED_MS }
  const hoverMs = options.hoverMs ?? { over: CORNER_HOVER_MS, leave: CORNER_HOVER_LEAVE_MS }
  const show = (v: EditorView, c: Corner) => v.dispatch(v.state.tr.setMeta(guideKey, { type: 'corner', corner: { from: c.from, to: c.to } } satisfies GuideMeta).setMeta('addToHistory', false))
  const hover = {
    fine: typeof window !== 'undefined' && (() => { try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches } catch { return false } })(),
    para: null as number | null,
    overTimer: null as ReturnType<typeof setTimeout> | null,
    leaveTimer: null as ReturnType<typeof setTimeout> | null,
    cancelLeave() { if (this.leaveTimer) { clearTimeout(this.leaveTimer); this.leaveTimer = null } },
    over(v: EditorView, paraPos: number) {
      this.cancelLeave()
      if (this.para === paraPos) return
      this.para = paraPos
      if (this.overTimer) clearTimeout(this.overTimer)
      this.overTimer = setTimeout(() => {
        this.overTimer = null
        if (v.isDestroyed || !options.enabled() || !v.editable || v.composing || this.para !== paraPos) return
        const c = cornerOfParagraph(v.state, paraPos, options.locale?.())
        const now = guideKey.getState(v.state)?.corner
        if (c && (!now || now.from !== c.from || now.to !== c.to)) show(v, c)
      }, hoverMs.over)
    },
    leave(v: EditorView) {
      if (this.overTimer) { clearTimeout(this.overTimer); this.overTimer = null }
      if (this.para === null || this.leaveTimer) return
      this.leaveTimer = setTimeout(() => {
        this.leaveTimer = null
        this.para = null
        if (v.isDestroyed) return
        const now = guideKey.getState(v.state)?.corner
        // Back to the caret's corner if the caret is resting at one; else none.
        const caret = v.hasFocus() ? cornerFor(v.state, options.locale?.()) : null
        if (caret && (!now || now.from !== caret.from || now.to !== caret.to)) show(v, caret)
        else if (!caret && now) v.dispatch(v.state.tr.setMeta(guideKey, { type: 'clearCorner' } satisfies GuideMeta).setMeta('addToHistory', false))
      }, hoverMs.leave)
    },
  }
  return new Plugin<GuideState>({
    key: guideKey,
    state: {
      init: () => ({ corner: null, preview: false, foldHint: null }),
      apply(tr: Transaction, value: GuideState, _old, newState): GuideState {
        const meta = tr.getMeta(guideKey) as GuideMeta | undefined
        let next = value
        // Any edit or caret move ends the corner (it comes back after the next rest).
        if ((tr.docChanged || tr.selectionSet) && next.corner && meta?.type !== 'corner') next = { ...next, corner: null, preview: false }
        // The writer's next edit ends the first-fold line.
        if (tr.docChanged && next.foldHint && !tr.getMeta(TR_LOAD)) next = { ...next, foldHint: null }
        if (meta?.type === 'corner') next = { ...next, corner: meta.corner, preview: false }
        else if (meta?.type === 'clearCorner') next = { ...next, corner: null, preview: false }
        else if (meta?.type === 'preview') next = next.corner ? { ...next, preview: meta.on } : next
        else if (meta?.type === 'foldHint') next = { ...next, foldHint: meta.foldId }
        else if (meta?.type === 'clearFoldHint') next = { ...next, foldHint: null }
        // Gone, or opened again: the line has done its work.
        if (next.foldHint && (foldHintAt(newState, next.foldHint) === null || getFoldView(newState).open.has(next.foldHint))) next = { ...next, foldHint: null }
        return next
      },
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | null = null
      const clear = () => { if (timer) { clearTimeout(timer); timer = null } }
      const arm = (v: EditorView) => {
        clear()
        const candidate = cornerFor(v.state, options.locale?.())
        if (!candidate) return
        timer = setTimeout(() => {
          timer = null
          // Never during an IME composition (CJK input, Android keyboards): a
          // decoration at the caret mid-composition can break the input.
          if (!options.enabled() || !v.editable || !v.hasFocus() || v.composing) return
          const now = cornerFor(v.state, options.locale?.())
          if (!now || now.from !== candidate.from || now.to !== candidate.to) return
          show(v, now)
        }, candidate.finished ? rest.finished : rest.unfinished)
      }
      arm(view)
      return {
        update(v, prev) {
          if (v.state.doc === prev.doc && v.state.selection.eq(prev.selection)) return
          arm(v)
        },
        destroy() {
          clear()
          if (hover.overTimer) clearTimeout(hover.overTimer)
          if (hover.leaveTimer) clearTimeout(hover.leaveTimer)
        },
      }
    },
    props: {
      handleDOMEvents: {
        // On a fine pointer the corner also comes where the pointer rests on
        // a written line: exploring with the mouse finds it without a pause
        // in the typing (the fresh-eyes test, 2026-10-22).
        mousemove(view, event) {
          if (!hover.fine || event.buttons !== 0) return false
          const target = event.target as HTMLElement | null
          if (target?.closest?.('[data-folio-corner]')) { hover.cancelLeave(); return false }
          const paraPos = paragraphAtPoint(view, event.clientX, event.clientY)
          if (paraPos === null) { hover.leave(view); return false }
          hover.over(view, paraPos)
          return false
        },
        mouseleave(view) {
          hover.leave(view)
          return false
        },
        compositionstart(view) {
          if (guideKey.getState(view.state)?.corner) view.dispatch(view.state.tr.setMeta(guideKey, { type: 'clearCorner' } satisfies GuideMeta).setMeta('addToHistory', false))
          return false
        },
        blur(view) {
          if (guideKey.getState(view.state)?.corner && hover.para === null) {
            queueMicrotask(() => {
              if (view.isDestroyed || view.hasFocus()) return
              view.dispatch(view.state.tr.setMeta(guideKey, { type: 'clearCorner' } satisfies GuideMeta).setMeta('addToHistory', false))
            })
          }
          return false
        },
      },
      decorations(state) {
        const g = guideKey.getState(state)
        if (!g || (!g.corner && !g.foldHint)) return null
        const decos: Decoration[] = []
        if (g.corner && options.enabled()) {
          const corner = g.corner
          const learned = options.learned()
          decos.push(Decoration.widget(corner.to, (view) => cornerButton(view, corner, learned, options, { enter: () => hover.cancelLeave(), leave: () => hover.leave(view) }), {
            side: 1,
            key: `corner:${corner.from}:${corner.to}:${learned ? 'l' : 'n'}`,
            ignoreSelection: true,
            stopEvent: () => true,
          }))
          if (g.preview) decos.push(Decoration.inline(corner.from, corner.to, { class: 'folio-corner-preview' }))
        }
        if (g.foldHint && options.enabled()) {
          // Beside the crease itself (after it: the crease is side 1), where
          // the eye already is and a finger can press it.
          const line = lineOf(state, g.foldHint)
          const foldId = g.foldHint
          if (line) {
            decos.push(Decoration.widget(line.to, (view) => foldHintLabel(view, foldId, options.labels().foldHint), {
              side: 2,
              key: `foldHint:${foldId}`,
              ignoreSelection: true,
              stopEvent: () => true,
            }))
          }
        }
        return DecorationSet.create(state.doc, decos)
      },
    },
  })
}

function cornerButton(view: EditorView, corner: Corner, learned: boolean, options: GuideOptions, pointer: { enter: () => void; leave: () => void }): HTMLElement {
  const labels = options.labels()
  // A zero-width anchor: the corner sits after the sentence without moving a
  // single character (the page never reflows when it comes and goes).
  const anchor = document.createElement('span')
  anchor.className = 'folio-corner-anchor'
  anchor.setAttribute('contenteditable', 'false')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'folio-corner'
  button.dataset.folioCorner = ''
  if (learned) button.dataset.learned = 'true'
  button.setAttribute('aria-label', labels.cornerLabel)
  const key = options.shortcut?.()
  button.title = key ? `${labels.cornerLabel} (${key})` : labels.cornerLabel
  const glyph = document.createElement('span')
  glyph.className = 'folio-corner__glyph'
  glyph.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  label.className = 'folio-corner__label'
  label.setAttribute('aria-hidden', 'true')
  label.textContent = labels.corner
  button.append(glyph, label)
  const preview = (on: boolean) => {
    if (view.isDestroyed) return
    const g = guideKey.getState(view.state)
    if (!g?.corner || g.preview === on) return
    view.dispatch(view.state.tr.setMeta(guideKey, { type: 'preview', on } satisfies GuideMeta).setMeta('addToHistory', false))
  }
  // The editor never sees events inside the corner (stopEvent), so the corner
  // tells the hover logic itself that the pointer is on it.
  button.addEventListener('mouseenter', () => { pointer.enter(); preview(true) })
  button.addEventListener('mouseleave', () => { preview(false); pointer.leave() })
  button.addEventListener('focus', () => preview(true))
  button.addEventListener('blur', () => preview(false))
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', (e) => {
    e.preventDefault()
    options.onLift(corner)
  })
  anchor.appendChild(button)
  // Where the words would run past the column, the corner goes alone; where
  // even the corner would leave the screen, it doesn't show on this line.
  requestAnimationFrame(() => {
    if (!anchor.isConnected) return
    // No room beside it: a writer still learning the corner gets its words
    // just under it; one who knows it gets the corner alone.
    const rect = button.getBoundingClientRect()
    if (rect.right > roomRight(view)) {
      button.dataset[learned ? 'tight' : 'below'] = 'true'
      // Under it, the words end on the screen even when a touch target runs past it.
      const over = label.getBoundingClientRect().right - (window.innerWidth - 8)
      if (!learned && over > 0) label.style.right = `${over}px`
    }
    // The visible corner must fit; a touch target may run past the edge.
    if (glyph.getBoundingClientRect().right > window.innerWidth - 4) anchor.style.display = 'none'
    else anchor.dataset.shown = 'true'
  })
  return anchor
}

/**
 * The first fold away's line, beside the crease: "folded here · open".
 * Pressing it opens the fold, as the crease does. Haloed in paper like the
 * crease's own hover label; below the line where the column ends.
 */
function foldHintLabel(view: EditorView, foldId: string, text: string): HTMLElement {
  const anchor = document.createElement('span')
  anchor.className = 'folio-corner-anchor folio-foldhint-anchor'
  anchor.setAttribute('contenteditable', 'false')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'folio-foldhint'
  button.dataset.folioFoldHint = ''
  button.textContent = text
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', (e) => {
    e.preventDefault()
    view.dispatch(view.state.tr.setMeta(foldViewKey, { type: 'open', ids: [foldId] } satisfies FoldViewMeta).setMeta('addToHistory', false))
  })
  anchor.appendChild(button)
  requestAnimationFrame(() => {
    if (!anchor.isConnected) return
    if (button.getBoundingClientRect().right > roomRight(view)) button.dataset.below = 'true'
    anchor.dataset.shown = 'true'
  })
  return anchor
}

/** How far right a corner's words may reach: into the page's margin, never off the screen. */
function roomRight(view: EditorView): number {
  return Math.min(view.dom.getBoundingClientRect().right + 24, window.innerWidth - 8)
}

/** Set or clear the first-fold line. */
export function foldHint(view: EditorView, foldId: string | null): void {
  view.dispatch(view.state.tr.setMeta(guideKey, (foldId ? { type: 'foldHint', foldId } : { type: 'clearFoldHint' }) satisfies GuideMeta).setMeta('addToHistory', false))
}
