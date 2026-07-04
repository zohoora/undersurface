import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'

void React

// ── prefers-reduced-motion shim (togglable per test) ──
let prefersReduced = false
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (q: string) => ({
    matches: q.includes('prefers-reduced-motion') ? prefersReduced : false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false },
  }),
})

// ── Minimal Web Audio stubs (jsdom has none) ──
class FakeParam {
  setValueAtTime() { return this }
  cancelScheduledValues() { return this }
  linearRampToValueAtTime() { return this }
  exponentialRampToValueAtTime() { return this }
}
class FakeAudioContext {
  currentTime = 0
  destination = {}
  close = vi.fn(() => Promise.resolve())
}
class FakeStereoPannerNode {
  pan = new FakeParam()
  connect(next: unknown) { return next }
}
class FakeGainNode {
  gain = new FakeParam()
  connect(next: unknown) { return next }
}
class FakeOscillatorNode {
  connect(next: unknown) { return next }
  start() {}
  stop() {}
}
vi.stubGlobal('AudioContext', FakeAudioContext)
vi.stubGlobal('StereoPannerNode', FakeStereoPannerNode)
vi.stubGlobal('GainNode', FakeGainNode)
vi.stubGlobal('OscillatorNode', FakeOscillatorNode)
// Keep rAF deterministic — render the dot without spinning an animation loop.
vi.stubGlobal('requestAnimationFrame', () => 1)
vi.stubGlobal('cancelAnimationFrame', () => {})

import { BilateralStimulus } from './BilateralStimulus'

afterEach(() => {
  cleanup()
  prefersReduced = false
})

describe('BilateralStimulus', () => {
  it('renders the traveling dot on the visual channel while running', () => {
    render(<BilateralStimulus channel="visual" running passMs={2000} volume={0.5} />)
    expect(screen.queryByTestId('bls-dot')).not.toBeNull()
  })

  it('renders no dot on the audio channel (audible only)', () => {
    render(<BilateralStimulus channel="audio" running passMs={2000} volume={0.5} />)
    expect(screen.queryByTestId('bls-dot')).toBeNull()
  })

  it('renders no dot when not running', () => {
    render(<BilateralStimulus channel="visual" running={false} passMs={2000} volume={0.5} />)
    expect(screen.queryByTestId('bls-dot')).toBeNull()
  })

  it('falls back to audio (no dot) when the user prefers reduced motion', () => {
    prefersReduced = true
    render(<BilateralStimulus channel="visual" running passMs={2000} volume={0.5} />)
    expect(screen.queryByTestId('bls-dot')).toBeNull()
  })

  it('does not throw when unmounted mid-run (visual and audio)', () => {
    const visual = render(<BilateralStimulus channel="visual" running passMs={2000} volume={0.5} />)
    expect(() => visual.unmount()).not.toThrow()
    const audio = render(<BilateralStimulus channel="audio" running passMs={2000} volume={0.5} />)
    expect(() => audio.unmount()).not.toThrow()
  })
})
