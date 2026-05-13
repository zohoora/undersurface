import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

// ─── Mocks (hoisted by Vitest) ────────────────────────────────

const correctSentenceMock = vi.fn<(s: string) => Promise<string | null>>()
const extractCompletedSentenceMock = vi.fn<(t: string) => { sentence: string; start: number; end: number } | null>()
const shouldTriggerAutocorrectMock = vi.fn<(k: string, t: string) => boolean>()

vi.mock('../ai/llmCorrect', () => ({
  correctSentence: (s: string) => correctSentenceMock(s),
  extractCompletedSentence: (t: string) => extractCompletedSentenceMock(t),
  shouldTriggerAutocorrect: (k: string, t: string) => shouldTriggerAutocorrectMock(k, t),
}))

const getLanguageCodeMock = vi.fn(() => 'en')
vi.mock('../i18n', () => ({
  getLanguageCode: () => getLanguageCodeMock(),
}))

const getGlobalConfigMock = vi.fn(() => ({ features: { autocorrectEnabled: true } }) as unknown)
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => getGlobalConfigMock(),
}))

const { useAutocorrect } = await import('./useAutocorrect')

// ─── Editor / KeyboardEvent fakes ─────────────────────────────

interface FakeEditor {
  dispatched: Array<{ from: number; to: number; text: string }>
  insertedContent: string[]
  state: Editor['state']
  view: Editor['view']
  commands: Editor['commands']
}

/**
 * Build a minimal TipTap-shaped editor that satisfies the surface useAutocorrect
 * touches: state.selection.from / $from.parentOffset / $from.parent.textBetween,
 * state.doc.textBetween, state.tr.replaceWith, state.schema.text,
 * view.dispatch, commands.insertContent. The "document" is a single line of
 * plain text — we treat parentOffset and from as identical (offset = position).
 */
function makeEditor(opts: { text: string; cursor: number; docStart?: number }): FakeEditor {
  const docStart = opts.docStart ?? 0
  const doc = {
    content: { size: opts.text.length + docStart },
    textBetween: (from: number, to: number) => opts.text.slice(from - docStart, to - docStart),
  }
  const $from = {
    parentOffset: opts.cursor - docStart,
    parent: {
      textBetween: (from: number, to: number) => opts.text.slice(from, to),
    },
    start: () => docStart,
  }
  const dispatched: FakeEditor['dispatched'] = []
  const insertedContent: string[] = []
  const tr = {
    replaceWith: (from: number, to: number, node: { text: string }) => {
      // Return a "fake" transaction object — the only thing dispatch consumes
      // is its existence. We just record what would have been written.
      return { _from: from, _to: to, _text: node.text }
    },
  }
  const view = {
    dispatch: (transaction: unknown) => {
      const t = transaction as { _from: number; _to: number; _text: string }
      dispatched.push({ from: t._from, to: t._to, text: t._text })
    },
  }
  const schema = {
    text: (s: string) => ({ text: s }),
  }
  const state = {
    selection: { from: opts.cursor, $from },
    doc,
    tr,
    schema,
  }
  return {
    dispatched,
    insertedContent,
    state: state as unknown as Editor['state'],
    view: view as unknown as Editor['view'],
    commands: {
      insertContent: (s: string) => { insertedContent.push(s); return true },
    } as unknown as Editor['commands'],
  }
}

function makeKey(key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}): KeyboardEvent {
  let prevented = false
  return {
    key,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    altKey: mods.altKey ?? false,
    preventDefault: () => { prevented = true },
    // expose for assertions
    get defaultPrevented() { return prevented },
  } as unknown as KeyboardEvent
}

beforeEach(() => {
  correctSentenceMock.mockReset()
  extractCompletedSentenceMock.mockReset()
  shouldTriggerAutocorrectMock.mockReset().mockReturnValue(false)
  getLanguageCodeMock.mockReset().mockReturnValue('en')
  getGlobalConfigMock.mockReset().mockReturnValue({ features: { autocorrectEnabled: true } })
})

// ─── Tests ────────────────────────────────────────────────────

describe('useAutocorrect — modifier keys', () => {
  it('ignores Cmd/Ctrl/Alt chord keystrokes (returns false, no side-effects)', () => {
    const { result } = renderHook(() => useAutocorrect({ autocorrect: true, autoCapitalize: true }))
    const editor = makeEditor({ text: 'hello', cursor: 5 })

    expect(result.current(editor as unknown as Editor, makeKey('a', { metaKey: true }))).toBe(false)
    expect(result.current(editor as unknown as Editor, makeKey('a', { ctrlKey: true }))).toBe(false)
    expect(result.current(editor as unknown as Editor, makeKey('a', { altKey: true }))).toBe(false)
    expect(editor.insertedContent).toEqual([])
    expect(editor.dispatched).toEqual([])
  })
})

