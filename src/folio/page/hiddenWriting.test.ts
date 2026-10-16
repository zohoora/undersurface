import { afterEach, describe, expect, it } from 'vitest'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { undo, undoDepth } from '@tiptap/pm/history'
import { Slice, Fragment } from '@tiptap/pm/model'
import { TR_LOAD } from './foldView'
import { lift, unlift, apart } from './commands'
import { doc, keyup, makeEditor, openIds, p, posOf, press, setOpen, topLevelTypes, u, undersideText } from './testUtils'
import type { TestEditor } from './testUtils'

// C1 (draft 4 §5.1): every row of the table, K1–K4 and the invariants, at the
// state and jsdom-view level. Real browsers, IME and devices are the
// Playwright matrix and the owner's checklist.

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

const DINNER = () => doc(
  p('Before.', { pid: 'p1' }),
  p('It was nice to see everyone.', { pid: 'p2', fold: 'f1' }),
  u('f1', [p('I felt absent the whole time.', { pid: 'p3' })]),
  p('After.', { pid: 'p4' }),
)

function caretAt(editor: TestEditor['editor'], pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

describe('layer 1: closed undersides keep no text in the DOM', () => {
  it('renders a closed underside as an empty placeholder and an open one with its text', () => {
    t = makeEditor(DINNER())
    const dom = t.editor.view.dom
    expect(dom.textContent).not.toContain('I felt absent')
    expect(dom.querySelector('.folio-underside--closed')?.getAttribute('contenteditable')).toBe('false')
    setOpen(t.editor, ['f1'])
    expect(dom.textContent).toContain('I felt absent')
    setOpen(t.editor, ['f1'], false)
    expect(dom.textContent).not.toContain('I felt absent')
  })

  it('opening and closing change neither the document nor the undo history', () => {
    t = makeEditor(DINNER())
    const before = t.editor.state.doc
    const depth = undoDepth(t.editor.state)
    setOpen(t.editor, ['f1'])
    setOpen(t.editor, ['f1'], false)
    expect(t.editor.state.doc.eq(before)).toBe(true)
    expect(undoDepth(t.editor.state)).toBe(depth)
  })

  it('shows a crease button with an accessible name and toggles on click', () => {
    t = makeEditor(DINNER())
    const crease = t.editor.view.dom.querySelector<HTMLButtonElement>('button.folio-crease')
    expect(crease?.getAttribute('aria-label')).toBe('Open writing beneath')
    crease?.click()
    expect(openIds(t.editor)).toEqual(['f1'])
  })

  it('I8: a selection placed inside a closed underside is moved out', () => {
    t = makeEditor(DINNER())
    const inside = posOf(t.editor, 'I felt') + 2
    caretAt(t.editor, inside)
    const sel = t.editor.state.selection
    const closedFrom = t.editor.state.doc.resolve(posOf(t.editor, 'After.')).before(1) - t.editor.state.doc.child(2).nodeSize
    const closedTo = closedFrom + t.editor.state.doc.child(2).nodeSize
    expect(sel.from <= closedFrom || sel.from >= closedTo).toBe(true)
  })
})

describe('lift, unlift and Apart', () => {
  it('lifts the selection, opens the underside and puts the caret in the beneath, as one undo step', () => {
    t = makeEditor(doc(p('We drove back late. The heater only worked on one side.', { pid: 'a' })))
    const from = posOf(t.editor, 'The heater')
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, from, from + 'The heater only worked on one side.'.length)))
    const r = lift(t.editor.state, { now: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    t.editor.view.dispatch(r.tr)
    // StarterKit's trailing node keeps a paragraph after a final underside, so there's always somewhere to write.
    expect(topLevelTypes(t.editor)).toEqual(['p:We drove back late. The heater only worked on one side.', `u:${r.foldId}`, 'p:'])
    expect(openIds(t.editor)).toContain(r.foldId)
    expect(t.editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(t.editor.state.selection.$from.node(2).type.name).toBe('beneath')
    undo(t.editor.state, t.editor.view.dispatch)
    expect(topLevelTypes(t.editor)).toEqual(['p:We drove back late. The heater only worked on one side.'])
  })

  it('lifts the sentence around the caret when nothing is selected', () => {
    t = makeEditor(doc(p('First one. Second one here. Third.', { pid: 'a' })))
    caretAt(t.editor, posOf(t.editor, 'one here') + 1)
    const r = lift(t.editor.state)
    expect(r.ok && r.tr.doc.nodeAt(1) !== null).toBe(true)
    if (!r.ok) return
    t.editor.view.dispatch(r.tr)
    const marked: string[] = []
    t.editor.state.doc.child(0).forEach((n) => { if (n.marks.some((m) => m.type.name === 'fold')) marked.push(n.text ?? '') })
    expect(marked.join('')).toBe('Second one here.')
  })

  it('refuses to lift a line that already has something beneath it', () => {
    t = makeEditor(DINNER())
    const from = posOf(t.editor, 'nice')
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, from, from + 4)))
    const r = lift(t.editor.state)
    expect(r).toEqual({ ok: false, reason: 'alreadyLifted' })
  })

  it('unlifts only an empty fold, removing the mark and the underside together', () => {
    t = makeEditor(doc(p('Line.', { pid: 'a', fold: 'f9' }), u('f9', [p('', { pid: 'b' })])))
    const r = unlift(t.editor.state, 'f9')
    expect(r.ok).toBe(true)
    if (r.ok) t.editor.view.dispatch(r.tr)
    expect(topLevelTypes(t.editor)).toEqual(['p:Line.'])
    t = makeEditor(DINNER())
    expect(unlift(t.editor.state, 'f1')).toEqual({ ok: false, reason: 'notEmpty' })
  })

  it('Apart adds a between from stop 1 and never moves closer than "close" while it has text', () => {
    t = makeEditor(DINNER())
    setOpen(t.editor, ['f1'])
    const r1 = apart(t.editor.state, 'f1', 1, { between: true, distance: true })
    expect(r1.ok).toBe(true)
    if (r1.ok) t.editor.view.dispatch(r1.tr)
    const us = t.editor.state.doc.child(2)
    expect(us.attrs.gap).toBe(1)
    expect(us.firstChild?.type.name).toBe('between')
    // write in the between, then try to close to touching
    const betweenPara = t.editor.state.doc.resolve(0).posAtIndex(2) + 3
    t.editor.view.dispatch(t.editor.state.tr.insertText('bread', betweenPara))
    expect(apart(t.editor.state, 'f1', -1, { between: true, distance: true })).toEqual({ ok: false, reason: 'blocked' })
  })
})

