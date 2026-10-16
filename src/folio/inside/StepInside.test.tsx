import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { ShorePresentation } from '../safety/shorePresentation'
import { doc, makeEditor, p, setOpen, u } from '../page/testUtils'
import type { TestEditor } from '../page/testUtils'
import { ENGLISH_STRINGS } from '../page/strings'
import type { InsideSound } from './insideSound'
import { useStepInside } from './useStepInside'

// H1 (build plan §4): open, leave both ways, the focus trap and inert root,
// closing on shore, reduced motion, and sound's start and stop.

vi.mock('../../i18n', () => ({
  useTranslation: () => new Proxy({}, { get: (_, key: string) => key }),
}))
const { StepInside } = await import('./StepInside')

const COMPOSITION = { v: 1 as const, line: [{ type: 'text', text: 'It was nice.' }], gap: 2 as const, between: [{ type: 'paragraph', content: [{ type: 'text', text: 'The drive.' }] }], beneath: [{ type: 'paragraph', content: [{ type: 'text', text: 'I felt absent.' }] }] }

function fakeSound() {
  return { play: vi.fn(), setStand: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn() } as unknown as InsideSound & Record<'play' | 'setStand' | 'pause' | 'resume' | 'stop', ReturnType<typeof vi.fn>>
}

let root: HTMLElement
beforeEach(() => { root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root) })
afterEach(() => { cleanup(); root.remove(); vi.unstubAllGlobals() })

describe('StepInside', () => {
  const props = (extra: Partial<React.ComponentProps<typeof StepInside>> = {}) => ({
    uid: 'u', composition: COMPOSITION, line: 'It was nice.', undersideLabel: "Beneath 'It was nice.', set apart, 3 of 5",
    soundAvailable: false, reduceMotion: false, onLeave: vi.fn(), sound: fakeSound(), ...extra,
  })

  it('is a named dialog over an inert page, reading the composition in order', () => {
    const pr = props()
    render(<StepInside {...pr} />, { container: document.body.appendChild(document.createElement('div')) })
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('folio.inside'.replace('{line}', 'It was nice.'))
    expect(root.hasAttribute('inert')).toBe(true)
    expect(dialog.textContent).toMatch(/Beneath 'It was nice\.', set apart, 3 of 5.*It was nice\..*The drive\..*I felt absent\./)
    expect(dialog.querySelector('[contenteditable]')).toBeNull()
    cleanup()
    expect(root.hasAttribute('inert')).toBe(false)
  })

  it('Escape and Back to the page leave to the page; Back and write leaves to write', () => {
    const pr = props()
    render(<StepInside {...pr} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(pr.onLeave).toHaveBeenLastCalledWith('page')
    fireEvent.click(screen.getByRole('button', { name: 'folio.backToPage' }))
    expect(pr.onLeave).toHaveBeenLastCalledWith('page')
    fireEvent.click(screen.getByRole('button', { name: 'folio.backAndWrite' }))
    expect(pr.onLeave).toHaveBeenLastCalledWith('write')
  })

  it('standing distance: three steps, never below the page\'s size', () => {
    render(<StepInside {...props()} />)
    const stage = document.querySelector('.folio-inside__stage') as HTMLElement
    const closer = screen.getByRole('button', { name: 'folio.standCloser' }) as HTMLButtonElement
    const back = screen.getByRole('button', { name: 'folio.standBack' }) as HTMLButtonElement
    expect(stage.style.getPropertyValue('--folio-stand')).toBe('1.14')
    fireEvent.click(closer)
    expect(stage.style.getPropertyValue('--folio-stand')).toBe('1.3')
    expect(closer.disabled).toBe(true)
    fireEvent.click(back)
    fireEvent.click(back)
    expect(stage.style.getPropertyValue('--folio-stand')).toBe('1')
    expect(back.disabled).toBe(true)
  })

  it('no sound control without the sound switch or on native; silence by default', () => {
    const pr = props()
    render(<StepInside {...pr} />)
    expect(screen.queryByRole('group', { name: 'folio.sound' })).toBeNull()
    expect(pr.sound?.play).not.toHaveBeenCalled()
  })

  it('sound starts only on the writer\'s choice, follows distance, pauses when hidden, stops on leaving', () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: () => {} })
    const sound = fakeSound()
    const { unmount } = render(<StepInside {...props({ soundAvailable: true, sound })} />)
    expect(sound.play).toHaveBeenLastCalledWith('silence', 1)
    fireEvent.click(screen.getByRole('button', { name: 'folio.sound.forest' }))
    expect(sound.play).toHaveBeenLastCalledWith('forest', 1)
    expect(mem.get('us.folioSound.u')).toBe('forest')
    fireEvent.click(screen.getByRole('button', { name: 'folio.standCloser' }))
    expect(sound.setStand).toHaveBeenLastCalledWith(2)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    fireEvent(document, new Event('visibilitychange'))
    expect(sound.pause).toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    unmount()
    expect(sound.stop).toHaveBeenCalled()
  })

  it('reduced motion turns the fade off', () => {
    render(<StepInside {...props({ reduceMotion: true })} />)
    expect(document.querySelector('.folio-inside-backdrop')?.getAttribute('data-reduce-motion')).toBe('true')
  })
})

