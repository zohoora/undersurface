import { afterEach, describe, expect, it, vi } from 'vitest'
import { doc, makeEditor, p } from '../page/testUtils'
import type { TestEditor } from '../page/testUtils'
import { noteRender } from './noteViews'
import type { NoteHandlers } from './noteViews'
import { notesKey, withNote } from './notes'

// H2: the note is labelled, distinct, and offers exactly its actions.

const LABELS = { label: 'Companion', asking: 'Asking…', failed: "Couldn't ask right now.", keep: 'Keep', dismiss: 'Dismiss', copy: 'Copy', deleteNote: 'Delete note', talkNow: 'Talk now' }

function handlers(over: Partial<NoteHandlers> = {}): NoteHandlers {
  return { keep: vi.fn(), dismiss: vi.fn(), copy: vi.fn(), deleteNote: vi.fn(), talkNow: null, ...over }
}
const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')].map((b) => b.textContent)

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

describe('note views', () => {
  it('a pending note is labelled "Companion" and offers Keep, Copy, Dismiss', () => {
    const h = handlers()
    const el = noteRender(() => LABELS, () => h).pending({ pid: 'p', status: 'note', text: 'A cold soup.', grounded: false })
    expect(el.getAttribute('role')).toBe('note')
    expect(el.getAttribute('aria-label')).toBe('Companion')
    expect(el.getAttribute('contenteditable')).toBe('false')
    expect(el.textContent).toContain('A cold soup.')
    expect(buttons(el)).toEqual(['Keep', 'Copy', 'Dismiss'])
    ;(el.querySelectorAll('button')[0] as HTMLButtonElement).click()
    expect(h.keep).toHaveBeenCalledWith({ pid: 'p', status: 'note', text: 'A cold soup.', grounded: false })
  })

  it('a grounded note in shore offers the shore door', () => {
    const talk = vi.fn()
    const el = noteRender(() => LABELS, () => handlers({ talkNow: talk })).pending({ pid: 'p', status: 'note', text: 'Steady.', grounded: true })
    expect(buttons(el)).toEqual(['Keep', 'Copy', 'Dismiss', 'Talk now'])
    ;(el.querySelectorAll('button')[3] as HTMLButtonElement).click()
    expect(talk).toHaveBeenCalled()
  })

  it('asking shows no actions; a failure offers Dismiss only; a kept note offers Copy and Delete', () => {
    const r = noteRender(() => LABELS, () => handlers())
    expect(buttons(r.pending({ pid: 'p', status: 'asking' }))).toEqual([])
    expect(buttons(r.pending({ pid: 'p', status: 'failed' }))).toEqual(['Dismiss'])
    expect(buttons(r.kept({ id: 'n', pid: 'p', text: 'Kept.', createdAt: 1 }))).toEqual(['Copy', 'Delete note'])
  })

  it('kept notes sit beside their paragraph; a note whose paragraph is gone sits at the end', () => {
    t = makeEditor(doc(p('First.', { pid: 'a' }), p('Second.', { pid: 'b' })), { notes: () => noteRender(() => LABELS, () => handlers()) })
    const ed = t.editor
    ed.view.dispatch(withNote(ed.state.tr, { id: 'n1', pid: 'a', text: 'About the first.', createdAt: 1 })!)
    ed.view.dispatch(withNote(ed.state.tr, { id: 'n2', pid: 'gone', text: 'Loose.', createdAt: 1 })!)
    const paras = ed.view.dom.querySelectorAll('p')
    expect(paras[0].querySelector('.folio-note')?.textContent).toContain('About the first.')
    expect(paras[1].querySelector('.folio-note')).toBeNull()
    expect((ed.view.dom.lastElementChild as HTMLElement).textContent).toContain('Loose.')
    ed.view.dispatch(ed.state.tr.setMeta(notesKey, { pending: { pid: 'b', status: 'asking' } }))
    expect(paras[1].querySelector('.folio-note--asking')).not.toBeNull()
    // The editor's text never includes the notes.
    expect(ed.state.doc.textContent).toBe('First.Second.')
  })
})
