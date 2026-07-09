import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const consentAdd = vi.fn(async () => {})
vi.mock('../store/db', () => ({ db: { consent: { add: (...args: unknown[]) => consentAdd(...args) } } }))
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('./PolicyModal', () => ({ default: () => null }))

const { Onboarding } = await import('./Onboarding')

describe('Onboarding adult audience gate', () => {
  it('requires the adult, service, and policy acknowledgements before starting', async () => {
    const onComplete = vi.fn()
    render(<Onboarding onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /how does it work/i }))
    fireEvent.click(screen.getByRole('button', { name: /one more thing/i }))

    const begin = screen.getByRole('button', { name: /begin a session/i })
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    expect(begin).toBeDisabled()

    fireEvent.click(boxes[0])
    fireEvent.click(boxes[1])
    expect(begin).toBeDisabled()
    fireEvent.click(boxes[2])
    expect(begin).toBeEnabled()

    fireEvent.click(begin)
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(consentAdd).toHaveBeenCalledWith(expect.objectContaining({ adultOnlyAcknowledged: true }))
  })
})
