import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, cleanup, screen } from '@testing-library/react'

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
  values: number[] = []
  setValueAtTime(value: number) { this.values.push(value); return this }
  cancelScheduledValues() { return this }
  linearRampToValueAtTime() { return this }
  exponentialRampToValueAtTime() { return this }
}
class FakeAudioContext {
  currentTime = 0
  destination = {}
  resume = vi.fn(() => Promise.resolve())
  close = vi.fn(() => Promise.resolve())
}
class FakeStereoPannerNode {
  pan = new FakeParam()
  constructor() { panners.push(this) }
  connect(next: unknown) { return next }
  disconnect() {}
}
class FakeGainNode {
  gain = new FakeParam()
  connect(next: unknown) { return next }
  disconnect() {}
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

const panners: FakeStereoPannerNode[] = []

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  prefersReduced = false
  panners.length = 0
  vi.stubGlobal('requestAnimationFrame', () => 1)
})

describe('BilateralStimulus', () => {
  it('renders the traveling dot on the visual channel while running', () => {
    render(<BilateralStimulus channel="visual" running passMs={2000} volume={0.5} />)
    expect(screen.queryByTestId('bls-dot')).not.toBeNull()
    expect(screen.queryByTestId('drift-rhythm-lane')).not.toBeNull()
  })

  it('keeps a quiet visual trace on the audio channel', () => {
    render(<BilateralStimulus channel="audio" running passMs={2000} volume={0.5} />)
    expect(screen.queryByTestId('bls-dot')).not.toBeNull()
  })

  it('renders no dot when not running', () => {
    render(<BilateralStimulus channel="visual" running={false} passMs={2000} volume={0.5} />)
    expect(screen.queryByTestId('bls-dot')).toBeNull()
  })

  it('keeps a reduced alternating visual cue instead of changing modality', () => {
    prefersReduced = true
    render(<BilateralStimulus channel="visual" running passMs={2000} volume={0.5} />)
    expect(screen.queryByTestId('bls-dot')).not.toBeNull()
  })

  it('does not throw when unmounted mid-run (visual and audio)', () => {
    const visual = render(<BilateralStimulus channel="visual" running passMs={2000} volume={0.5} />)
    expect(() => visual.unmount()).not.toThrow()
    const audio = render(<BilateralStimulus channel="audio" running passMs={2000} volume={0.5} />)
    expect(() => audio.unmount()).not.toThrow()
  })

  it('uses the same frame clock for the visible endpoint and stereo side', async () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
    vi.spyOn(performance, 'now').mockReturnValue(0)
    render(<BilateralStimulus channel="audio" running passMs={2000} volume={0.5} />)
    await act(async () => { await Promise.resolve() })

    act(() => { frame?.(0) })
    expect(screen.getByTestId('bls-dot').style.left).toBe('6%')
    expect(panners.at(-1)?.pan.values.at(-1)).toBe(-1)

    act(() => { frame?.(2000) })
    expect(screen.getByTestId('bls-dot').style.left).toBe('94%')
    expect(panners.at(-1)?.pan.values.at(-1)).toBe(1)
    vi.restoreAllMocks()
  })
})