describe('useStepInside', () => {
  // jsdom has no layout; ProseMirror's scrollIntoView asks for rects.
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }
  beforeEach(() => {
    const proto = Range.prototype as unknown as Record<string, unknown>
    proto.getClientRects = () => [rect]
    proto.getBoundingClientRect = () => rect
    ;(Element.prototype as unknown as Record<string, unknown>).getClientRects = () => [rect]
  })
  let t: TestEditor | null = null
  afterEach(() => { t?.destroy(); t = null })
  const DOC = doc(p('Before.', { pid: 'a' }), p('It was nice.', { pid: 'b', fold: 'f1' }), u('f1', [p('I felt absent.', { pid: 'c' })]), p('After.', { pid: 'd' }))

  function setup(enabled = true) {
    t = makeEditor(DOC)
    const shore = new ShorePresentation({ lastActivationAt: null })
    const hook = renderHook(() => useStepInside({ editor: t!.editor, shore, enabled, reduceMotion: true, strings: () => ENGLISH_STRINGS }))
    return { shore, hook }
  }

  it('opens only on an open fold with writing, only when enabled and on Normal paper', () => {
    const { hook } = setup()
    act(() => hook.result.current.open('f1'))
    expect(hook.result.current.inside).toBeNull() // closed fold
    setOpen(t!.editor, ['f1'])
    act(() => hook.result.current.open('f1'))
    expect(hook.result.current.inside?.line).toBe('It was nice.')
    expect(hook.result.current.inside?.label).toBe("Beneath 'It was nice.', set touching, 1 of 5")
    const off = setup(false)
    setOpen(t!.editor, ['f1'])
    act(() => off.hook.result.current.open('f1'))
    expect(off.hook.result.current.inside).toBeNull()
  })

  it('Back to the page restores the exact selection; Back and write ends in the beneath', () => {
    const { hook } = setup()
    setOpen(t!.editor, ['f1'])
    const ed = t!.editor
    ed.commands.setTextSelection({ from: 2, to: 5 })
    act(() => hook.result.current.open('f1'))
    ed.commands.setTextSelection(1)
    act(() => hook.result.current.leave('page'))
    expect([ed.state.selection.from, ed.state.selection.to]).toEqual([2, 5])
    act(() => hook.result.current.open('f1'))
    act(() => hook.result.current.leave('write'))
    const $c = ed.state.selection.$from
    expect($c.node(2).type.name).toBe('beneath')
    expect($c.parentOffset).toBe($c.parent.content.size)
  })

  it('shore closes it at once, and it can\'t open in Shore or Quiet', () => {
    const { shore, hook } = setup()
    setOpen(t!.editor, ['f1'])
    act(() => hook.result.current.open('f1'))
    expect(hook.result.current.inside).not.toBeNull()
    act(() => shore.groundingChanged(true))
    expect(hook.result.current.inside).toBeNull()
    act(() => hook.result.current.open('f1'))
    expect(hook.result.current.inside).toBeNull()
    act(() => shore.okay())
    act(() => hook.result.current.open('f1'))
    expect(hook.result.current.inside).toBeNull()
  })
})
