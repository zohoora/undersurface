import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Part, PartLetter } from '../../types'

let letterFixtures: PartLetter[] = []
let grounding = false
const updateLetter = vi.fn(async () => {})

vi.mock('../../store/db', () => ({
  db: {
    letters: { toArray: async () => letterFixtures, update: (...a: unknown[]) => updateLetter(...(a as [])) },
    parts: {
      toArray: async () => [
        { id: 'watcher', name: 'The Watcher', color: 'var(--test-watcher)', isSeeded: false },
        { id: 'tender', name: 'The Tender One', color: 'var(--test-tender)', isSeeded: false },
      ] as unknown as Part[],
    },
  },
}))
vi.mock('../../hooks/useGroundingMode', () => ({ useGroundingMode: () => grounding }))

const { LettersSection } = await import('./LettersSection')

const letter = (overrides: Partial<PartLetter>): PartLetter => ({
  id: 'l1', partIds: ['watcher', 'tender'], content: 'First paragraph.\n\nSecond paragraph.',
  triggerType: 'milestone', createdAt: Date.UTC(2026, 8, 1), isRead: false, ...overrides,
})

beforeEach(() => {
  grounding = false
  letterFixtures = []
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('LettersSection', () => {
  it('renders nothing when there are no letters', async () => {
    const view = render(<LettersSection isOpen />)
    await waitFor(() => expect(view.container.innerHTML).toBe(''))
  })

  it('lists letters newest first with signatories and an unread dot', async () => {
    letterFixtures = [
      letter({ id: 'old', createdAt: Date.UTC(2026, 6, 1), isRead: true, partIds: ['tender'] }),
      letter({ id: 'new', createdAt: Date.UTC(2026, 9, 1) }),
    ]
    render(<LettersSection isOpen />)
    const items = await screen.findAllByRole('button', { name: /From/ })
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAccessibleName(expect.stringMatching(/^Unread: From The Watcher, The Tender One/))
    expect(items[1]).toHaveAccessibleName(expect.stringMatching(/^From The Tender One/))
    expect(screen.getAllByTestId('letter-unread-dot')).toHaveLength(1)
    expect(screen.getByText('Letters')).toBeInTheDocument()
  })

  it('opens a letter to read and marks it read', async () => {
    letterFixtures = [letter({ id: 'l1' })]
    render(<LettersSection isOpen />)
    fireEvent.click(await screen.findByRole('button', { name: /Unread: From/ }))

    expect(screen.getByText('First paragraph.')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
    expect(updateLetter).toHaveBeenCalledWith('l1', { isRead: true })

    fireEvent.click(screen.getByRole('button', { name: /All letters/ }))
    expect(await screen.findByRole('button', { name: /^From The Watcher/ })).toBeInTheDocument()
    expect(screen.queryByTestId('letter-unread-dot')).toBeNull()
  })

  it('does not re-write a letter that is already read', async () => {
    letterFixtures = [letter({ id: 'l2', isRead: true })]
    render(<LettersSection isOpen />)
    fireEvent.click(await screen.findByRole('button', { name: /From/ }))
    expect(screen.getByText('First paragraph.')).toBeInTheDocument()
    expect(updateLetter).not.toHaveBeenCalled()
  })

  it('is hidden while grounding is active', async () => {
    grounding = true
    letterFixtures = [letter({})]
    const view = render(<LettersSection isOpen />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.container.innerHTML).toBe('')
  })
})
