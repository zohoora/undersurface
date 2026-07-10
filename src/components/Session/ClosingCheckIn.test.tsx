import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const update = vi.fn(async () => {})
const recordSessionOutcome = vi.fn(async () => {})
const recordSessionNextStep = vi.fn(async () => {})
vi.mock('../../store/db', () => ({ db: { sessions: { update } } }))
vi.mock('../../store/interventionOutcomes', () => ({ recordSessionOutcome, recordSessionNextStep }))

const { ClosingCheckIn } = await import('./ClosingCheckIn')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe('ClosingCheckIn anti-dependence outcome', () => {
  it('preserves the one-tap close when personal science is off', () => {
    const onDone = vi.fn()
    render(<ClosingCheckIn sessionId="s1" onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Lighter' }))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('optionally records what the writer carries into life before closing', async () => {
    const onDone = vi.fn()
    render(<ClosingCheckIn sessionId="s1" onDone={onDone} showNextStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Lighter' }))
    await screen.findByText('What happens next?')
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'One offline step' }))
    expect(onDone).toHaveBeenCalledOnce()
    await waitFor(() => expect(recordSessionNextStep).toHaveBeenCalledWith('s1', 'offline_action'))
  })
})
