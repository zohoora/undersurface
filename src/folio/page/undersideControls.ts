import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import { BENEATH, BETWEEN, FOLD, MAX_GAP } from './schema'
import { TR_VISIBLE_EDIT, toggleFold } from './foldView'
import { apart, isEmptyUnderside, unlift } from './commands'
import type { Gap } from './schema'

// The open underside's controls (draft 4 §3.5, §3.6; plain labels ordered by
// use, 2026-10-22, with Fable): an empty fold offers only Cancel (Unlift),
// quietly, so the page never opens by offering to undo itself; a written one
// Fold away (Close) in ink, Keep a copy, Read it alone (Step inside), and at the far end Move
// apart and Move closer, both always there (disabled at the ends, so the row
// never jumps). Each says what it does in its tooltip. For a loose underside:
// Keep it here, Turn into page text, Remove. Plain DOM inside the node view
// (non-editable), so they never enter the document and keyboard focus reaches
// them in reading order.

export interface ControlLabels {
  close: string
  unlift: string
  closer: string
  farther: string
  looseTitle: string
  looseKeep: string
  looseToPage: string
  looseRemove: string
  /** Phase 2; absent hides Keep. */
  keep?: string
  /** H1; absent hides Step inside. */
  stepInside?: string
  /** What each does, as tooltips (absent: none). */
  tips?: { close: string; farther: string; closer: string; keep: string; stepInside: string }
}

export interface ControlDeps {
  labels: () => ControlLabels
  switches: () => { between: boolean; distance: boolean }
  onAnnounce?: (message: string) => void
  announceGap?: (dir: -1 | 1, gap: Gap) => string
  closerBlocked?: () => string
  unlifted?: () => string
  /** Hidden for the rest of this visit after "Keep it here". */
  looseAcknowledged: Set<string>
  /** Keep (draft 4 §3.7): snapshot this fold. Shown only when something is written. */
  onKeep?: (foldId: string) => void
  /** Step inside (H1). Shown only when something is written; hidden in Shore and Quiet by CSS. */
  onStepInside?: (foldId: string) => void
}

function button(label: string, onClick: () => void, tip?: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'folio-button'
  b.textContent = label
  if (tip) b.title = tip
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', (e) => { e.preventDefault(); onClick() })
  return b
}

function current(view: EditorView, getPos: () => number | undefined): { node: PMNode; pos: number } | null {
  const pos = getPos()
  if (pos === undefined) return null
  const node = view.state.doc.nodeAt(pos)
  return node ? { node, pos } : null
}

