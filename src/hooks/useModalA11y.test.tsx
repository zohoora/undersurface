import React, { useRef } from 'react'
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { useModalA11y } from './useModalA11y'

void React // classic JSX transform in test env references React.createElement

// jsdom has no layout engine, so offsetParent is always null and the hook's
// visibility filter would treat every element as hidden. Shim it to report the
// parent (truthy for attached, visible nodes) so the trap logic is exercised.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.parentNode },
  })
})

afterEach(cleanup)

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useModalA11y(ref, onClose)
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <button>First</button>
      <button>Last</button>
    </div>
  )
}

describe('useModalA11y', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves initial focus into the dialog (first focusable)', () => {
    render(<Dialog onClose={() => {}} />)
    expect((document.activeElement as HTMLElement)?.textContent).toBe('First')
  })

  it('restores focus to the opener on unmount', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { unmount } = render(<Dialog onClose={() => {}} />)
    // Focus moved into the dialog…
    expect(document.activeElement).not.toBe(opener)
    unmount()
    // …and returns to the opener when the modal closes.
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('wraps Tab from the last focusable back to the first', () => {
    render(<Dialog onClose={() => {}} />)
    const buttons = document.querySelectorAll('button')
    const last = buttons[buttons.length - 1] as HTMLElement
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect((document.activeElement as HTMLElement)?.textContent).toBe('First')
  })
})
