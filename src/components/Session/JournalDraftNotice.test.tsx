import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

void React

vi.mock('../../i18n', () => ({
  useTranslation: () => new Proxy({}, { get: (_, key: string) => key }),
}))

const { JournalDraftNotice } = await import('./JournalDraftNotice')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('JournalDraftNotice', () => {
  it('offers retry and copy while the session is open', () => {
    const onRetry = vi.fn()
    render(<JournalDraftNotice mode="failed" text="kept words" sending={false} onRetry={onRetry} />)
    expect(screen.getByRole('status')).toHaveTextContent('session.journal.draftNotAdded')
    fireEvent.click(screen.getByText('session.journal.draftRetry'))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.getByText('session.journal.draftCopy')).toBeInTheDocument()
  })

  it('disables retry while an attempt is in flight', () => {
    render(<JournalDraftNotice mode="failed" text="kept words" sending onRetry={() => {}} />)
    expect(screen.getByText('session.journal.draftRetry')).toBeDisabled()
  })

  it('offers only copy once the session has closed, and copies the exact words', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<JournalDraftNotice mode="closed" text="every kept word" sending={false} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('session.journal.draftClosed')
    expect(screen.queryByText('session.journal.draftRetry')).toBeNull()

    fireEvent.click(screen.getByText('session.journal.draftCopy'))
    expect(writeText).toHaveBeenCalledWith('every kept word')
    await waitFor(() => expect(screen.getByText('session.journal.draftCopied')).toBeInTheDocument())
  })
})
