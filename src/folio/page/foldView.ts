import { Plugin, PluginKey, NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'
import { BETWEEN, FOLD, GAP_LINE_HEIGHTS, MAX_GAP, UNDERSIDE, foldRange, undersides } from './schema'
import type { Gap } from './schema'
import type { FolioStrings } from './strings'

// C1 layer 1 (draft 4 §5.1): open/closed is view state, never document state.
// A closed underside renders as an empty, zero-height, non-editable
// placeholder with no contentDOM, so its text is not in the DOM at all. A
// selection never rests inside one (I8). Fences (K2) live here too.

export const foldViewKey = new PluginKey<FoldViewState>('folioFoldView')

export const FENCE_MS = 600
export const FENCE_MAX_MS = 3000

export interface Fence {
  /** When the fence was raised (protection event). */
  at: number
  /** The key that caused it, held until keyup; null when not key-driven. */
  key: string | null
  keyReleased: boolean
}

export interface FoldViewState {
  open: ReadonlySet<string>
  fences: ReadonlyMap<string, Fence>
}

export type FoldViewMeta =
  | { type: 'open'; ids: string[]; fence?: { key: string | null; at: number } }
  | { type: 'close'; ids: string[] }
  | { type: 'toggle'; id: string }
  | { type: 'keyup'; key: string }
  | { type: 'liftFences' }
  | { type: 'load'; open: string[] }

export const TR_VISIBLE_EDIT = 'folio:visibleEdit'
export const TR_LOAD = 'folio:load'
export const TR_INTEGRITY = 'folio:integrity'
export const TR_RESTORE = 'folio:restore'

export function getFoldView(state: EditorState): FoldViewState {
  return foldViewKey.getState(state) ?? { open: new Set(), fences: new Map() }
}

export function isOpen(state: EditorState, foldId: string | null): boolean {
  return !!foldId && getFoldView(state).open.has(foldId)
}

/** Closed undersides in `doc`, given the open set: `[pos, end)` ranges. */
export function closedRanges(doc: PMNode, open: ReadonlySet<string>): { foldId: string; from: number; to: number; node: PMNode }[] {
  return undersides(doc)
    .filter((u) => !u.foldId || !open.has(u.foldId))
    .map((u) => ({ foldId: u.foldId ?? '', from: u.pos, to: u.pos + u.node.nodeSize, node: u.node }))
}

export function fenceActive(fence: Fence | undefined, now: number): boolean {
  if (!fence) return false
  const age = now - fence.at
  if (age >= FENCE_MAX_MS) return false
  if (age < FENCE_MS) return true
  return fence.key !== null && !fence.keyReleased
}

function applyMeta(value: FoldViewState, meta: FoldViewMeta | undefined, doc: PMNode): FoldViewState {
  if (!meta) return value
  const open = new Set(value.open)
  const fences = new Map(value.fences)
  switch (meta.type) {
    case 'open':
      for (const id of meta.ids) {
        open.add(id)
        if (meta.fence) fences.set(id, { at: meta.fence.at, key: meta.fence.key, keyReleased: meta.fence.key === null })
      }
      break
    case 'close':
      for (const id of meta.ids) { open.delete(id); fences.delete(id) }
      break
    case 'toggle':
      if (open.has(meta.id)) { open.delete(meta.id); fences.delete(meta.id) } else open.add(meta.id)
      break
    case 'keyup':
      for (const [id, f] of fences) if (f.key === meta.key) fences.set(id, { ...f, keyReleased: true })
      break
    case 'liftFences':
      fences.clear()
      break
    case 'load': {
      const present = new Set(undersides(doc).map((u) => u.foldId).filter((id): id is string => !!id))
      open.clear()
      for (const id of meta.open) if (present.has(id)) open.add(id)
      fences.clear()
      break
    }
  }
  return { open, fences }
}

/** Nearest text position outside every closed underside, searching in `dir`. */
export function nearestOutside(doc: PMNode, pos: number, dir: -1 | 1, closed: { from: number; to: number }[]): Selection | null {
  let probe = pos
  for (let guard = 0; guard < 1000; guard++) {
    const found = Selection.findFrom(doc.resolve(Math.max(0, Math.min(probe, doc.content.size))), dir, true)
    if (!found) return null
    const inside = closed.find((r) => found.from > r.from && found.from < r.to)
    if (!inside) return found
    probe = dir > 0 ? inside.to : inside.from
  }
  return null
}

function selectionInsideClosed(sel: Selection, closed: { from: number; to: number }[]): { from: number; to: number } | null {
  if (sel instanceof NodeSelection && sel.node.type.name === UNDERSIDE) return null
  for (const r of closed) {
    const headIn = sel.head > r.from && sel.head < r.to
    const anchorIn = sel.anchor > r.from && sel.anchor < r.to
    if (headIn || anchorIn) return r
  }
  return null
}

export interface FoldViewOptions {
  strings: () => FolioStrings
  onAnnounce?: (message: string) => void
}

export function foldViewPlugin(options: FoldViewOptions): Plugin<FoldViewState> {
  return new Plugin<FoldViewState>({
    key: foldViewKey,
    // A fold just folded away is marked for a moment, so its sheet can be seen
    // going under the line (folio.css, folio-tuck); folds closed by a load never are.
    view: () => ({
      update(view, prev) {
        const before = getFoldView(prev).open
        const now = getFoldView(view.state).open
        if (before === now || before.size === 0) return
        for (const id of before) {
          if (now.has(id)) continue
          const el = view.dom.querySelector(`.folio-underside--closed[data-fold-id="${CSS.escape(id)}"]`) as HTMLElement | null
          if (!el) continue
          el.dataset.tucking = 'true'
          setTimeout(() => { delete el.dataset.tucking }, 700)
        }
      },
    }),
    state: {
      init: () => ({ open: new Set(), fences: new Map() }),
      apply(tr, value, _old, newState) {
        let next = value
        if (tr.docChanged && value.open.size > 0) {
          // Drop ids whose underside no longer exists.
          const present = new Set(undersides(newState.doc).map((u) => u.foldId))
          if ([...value.open].some((id) => !present.has(id))) {
            next = { open: new Set([...value.open].filter((id) => present.has(id))), fences: new Map([...value.fences].filter(([id]) => present.has(id))) }
          }
        }
        return applyMeta(next, tr.getMeta(foldViewKey) as FoldViewMeta | undefined, newState.doc)
      },
    },
    // I8: a selection that ends inside a closed underside is moved out before
    // the next key can be read.
    appendTransaction(trs, oldState, newState) {
      if (!trs.some((tr) => tr.selectionSet || tr.docChanged || tr.getMeta(foldViewKey))) return null
      const closed = closedRanges(newState.doc, getFoldView(newState).open)
      const inside = selectionInsideClosed(newState.selection, closed)
      if (!inside) return null
      const dir: -1 | 1 = oldState.selection.head <= inside.from ? -1 : 1
      const tr = newState.tr
      const target = nearestOutside(newState.doc, dir < 0 ? inside.from : inside.to, dir, closed)
        ?? nearestOutside(newState.doc, dir < 0 ? inside.to : inside.from, dir < 0 ? 1 : -1, closed)
      tr.setSelection(target ?? NodeSelection.create(newState.doc, inside.from))
      return tr.setMeta('addToHistory', false)
    },
    props: {
      decorations(state) {
        const { open } = getFoldView(state)
        const decos: Decoration[] = []
        const strings = options.strings()
        state.doc.forEach((node, offset) => {
          if (node.type.name === UNDERSIDE) {
            const id = node.attrs.foldId as string | null
            if (id && open.has(id)) {
              decos.push(Decoration.node(offset, offset + node.nodeSize, {}, { folioOpen: true }))
              // An empty passage is bare paper: its wash, a line-shaped blur
              // with nothing on it, reads as text hidden from the writer.
              node.forEach((passage, at) => {
                if (passage.textContent !== '') return
                const from = offset + 1 + at
                decos.push(Decoration.node(from, from + passage.nodeSize, { class: 'folio-passage-empty' }))
              })
              // An empty between invites writing: "write between them" (§3.6;
              // the plain verb since 2026-10-22).
              const first = node.firstChild
              if (first?.type.name === BETWEEN && first.textContent === '' && first.childCount === 1) {
                const pPos = offset + 2
                const para = first.firstChild
                if (para) decos.push(Decoration.node(pPos, pPos + para.nodeSize, { class: 'folio-between-empty', 'data-between-hint': strings.betweenHint }))
              }
            }
            return
          }
          if (node.type.name !== 'paragraph') return
          const seen = new Set<string>()
          node.forEach((child) => {
            for (const mark of child.marks) {
              if (mark.type.name !== FOLD) continue
              const id = mark.attrs.foldId as string | null
              if (!id || seen.has(id)) continue
              seen.add(id)
              const range = foldRange(node, offset, id)
              if (!range) continue
              const isOpenNow = open.has(id)
              // A closed fold's line: the sheet beneath seen faintly through
              // the paper (2026-10-22, with Fable): something is under here.
              if (!isOpenNow) decos.push(Decoration.inline(range.from, range.to, { class: 'folio-fold--closed' }))
              decos.push(Decoration.widget(range.to, (view) => creaseButton(view, id, isOpenNow, strings), {
                side: 1,
                key: `crease:${id}:${isOpenNow ? 'o' : 'c'}`,
                ignoreSelection: true,
                stopEvent: () => true,
              }))
            }
          })
        })
        return DecorationSet.create(state.doc, decos)
      },
    },
  })
}

function creaseButton(view: EditorView, foldId: string, open: boolean, strings: FolioStrings): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `folio-crease${open ? ' folio-crease--open' : ''}`
  button.setAttribute('contenteditable', 'false')
  button.dataset.foldId = foldId
  button.setAttribute('aria-expanded', open ? 'true' : 'false')
  button.setAttribute('aria-label', open ? strings.closeBeneath : strings.openBeneath)
  // On hover and focus the crease says what it does: "open", "fold away".
  if (strings.creaseOpen && strings.creaseClose) button.dataset.hint = open ? strings.creaseClose : strings.creaseOpen
  // A plain glyph as the fallback; folio.css hides it and draws a dog-ear
  // instead. The label carries the meaning either way.
  const glyph = document.createElement('span')
  glyph.className = 'folio-crease__glyph'
  glyph.setAttribute('aria-hidden', 'true')
  glyph.textContent = '⌟'
  button.appendChild(glyph)
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', (e) => {
    e.preventDefault()
    view.dispatch(view.state.tr.setMeta(foldViewKey, { type: 'toggle', id: foldId } satisfies FoldViewMeta).setMeta('addToHistory', false))
  })
  return button
}

