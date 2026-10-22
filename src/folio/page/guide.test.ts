import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import { cornerFor, foldHint, guideKey } from './guide'
import type { Corner, GuideOptions } from './guide'
import { lift } from './commands'
import { nearestStop } from './foldView'
import { keyLabel } from './keyLabels'
import { undersideControls } from './undersideControls'
import { doc, makeEditor, openIds, p, posOf, setOpen, u } from './testUtils'
import type { TestEditor } from './testUtils'
import { ENGLISH_STRINGS } from './strings'

// The first moment (docs/vision/2026-10-22-folio-first-moment.md): the corner
// after the sentence the caret rests at, the first-fold line, the controls in
// their order of use, the drag's stops and the keys as a writer reads them.

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null; vi.useRealTimers() })

const caret = (ed: TestEditor['editor'], pos: number) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))
const endOf = (ed: TestEditor['editor'], text: string) => posOf(ed, text) + text.length

function guide(over: Partial<GuideOptions> = {}): GuideOptions & { lifts: Corner[] } {
  const lifts: Corner[] = []
  return {
    enabled: () => true,
    learned: () => false,
    labels: () => ({ corner: 'write beneath this', cornerLabel: 'Write beneath this line', foldHint: 'folded here · open' }),
    shortcut: () => '⌘⇧↵',
    onLift: (c) => lifts.push(c),
    locale: () => 'en',
    restMs: { finished: 10, unfinished: 40 },
    lifts,
    ...over,
  }
}

function withFocus(ed: TestEditor['editor']) {
  vi.spyOn(ed.view, 'hasFocus').mockReturnValue(true)
}

describe('cornerFor', () => {
  it('offers the last sentence of a written page paragraph, finished or not', () => {
    t = makeEditor(doc(p('It was nice. Everyone came.', { pid: 'a' })))
    caret(t.editor, endOf(t.editor, 'Everyone came.'))
    const c = cornerFor(t.editor.state, 'en')
    expect(c && t.editor.state.doc.textBetween(c.from, c.to)).toBe('Everyone came.')
    expect(c?.finished).toBe(true)
    t.editor.commands.insertContent(' And then')
    expect(cornerFor(t.editor.state, 'en')?.finished).toBe(false)
  })

  it('belongs to the paragraph: from anywhere in it, the corner is its last sentence', () => {
    t = makeEditor(doc(p('First one. Second one.', { pid: 'a' })))
    caret(t.editor, posOf(t.editor, 'First one.') + 3)
    const c = cornerFor(t.editor.state, 'en')
    expect(c && t.editor.state.doc.textBetween(c.from, c.to)).toBe('Second one.')
  })

  it('on a fresh empty line, offers the paragraph just finished above it', () => {
    t = makeEditor(doc(p('We drove back late.', { pid: 'a' }), p('', { pid: 'b' })))
    caret(t.editor, endOf(t.editor, 'We drove back late.') + 2)
    const c = cornerFor(t.editor.state, 'en')
    expect(c && t.editor.state.doc.textBetween(c.from, c.to)).toBe('We drove back late.')
    expect(c?.finished).toBe(true)
  })

  it("isn't offered on a lifted line, in an underside, or with a selection", () => {
    t = makeEditor(doc(
      p('First one. Second one.', { pid: 'a' }),
      p('Lifted line.', { pid: 'b', fold: 'f1' }),
      u('f1', [p('Beneath words.', { pid: 'c' })]),
      p('', { pid: 'd' }),
    ))
    setOpen(t.editor, ['f1'])
    caret(t.editor, endOf(t.editor, 'Lifted line.'))
    expect(cornerFor(t.editor.state, 'en')).toBeNull()
    caret(t.editor, endOf(t.editor, 'Beneath words.'))
    expect(cornerFor(t.editor.state, 'en')).toBeNull()
    caret(t.editor, posOf(t.editor, 'Second one.') + 1)
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, posOf(t.editor, 'Second one.'), endOf(t.editor, 'Second one.'))))
    expect(cornerFor(t.editor.state, 'en')).toBeNull()
  })

  it("isn't offered on an empty or one-letter paragraph", () => {
    t = makeEditor(doc(p('', { pid: 'a' })))
    caret(t.editor, 1)
    expect(cornerFor(t.editor.state, 'en')).toBeNull()
    t.editor.commands.insertContent('I')
    expect(cornerFor(t.editor.state, 'en')).toBeNull()
  })
})