describe('Backspace and Delete at an underside (K1, B4)', () => {
  it('first press selects the closed underside; a held key never deletes it; a fresh press opens it', () => {
    t = makeEditor(DINNER())
    caretAt(t.editor, posOf(t.editor, 'After.'))
    expect(press(t.editor, 'Backspace')).toBe(true)
    expect(t.editor.state.selection).toBeInstanceOf(NodeSelection)
    press(t.editor, 'Backspace', { repeat: true })
    expect(t.editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
    press(t.editor, 'Backspace')
    expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
    expect(openIds(t.editor)).toContain('f1')
    expect(t.protectedIds.flat()).toContain('f1')
  })

  it('B4: Backspace in an empty paragraph after a closed fold selects it; typing never reaches the hidden beneath', () => {
    t = makeEditor(doc(p('It was nice.', { pid: 'a', fold: 'f1' }), u('f1', [p('Hidden words.', { pid: 'b' })]), p('', { pid: 'c' })))
    const end = t.editor.state.doc.content.size - 1
    caretAt(t.editor, end)
    press(t.editor, 'Backspace')
    expect(t.editor.state.selection).toBeInstanceOf(NodeSelection)
    expect((t.editor.state.selection as NodeSelection).node.attrs.foldId).toBe('f1')
    t.editor.view.someProp('handleTextInput', (f) => f(t!.editor.view, t!.editor.state.selection.from, t!.editor.state.selection.to, 'x', () => t!.editor.state.tr))
    expect(undersideText(t.editor, 'f1')).toBe('Hidden words.')
  })

  it('Delete at the end of a lifted line selects the underside first', () => {
    t = makeEditor(DINNER())
    caretAt(t.editor, posOf(t.editor, 'everyone.') + 'everyone.'.length)
    press(t.editor, 'Delete')
    expect(t.editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
  })

  it('K4: word and control deletion bindings follow the same rules', () => {
    for (const init of [{ altKey: true }, { metaKey: true }, { ctrlKey: true, key: 'h' }]) {
      t?.destroy()
      t = makeEditor(DINNER())
      caretAt(t.editor, posOf(t.editor, 'After.'))
      const key = (init as { key?: string }).key ?? 'Backspace'
      press(t.editor, key, init)
      expect(t.editor.state.selection).toBeInstanceOf(NodeSelection)
      press(t.editor, key, { ...init, repeat: true })
      expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
    }
  })

  it('Backspace at the start of a beneath moves to the between and deletes nothing; repeat does nothing', () => {
    t = makeEditor(doc(
      p('Line.', { pid: 'a', fold: 'f1' }),
      u('f1', [p('Beneath text.', { pid: 'c' })], { between: [p('Between text.', { pid: 'b' })] }),
    ))
    setOpen(t.editor, ['f1'])
    const before = t.editor.state.doc
    caretAt(t.editor, posOf(t.editor, 'Beneath text.'))
    press(t.editor, 'Backspace', { repeat: true })
    expect(t.editor.state.doc.eq(before)).toBe(true)
    press(t.editor, 'Backspace')
    expect(t.editor.state.doc.eq(before)).toBe(true)
    expect(t.editor.state.selection.$from.node(2).type.name).toBe('between')
  })
})

describe('deleting across closed folds', () => {
  it('keeps a closed underside when a selection across it is deleted, opened and loose', () => {
    t = makeEditor(DINNER())
    const from = posOf(t.editor, 'Before.')
    const to = posOf(t.editor, 'After.') + 3
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, from, to)))
    press(t.editor, 'Backspace')
    expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
    expect(openIds(t.editor)).toContain('f1')
    expect(topLevelTypes(t.editor)).toContain('u:f1:loose')
    expect(t.editor.view.dom.textContent).toContain('er.')
    expect(t.diagnostics).not.toContain('folio.hidden.restored') // layer 2 did it, not the net
  })

  it('typing over a selection that holds a closed fold replaces only the visible text', () => {
    t = makeEditor(DINNER())
    const from = posOf(t.editor, 'everyone.') + 2
    const to = posOf(t.editor, 'After.') + 2
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, from, to)))
    t.editor.view.someProp('handleTextInput', (f) => f(t!.editor.view, from, to, 'Z', () => t!.editor.state.tr))
    expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
    expect(t.editor.state.doc.textContent).toContain('evZter.')
    expect(t.diagnostics).not.toContain('folio.hidden.restored')
  })

  it('native Cut across a closed fold keeps it and copies only visible text', () => {
    t = makeEditor(DINNER())
    const from = posOf(t.editor, 'Before.')
    const to = posOf(t.editor, 'After.') + 6
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, from, to)))
    const store: Record<string, string> = {}
    const event = new Event('cut', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { clearData: () => {}, setData: (k: string, v: string) => { store[k] = v } } })
    t.editor.view.dom.dispatchEvent(event)
    expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
    expect(store['text/plain']).toContain('It was nice')
    expect(store['text/plain']).not.toContain('I felt absent')
    expect(t.diagnostics).not.toContain('folio.hidden.restored')
  })

  it('copy leaves out closed undersides and unwraps open ones; paste never creates folds', () => {
    t = makeEditor(DINNER())
    const all = t.editor.state.doc.content
    const closedText = t.editor.view.serializeForClipboard(new Slice(all, 0, 0)).text
    expect(closedText).not.toContain('I felt absent')
    setOpen(t.editor, ['f1'])
    const openText = t.editor.view.serializeForClipboard(new Slice(t.editor.state.doc.content, 0, 0)).text
    expect(openText).toContain('I felt absent')
    const pasted = t.editor.view.someProp('transformPasted', (f) => f(new Slice(Fragment.from(t!.editor.state.doc.child(2)), 0, 0), t!.editor.view))
    let hasUnderside = false
    pasted?.content.forEach((n) => { if (n.type.name === 'underside') hasUnderside = true })
    expect(hasUnderside).toBe(false)
  })
})

