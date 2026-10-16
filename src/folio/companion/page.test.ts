import { afterEach, describe, expect, it } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import type { JSONContent } from '@tiptap/core'
import { doc, makeEditor, p, posOf, setOpen, u } from '../page/testUtils'
import type { TestEditor } from '../page/testUtils'
import { readingOrderUnits } from '../safety/samples'
import { traceUnits } from '../kept/keep'
import { getFoldView } from '../page/foldView'
import { COMPANION_TEXT, TR_COMPANION, writerText } from './companionText'
import { OPENING, dispatchPresence, presence, sentenceRange } from './presence'
import { arrivalLift, arrivalOpening, closeFold, companionLift } from './acts'

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

const companion = (text: string, kind = 'between'): JSONContent => ({ type: 'text', text, marks: [{ type: COMPANION_TEXT, attrs: { kind, original: text } }] })
const para = (pid: string, ...content: JSONContent[]): JSONContent => ({ type: 'paragraph', attrs: { pid }, content })
const SW = { between: true, distance: true }

function companionRuns(ed: TestEditor['editor']): string[] {
  const out: string[] = []
  ed.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === COMPANION_TEXT)) out.push(n.text ?? '') })
  return out
}

describe('ghosts and marks', () => {
  it('a ghost shows in its empty paragraph, never enters the document, and goes at the first character', () => {
    t = makeEditor(doc(p('Line.', { pid: 'p1', fold: 'f1' }), u('f1', [p('', { pid: 'b1' })])))
    setOpen(t.editor, ['f1'])
    dispatchPresence(t.editor.view, { type: 'ghost', pid: 'b1', text: 'What was on the other side?' })
    const ghost = t.editor.view.dom.querySelector('p.folio-ghost')
    expect(ghost?.getAttribute('data-ghost')).toBe('What was on the other side?')
    expect(JSON.stringify(t.editor.getJSON())).not.toContain('other side')
    const at = (() => { let x = 0; t!.editor.state.doc.descendants((n, pos) => { if (n.attrs.pid === 'b1') x = pos + 1 }); return x })()
    t.editor.view.dispatch(t.editor.state.tr.insertText('H', at))
    expect(t.editor.view.dom.querySelector('p.folio-ghost')).toBeNull()
    expect(presence(t.editor.state).ghosts.size).toBe(0)
  })

  it('the opening ghost sits on a blank page only', () => {
    t = makeEditor(doc(p('', { pid: 'p1' })))
    dispatchPresence(t.editor.view, { type: 'ghost', pid: OPENING, text: 'What did today sound like?' })
    expect(t.editor.view.dom.querySelector('p.folio-ghost')?.getAttribute('data-ghost')).toBe('What did today sound like?')
    t.editor.commands.insertContent('W')
    expect(t.editor.view.dom.querySelector('p.folio-ghost')).toBeNull()
  })

  it('a mark points at an unlifted sentence; it goes when the sentence changes or is lifted', () => {
    t = makeEditor(doc(p('We drove back late. I kept checking the mirror.', { pid: 'p1' })))
    dispatchPresence(t.editor.view, { type: 'mark', pid: 'p1', sentence: 'I kept checking the mirror.' })
    expect(t.editor.view.dom.querySelector('.folio-marked')?.textContent).toBe('I kept checking the mirror.')
    expect(t.editor.view.dom.querySelector('button.folio-mark')).not.toBeNull()
    t.editor.view.dispatch(t.editor.state.tr.insertText('X', posOf(t.editor, 'mirror')))
    expect(presence(t.editor.state).mark).toBeNull()
  })

  it('clearAll removes every ghost and the mark at once (the gate closed)', () => {
    t = makeEditor(doc(p('One sentence here.', { pid: 'p1' }), p('', { pid: 'p2' })))
    dispatchPresence(t.editor.view, { type: 'mark', pid: 'p1', sentence: 'One sentence here.' })
    dispatchPresence(t.editor.view, { type: 'ghost', pid: 'p2', text: 'Q?' })
    dispatchPresence(t.editor.view, { type: 'clearAll' })
    expect(presence(t.editor.state)).toEqual({ ghosts: new Map(), mark: null })
    expect(t.editor.view.dom.querySelector('.folio-ghost, .folio-marked')).toBeNull()
  })
})

