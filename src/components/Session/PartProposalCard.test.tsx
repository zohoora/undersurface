import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { UserPart } from '../../types'

void React

const getMock = vi.fn()
const updateMock = vi.fn(async () => {})
vi.mock('../../store/db', () => ({
  db: { userParts: { get: (...a: unknown[]) => getMock(...a), update: (...a: unknown[]) => updateMock(...a) } },
}))
vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    'parts.card.hint': 'If this feels true, name it in your own words',
    'parts.card.keep': 'Keep',
    'parts.card.notQuite': 'Not quite',
  }),
}))

const { PartProposalCard } = await import('./PartProposalCard')

function makePart(over: Partial<UserPart> = {}): UserPart {
  return {
    id: 'up-1',
    name: 'the part that braces',
    description: 'braces before good news',
    stance: 'protective',
    status: 'candidate',
    evidence: [],
    sessionsSeen: 2,
    dismissedCount: 0,
    lastActiveAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

beforeEach(() => {
  getMock.mockReset()
  updateMock.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('PartProposalCard', () => {
  it('renders the editable name pre-filled for a candidate part', async () => {
    getMock.mockResolvedValue(makePart())
    const { getByDisplayValue } = render(<PartProposalCard partId="up-1" />)
    await waitFor(() => getByDisplayValue('the part that braces'))
  })

  it('renders nothing when the part is no longer a candidate (history re-render)', async () => {
    getMock.mockResolvedValue(makePart({ status: 'active' }))
    const { container } = render(<PartProposalCard partId="up-1" />)
    await waitFor(() => expect(getMock).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('Keep confirms with the edited name', async () => {
    getMock.mockResolvedValue(makePart())
    const { getByDisplayValue, getByText } = render(<PartProposalCard partId="up-1" />)
    const input = await waitFor(() => getByDisplayValue('the part that braces'))

    fireEvent.change(input, { target: { value: 'the bracer' } })
    fireEvent.click(getByText('Keep'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('up-1', expect.objectContaining({
      status: 'active',
      name: 'the bracer',
    })))
    // Settles into a quiet confirmation with the kept name.
    getByText('✓ the bracer')
  })

  it('"Not quite" increments dismissals; a second dismissal retires', async () => {
    getMock.mockResolvedValue(makePart())
    const { getByText } = render(<PartProposalCard partId="up-1" />)
    const btn = await waitFor(() => getByText('Not quite'))
    fireEvent.click(btn)
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('up-1', expect.objectContaining({
      dismissedCount: 1,
    })))
    expect(updateMock.mock.calls[0][1]).not.toHaveProperty('status')

    // Second dismissal (fresh render, part already dismissed once).
    updateMock.mockClear()
    getMock.mockResolvedValue(makePart({ dismissedCount: 1 }))
    const { getByText: getByText2 } = render(<PartProposalCard partId="up-1" />)
    fireEvent.click(await waitFor(() => getByText2('Not quite')))
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('up-1', expect.objectContaining({
      dismissedCount: 2,
      status: 'retired',
    })))
  })
})