describe('layer 3: the history guard', () => {
  it('refuses an undo that would change a closed underside, opens it, and the next undo applies', async () => {
    t = makeEditor(DINNER())
    setOpen(t.editor, ['f1'])
    const original = t.editor.state.doc
    t.editor.view.dispatch(t.editor.state.tr.insertText(' Really.', posOf(t.editor, 'time.') + 5))
    setOpen(t.editor, ['f1'], false)
    const depth = undoDepth(t.editor.state)
    undo(t.editor.state, t.editor.view.dispatch)
    expect(undoDepth(t.editor.state)).toBe(depth)
    expect(undersideText(t.editor, 'f1')).toContain('Really.')
    await Promise.resolve()
    expect(openIds(t.editor)).toContain('f1')
    expect(t.announcements).toContain('Opened writing beneath a line. Undo again to change it.')
    undo(t.editor.state, t.editor.view.dispatch)
    expect(t.editor.state.doc.eq(original)).toBe(true)
  })
})

describe('layer 4: the safety net', () => {
  it('restores a closed underside removed by an untagged transaction, opens it and logs', () => {
    t = makeEditor(DINNER())
    const s = t.editor.state
    const start = s.doc.child(0).nodeSize + s.doc.child(1).nodeSize
    t.editor.view.dispatch(s.tr.delete(start, start + s.doc.child(2).nodeSize))
    expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
    expect(openIds(t.editor)).toContain('f1')
    expect(t.diagnostics).toContain('folio.hidden.restored')
  })

  it('restores closed content changed in place', () => {
    t = makeEditor(DINNER())
    const at = posOf(t.editor, 'absent')
    t.editor.view.dispatch(t.editor.state.tr.insertText('X', at))
    expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
  })

  it('a programmatic load that removes an underside is not restored', () => {
    t = makeEditor(DINNER())
    const s = t.editor.state
    const start = s.doc.child(0).nodeSize + s.doc.child(1).nodeSize
    t.editor.view.dispatch(s.tr.delete(start, start + s.doc.child(2).nodeSize).setMeta(TR_LOAD, true))
    expect(undersideText(t.editor, 'f1')).toBeNull()
    expect(t.diagnostics).not.toContain('folio.hidden.restored')
  })

  it('restores the underside when its placeholder is removed from the DOM', async () => {
    t = makeEditor(DINNER())
    t.editor.view.dom.querySelector('.folio-underside--closed')?.remove()
    // Let ProseMirror's DOM observer read the mutation.
    await new Promise((r) => setTimeout(r, 30))
    t.editor.view.domObserver.flush()
    expect(undersideText(t.editor, 'f1')).toBe('I felt absent the whole time.')
  })
})

