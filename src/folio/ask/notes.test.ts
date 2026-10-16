import { afterEach, describe, expect, it } from 'vitest'
import { undo } from '@tiptap/pm/history'
import { doc, makeEditor, p, setOpen, u } from '../page/testUtils'
import type { TestEditor } from '../page/testUtils'
import { snapshotFold } from '../kept/keep'
import { NOTES_MAX, loadDoc, notesOf, withNote, withoutNote } from './notes'

// Companion notes (H2): stored with the page's words, so C2 saves and copies
// them; never undone as text; never part of a trace.

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

const note = (id: string, pid = 'p1') => ({ id, pid, text: `Note ${id}.`, createdAt: 1 })

describe('companion notes', () => {
  it('keep and delete a note; it travels in the page JSON and survives a load', () => {
    t = makeEditor(doc(p('A line.', { pid: 'p1' })))
    const ed = t.editor
    ed.view.dispatch(withNote(ed.state.tr, note('n1'))!)
    expect(notesOf(ed.state.doc)).toEqual([note('n1')])
    const saved = JSON.stringify(ed.getJSON())
    expect(JSON.parse(saved).attrs.folioNotes).toEqual([note('n1')])

    // A fresh load of the stored page brings its notes back.
    t.destroy()
    t = makeEditor(doc(p('Other.', { pid: 'x' })))
    t.editor.view.dispatch(loadDoc(t.editor.state.tr, t.editor.schema, saved))
    expect(notesOf(t.editor.state.doc)).toEqual([note('n1')])
    expect(t.editor.state.doc.textContent).toBe('A line.')

    t.editor.view.dispatch(withoutNote(t.editor.state.tr, 'n1'))
    expect(notesOf(t.editor.state.doc)).toEqual([])
  })

  it('undo never removes a kept note', () => {
    t = makeEditor(doc(p('A line.', { pid: 'p1' })))
    const ed = t.editor
    ed.commands.insertContentAt(8, ' More.')
    ed.view.dispatch(withNote(ed.state.tr, note('n1'))!)
    undo(ed.state, ed.view.dispatch)
    expect(ed.state.doc.textContent).toBe('A line.')
    expect(notesOf(ed.state.doc)).toHaveLength(1)
  })

  it('at most 50 per page', () => {
    t = makeEditor(doc(p('A line.', { pid: 'p1' })))
    const ed = t.editor
    for (let i = 0; i < NOTES_MAX; i++) ed.view.dispatch(withNote(ed.state.tr, note(`n${i}`))!)
    expect(withNote(ed.state.tr, note('one-more'))).toBeNull()
    expect(notesOf(ed.state.doc)).toHaveLength(NOTES_MAX)
  })

  it('a note on a beneath paragraph is never part of a kept snapshot', () => {
    t = makeEditor(doc(p('It was nice.', { pid: 'a', fold: 'f1' }), u('f1', [p('Beneath.', { pid: 'b' })])))
    setOpen(t.editor, ['f1'])
    t.editor.view.dispatch(withNote(t.editor.state.tr, note('n1', 'b'))!)
    const snapshot = snapshotFold(t.editor.state.doc, 'f1')
    expect(JSON.stringify(snapshot?.composition)).not.toContain('Note n1')
  })

  it('malformed stored notes are ignored', () => {
    t = makeEditor(doc(p('A line.', { pid: 'p1' })))
    t.editor.view.dispatch(t.editor.state.tr.setDocAttribute('folioNotes', [{ nope: 1 }, note('ok')]))
    expect(notesOf(t.editor.state.doc)).toEqual([note('ok')])
  })
})
