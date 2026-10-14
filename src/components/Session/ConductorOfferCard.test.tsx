import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const overrideMock = vi.fn(async () => {})
vi.mock('../../store/personalScience', () => ({
  markResearchOverridden: (...args: unknown[]) => overrideMock(...args),
}))
vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    'conductor.offer.decline': 'Not now',
    'conductor.offer.declined': 'We will stay here.',
  }),
}))

import { ConductorOfferCard } from './ConductorOfferCard'

void React

beforeEach(() => vi.clearAllMocks())

describe('ConductorOfferCard', () => {
  it('records an override rather than treating a decline as a negative outcome', async () => {
    render(<ConductorOfferCard eventId="conductor-u2" />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(overrideMock).toHaveBeenCalledWith('conductor-u2', 'continue_talk'))
    expect(screen.getByRole('status')).toHaveTextContent('We will stay here.')
  })

  it('gives the quiet decline a full-size touch target', () => {
    render(<ConductorOfferCard eventId="conductor-u3" />)
    const decline = screen.getAllByRole('button', { name: 'Not now' }).at(-1) as HTMLElement
    expect(decline.style.minHeight).toBe('44px')
    expect(parseInt(decline.style.fontSize, 10)).toBeGreaterThanOrEqual(12)
  })
})
import React from 'react'
