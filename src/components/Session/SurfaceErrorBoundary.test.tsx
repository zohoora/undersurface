import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('../../i18n', () => ({ t: (key: string) => key }))

const { SurfaceErrorBoundary } = await import('./SurfaceErrorBoundary')

void React

function Exploding(): never {
  throw new Error('Failed to fetch dynamically imported module')
}

describe('SurfaceErrorBoundary', () => {
  it('contains a surface failure locally and returns the writer to Talk', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onExit = vi.fn()
    render(
      <div>
        <p>talk composer draft</p>
        <SurfaceErrorBoundary surface="room" onExit={onExit}>
          <Exploding />
        </SurfaceErrorBoundary>
      </div>,
    )
    // The rest of the session is still rendered.
    expect(screen.getByText('talk composer draft')).toBeTruthy()
    expect(screen.getByText('surface.error.body')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'surface.error.back' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