export function toggleFold(state: EditorState, foldId: string): Transaction {
  return state.tr.setMeta(foldViewKey, { type: 'toggle', id: foldId } satisfies FoldViewMeta).setMeta('addToHistory', false)
}

export function openFolds(tr: Transaction, ids: string[], fence?: { key: string | null; at: number }): Transaction {
  return tr.setMeta(foldViewKey, { type: 'open', ids, fence } satisfies FoldViewMeta)
}

/**
 * Dragging the beneath's corner (2026-10-22, draft 4 §3.6: "dragging the
 * beneath's edge… snaps to the stops and is never the only way"). The host
 * runs Apart one stop at a time and announces where the drag ended.
 */
export interface GripOptions {
  /** The distance switch. */
  enabled: () => boolean
  label: () => string
  /** One stop closer (-1) or farther (+1); false when it can't go further. */
  step: (view: EditorView, foldId: string, dir: -1 | 1) => boolean
  /** The drag ended at `gap` (unchanged when equal to `from`). */
  done?: (view: EditorView, foldId: string, gap: Gap, from: Gap) => void
}

/** The stop nearest a distance of `lines` line-heights. */
export function nearestStop(lines: number): Gap {
  let best: Gap = 0
  for (let k = 0; k <= MAX_GAP; k++) {
    if (Math.abs(GAP_LINE_HEIGHTS[k as Gap] - lines) < Math.abs(GAP_LINE_HEIGHTS[best] - lines)) best = k as Gap
  }
  return best
}

