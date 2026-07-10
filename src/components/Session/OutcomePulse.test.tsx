import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionMessage } from '../../types'

const add = vi.fn()
const get = vi.fn(async () => undefined)
const update = vi.fn()
const toArray = vi.fn(async () => [])
vi.mock('../../store/db', () => ({
  generateId: () => 'generated',
  db: {
    interventionOutcomes: {
      add,
      get,
      update,
      orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray }) }) }),
    },
  },
}))

const { OutcomePulse, DelayedOutcomePulse, FieldWindowTimingPulse } = await import('./OutcomePulse')

const message: SessionMessage = {
  id: 'm1', speaker: 'therapist', partId: null, partName: null,
  content: 'A thought.', timestamp: 10, phase: 'deepening', isEmergence: false,
  surface: 'talk', responseMode: 'make_concrete',
}

describe('outcome pulses', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records an explicitly negative immediate outcome', async () => {
    render(<OutcomePulse message={message} sessionId="s1" />)
    await waitFor(() => expect(get).toHaveBeenCalled())
    fireEvent.click(screen.getByText('made it worse'))
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'm1', intervention: 'make_concrete', immediate: 'worse',
    })))
  })

  it('adds an immediate rating without replacing prior prism feedback', async () => {
    const existing = {
      id: 'message-m1', prismFeedback: { hypotheses: [], noneFit: true, submittedAt: 1 },
    }
    get.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing)
    render(<OutcomePulse message={message} sessionId="s1" />)
    fireEvent.click(await screen.findByText('yes'))
    await waitFor(() => expect(update).toHaveBeenCalledWith('message-m1', expect.objectContaining({ immediate: 'helped' })))
    expect(add).not.toHaveBeenCalled()
  })

  it('asks for agency after a transfer-ladder outcome and persists it separately', async () => {
    render(<OutcomePulse message={{ ...message, researchEventId: 'r-transfer', researchArm: 'transfer_user_first' }} sessionId="s1" />)
    await waitFor(() => expect(get).toHaveBeenCalled())
    fireEvent.click(screen.getByText('yes'))
    expect(await screen.findByText('Could more of that come from you next time?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('yes, more mine'))
    await waitFor(() => expect(update).toHaveBeenCalledWith('message-m1', expect.objectContaining({ agency: 'more' })))
  })

  it('records a later reversal without overwriting the immediate rating', async () => {
    toArray.mockResolvedValueOnce([{
      id: 'old', source: 'talk', sourceId: 'old-message', sessionId: 'old-session',
      intervention: 'reflect', immediate: 'helped', createdAt: 1, updatedAt: 1,
    }])
    render(<DelayedOutcomePulse sessionId="new-session" />)
    const regret = await screen.findByText('I regret it')
    fireEvent.click(regret)
    await waitFor(() => expect(update).toHaveBeenCalledWith('old', expect.objectContaining({
      delayed: 'regret',
      horizonOutcomes: [expect.objectContaining({ horizon: 'next_day', outcome: 'regret' })],
    })))
  })

  it('asks a distinct later-today question before the next-day horizon', async () => {
    toArray.mockResolvedValueOnce([{
      id: 'recent', source: 'talk', sourceId: 'm2', sessionId: 'old-session',
      intervention: 'reflect', immediate: 'helped', createdAt: Date.now() - 3 * 60 * 60_000, updatedAt: 1,
    }])
    render(<DelayedOutcomePulse sessionId="new-session" />)
    expect(await screen.findByText('A little later, did any of that still help?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('stayed with me'))
    await waitFor(() => expect(update).toHaveBeenCalledWith('recent', expect.objectContaining({
      horizonOutcomes: [expect.objectContaining({ horizon: 'later_today', outcome: 'stayed' })],
    })))
  })

  it('asks about field-window timing without inferring from SMS silence', async () => {
    toArray.mockResolvedValueOnce([{
      id: 'outcome-field', source: 'sms', sourceId: 'field-1', intervention: 'field_window',
      fieldWindowArm: 'field_no_contact', windowLabel: 'After work',
      createdAt: Date.now() - 60 * 60_000, updatedAt: 1,
    }])
    render(<FieldWindowTimingPulse sessionId="new-session" />)
    expect(await screen.findByText('Earlier, was quiet the better fit for that window?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('good timing'))
    await waitFor(() => expect(update).toHaveBeenCalledWith('outcome-field', expect.objectContaining({
      immediate: 'helped', timingAskedAt: expect.any(Number),
    })))
  })
})
