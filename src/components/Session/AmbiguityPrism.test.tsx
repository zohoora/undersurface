import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const record = vi.fn(async () => ({}))
vi.mock('../../store/ambiguityPrism', () => ({ recordAmbiguityPrismFeedback: record }))
vi.mock('../../store/db', () => ({ db: { interventionOutcomes: { get: async () => undefined } } }))

const { AmbiguityPrism } = await import('./AmbiguityPrism')
const message = {
  id: 'm1', speaker: 'therapist', partId: null, partName: null, content: 'Possibilities.',
  timestamp: 1, phase: 'exploration', isEmergence: false, surface: 'talk',
  responseMode: 'reflect', researchEventId: 'r1', researchArm: 'ambiguity_prism',
} as const
const hypotheses = [
  { id: 'h1', text: 'Fear of disappointing them.' },
  { id: 'h2', text: 'Anger translated into duty.' },
  { id: 'h3', text: 'Mostly exhausted.' },
]

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('AmbiguityPrism', () => {
  it('lets the writer review each possibility and supply their own frame', async () => {
    render(<AmbiguityPrism message={message} sessionId="s1" hypotheses={hypotheses} />)
    const fits = screen.getAllByRole('button', { name: 'fits' })
    fireEvent.click(fits[0])
    const maybe = screen.getAllByRole('button', { name: 'maybe' })
    fireEvent.click(maybe[1])
    const notThis = screen.getAllByRole('button', { name: 'not this' })
    fireEvent.click(notThis[2])
    fireEvent.change(screen.getByRole('textbox', { name: /A better frame/i }), { target: { value: 'I need more time because it matters.' } })
    fireEvent.click(screen.getByRole('button', { name: 'took some work' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep my review' }))
    await waitFor(() => expect(record).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1', betterFrame: 'I need more time because it matters.', correctionEffort: 'some_work',
      hypotheses: [
        expect.objectContaining({ id: 'h1', fit: 'fits' }),
        expect.objectContaining({ id: 'h2', fit: 'maybe' }),
        expect.objectContaining({ id: 'h3', fit: 'not_this' }),
      ],
    })))
  })

  it('makes none-of-these a real contested outcome', async () => {
    render(<AmbiguityPrism message={message} sessionId="s1" hypotheses={hypotheses} />)
    fireEvent.click(screen.getByRole('button', { name: 'none of these' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep my review' }))
    await waitFor(() => expect(record).toHaveBeenCalledWith(expect.objectContaining({
      noneFit: true,
      hypotheses: hypotheses.map(item => ({ ...item, fit: 'not_this' })),
    })))
  })

  it('keeps text legible and every control at a full-size touch target', () => {
    render(<AmbiguityPrism message={message} sessionId="s1" hypotheses={hypotheses} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.style.minHeight).toBe('44px')
      expect(parseInt(button.style.fontSize, 10)).toBeGreaterThanOrEqual(12)
    }
    expect(screen.getByRole('textbox', { name: /A better frame/i }).style.minHeight).toBe('44px')
  })
})
