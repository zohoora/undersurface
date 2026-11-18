import { describe, expect, it } from 'vitest'
import { CRISIS_WINDOW_MAX, CRISIS_WINDOW_OVERLAP, crisisWindows } from './crisisWindows'

const filler = (n: number) => 'The bus was late again and I read on the bench. '.repeat(Math.ceil(n / 49)).slice(0, n)

describe('crisisWindows', () => {
  it('is one window, the whole text, up to 1,000 characters (as before)', () => {
    expect(crisisWindows('short')).toEqual(['short'])
    const exact = filler(CRISIS_WINDOW_MAX)
    expect(crisisWindows(exact)).toEqual([exact])
  })

  it('starts with exactly the last 1,000 characters, the sample the single check read', () => {
    const text = filler(4_321)
    expect(crisisWindows(text)[0]).toBe(text.slice(-1000))
  })

  it('covers every character, each window at most 1,000, neighbours overlapping by at least 150', () => {
    // Every character distinct, so each window's position in the text is unambiguous.
    const text = Array.from({ length: 4_321 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('')
    const windows = crisisWindows(text)
    expect(windows.length).toBe(Math.ceil((text.length - CRISIS_WINDOW_OVERLAP) / (CRISIS_WINDOW_MAX - CRISIS_WINDOW_OVERLAP)))
    for (const w of windows) expect(w.length).toBeLessThanOrEqual(CRISIS_WINDOW_MAX)
    expect(windows.at(-1)).toBe(text.slice(0, CRISIS_WINDOW_MAX))
    const spans = windows.map((w) => ({ start: text.indexOf(w), end: text.indexOf(w) + w.length }))
    const covered = new Array(text.length).fill(false)
    for (const { start, end } of spans) for (let i = start; i < end; i++) covered[i] = true
    expect(covered.every(Boolean)).toBe(true)
    for (let k = 0; k + 1 < spans.length; k++) {
      // Windows go newest first: each earlier window ends inside the later one.
      expect(spans[k + 1].end - spans[k].start).toBeGreaterThanOrEqual(CRISIS_WINDOW_OVERLAP)
    }
  })

  it('reads a sentence that sits across a boundary whole in one window', () => {
    const sentence = 'Some nights I think everyone would be better off without me.'
    // Put the sentence across the boundary between the first two windows.
    const tail = filler(CRISIS_WINDOW_MAX - 30)
    const text = filler(1_500) + sentence + tail
    const windows = crisisWindows(text)
    expect(windows[0].includes(sentence)).toBe(false)
    expect(windows.some((w) => w.includes(sentence))).toBe(true)
  })

  it('never begins a window on half of a surrogate pair', () => {
    const text = '🙂'.repeat(1_337)
    for (const w of crisisWindows(text)) {
      expect(/^[\udc00-\udfff]/.test(w)).toBe(false)
    }
  })
})