describe('the companion\'s words', () => {
  it('a writer\'s edit inside them makes the whole run the writer\'s', () => {
    t = makeEditor(doc(para('p1', companion('The dashboard clock, a minute fast.'))))
    t.editor.view.dispatch(t.editor.state.tr.insertText('X', posOf(t.editor, 'clock')))
    expect(companionRuns(t.editor)).toEqual([])
    expect(t.editor.state.doc.textContent).toBe('The dashboard Xclock, a minute fast.')
  })

  it('continuing after them keeps them the companion\'s (a starter, continued)', () => {
    t = makeEditor(doc(para('p1', companion('On her side it was'))))
    const end = 1 + 'On her side it was'.length
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, end)))
    t.editor.commands.insertContent(' freezing.')
    expect(companionRuns(t.editor)).toEqual(['On her side it was'])
    expect(writerText(t.editor.state.doc.firstChild!)).toBe(' freezing.')
  })

  it('deleting inside them takes them over; the companion\'s own edits never do', () => {
    t = makeEditor(doc(para('p1', companion('A minute fast.'))))
    const at = posOf(t.editor, 'minute')
    t.editor.view.dispatch(t.editor.state.tr.delete(at, at + 2))
    expect(companionRuns(t.editor)).toEqual([])
    t.destroy()
    t = makeEditor(doc(para('p1', companion('A minute fast.'))))
    t.editor.view.dispatch(t.editor.state.tr.insertText('!', posOf(t.editor, 'fast')).setMeta(TR_COMPANION, true))
    expect(companionRuns(t.editor).join('')).toContain('!fast')
  })

  it('the checks skip what only the companion wrote, and read whole what the writer finished', () => {
    t = makeEditor(doc(
      p('The heater only worked on one side.', { pid: 'p1', fold: 'f1' }),
      u('f1', [para('b1', companion('On her side it was', 'starter'), { type: 'text', text: ' freezing.' }), para('b2', companion('An unanswered starter', 'starter'))], { between: [para('w1', companion('Warm air, then the window.'))], gap: 1 }),
    ))
    const units = readingOrderUnits(t.editor.state.doc)
    // The between and the untouched starter are the companion's alone; the
    // finished sentence is read whole, the companion's half included.
    expect(units.map((x) => [x.pid, x.text])).toEqual([['p1', 'The heater only worked on one side.'], ['b1', 'On her side it was freezing.']])
    const composition = JSON.stringify({ v: 1, line: [{ type: 'text', text: 'The heater only worked on one side.' }], gap: 1, between: [para('w1', companion('Warm air, then the window.'))], beneath: [para('b1', companion('On her side it was', 'starter'), { type: 'text', text: ' freezing.' })] })
    const tu = traceUnits({ id: 't1', surface: 'The heater only worked on one side.', composition })
    expect(tu.map((x) => [x.pid, x.text])).toEqual([['t1:beneath', 'On her side it was freezing.']])
  })

  it('marked text that no longer matches what the companion wrote is the writer\'s, however it got there', () => {
    // As an Android keyboard or an IME can leave it: the writer's words inside the span.
    const changed: JSONContent = { type: 'text', text: 'Warm air, then the window. I want to die', marks: [{ type: COMPANION_TEXT, attrs: { kind: 'between', original: 'Warm air, then the window.' } }] }
    t = makeEditor(doc(p('Line.', { pid: 'p1', fold: 'f1' }), u('f1', [p('x', { pid: 'b0' })], { between: [para('w1', changed)], gap: 1 })))
    expect(readingOrderUnits(t.editor.state.doc).find((x) => x.pid === 'w1')?.text).toBe('Warm air, then the window. I want to die')
  })

  it('a trace without companion text keeps the same units as before', () => {
    const composition = JSON.stringify({ v: 1, line: [{ type: 'text', text: 'L' }], gap: 0, between: null, beneath: [para('b1', { type: 'text', text: 'One.' }), { type: 'paragraph' }, para('b2', { type: 'text', text: 'Two.' })] })
    expect(traceUnits({ id: 't1', surface: 'L', composition })[0].text).toBe('One.\n\n\n\nTwo.')
  })
})