/** The underside node view: a contentless placeholder when closed, the full
 *  composition with its controls when open. Switching recreates the view. */
export function undersideNodeView(options: {
  strings: () => FolioStrings
  controls?: (args: { view: EditorView; getPos: () => number | undefined; node: PMNode }) => HTMLElement | null
  grip?: GripOptions
}) {
  // The controls are rebuilt only when what they show changes (empty or
  // written, loose or not), so focus stays on a button pressed repeatedly.
  return (node: PMNode, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[]): NodeView => {
    const open = decorations.some((d) => (d.spec as { folioOpen?: boolean }).folioOpen)
    return open ? new OpenUndersideView(node, view, getPos, options) : new ClosedUndersideView(node)
  }
}

class ClosedUndersideView implements NodeView {
  dom: HTMLElement
  private node: PMNode

  constructor(node: PMNode) {
    this.node = node
    this.dom = document.createElement('div')
    this.dom.className = 'folio-underside folio-underside--closed'
    this.dom.setAttribute('contenteditable', 'false')
    this.dom.setAttribute('aria-hidden', 'true')
    this.dom.dataset.foldId = String(node.attrs.foldId ?? '')
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    if (decorations.some((d) => (d.spec as { folioOpen?: boolean }).folioOpen)) return false
    this.node = node
    this.dom.dataset.foldId = String(node.attrs.foldId ?? '')
    return true
  }