describe('useAutocorrect — auto-capitalize', () => {
  it('capitalizes the first letter at paragraph start', () => {
    const { result } = renderHook(() => useAutocorrect({ autocorrect: false, autoCapitalize: true }))
    const editor = makeEditor({ text: '', cursor: 0 })

    const evt = makeKey('h')
    expect(result.current(editor as unknown as Editor, evt)).toBe(true)
    expect(evt.defaultPrevented).toBe(true)
    expect(editor.insertedContent).toEqual(['H'])
  })

  it('capitalizes after a sentence ending ("hi. ↓")', () => {
    const { result } = renderHook(() => useAutocorrect({ autocorrect: false, autoCapitalize: true }))
    // textBefore (3 chars) at cursor=4 reads ". " (1 dot + 1 space). The hook
    // reads `from-3 .. from`, so we feed 'i. ' at offset 1..4.
    const editor = makeEditor({ text: 'hi. ', cursor: 4 })

    const evt = makeKey('w')
    expect(result.current(editor as unknown as Editor, evt)).toBe(true)
    expect(editor.insertedContent).toEqual(['W'])
  })

  it('does NOT capitalize mid-word (no sentence boundary, parentOffset>0)', () => {
    const { result } = renderHook(() => useAutocorrect({ autocorrect: false, autoCapitalize: true }))
    // textBefore reads "ell" — no [.!?]\s$ match, parentOffset != 0.
    const editor = makeEditor({ text: 'hell', cursor: 4 })

    const evt = makeKey('o')
    expect(result.current(editor as unknown as Editor, evt)).toBe(false)
    expect(editor.insertedContent).toEqual([])
  })

  it('does nothing when autoCapitalize is off', () => {
    const { result } = renderHook(() => useAutocorrect({ autocorrect: false, autoCapitalize: false }))
    const editor = makeEditor({ text: '', cursor: 0 })

    const evt = makeKey('h')
    expect(result.current(editor as unknown as Editor, evt)).toBe(false)
    expect(editor.insertedContent).toEqual([])
  })
})

describe('useAutocorrect — standalone "i" → "I" fix', () => {
  it('replaces standalone "i" before a space (English)', () => {
    getLanguageCodeMock.mockReturnValue('en')
    const { result } = renderHook(() => useAutocorrect({ autocorrect: false, autoCapitalize: true }))
    // Lookback (from-2..from) on text 'hi i' at cursor 4 reads ' i' — matches /(?:^|\s)i$/.
    const editor = makeEditor({ text: 'hi i', cursor: 4 })

    result.current(editor as unknown as Editor, makeKey(' '))
    expect(editor.dispatched).toContainEqual({ from: 3, to: 4, text: 'I' })
  })

  it('does NOT run the standalone-i fix outside English', () => {
    getLanguageCodeMock.mockReturnValue('fr')
    const { result } = renderHook(() => useAutocorrect({ autocorrect: false, autoCapitalize: true }))
    const editor = makeEditor({ text: 'hi i', cursor: 4 })

    result.current(editor as unknown as Editor, makeKey(' '))
    expect(editor.dispatched).toEqual([])
  })
})

