import Document from '@tiptap/extension-document'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { FolioNote } from '../../types/folio'

// Companion notes (H2, Ask). A kept note is stored with the page, labelled as
// the companion's, beside the paragraph it answers. It lives on the page's
// document as an attribute, so it's saved, conflict-copied and recovered by
// C2 exactly like the words. It's never part of a trace (Keep snapshots the
// composition only) and never undoable text. A pending note is shown, unsaved,
// until the writer keeps or dismisses it.

export const NOTES_MAX = 50
export const NOTES_ATTR = 'folioNotes'

/** The document node, with a place for kept notes. */
export const FolioDocument = Document.extend({
  addAttributes() {
    return { [NOTES_ATTR]: { default: null, rendered: false } }
  },
})

export function notesOf(doc: PMNode): FolioNote[] {
  const v = doc.attrs[NOTES_ATTR] as unknown
  return Array.isArray(v) ? (v as FolioNote[]).filter((n) => n && typeof n.text === 'string' && typeof n.pid === 'string') : []
}

export function withNote(tr: Transaction, note: FolioNote): Transaction | null {
  const notes = notesOf(tr.doc)
  if (notes.length >= NOTES_MAX) return null
  return tr.setDocAttribute(NOTES_ATTR, [...notes, note]).setMeta('addToHistory', false)
}

export function withoutNote(tr: Transaction, id: string): Transaction {
  return tr.setDocAttribute(NOTES_ATTR, notesOf(tr.doc).filter((n) => n.id !== id)).setMeta('addToHistory', false)
}

/** Replace the editor's content with a stored page's, its notes included. */
export function loadDoc(tr: Transaction, schema: Schema, json: string): Transaction {
  const node = schema.nodeFromJSON(JSON.parse(json))
  tr.replaceWith(0, tr.doc.content.size, node.content)
  return tr.setDocAttribute(NOTES_ATTR, node.attrs[NOTES_ATTR] ?? null)
}

// ------------------------------------------------------------ display

export type PendingNote =
  | { pid: string; status: 'asking' }
  | { pid: string; status: 'note'; text: string; grounded: boolean }
  | { pid: string; status: 'failed' }

export type NotesMeta = { pending: PendingNote | null }

export const notesKey = new PluginKey<{ pending: PendingNote | null }>('folioNotes')

export interface NoteRender {
  /** A kept note, beside its paragraph (or at the end if the paragraph is gone). */
  kept: (note: FolioNote) => HTMLElement
  pending: (note: PendingNote) => HTMLElement
}

/** Where a paragraph with this pid ends (inside it), or null. */
function paragraphEnd(doc: PMNode, pid: string): number | null {
  let at: number | null = null
  doc.descendants((node, pos) => {
    if (at !== null) return false
    if (node.type.name === 'paragraph') {
      if (node.attrs.pid === pid) at = pos + node.nodeSize - 1
      return false
    }
    return true
  })
  return at
}

export function notesPlugin(render: () => NoteRender | null): Plugin {
  return new Plugin({
    key: notesKey,
    state: {
      init: () => ({ pending: null as PendingNote | null }),
      apply(tr, value) {
        const meta = tr.getMeta(notesKey) as NotesMeta | undefined
        return meta ? { pending: meta.pending } : value
      },
    },
    props: {
      decorations(state) {
        const r = render()
        if (!r) return null
        const { doc } = state
        const decos: Decoration[] = []
        const loose: FolioNote[] = []
        for (const note of notesOf(doc)) {
          const at = paragraphEnd(doc, note.pid)
          if (at === null) { loose.push(note); continue }
          decos.push(Decoration.widget(at, () => r.kept(note), { side: 1, key: `note:${note.id}`, ignoreSelection: true, stopEvent: () => true }))
        }
        // Notes whose paragraph is gone stay visible, at the end of the page.
        loose.forEach((note) => {
          decos.push(Decoration.widget(doc.content.size, () => r.kept(note), { side: 1, key: `note:${note.id}`, ignoreSelection: true, stopEvent: () => true }))
        })
        const pending = notesKey.getState(state)?.pending
        if (pending) {
          const at = paragraphEnd(doc, pending.pid)
          if (at !== null) {
            const key = pending.status === 'note' ? `pending:${pending.pid}:${pending.text.length}` : `pending:${pending.pid}:${pending.status}`
            decos.push(Decoration.widget(at, () => r.pending(pending), { side: 1, key, ignoreSelection: true, stopEvent: () => true }))
          }
        }
        return decos.length > 0 ? DecorationSet.create(doc, decos) : null
      },
    },
  })
}
