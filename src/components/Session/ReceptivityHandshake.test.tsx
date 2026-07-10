import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReceptivityHandshake } from './ReceptivityHandshake'

afterEach(cleanup)

describe('ReceptivityHandshake', () => {
  it('saves only after all three writer-authored signals are selected', () => {
    const onSave = vi.fn()
    render(<ReceptivityHandshake onSave={onSave} onSkip={vi.fn()} />)
    const save = screen.getByRole('button', { name: 'Use for this session' })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'looping' }))
    fireEvent.click(screen.getByRole('button', { name: 'a few min' }))
    fireEvent.click(screen.getByRole('button', { name: 'perspective' }))
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ state: 'looping', capacity: 'few_minutes', need: 'perspective' }))
  })

  it('allows using the app without supplying research context', () => {
    const onSkip = vi.fn()
    render(<ReceptivityHandshake onSave={vi.fn()} onSkip={onSkip} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onSkip).toHaveBeenCalledOnce()
  })
})