describe('useAutocorrect — sentence-end LLM trigger', () => {
  it('extracts and dispatches a corrected sentence on sentence-end keystroke', async () => {
    shouldTriggerAutocorrectMock.mockReturnValue(true)
    extractCompletedSentenceMock.mockReturnValue({ sentence: 'helo there', start: 0, end: 10 })
    correctSentenceMock.mockResolvedValue('Hello there')

    const { result } = renderHook(() => useAutocorrect({ autocorrect: true, autoCapitalize: false }))
    const editor = makeEditor({ text: 'helo there', cursor: 10 })

    result.current(editor as unknown as Editor, makeKey(' '))
    // Let the microtask resolve.
    await Promise.resolve()
    await Promise.resolve()

    expect(correctSentenceMock).toHaveBeenCalledWith('helo there')
    expect(editor.dispatched).toContainEqual({ from: 0, to: 10, text: 'Hello there' })
  })

  it('does NOT dispatch when correctSentence returns null', async () => {
    shouldTriggerAutocorrectMock.mockReturnValue(true)
    extractCompletedSentenceMock.mockReturnValue({ sentence: 'ok done', start: 0, end: 7 })
    correctSentenceMock.mockResolvedValue(null)

    const { result } = renderHook(() => useAutocorrect({ autocorrect: true, autoCapitalize: false }))
    const editor = makeEditor({ text: 'ok done', cursor: 7 })

    result.current(editor as unknown as Editor, makeKey(' '))
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.dispatched).toEqual([])
  })

  it('does NOT dispatch if doc text changed mid-flight (stale-edit guard)', async () => {
    shouldTriggerAutocorrectMock.mockReturnValue(true)
    extractCompletedSentenceMock.mockReturnValue({ sentence: 'helo', start: 0, end: 4 })

    let resolveCorrect!: (v: string | null) => void
    correctSentenceMock.mockReturnValue(new Promise((r) => { resolveCorrect = r }))

    const { result } = renderHook(() => useAutocorrect({ autocorrect: true, autoCapitalize: false }))
    const editor = makeEditor({ text: 'helo', cursor: 4 })

    result.current(editor as unknown as Editor, makeKey(' '))

    // Simulate user typing more after the trigger — the doc text no longer
    // matches the original sentence.
    editor.state.doc.textBetween = (from: number, to: number) => 'changed!'.slice(from, to)

    resolveCorrect('Hello')
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.dispatched).toEqual([])
  })

  it('is gated by the global autocorrectEnabled feature flag (admin off)', () => {
    getGlobalConfigMock.mockReturnValue({ features: { autocorrectEnabled: false } })
    shouldTriggerAutocorrectMock.mockReturnValue(true)
    extractCompletedSentenceMock.mockReturnValue({ sentence: 'helo', start: 0, end: 4 })
    correctSentenceMock.mockResolvedValue('Hello')

    const { result } = renderHook(() => useAutocorrect({ autocorrect: true, autoCapitalize: false }))
    const editor = makeEditor({ text: 'helo', cursor: 4 })
    result.current(editor as unknown as Editor, makeKey(' '))

    expect(correctSentenceMock).not.toHaveBeenCalled()
  })

  it('is gated by the per-user autocorrect prop (settings off)', () => {
    shouldTriggerAutocorrectMock.mockReturnValue(true)
    extractCompletedSentenceMock.mockReturnValue({ sentence: 'helo', start: 0, end: 4 })

    const { result } = renderHook(() => useAutocorrect({ autocorrect: false, autoCapitalize: false }))
    const editor = makeEditor({ text: 'helo', cursor: 4 })
    result.current(editor as unknown as Editor, makeKey(' '))

    expect(correctSentenceMock).not.toHaveBeenCalled()
  })
})

describe('useAutocorrect — backspace undo', () => {
  it('reverts to original when Backspace fires right after an autocorrect', async () => {
    // First: drive an autocorrect to populate lastAutocorrectRef.
    shouldTriggerAutocorrectMock.mockReturnValue(true)
    extractCompletedSentenceMock.mockReturnValue({ sentence: 'helo', start: 0, end: 4 })
    correctSentenceMock.mockResolvedValue('Hello')

    const { result } = renderHook(() => useAutocorrect({ autocorrect: true, autoCapitalize: false }))
    const ed1 = makeEditor({ text: 'helo', cursor: 4 })
    result.current(ed1 as unknown as Editor, makeKey(' '))
    await Promise.resolve(); await Promise.resolve()
    expect(ed1.dispatched).toContainEqual({ from: 0, to: 4, text: 'Hello' })

    // Now: a fresh editor reflecting the corrected state — Backspace.
    const ed2 = makeEditor({ text: 'Hello', cursor: 5 })
    const evt = makeKey('Backspace')
    const handled = result.current(ed2 as unknown as Editor, evt)

    expect(handled).toBe(true)
    expect(evt.defaultPrevented).toBe(true)
    expect(ed2.dispatched).toContainEqual({ from: 0, to: 5, text: 'helo' })
  })

  it('clears the undo state after any non-Backspace keystroke', async () => {
    shouldTriggerAutocorrectMock.mockReturnValue(true)
    extractCompletedSentenceMock.mockReturnValue({ sentence: 'helo', start: 0, end: 4 })
    correctSentenceMock.mockResolvedValue('Hello')

    const { result } = renderHook(() => useAutocorrect({ autocorrect: true, autoCapitalize: false }))
    const ed1 = makeEditor({ text: 'helo', cursor: 4 })
    result.current(ed1 as unknown as Editor, makeKey(' '))
    await Promise.resolve(); await Promise.resolve()

    // Type a regular char — should clear undo state.
    shouldTriggerAutocorrectMock.mockReturnValue(false)
    const ed2 = makeEditor({ text: 'Hellox', cursor: 6 })
    result.current(ed2 as unknown as Editor, makeKey('x'))

    // Now Backspace should NOT undo (state was cleared).
    const ed3 = makeEditor({ text: 'Hello', cursor: 5 })
    const handled = result.current(ed3 as unknown as Editor, makeKey('Backspace'))
    expect(handled).toBe(false)
    expect(ed3.dispatched).toEqual([])
  })
})
