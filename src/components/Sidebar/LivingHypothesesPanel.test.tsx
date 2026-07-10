import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const update = vi.fn(async () => {})
const rows = [{
  id: 'h1', text: 'I may be buying time because the choice matters.', status: 'candidate',
  source: 'writer_rewrite', sourceMessageId: 'm1', sourceSessionId: 's1', createdAt: 1, updatedAt: 1,
}]
vi.mock('../../store/db', () => ({
  db: { livingHypotheses: { orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => rows }) }) }), update } },
}))
const { LivingHypothesesPanel } = await import('./LivingHypothesesPanel')

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('LivingHypothesesPanel', () => {
  it('lets the writer correct wording and lifecycle status', async () => {
    render(<LivingHypothesesPanel isOpen />)
    const input = await screen.findByRole('textbox', { name: 'Hypothesis wording' })
    fireEvent.change(input, { target: { value: 'This matters, so I am moving carefully.' } })
    fireEvent.blur(input)
    await waitFor(() => expect(update).toHaveBeenCalledWith('h1', expect.objectContaining({ text: 'This matters, so I am moving carefully.' })))
    fireEvent.change(screen.getByRole('combobox', { name: 'Hypothesis status' }), { target: { value: 'confirmed' } })
    await waitFor(() => expect(update).toHaveBeenCalledWith('h1', expect.objectContaining({ status: 'confirmed' })))
  })
})
