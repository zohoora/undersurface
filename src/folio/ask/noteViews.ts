import type { FolioNote } from '../../types/folio'
import type { NoteRender, PendingNote } from './notes'

// The companion's notes as plain DOM inside the editor's widgets (H2): graphite,
// labelled "Companion", visually distinct from the writer's words. Spans only,
// since the widget sits inside the paragraph it answers.

export interface NoteLabels {
  label: string
  asking: string
  failed: string
  keep: string
  dismiss: string
  copy: string
  deleteNote: string
  talkNow: string
}

export interface NoteHandlers {
  keep: (pending: Extract<PendingNote, { status: 'note' }>) => void
  dismiss: () => void
  copy: (text: string) => void
  deleteNote: (id: string) => void
  /** Shore's door: shown on a grounded note while the page is in shore. */
  talkNow: (() => void) | null
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function action(label: string, onClick: () => void, ariaLabel?: string): HTMLButtonElement {
  const b = el('button', 'folio-button folio-button--inline folio-note__action', label)
  b.type = 'button'
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel)
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick() })
  return b
}

function shell(labels: NoteLabels, kind: string): { root: HTMLElement; body: HTMLElement; actions: HTMLElement } {
  const root = el('span', `folio-note folio-note--${kind}`)
  root.setAttribute('role', 'note')
  root.setAttribute('aria-label', labels.label)
  root.setAttribute('contenteditable', 'false')
  root.appendChild(el('span', 'folio-note__label', labels.label))
  const body = el('span', 'folio-note__text')
  root.appendChild(body)
  const actions = el('span', 'folio-note__actions')
  root.appendChild(actions)
  return { root, body, actions }
}

export function noteRender(labels: () => NoteLabels, handlers: () => NoteHandlers): NoteRender {
  return {
    kept(note: FolioNote) {
      const l = labels()
      const h = handlers()
      const { root, body, actions } = shell(l, 'kept')
      body.textContent = note.text
      actions.appendChild(action(l.copy, () => h.copy(note.text)))
      actions.appendChild(action(l.deleteNote, () => h.deleteNote(note.id)))
      return root
    },
    pending(p: PendingNote) {
      const l = labels()
      const h = handlers()
      const { root, body, actions } = shell(l, p.status)
      if (p.status === 'asking') {
        body.textContent = l.asking
        root.setAttribute('aria-busy', 'true')
        return root
      }
      if (p.status === 'failed') {
        body.textContent = l.failed
        actions.appendChild(action(l.dismiss, () => h.dismiss()))
        return root
      }
      body.textContent = p.text
      actions.appendChild(action(l.keep, () => h.keep(p)))
      actions.appendChild(action(l.copy, () => h.copy(p.text)))
      actions.appendChild(action(l.dismiss, () => h.dismiss()))
      if (p.grounded && h.talkNow) actions.appendChild(action(l.talkNow, () => h.talkNow?.()))
      return root
    },
  }
}
