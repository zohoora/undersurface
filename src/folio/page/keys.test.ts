import { afterEach, describe, expect, it } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import { doc, makeEditor, openIds, p, posOf, press, setOpen, topLevelTypes, u } from './testUtils'
import type { TestEditor } from './testUtils'

// S5's key table in jsdom (Mod is Control here). The browser matrix checks
// delivery in Chromium, WebKit and Firefox.

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

const caret = (ed: TestEditor['editor'], pos: number) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))

describe('folio keys', () => {
  it('Mod+Shift+Enter lifts the sentence at the caret, then opens and closes the fold from its line', () => {
    t = makeEditor(doc(p('One line here.', { pid: 'a' })))
    caret(t.editor, 4)
    press(t.editor, 'Enter', { ctrlKey: true, shiftKey: true })
    expect(topLevelTypes(t.editor)[1]).toMatch(/^u:/)
    expect(t.announcements).toContain('Lifted. Writing beneath.')
    const id = openIds(t.editor)[0]
    caret(t.editor, 3)
    press(t.editor, 'Enter', { ctrlKey: true, shiftKey: true })
    expect(openIds(t.editor)).not.toContain(id)
    caret(t.editor, 3)
    press(t.editor, 'Enter', { ctrlKey: true, shiftKey: true })
    expect(openIds(t.editor)).toContain(id)
  })

  it('Esc unlifts an empty fold and closes a written one, putting the caret on its line', () => {
    t = makeEditor(doc(p('Line.', { pid: 'a', fold: 'f1' }), u('f1', [p('', { pid: 'b' })]), p('Written.', { pid: 'c', fold: 'f2' }), u('f2', [p('Words.', { pid: 'd' })])))
    setOpen(t.editor, ['f1', 'f2'])
    caret(t.editor, posOf(t.editor, 'Words.'))
    press(t.editor, 'Escape')
    expect(openIds(t.editor)).not.toContain('f2')
    expect(t.editor.state.selection.$from.depth).toBe(1)
    caret(t.editor, 1 + 'Line.'.length + 1 + 3)
    press(t.editor, 'Escape')
    expect(topLevelTypes(t.editor)).not.toContain('u:f1')
  })

  it('Mod+Alt+] and [ set the distance and announce it; closer is refused while the between has words', () => {
    t = makeEditor(doc(p('Line.', { pid: 'a', fold: 'f1' }), u('f1', [p('Beneath.', { pid: 'b' })])))
    setOpen(t.editor, ['f1'])
    caret(t.editor, posOf(t.editor, 'Beneath.'))
    press(t.editor, ']', { ctrlKey: true, altKey: true })
    press(t.editor, ']', { ctrlKey: true, altKey: true })
    expect(t.editor.state.doc.child(1).attrs.gap).toBe(2)
    expect(t.announcements).toContain('Farther: apart, 3 of 5')
    press(t.editor, '[', { ctrlKey: true, altKey: true })
    expect(t.editor.state.doc.child(1).attrs.gap).toBe(1)
  })

  it('Mod+Alt+. and , move between lifted lines and announce them (the discovery path)', () => {
    t = makeEditor(doc(p('First lifted.', { pid: 'a', fold: 'f1' }), u('f1', [p('x', { pid: 'b' })]), p('Plain.', { pid: 'c' }), p('Second lifted.', { pid: 'd', fold: 'f2' }), u('f2', [p('y', { pid: 'e' })])))
    caret(t.editor, 1)
    press(t.editor, '.', { ctrlKey: true, altKey: true })
    expect(t.announcements.at(-1)).toBe("Writing beneath 'First lifted.', closed")
    press(t.editor, '.', { ctrlKey: true, altKey: true })
    expect(t.announcements.at(-1)).toBe("Writing beneath 'Second lifted.', closed")
    press(t.editor, ',', { ctrlKey: true, altKey: true })
    expect(t.announcements.at(-1)).toBe("Writing beneath 'First lifted.', closed")
  })
})
