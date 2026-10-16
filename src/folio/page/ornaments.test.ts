import { afterEach, describe, expect, it } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import { setOrnaments } from './folioCore'
import { ENGLISH_STRINGS } from './strings'
import { doc, makeEditor, p, posOf, setOpen, u } from './testUtils'
import type { TestEditor } from './testUtils'

// Step 6's art pass: the Journal's paragraph settle reaches into undersides,
// both ornaments follow their switches, and an empty between says "between".

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

// The writer's text only: the crease button is a widget inside the line.
const settled = (ed: TestEditor['editor']) =>
  [...ed.view.dom.querySelectorAll('.settled-paragraph')].map((el) => {
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('[contenteditable="false"]').forEach((w) => w.remove())
    return copy.textContent
  })

function caretIn(ed: TestEditor['editor'], text: string) {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, posOf(ed, text) + 1)))
}

describe('paragraph settle in Folio', () => {
  it('settles paragraphs beneath an open line, but not the one being written', () => {
    t = makeEditor(doc(
      p('Before.', { pid: 'p1' }),
      p('It was nice to see everyone.', { pid: 'p2', fold: 'f1' }),
      u('f1', [p('I felt absent the whole time.', { pid: 'p3' })]),
    ))
    setOpen(t.editor, ['f1'])
    caretIn(t.editor, 'Before.')
    expect(settled(t.editor)).toEqual(['It was nice to see everyone.', 'I felt absent the whole time.'])
    caretIn(t.editor, 'I felt absent')
    expect(settled(t.editor)).toEqual(['Before.', 'It was nice to see everyone.'])
  })

  it('turns off with its switch, and back on', () => {
    t = makeEditor(doc(p('One.', { pid: 'p1' }), p('Two.', { pid: 'p2' })))
    caretIn(t.editor, 'Two.')
    expect(settled(t.editor)).toEqual(['One.'])
    setOrnaments(t.editor, { ink: false, settle: false })
    expect(settled(t.editor)).toEqual([])
    expect(t.editor.storage.inkWeight?.disabled).toBe(true)
    setOrnaments(t.editor, { ink: true, settle: true })
    expect(settled(t.editor)).toEqual(['One.'])
    expect(t.editor.storage.inkWeight?.disabled).toBe(false)
  })
})

describe('the between hint', () => {
  const withBetween = (between: string) => doc(
    p('It was nice to see everyone.', { pid: 'p1', fold: 'f1' }),
    u('f1', [p('I felt absent.', { pid: 'p3' })], { between: [p(between, { pid: 'p2' })] }),
  )

  it('shows "between" in an empty, open between', () => {
    t = makeEditor(withBetween(''), { strings: () => ({ ...ENGLISH_STRINGS, betweenHint: 'zwischen' }) })
    expect(t.editor.view.dom.querySelector('.folio-between-empty')).toBeNull()
    setOpen(t.editor, ['f1'])
    const hint = t.editor.view.dom.querySelector('.folio-between-empty')
    expect(hint?.getAttribute('data-between-hint')).toBe('zwischen')
  })

  it('goes once there is writing between', () => {
    t = makeEditor(withBetween('The drive home.'))
    setOpen(t.editor, ['f1'])
    expect(t.editor.view.dom.querySelector('.folio-between-empty')).toBeNull()
  })
})

describe('an empty passage is bare paper', () => {
  const empties = (ed: TestEditor['editor']) =>
    [...ed.view.dom.querySelectorAll('.folio-passage-empty')].map((el) => el.hasAttribute('data-folio-between') ? 'between' : 'beneath')

  it('marks an open, empty beneath and between, and only while open', () => {
    t = makeEditor(doc(
      p('It was nice to see everyone.', { pid: 'p1', fold: 'f1' }),
      u('f1', [p('', { pid: 'p3' })], { between: [p('', { pid: 'p2' })] }),
    ))
    expect(empties(t.editor)).toEqual([])
    setOpen(t.editor, ['f1'])
    expect(empties(t.editor)).toEqual(['between', 'beneath'])
  })

  it('loses the mark at the first character', () => {
    t = makeEditor(doc(
      p('It was nice to see everyone.', { pid: 'p1', fold: 'f1' }),
      u('f1', [p('', { pid: 'p3' })]),
    ))
    setOpen(t.editor, ['f1'])
    expect(empties(t.editor)).toEqual(['beneath'])
    let at = -1
    t.editor.state.doc.descendants((node, pos) => { if (node.attrs.pid === 'p3') at = pos })
    t.editor.view.dispatch(t.editor.state.tr.insertText('I', at + 1))
    expect(empties(t.editor)).toEqual([])
  })
})
