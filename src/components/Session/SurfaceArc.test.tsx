import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const update = vi.fn()
vi.mock('../../store/db', () => ({ db: { interventionOutcomes: { update } } }))
const { SurfaceArcReturn } = await import('./SurfaceArc')

describe('surface arc return', () => {
  it('captures what changed and permits a negative result', async () => {
    const onDone = vi.fn()
    render(<SurfaceArcReturn outcomeId="arc-1" surface="journal" onDone={onDone} />)
    fireEvent.change(screen.getByPlaceholderText('A word is enough (optional)'), { target: { value: 'More activated.' } })
    fireEvent.click(screen.getByText('stronger / worse'))
    await waitFor(() => expect(update).toHaveBeenCalledWith('arc-1', expect.objectContaining({
      immediate: 'worse', note: 'More activated.',
    })))
    expect(onDone).toHaveBeenCalled()
  })
})