  selectNode() { this.dom.classList.add('ProseMirror-selectednode') }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode') }
  ignoreMutation() { return true }
  stopEvent() { return false }
}

class OpenUndersideView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private controls: HTMLElement | null
  private fromLabel: HTMLElement | null = null
  private grip: HTMLElement | null = null
  private resize: ResizeObserver | null = null
  private node: PMNode
  private readonly strings: () => FolioStrings
  private readonly view: EditorView
  private readonly getPos: () => number | undefined
  private readonly makeControls?: (args: { view: EditorView; getPos: () => number | undefined; node: PMNode }) => HTMLElement | null

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    options: { strings: () => FolioStrings; controls?: (args: { view: EditorView; getPos: () => number | undefined; node: PMNode }) => HTMLElement | null; grip?: GripOptions },
  ) {
    this.node = node
    this.strings = options.strings
    this.view = view
    this.getPos = getPos
    this.makeControls = options.controls
    this.dom = document.createElement('div')
    this.dom.className = 'folio-underside folio-underside--open'
    this.dom.setAttribute('role', 'group')
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'folio-underside__content'
    this.dom.appendChild(this.contentDOM)
    this.controls = options.controls?.({ view, getPos, node }) ?? null
    if (this.controls) {
      this.controls.setAttribute('contenteditable', 'false')
      this.dom.appendChild(this.controls)
    }
    if (options.grip?.enabled() && !node.attrs.loose) this.makeGrip(options.grip)
    this.render()
  }

  /**
   * The beneath's corner, where the fold's edge meets it: drag it down to move
   * apart, up to move closer, snapping to the five stops. A pointer aid only
   * (aria-hidden, not focusable): the buttons and keys do the same.
   */
  private makeGrip(grip: GripOptions) {
    const el = document.createElement('div')
    el.className = 'folio-grip'
    el.setAttribute('contenteditable', 'false')
    el.setAttribute('aria-hidden', 'true')
    el.dataset.folioGrip = ''
    el.title = grip.label()
    el.addEventListener('mousedown', (e) => e.preventDefault())
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const foldId = String(this.node.attrs.foldId ?? '')
      if (!foldId) return
      try { el.setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
      const startY = e.clientY
      const from = (this.node.attrs.gap ?? 0) as Gap
      const lh = parseFloat(getComputedStyle(this.contentDOM).lineHeight) || 30
      let at: Gap = from
      el.dataset.dragging = 'true'
      // The five stops as hairlines on the fold's edge, fixed where the drag
      // began: where it will snap.
      const stops = document.createElement('div')
      stops.className = 'folio-grip-stops'
      stops.setAttribute('aria-hidden', 'true')
      const top0 = parseFloat(el.style.top || '0')
      for (let k = 0; k <= MAX_GAP; k++) {
        const tick = document.createElement('span')
        tick.style.top = `${top0 + (GAP_LINE_HEIGHTS[k as Gap] - GAP_LINE_HEIGHTS[from]) * lh}px`
        stops.appendChild(tick)
      }
      this.dom.appendChild(stops)
      const move = (ev: PointerEvent) => {
        const target = nearestStop(GAP_LINE_HEIGHTS[from] + (ev.clientY - startY) / lh)
        while (at < target && grip.step(this.view, foldId, 1)) at = (at + 1) as Gap
        while (at > target && grip.step(this.view, foldId, -1)) at = (at - 1) as Gap
      }
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        delete el.dataset.dragging
        stops.remove()
        grip.done?.(this.view, foldId, at, from)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    })
    this.grip = el
    this.dom.appendChild(el)
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.placeGrip())
      this.resize.observe(this.contentDOM)
    }
    requestAnimationFrame(() => this.placeGrip())
  }

  /** The grip follows the beneath's top edge (the distance and the between move it). */
  private placeGrip() {
    if (!this.grip) return
    const beneath = this.contentDOM.querySelector(':scope > [data-folio-beneath]') as HTMLElement | null
    if (!beneath) return
    this.grip.style.top = `${beneath.offsetTop + this.contentDOM.offsetTop}px`
  }

  destroy() {
    this.resize?.disconnect()
    this.resize = null
  }

  private render() {
    const gap = (this.node.attrs.gap ?? 0) as Gap
    const hasBetween = this.node.firstChild?.type.name === BETWEEN
    this.dom.dataset.foldId = String(this.node.attrs.foldId ?? '')
    this.dom.dataset.gap = String(gap)
    this.dom.dataset.loose = this.node.attrs.loose ? 'true' : 'false'
    this.dom.style.setProperty('--folio-gap-lines', String(GAP_LINE_HEIGHTS[gap] ?? 0))
    this.dom.toggleAttribute('data-has-between', hasBetween)
    const s = this.strings()
    const line = String(this.node.attrs.surfaceSnapshot ?? '')
    this.dom.setAttribute('aria-label', s.undersideLabel(line, gap))
    // Lifted from a kept thing: "from 14 Oct" (draft 4 §3.8).
    const keptAt = this.node.attrs.fromKeptAt as number | null
    if (keptAt) {
      if (!this.fromLabel) {
        this.fromLabel = document.createElement('div')
        this.fromLabel.className = 'folio-underside__from'
        this.fromLabel.setAttribute('contenteditable', 'false')
        this.dom.insertBefore(this.fromLabel, this.contentDOM)
      }
      this.fromLabel.textContent = s.fromDate(keptAt)
    } else if (this.fromLabel) {
      this.fromLabel.remove()
      this.fromLabel = null
    }
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    if (!decorations.some((d) => (d.spec as { folioOpen?: boolean }).folioOpen)) return false
    const before = controlsSignature(this.node)
    this.node = node
    this.render()
    if (this.makeControls && controlsSignature(node) !== before) {
      const next = this.makeControls({ view: this.view, getPos: this.getPos, node })
      if (next) next.setAttribute('contenteditable', 'false')
      if (this.controls && next) this.dom.replaceChild(next, this.controls)
      else if (next) this.dom.appendChild(next)
      else this.controls?.remove()
      this.controls = next
    } else {
      // Within one signature the controls adjust in place (Move closer
      // appears once apart), so focus stays on a button pressed repeatedly.
      (this.controls as (HTMLElement & { folioSync?: (n: PMNode) => void }) | null)?.folioSync?.(node)
    }
    this.placeGrip()
    return true
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false
    return !this.contentDOM.contains(mutation.target as globalThis.Node)
  }

  stopEvent(event: Event): boolean {
    const target = event.target as globalThis.Node
    return (!!this.controls && this.controls.contains(target)) || (!!this.grip && this.grip.contains(target))
  }
}

function controlsSignature(node: PMNode): string {
  return `${node.textContent.trim() === '' ? 'empty' : 'written'}:${node.attrs.loose ? 'loose' : 'held'}`
}

export function setSelectionOutside(tr: Transaction, pos: number, dir: -1 | 1, open: ReadonlySet<string>): Transaction {
  const closed = closedRanges(tr.doc, open)
  const target = nearestOutside(tr.doc, pos, dir, closed) ?? nearestOutside(tr.doc, pos, dir < 0 ? 1 : -1, closed)
  if (target) tr.setSelection(target)
  else tr.setSelection(TextSelection.create(tr.doc, Math.min(pos, tr.doc.content.size)))
  return tr
}
