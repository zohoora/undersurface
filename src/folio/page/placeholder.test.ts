import { afterEach, describe, expect, it } from 'vitest'
import { doc, makeEditor, p, u } from './testUtils'
import type { TestEditor } from './testUtils'

// The blank page's hint (draft 4 §3.12): only while the page is one empty
// paragraph, never in the document, never on an underside.

const HINT = 'Write anything. Select a line to lift it.'
let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

const hinted = (ed: TestEditor['editor']) =>
  [...ed.view.dom.querySelectorAll('[data-placeholder]')].map((el) => `${el.tagName.toLowerCase()}.${el.className}:${el.getAttribute('data-placeholder')}`)

describe('the blank page hint', () => {
  it('shows on a blank page and stays out of the document', () => {
    t = makeEditor(doc(p('')), { placeholder: HINT })
    expect(hinted(t.editor)).toEqual([`p.is-editor-empty:${HINT}`])
    expect(t.editor.getText()).toBe('')
    expect(JSON.stringify(t.editor.getJSON())).not.toContain('Write anything')
  })

  it('goes at the first character and comes back when the page is emptied', () => {
    t = makeEditor(doc(p('')), { placeholder: HINT })
    t.editor.commands.insertContent('W')
    expect(hinted(t.editor)).toEqual([])
    t.editor.commands.deleteRange({ from: 1, to: 2 })
    expect(hinted(t.editor)).toEqual([`p.is-editor-empty:${HINT}`])
  })

  it('stays away from a page with more than one paragraph or an underside', () => {
    t = makeEditor(doc(p(''), p('')), { placeholder: HINT })
    expect(hinted(t.editor)).toEqual([])
    t.destroy()
    t = makeEditor(doc(p('Line.', { pid: 'p1', fold: 'f1' }), u('f1', [p('')])), { placeholder: HINT })
    expect(hinted(t.editor)).toEqual([])
  })

  it('is absent when no hint is given (the harness, a kept composition)', () => {
    t = makeEditor(doc(p('')))
    expect(hinted(t.editor)).toEqual([])
  })
})
