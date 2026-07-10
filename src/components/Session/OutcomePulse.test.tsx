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

const { OutcomePulse, DelayedOutcomePulse } = await import('./OutcomePulse')

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

  it('records a later reversal without overwriting the immediate rating', async () => {
    toArray.mockResolvedValueOnce([{
      id: 'old', source: 'talk', sourceId: 'old-message', sessionId: 'old-session',
      intervention: 'reflect', immediate: 'helped', createdAt: 1, updatedAt: 1,
    }])
    render(<DelayedOutcomePulse sessionId="new-session" />)
    const regret = await screen.findByText('I regret it')
    fireEvent.click(regret)
    await waitFor(() => expect(update).toHaveBeenCalledWith('old', expect.objectContaining({ delayed: 'regret' })))
  })
})