describe('the companion\'s words, however the change arrives', () => {
  it('writer text that arrives inside the span (a DOM-read change) takes the run over', () => {
    t = makeEditor(doc(para('p1', companion('On her side it was', 'starter'))))
    const s = t.editor.state
    const end = 1 + 'On her side it was'.length
    // As readDOMChange delivers it: the typed text carries the span's mark.
    const typed = s.schema.text(' cold', [s.schema.marks[COMPANION_TEXT].create({ kind: 'starter', original: 'On her side it was' })])
    t.editor.view.dispatch(s.tr.replaceWith(end, end, typed))
    expect(companionRuns(t.editor)).toEqual([])
    expect(readingOrderUnits(t.editor.state.doc)[0].text).toBe('On her side it was cold')
  })

  const companionUnderside = (beneath: JSONContent[], between?: JSONContent[]): JSONContent => {
    const node = u('f1', beneath, between ? { between, gap: 1 } : {})
    return { ...node, attrs: { ...node.attrs, liftedBy: 'companion', surfaceSnapshot: 'Lifted by it.' } }
  }
  const deleteLine = (ed: TestEditor['editor']) => {
    const at = posOf(ed, 'Lifted by it.')
    ed.view.dispatch(ed.state.tr.delete(at, at + 'Lifted by it.'.length))
  }

  it('a companion-lifted underside with nothing of the writer\'s goes when its line is deleted', () => {
    t = makeEditor(doc(p('Keep this. Lifted by it.', { pid: 'p1', fold: 'f1', foldFrom: 11 }), companionUnderside([p('', { pid: 'b1' })], [para('w1', companion('A line of its own.'))])))
    setOpen(t.editor, ['f1'])
    deleteLine(t.editor)
    let undersides = 0
    t.editor.state.doc.forEach((n) => { if (n.type.name === 'underside') undersides++ })
    expect(undersides).toBe(0)
  })

  it('one with the writer\'s words stays (loose, as any underside would)', () => {
    t = makeEditor(doc(p('Keep this. Lifted by it.', { pid: 'p1', fold: 'f1', foldFrom: 11 }), companionUnderside([p('Mine.', { pid: 'b1' })])))
    setOpen(t.editor, ['f1'])
    deleteLine(t.editor)
    let undersides = 0
    t.editor.state.doc.forEach((n) => { if (n.type.name === 'underside') undersides++ })
    expect(undersides).toBe(1)
  })

  it('the clipboard never carries the companion\'s mark', async () => {
    const { visibleSlice } = await import('../page/protect')
    t = makeEditor(doc(para('p1', companion('Warm air, then the window.'))))
    const slice = t.editor.state.doc.slice(1, 1 + 'Warm air'.length)
    let marked = false
    visibleSlice(slice, null, false).content.descendants((n) => { if (n.marks.some((m) => m.type.name === COMPANION_TEXT)) marked = true })
    expect(marked).toBe(false)
  })
})