describe('fences (K2)', () => {
  it('a protected underside cannot be selected for 600 ms and while the key is held', () => {
    t = makeEditor(DINNER())
    caretAt(t.editor, posOf(t.editor, 'After.'))
    press(t.editor, 'Backspace')
    press(t.editor, 'Backspace') // fresh press: kept, opened, fenced
    expect(openIds(t.editor)).toContain('f1')
    caretAt(t.editor, posOf(t.editor, 'After.'))
    press(t.editor, 'Backspace')
    expect(t.editor.state.selection).not.toBeInstanceOf(NodeSelection)
    t.clock.now += 700
    press(t.editor, 'Backspace')
    expect(t.editor.state.selection).not.toBeInstanceOf(NodeSelection) // key still held
    keyup(t.editor, 'Backspace')
    press(t.editor, 'Backspace')
    expect(t.editor.state.selection).toBeInstanceOf(NodeSelection)
  })

  it('a fence never lasts more than 3 seconds', () => {
    t = makeEditor(DINNER())
    caretAt(t.editor, posOf(t.editor, 'After.'))
    press(t.editor, 'Backspace')
    press(t.editor, 'Backspace')
    t.clock.now += 3100
    caretAt(t.editor, posOf(t.editor, 'After.'))
    press(t.editor, 'Backspace')
    expect(t.editor.state.selection).toBeInstanceOf(NodeSelection)
  })
})

describe('Enter and the invariants', () => {
  it('Enter at the end of a lifted line puts the new paragraph after its underside', () => {
    t = makeEditor(DINNER())
    setOpen(t.editor, ['f1'])
    caretAt(t.editor, posOf(t.editor, 'everyone.') + 'everyone.'.length)
    press(t.editor, 'Enter')
    expect(topLevelTypes(t.editor)).toEqual(['p:Before.', 'p:It was nice to see everyone.', 'u:f1', 'p:', 'p:After.'])
    expect(t.editor.state.selection.$from.parent.textContent).toBe('')
    expect(t.editor.state.selection.$from.depth).toBe(1)
  })

  it('I5 and I2: splitting a lifted line keeps the fold with the first fragment, and the underside follows it', () => {
    t = makeEditor(DINNER())
    const mid = posOf(t.editor, 'to see')
    t.editor.view.dispatch(t.editor.state.tr.split(mid))
    expect(topLevelTypes(t.editor)).toEqual(['p:Before.', 'p:It was nice ', 'u:f1', 'p:to see everyone.', 'p:After.'])
  })

  it('I9: every paragraph has a unique pid', () => {
    t = makeEditor(doc(p('One.', { pid: 'same' }), p('Two.', { pid: 'same' }), p('Three.')))
    t.editor.view.dispatch(t.editor.state.tr.insertText('!', 2))
    const pids: string[] = []
    t.editor.state.doc.descendants((n) => { if (n.type.name === 'paragraph') pids.push(n.attrs.pid as string) })
    expect(pids.every(Boolean)).toBe(true)
    expect(new Set(pids).size).toBe(pids.length)
  })

  it('I3: an underside whose line was deleted becomes loose', () => {
    t = makeEditor(DINNER())
    setOpen(t.editor, ['f1'])
    const s = t.editor.state
    const pStart = s.doc.child(0).nodeSize
    t.editor.view.dispatch(s.tr.delete(pStart, pStart + s.doc.child(1).nodeSize))
    expect(topLevelTypes(t.editor)).toContain('u:f1:loose')
  })

  it('italic text survives and coexists with a fold', () => {
    t = makeEditor(doc(p('Some words.', { pid: 'a', italic: true })))
    const from = posOf(t.editor, 'words')
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, from, from + 5)))
    const r = lift(t.editor.state)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    t.editor.view.dispatch(r.tr)
    const marks: string[] = []
    t.editor.state.doc.child(0).forEach((n) => n.marks.forEach((m) => marks.push(m.type.name)))
    expect(marks).toContain('italic')
    expect(marks).toContain('fold')
  })
})