describe('the corner', () => {
  it('comes after a rest, goes at the next key, and lifts exactly its sentence', () => {
    vi.useFakeTimers()
    const g = guide()
    t = makeEditor(doc(p('It was nice. Everyone came.', { pid: 'a' })), { guide: g })
    withFocus(t.editor)
    caret(t.editor, endOf(t.editor, 'Everyone came.'))
    expect(t.editor.view.dom.querySelector('[data-folio-corner]')).toBeNull()
    vi.advanceTimersByTime(12)
    const button = t.editor.view.dom.querySelector('[data-folio-corner]') as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.getAttribute('aria-label')).toBe('Write beneath this line')
    expect(button.title).toBe('Write beneath this line (⌘⇧↵)')
    expect(button.textContent).toBe('write beneath this')
    // The sentence it would lift is underlined while the pointer is on it.
    button.dispatchEvent(new MouseEvent('mouseenter'))
    expect(t.editor.view.dom.querySelector('.folio-corner-preview')?.textContent).toBe('Everyone came.')
    button.click()
    expect(g.lifts).toHaveLength(1)
    const r = lift(t.editor.state, { range: g.lifts[0] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      t.editor.view.dispatch(r.tr)
      const marked = t.editor.view.dom.querySelector('.folio-fold')?.textContent
      expect(marked).toBe('Everyone came.')
      expect(openIds(t.editor)).toEqual([r.foldId])
    }
  })

  it('goes at the first key and waits longer mid-sentence', () => {
    vi.useFakeTimers()
    t = makeEditor(doc(p('I went to the', { pid: 'a' })), { guide: guide() })
    withFocus(t.editor)
    caret(t.editor, endOf(t.editor, 'I went to the'))
    vi.advanceTimersByTime(12)
    expect(t.editor.view.dom.querySelector('[data-folio-corner]')).toBeNull()
    vi.advanceTimersByTime(40)
    expect(t.editor.view.dom.querySelector('[data-folio-corner]')).not.toBeNull()
    t.editor.commands.insertContent(' shop')
    expect(t.editor.view.dom.querySelector('[data-folio-corner]')).toBeNull()
  })

  it("doesn't show when switched off or unfocused, and drops its words once learned", () => {
    vi.useFakeTimers()
    let enabled = false
    let learned = false
    t = makeEditor(doc(p('Everyone came.', { pid: 'a' })), { guide: guide({ enabled: () => enabled, learned: () => learned }) })
    const focus = vi.spyOn(t.editor.view, 'hasFocus').mockReturnValue(true)
    caret(t.editor, endOf(t.editor, 'Everyone came.'))
    vi.advanceTimersByTime(12)
    expect(t.editor.view.dom.querySelector('[data-folio-corner]')).toBeNull()
    enabled = true
    focus.mockReturnValue(false)
    caret(t.editor, endOf(t.editor, 'Everyone came.') - 1)
    vi.advanceTimersByTime(12)
    expect(t.editor.view.dom.querySelector('[data-folio-corner]')).toBeNull()
    focus.mockReturnValue(true)
    learned = true
    caret(t.editor, endOf(t.editor, 'Everyone came.'))
    vi.advanceTimersByTime(12)
    expect((t.editor.view.dom.querySelector('[data-folio-corner]') as HTMLElement).dataset.learned).toBe('true')
  })

  it('never shows during an IME composition, and goes when one starts', () => {
    vi.useFakeTimers()
    t = makeEditor(doc(p('Everyone came.', { pid: 'a' })), { guide: guide() })
    withFocus(t.editor)
    const composing = vi.spyOn(t.editor.view, 'composing', 'get').mockReturnValue(true)
    caret(t.editor, endOf(t.editor, 'Everyone came.'))
    vi.advanceTimersByTime(12)
    expect(t.editor.view.dom.querySelector('[data-folio-corner]')).toBeNull()
    composing.mockReturnValue(false)
    caret(t.editor, endOf(t.editor, 'Everyone came.') - 1)
    caret(t.editor, endOf(t.editor, 'Everyone came.'))
    vi.advanceTimersByTime(12)
    expect(t.editor.view.dom.querySelector('[data-folio-corner]')).not.toBeNull()
    t.editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
    expect(t.editor.view.dom.querySelector('[data-folio-corner]')).toBeNull()
  })

  it('is never in the document, the history or the text a save reads', () => {
    vi.useFakeTimers()
    t = makeEditor(doc(p('Everyone came.', { pid: 'a' })), { guide: guide() })
    withFocus(t.editor)
    const before = JSON.stringify(t.editor.getJSON())
    caret(t.editor, endOf(t.editor, 'Everyone came.'))
    vi.advanceTimersByTime(12)
    expect(guideKey.getState(t.editor.state)?.corner).not.toBeNull()
    expect(JSON.stringify(t.editor.getJSON())).toBe(before)
    expect(t.editor.can().undo()).toBe(false)
  })
})

describe('the first-fold line', () => {
  it('sits beside the crease, opens the fold when pressed, and goes when it opens or at the next edit', () => {
    t = makeEditor(doc(p('Lifted line.', { pid: 'a', fold: 'f1' }), u('f1', [p('Words.', { pid: 'b' })]), p('After.', { pid: 'c' })), { guide: guide() })
    foldHint(t.editor.view, 'f1')
    const hint = () => t?.editor.view.dom.querySelector('[data-folio-fold-hint]') as HTMLButtonElement | null
    expect(hint()?.textContent).toBe('folded here · open')
    // Right after the crease, in the line.
    expect(hint()?.closest('p')?.querySelector('.folio-crease')).not.toBeNull()
    hint()?.click()
    expect(openIds(t.editor)).toEqual(['f1'])
    expect(guideKey.getState(t.editor.state)?.foldHint).toBeNull()
    setOpen(t.editor, ['f1'], false)
    foldHint(t.editor.view, 'f1')
    caret(t.editor, endOf(t.editor, 'After.'))
    t.editor.commands.insertContent('x')
    expect(guideKey.getState(t.editor.state)?.foldHint).toBeNull()
    expect(hint()).toBeNull()
  })
})

