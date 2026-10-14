import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const update = vi.fn()
vi.mock('../../store/db', () => ({ db: { interventionOutcomes: { update } } }))
const { SurfaceArcGuide, SurfaceArcReturn } = await import('./SurfaceArc')

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('surface arc return', () => {
  it('captures what changed and permits a negative result', async () => {
    const onDone = vi.fn()
    render(<SurfaceArcReturn outcomeId="arc-1" surface="journal" onDone={onDone} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Back from Journal. What is different now?' }), { target: { value: 'More activated.' } })
    fireEvent.click(screen.getByRole('button', { name: 'stronger / worse' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('arc-1', expect.objectContaining({
      immediate: 'worse', note: 'More activated.',
    })))
    expect(onDone).toHaveBeenCalled()
  })

  it('names legacy Relax/Drift arcs as Room', () => {
    render(<SurfaceArcReturn outcomeId="arc-2" surface="drift" onDone={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Back from Room. What is different now?' })).toBeInTheDocument()
  })

  it('gives every control a full-size touch target and legible text', () => {
    render(<SurfaceArcReturn outcomeId="arc-3" surface="speak" onDone={vi.fn()} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.style.minHeight).toBe('44px')
      expect(parseInt(button.style.fontSize, 10)).toBeGreaterThanOrEqual(12)
    }
    expect(screen.getByRole('textbox').style.minHeight).toBe('44px')
  })
})

describe('surface arc guide', () => {
  it('renders localized guidance and a return control', () => {
    const onReturn = vi.fn()
    render(<SurfaceArcGuide surface="speak" startedAt={0} onReturn={onReturn} />)
    expect(screen.getByText('Stay with this form for as long as it is useful, then return.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'return to Talk' }))
    expect(onReturn).toHaveBeenCalled()
  })
})
