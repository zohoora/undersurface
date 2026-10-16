import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CrisisResources } from './CrisisResources'

describe('CrisisResources', () => {
  it('Sessions: dismissing hides it, with no callback required', () => {
    render(<CrisisResources visible />)
    const close = screen.getAllByRole('button')[0]
    fireEvent.click(close)
    expect(document.querySelector('.crisis-resources')).toBeNull()
  })

  it('Folio: tells the page when dismissed, and a new token re-shows it', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<CrisisResources visible showToken={1} onDismiss={onDismiss} />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.crisis-resources')).toBeNull()
    rerender(<CrisisResources visible showToken={2} onDismiss={onDismiss} />)
    expect(document.querySelector('.crisis-resources')).not.toBeNull()
  })
})
