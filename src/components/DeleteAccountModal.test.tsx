import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

void React

// Node's own localStorage global shadows jsdom's here (as in settings.test.ts).
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

const fakeAuth: { currentUser: { uid: string } | null } = { currentUser: null }
const deleteAccountMock = vi.fn(async () => {})
const signOutMock = vi.fn(async () => { fakeAuth.currentUser = null })
vi.mock('../api/accountApi', () => ({ deleteAccount: () => deleteAccountMock() }))
vi.mock('../store/settings', () => ({ clearSettings: vi.fn() }))
vi.mock('firebase/auth', () => ({
  getAuth: () => fakeAuth,
  signOut: () => signOutMock(),
}))
vi.mock('../i18n', () => ({
  useTranslation: () => new Proxy({}, { get: (_, key: string) => key }),
}))

const { default: DeleteAccountModal } = await import('./DeleteAccountModal')
const { renderStrong } = await import('../utils/renderStrong')
const { readJournalDraft, writeJournalDraft } = await import('../store/journalDrafts')

beforeEach(() => {
  localStorage.clear()
  deleteAccountMock.mockClear()
  signOutMock.mockClear()
  fakeAuth.currentUser = { uid: 'uid-deleting' }
})

describe('DeleteAccountModal', () => {
  it("clears the deleted user's Journal drafts from this device", async () => {
    writeJournalDraft('uid-deleting', 'session-a', { text: 'marker-delete' })
    writeJournalDraft('uid-other', 'session-b', { text: 'not mine' })

    render(<DeleteAccountModal isOpen onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('delete'), { target: { value: 'delete' } })
    fireEvent.click(screen.getByText('delete.confirm'))

    await waitFor(() => expect(signOutMock).toHaveBeenCalledOnce())
    expect(deleteAccountMock).toHaveBeenCalledOnce()
    expect(readJournalDraft('uid-deleting', 'session-a')).toBeNull()
    expect(readJournalDraft('uid-other', 'session-b')?.text).toBe('not mine')
  })

  it('renders <strong> markup in translated copy as bold elements, not literal tags', () => {
    const { container } = render(<p>{renderStrong('Type <strong>delete</strong> to confirm')}</p>)
    expect(container.textContent).toBe('Type delete to confirm')
    expect(container.querySelector('strong')?.textContent).toBe('delete')
    expect(container.innerHTML).not.toContain('&lt;strong&gt;')
  })

  it('leaves copy without markup unchanged and never interprets other HTML', () => {
    const { container } = render(<p>{renderStrong('Plain <em>text</em>')}</p>)
    expect(container.textContent).toBe('Plain <em>text</em>')
    expect(container.querySelector('em')).toBeNull()
  })
})
