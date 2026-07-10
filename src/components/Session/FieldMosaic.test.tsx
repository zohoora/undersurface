import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const update = vi.fn()
let momentFixtures: Array<Record<string, unknown>> = []
vi.mock('../../store/db', () => ({
  db: {
    companionPreferences: { get: vi.fn(async () => ({ id: 'current', fieldMosaicEnabled: true })) },
    fieldMoments: {
      update,
      orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => momentFixtures }) }) }),
    },
  },
}))
vi.mock('../../firebase', () => ({ storage: {} }))
vi.mock('firebase/storage', () => ({ ref: vi.fn(), getBlob: vi.fn() }))

const { FieldMosaic } = await import('./FieldMosaic')

describe('FieldMosaic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    momentFixtures = [{
      id: 'moment-1', source: 'sms', sourceId: 'sms-1', text: 'Ask for the role change Monday.',
      createdAt: 10, status: 'unreviewed',
    }]
  })

  it('leaves connection and meaning to the writer', async () => {
    render(<FieldMosaic sessionId="session-1" />)
    expect(await screen.findByText('Ask for the role change Monday.')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('What does this mean to you? (optional)'), { target: { value: 'I am ready to ask.' } })
    fireEvent.click(screen.getByText('keep'))
    await waitFor(() => expect(update).toHaveBeenCalledWith('moment-1', {
      status: 'kept', userMeaning: 'I am ready to ask.', reviewedInSessionId: 'session-1', connectedTo: null,
    }))
  })

  it('connects two user-chosen moments and can bring one into Talk', async () => {
    momentFixtures.push({
      id: 'moment-2', source: 'talk', sourceId: 'talk-1', text: 'I keep waiting for permission.',
      createdAt: 9, status: 'unreviewed',
    })
    const onBringIntoTalk = vi.fn()
    render(<FieldMosaic sessionId="session-1" onBringIntoTalk={onBringIntoTalk} />)
    await screen.findByText('I keep waiting for permission.')
    const connectionSelects = screen.getAllByLabelText('Connect this moment')
    fireEvent.change(connectionSelects[0], { target: { value: 'moment-2' } })
    fireEvent.click(screen.getAllByText('bring into Talk')[0])
    await waitFor(() => expect(update).toHaveBeenCalledWith('moment-1', expect.objectContaining({ connectedTo: 'moment-2' })))
    expect(onBringIntoTalk).toHaveBeenCalledWith(expect.objectContaining({ id: 'moment-1', status: 'kept' }))
  })
})
