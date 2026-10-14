import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearJournalDraft,
  clearJournalDraftsForUser,
  getJournalDraftEpoch,
  journalDraftKey,
  journalDraftToDoc,
  readJournalDraft,
  writeJournalDraft,
} from './journalDrafts'

// Node's own localStorage global shadows jsdom's here (as in settings.test.ts),
// so install a complete in-memory Storage, including key() and length.
class MemoryStorage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  clear() { this.map.clear() }
  getItem(key: string) { return this.map.get(key) ?? null }
  key(index: number) { return [...this.map.keys()][index] ?? null }
  removeItem(key: string) { this.map.delete(key) }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
}
vi.stubGlobal('localStorage', new MemoryStorage())

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('journalDrafts store', () => {
  it('keys a draft by its owning (uid, sessionId) pair', () => {
    expect(journalDraftKey('u1', 's1')).toBe('us.journalDraft.u1.s1')
  })

  it('round-trips text and the stable message id', () => {
    expect(writeJournalDraft('u1', 's1', { text: 'first words', messageId: 'm-1' })).toBe(true)
    expect(readJournalDraft('u1', 's1')).toMatchObject({ text: 'first words', messageId: 'm-1' })
    expect(readJournalDraft('u1', 's2')).toBeNull()
    expect(readJournalDraft('u2', 's1')).toBeNull()
  })

  it('removes the key for a blank draft', () => {
    writeJournalDraft('u1', 's1', { text: 'words' })
    writeJournalDraft('u1', 's1', { text: '   ' })
    expect(localStorage.getItem(journalDraftKey('u1', 's1'))).toBeNull()
    writeJournalDraft('u1', 's1', { text: 'words' })
    clearJournalDraft('u1', 's1')
    expect(readJournalDraft('u1', 's1')).toBeNull()
  })

  it('ignores corrupt stored values', () => {
    localStorage.setItem(journalDraftKey('u1', 's1'), '{not json')
    expect(readJournalDraft('u1', 's1')).toBeNull()
    localStorage.setItem(journalDraftKey('u1', 's1'), JSON.stringify({ text: 42 }))
    expect(readJournalDraft('u1', 's1')).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(localStorage, 'key').mockImplementation(() => { throw new Error('blocked') })
    expect(readJournalDraft('u1', 's1')).toBeNull()
    expect(writeJournalDraft('u1', 's1', { text: 'words' })).toBe(false)
    expect(() => clearJournalDraft('u1', 's1')).not.toThrow()
    expect(() => clearJournalDraftsForUser('u1')).not.toThrow()
  })

  it('clears every draft for one uid and leaves other users alone', () => {
    writeJournalDraft('u1', 's1', { text: 'one' })
    writeJournalDraft('u1', 's2', { text: 'two' })
    writeJournalDraft('u2', 's1', { text: 'someone else' })
    localStorage.setItem('undersurface-settings', '{}')

    clearJournalDraftsForUser('u1')

    expect(readJournalDraft('u1', 's1')).toBeNull()
    expect(readJournalDraft('u1', 's2')).toBeNull()
    expect(readJournalDraft('u2', 's1')?.text).toBe('someone else')
    expect(localStorage.getItem('undersurface-settings')).toBe('{}')
  })

  it('refuses writes from a writer that predates a clear (no resurrection after sign-out)', () => {
    const before = getJournalDraftEpoch()
    clearJournalDraftsForUser('u1')
    expect(writeJournalDraft('u1', 's1', { text: 'late flush' }, before)).toBe(false)
    expect(readJournalDraft('u1', 's1')).toBeNull()
    expect(writeJournalDraft('u1', 's1', { text: 'new writer' }, getJournalDraftEpoch())).toBe(true)
  })
})

describe('journalDraftToDoc', () => {
  it('restores paragraphs and hard breaks as plain text, never parsing HTML', () => {
    expect(journalDraftToDoc('one <b>two\nthree\n\n\n\nfour')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'one <b>two' },
            { type: 'hardBreak' },
            { type: 'text', text: 'three' },
          ],
        },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'four' }] },
      ],
    })
  })

  it('round-trips through the Journal editor: restored text equals what the editor reported', async () => {
    const { Editor } = await import('@tiptap/core')
    const { default: StarterKit } = await import('@tiptap/starter-kit')
    const original = 'first <i love you\nsecond line & more\n\n\n\nafter a blank paragraph'
    const editor = new Editor({
      extensions: [StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      })],
      content: journalDraftToDoc(original),
    })
    expect(editor.getText()).toBe(original)
    editor.destroy()
  })
})