describe('the companion\'s acts', () => {
  it('a companion lift opens the fold without moving the caret, with a distance and its between', () => {
    t = makeEditor(doc(p('We drove back late. I kept checking the mirror.', { pid: 'p1' }), p('Now writing here.', { pid: 'p2' })))
    const caret = posOf(t.editor, 'here')
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, caret)))
    const r = companionLift(t.editor.state, { pid: 'p1', sentence: 'I kept checking the mirror.', gap: 2, between: 'The rear window, dark.', switches: SW })
    expect(r).not.toBeNull()
    t.editor.view.dispatch(r!.tr)
    expect(t.editor.state.selection.$from.parent.attrs.pid).toBe('p2')
    expect(getFoldView(t.editor.state).open.has(r!.foldId)).toBe(true)
    const und = t.editor.state.doc.child(1)
    expect(und.attrs).toMatchObject({ gap: 2, liftedBy: 'companion', surfaceSnapshot: 'I kept checking the mirror.' })
    expect(companionRuns(t.editor)).toEqual(['The rear window, dark.'])
    expect(t.diagnostics).toEqual([])
  })

  it('a stale offer is dropped: the sentence changed, or is already lifted', () => {
    t = makeEditor(doc(p('Short one. Lifted one.', { pid: 'p1', fold: 'f1', foldFrom: 11 }), u('f1', [p('x', { pid: 'b1' })])))
    expect(companionLift(t.editor.state, { pid: 'p1', sentence: 'Gone sentence.', switches: SW })).toBeNull()
    expect(companionLift(t.editor.state, { pid: 'p1', sentence: 'Lifted one.', switches: SW })).toBeNull()
    expect(sentenceRange(t.editor.state.doc, 'p1', 'Short one.')).not.toBeNull()
  })

  it('without the distance switch a companion lift stays touching', () => {
    t = makeEditor(doc(p('One. Two.', { pid: 'p1' })))
    const r = companionLift(t.editor.state, { pid: 'p1', sentence: 'Two.', gap: 3, between: 'b', switches: { between: true, distance: false } })
    t.editor.view.dispatch(r!.tr)
    expect(t.editor.state.doc.child(1).attrs.gap).toBe(0)
    expect(companionRuns(t.editor)).toEqual([])
  })

  it('arrival lifts a line from the last page, the between and a starter the caret continues', () => {
    t = makeEditor(doc(p('', { pid: 'p0' })))
    const r = arrivalLift(t.editor.state, { sentence: 'The heater only worked on one side.', gap: 1, between: 'Warm air, then the window.', starter: 'On her side it was', fromPageId: 'page-0', fromAt: 1_792_000_000_000, switches: SW })
    t.editor.view.dispatch(r!.tr)
    expect(companionRuns(t.editor)).toEqual(['Warm air, then the window.', 'On her side it was'])
    expect(t.editor.state.doc.child(1).attrs).toMatchObject({ fromPageId: 'page-0', fromKeptAt: 1_792_000_000_000, liftedBy: 'companion' })
    t.editor.commands.insertContent('freezing.')
    const beneath = readingOrderUnits(t.editor.state.doc).find((x) => x.kind === 'beneath')
    expect(beneath?.text).toBe('On her side it was freezing.')
    expect(companionRuns(t.editor)).toEqual(['Warm air, then the window.', 'On her side it was'])
  })

  it('arrival never writes over a page that has words', () => {
    t = makeEditor(doc(p('Already here.', { pid: 'p0' })))
    expect(arrivalLift(t.editor.state, { sentence: 'x', gap: 0, between: '', starter: '', fromPageId: 'a', fromAt: 1, switches: SW })).toBeNull()
    expect(arrivalOpening(t.editor.state, 'What did today sound like?')).toBeNull()
  })

  it('an opening line is the companion\'s; the caret waits on the next line', () => {
    t = makeEditor(doc(p('', { pid: 'p0' })))
    t.editor.view.dispatch(arrivalOpening(t.editor.state, 'What did the morning keep?')!)
    expect(companionRuns(t.editor)).toEqual(['What did the morning keep?'])
    expect(t.editor.state.selection.$from.parent.textContent).toBe('')
    expect(readingOrderUnits(t.editor.state.doc)).toEqual([])
  })

  it('closing keeps the words; only the view changes', () => {
    t = makeEditor(doc(p('Line.', { pid: 'p1', fold: 'f1' }), u('f1', [p('Beneath.', { pid: 'b1' })])))
    setOpen(t.editor, ['f1'])
    const before = JSON.stringify(t.editor.getJSON())
    t.editor.view.dispatch(closeFold(t.editor.state, 'f1'))
    expect(getFoldView(t.editor.state).open.has('f1')).toBe(false)
    expect(JSON.stringify(t.editor.getJSON())).toBe(before)
  })
})