export function undersideControls(deps: ControlDeps) {
  return ({ view, getPos, node }: { view: EditorView; getPos: () => number | undefined; node: PMNode }): HTMLElement => {
    const labels = deps.labels()
    const foldId = String(node.attrs.foldId ?? '')
    const wrap = document.createElement('div')
    wrap.className = 'folio-underside__controls'

    if (node.attrs.loose && !deps.looseAcknowledged.has(foldId)) {
      const title = document.createElement('span')
      title.className = 'folio-line'
      title.style.margin = '0 auto 0 0'
      title.style.padding = '0'
      title.textContent = labels.looseTitle
      wrap.appendChild(title)
      wrap.appendChild(button(labels.looseKeep, () => {
        deps.looseAcknowledged.add(foldId)
        title.remove()
        for (const b of [...wrap.querySelectorAll('[data-loose-action]')]) b.remove()
      }))
      const toPage = button(labels.looseToPage, () => {
        const c = current(view, getPos)
        if (!c) return
        const paragraphs: PMNode[] = []
        c.node.forEach((passage) => {
          if (passage.type.name === BETWEEN || passage.type.name === BENEATH) passage.forEach((p) => paragraphs.push(p))
        })
        const tr = view.state.tr.setMeta(TR_VISIBLE_EDIT, true)
        tr.replaceWith(c.pos, c.pos + c.node.nodeSize, Fragment.from(paragraphs))
        view.dispatch(tr.scrollIntoView())
      })
      toPage.dataset.looseAction = 'toPage'
      wrap.appendChild(toPage)
      const remove = button(labels.looseRemove, () => {
        const c = current(view, getPos)
        if (!c) return
        view.dispatch(view.state.tr.setMeta(TR_VISIBLE_EDIT, true).delete(c.pos, c.pos + c.node.nodeSize).scrollIntoView())
      })
      remove.dataset.looseAction = 'remove'
      wrap.appendChild(remove)
      return wrap
    }

    const empty = isEmptyUnderside(node)
    const tips = labels.tips
    const first = button(empty ? labels.unlift : labels.close, () => {
      const c = current(view, getPos)
      if (!c) return
      if (isEmptyUnderside(c.node)) {
        const r = unlift(view.state, foldId)
        if (r.ok) { view.dispatch(r.tr); deps.onAnnounce?.(deps.unlifted?.() ?? '') }
        return
      }
      view.dispatch(toggleFold(view.state, foldId))
      // Put the caret back on the lifted line.
      let target: number | null = null
      view.state.doc.forEach((p, offset) => {
        if (target !== null || p.type.name !== 'paragraph') return
        p.forEach((child, childOffset) => {
          if (child.marks.some((m) => m.type.name === FOLD && m.attrs.foldId === foldId)) target = offset + 1 + childOffset + child.nodeSize
        })
      })
      if (target !== null) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)).setMeta('addToHistory', false))
      view.focus()
    }, empty ? undefined : tips?.close)
    if (empty) {
      // Nothing written yet: only the way back, quiet and out of the way.
      first.dataset.folioUnlift = ''
      wrap.dataset.empty = 'true'
      wrap.appendChild(first)
      return wrap
    }
    first.dataset.folioPrimary = 'close'
    wrap.appendChild(first)

    if (deps.onKeep && labels.keep) {
      const keep = button(labels.keep, () => deps.onKeep?.(foldId), tips?.keep)
      keep.dataset.folioKeep = ''
      wrap.appendChild(keep)
    }
    if (deps.onStepInside && labels.stepInside) {
      const inside = button(labels.stepInside, () => deps.onStepInside?.(foldId), tips?.stepInside)
      inside.dataset.folioStepInside = ''
      wrap.appendChild(inside)
    }

    let farther: HTMLButtonElement | null = null
    let closer: HTMLButtonElement | null = null
    if (deps.switches().distance) {
      const step = (dir: -1 | 1) => () => {
        const r = apart(view.state, foldId, dir, deps.switches())
        if (!r.ok) {
          if (r.reason === 'blocked' && dir < 0) deps.onAnnounce?.(deps.closerBlocked?.() ?? '')
          return
        }
        view.dispatch(r.tr)
        if (deps.announceGap) deps.onAnnounce?.(deps.announceGap(dir, r.gap as Gap))
      }
      farther = button(labels.farther, step(1), tips?.farther)
      farther.dataset.folioApart = 'farther'
      closer = button(labels.closer, step(-1), tips?.closer)
      closer.dataset.folioApart = 'closer'
      wrap.appendChild(farther)
      wrap.appendChild(closer)
    }

    // At the ends of the five stops a button is disabled, not removed: the
    // row never jumps, and focus stays where it was (aria-disabled keeps it
    // focusable; pressing it does nothing).
    const sync = (n: PMNode) => {
      const gap = Number(n.attrs.gap ?? 0) as Gap
      closer?.setAttribute('aria-disabled', gap <= 0 ? 'true' : 'false')
      farther?.setAttribute('aria-disabled', gap >= MAX_GAP ? 'true' : 'false')
    }
    sync(node)
    ;(wrap as HTMLElement & { folioSync?: (n: PMNode) => void }).folioSync = sync
    return wrap
  }
}
