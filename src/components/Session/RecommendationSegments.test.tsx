import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecommendationSegments } from './RecommendationSegments'

describe('RecommendationSegments', () => {
  it('adds a visible destination cue to older ambiguous recommendation text', () => {
    render(
      <RecommendationSegments
        text="This may need more room. [write about it for a moment](#switch:journal)"
        onTap={() => {}}
      />,
    )

    const action = screen.getByRole('button', { name: 'write about it for a moment — Journal' })
    expect(action).toHaveTextContent('write about it for a moment')
    expect(action).toHaveTextContent('Journal→')
  })

  it('does not repeat a destination already named in clear link text', () => {
    const { container } = render(
      <RecommendationSegments
        text="This may need more room. [Open Journal for a few quiet minutes](#switch:journal)"
        onTap={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Open Journal for a few quiet minutes — Journal' }))
      .toHaveTextContent('Open Journal for a few quiet minutes')
    expect(container.querySelector('.session-recommendation__destination')).toBeNull()
  })

  it('keeps the destination action wired to its surface', () => {
    const onTap = vi.fn()
    render(
      <RecommendationSegments
        text="[Continue in Speak and say this aloud](#switch:speak)"
        onTap={onTap}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue in Speak and say this aloud — Speak' }))
    expect(onTap).toHaveBeenCalledWith('speak')
  })
})
