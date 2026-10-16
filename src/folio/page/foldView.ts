import { Plugin, PluginKey, NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'
import { BETWEEN, FOLD, GAP_LINE_HEIGHTS, UNDERSIDE, foldRange, undersides } from './schema'
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
            if (id && open.has(id)) decos.push(Decoration.node(offset, offset + node.nodeSize, {}, { folioOpen: true }))
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
  button.textContent = '⌟'
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

/** The underside node view: a contentless placeholder when closed, the full
 *  composition with its controls when open. Switching recreates the view. */
export function undersideNodeView(options: {
  strings: () => FolioStrings
  controls?: (args: { view: EditorView; getPos: () => number | undefined; node: PMNode }) => HTMLElement | null
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
  private node: PMNode
  private readonly strings: () => FolioStrings
  private readonly view: EditorView
  private readonly getPos: () => number | undefined
  private readonly makeControls?: (args: { view: EditorView; getPos: () => number | undefined; node: PMNode }) => HTMLElement | null

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    options: { strings: () => FolioStrings; controls?: (args: { view: EditorView; getPos: () => number | undefined; node: PMNode }) => HTMLElement | null },
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
    this.render()
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
    }
    return true
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false
    return !this.contentDOM.contains(mutation.target as globalThis.Node)
  }

  stopEvent(event: Event): boolean {
    return !!this.controls && this.controls.contains(event.target as globalThis.Node)
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