describe('the open fold, in its order of use', () => {
  const labels = {
    close: 'Fold away', unlift: 'Put it back', closer: 'Move closer', farther: 'Move apart',
    looseTitle: 'Beneath a line you removed', looseKeep: 'Keep it here', looseToPage: 'Turn into page text', looseRemove: 'Remove',
    keep: 'Keep a copy', stepInside: 'Sit with it',
    tips: { close: 'Tuck this under its line.', farther: 'More space between the line and what\'s beneath it', closer: 'Less space', keep: 'Save a dated copy', stepInside: 'Full screen' },
  }
  const visible = (ed: TestEditor['editor']) => [...ed.view.dom.querySelectorAll('.folio-underside__controls button')]
    .filter((b) => !(b as HTMLButtonElement).hidden).map((b) => b.textContent)
  const controls = () => undersideControls({
    labels: () => labels,
    switches: () => ({ between: true, distance: true }),
    looseAcknowledged: new Set(),
    onKeep: () => {},
    onStepInside: () => {},
  })

  it('offers only Put it back on an empty fold; on a written one Fold away, Keep a copy, Sit with it, then the distance', () => {
    t = makeEditor(doc(p('Line.', { pid: 'a', fold: 'f1' }), u('f1', [p('', { pid: 'b' })])), { controls: controls(), strings: () => ENGLISH_STRINGS })
    setOpen(t.editor, ['f1'])
    expect(visible(t.editor)).toEqual(['Put it back'])
    caret(t.editor, posOf(t.editor, 'Line.') + 'Line.'.length + 4)
    t.editor.commands.insertContent('Beneath.')
    expect(visible(t.editor)).toEqual(['Fold away', 'Keep a copy', 'Sit with it', 'Move apart', 'Move closer'])
    const closer = t.editor.view.dom.querySelector('[data-folio-apart="closer"]') as HTMLButtonElement
    const apart = t.editor.view.dom.querySelector('[data-folio-apart="farther"]') as HTMLButtonElement
    // At touching, Move closer is there but disabled (the row never jumps).
    expect(closer.getAttribute('aria-disabled')).toBe('true')
    expect(apart.title).toBe('More space between the line and what\'s beneath it')
    apart.focus()
    apart.click()
    expect(closer.getAttribute('aria-disabled')).toBe('false')
    expect(document.activeElement).toBe(apart)
  })

  it('says what the crease does, and tints a closed fold\'s line', () => {
    t = makeEditor(doc(p('Line.', { pid: 'a', fold: 'f1' }), u('f1', [p('Words.', { pid: 'b' })])), { strings: () => ENGLISH_STRINGS })
    expect((t.editor.view.dom.querySelector('.folio-crease') as HTMLElement).dataset.hint).toBe('open')
    expect(t.editor.view.dom.querySelector('.folio-fold--closed')?.textContent).toBe('Line.')
    setOpen(t.editor, ['f1'])
    expect((t.editor.view.dom.querySelector('.folio-crease') as HTMLElement).dataset.hint).toBe('fold away')
    expect(t.editor.view.dom.querySelector('.folio-fold--closed')).toBeNull()
  })
})

describe('dragging the beneath', () => {
  it('snaps to the nearest of the five stops', () => {
    expect(nearestStop(0)).toBe(0)
    expect(nearestStop(0.6)).toBe(1)
    expect(nearestStop(2.1)).toBe(2)
    expect(nearestStop(5.2)).toBe(3)
    expect(nearestStop(40)).toBe(4)
    expect(nearestStop(-3)).toBe(0)
  })
})

describe('keys as a writer reads them', () => {
  it('uses symbols on Apple devices and names elsewhere', () => {
    expect(keyLabel('Mod-Shift-Enter', true)).toBe('⌘⇧↵')
    expect(keyLabel('Mod-Shift-Enter', false)).toBe('Ctrl+Shift+Enter')
    expect(keyLabel('Mod-Alt-]', false)).toBe('Ctrl+Alt+]')
    expect(keyLabel('Escape', true)).toBe('Esc')
  })
})

describe('lift with a range', () => {
  it('lifts exactly the range, and refuses one across paragraphs', () => {
    const t2 = makeEditor(doc(p('One. Two.', { pid: 'a' }), p('Three.', { pid: 'b' })))
    t = t2
    const from = posOf(t2.editor, 'One.')
    const r = lift(t2.editor.state, { range: { from, to: from + 4 } })
    expect(r.ok && r.tr.doc.textBetween(from, from + 4)).toBe('One.')
    const across = lift(t2.editor.state, { range: { from, to: posOf(t2.editor, 'Three.') + 2 } })
    expect(across.ok).toBe(false)
  })
})
