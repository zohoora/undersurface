import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const add = vi.fn(async () => {})
const linkResearchOutcome = vi.fn(async () => {})
vi.mock('../../store/db', () => ({ db: { interventionOutcomes: { add } } }))
vi.mock('../../store/personalScience', () => ({ linkResearchOutcome }))

const { AllianceRepairFeedback, ResearchMomentNotice } = await import('./ResearchMoment')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const message = {
  id: 'm1', speaker: 'therapist', partId: null, partName: null, content: 'Take the space.',
  timestamp: 1, phase: 'exploration', isEmergence: false, surface: 'talk',
  responseMode: 'offer_quiet', researchEventId: 'r1', researchArm: 'designed_silence',
} as const

describe('research and alliance feedback', () => {
  it('makes fixed experimental turns transparent and immediately overridable', () => {
    const onOverride = vi.fn()
    render(<ResearchMomentNotice message={message} onOverride={onOverride} />)
    expect(screen.getByText('personal science comparison')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I want a response instead' }))
    expect(onOverride).toHaveBeenCalledOnce()
  })

  it('names a fixed transfer rung and keeps an ordinary-response override', () => {
    const onOverride = vi.fn()
    render(<ResearchMomentNotice message={{ ...message, researchArm: 'transfer_minimal_cue' }} onOverride={onOverride} />)
    expect(screen.getByText('transfer practice · minimal cue')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I want a response instead' }))
    expect(onOverride).toHaveBeenCalledOnce()
  })

  it('records the writer-confirmed rupture reason and starts repair', async () => {
    const onRepair = vi.fn()
    render(<AllianceRepairFeedback message={message} sessionId="s1" onRepair={onRepair} />)
    fireEvent.click(screen.getByRole('button', { name: 'you missed me' }))
    fireEvent.click(screen.getByRole('button', { name: 'too certain' }))
    await waitFor(() => expect(onRepair).toHaveBeenCalledWith('too_certain'))
    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      researchEventId: 'r1',
      repairReason: 'too_certain',
      immediate: 'not_wanted',
    }))
    expect(linkResearchOutcome).toHaveBeenCalledWith('r1', 'repair-m1')
  })
})
