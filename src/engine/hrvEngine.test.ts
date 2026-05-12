// Most of HrvEngine's surface is browser-API plumbing (getUserMedia,
// OffscreenCanvas, Worker, MediaStream) which jsdom doesn't implement.
// These tests cover what IS pure: instantiation, the module-level heart-rate
// accessor, default state, and the callback-registration API.
//
// The signal-processing core lives in hrvSignalWorker.ts and has its own
// dedicated tests (CHROM, FFT, peak detection, bandpass filter). End-to-end
// behavior is verified on the live site via the Relax / Session HRV path.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../services/diagnostics', () => ({
  engineLog: vi.fn(),
}))

const { HrvEngine, getCurrentHeartRate } = await import('./hrvEngine')

describe('module-level getCurrentHeartRate', () => {
  it('returns null before any engine has produced a measurement', () => {
    expect(getCurrentHeartRate()).toBeNull()
  })
})

describe('HrvEngine — instantiation + default state', () => {
  let engine: InstanceType<typeof HrvEngine>

  beforeEach(() => {
    engine = new HrvEngine()
  })

  it('instantiates without throwing', () => {
    expect(engine).toBeInstanceOf(HrvEngine)
  })

  it('starts in calibrating state (true until first window completes)', () => {
    expect(engine.isCalibrating()).toBe(true)
  })

  it('has no latest measurement before start()', () => {
    expect(engine.getLatest()).toBeNull()
  })

  it('has no MediaStream before start()', () => {
    expect(engine.getStream()).toBeNull()
  })

  it('has no video size before start()', () => {
    expect(engine.getVideoSize()).toBeNull()
  })

  it('exposes an empty signal-dump array before start()', () => {
    expect(engine.getSignalDumps()).toEqual([])
  })
})

describe('HrvEngine — callback registration', () => {
  it('onMeasurement accepts callbacks (no throw on subscribe)', () => {
    const engine = new HrvEngine()
    expect(() => engine.onMeasurement(() => {})).not.toThrow()
  })

  it('onCalibrationComplete accepts callbacks', () => {
    const engine = new HrvEngine()
    expect(() => engine.onCalibrationComplete(() => {})).not.toThrow()
  })

  it('onError accepts callbacks', () => {
    const engine = new HrvEngine()
    expect(() => engine.onError(() => {})).not.toThrow()
  })
})

describe('HrvEngine — setSessionId', () => {
  it('accepts a string id', () => {
    const engine = new HrvEngine()
    expect(() => engine.setSessionId('chat-1')).not.toThrow()
  })

  it('accepts null (detach from any session)', () => {
    const engine = new HrvEngine()
    expect(() => engine.setSessionId(null)).not.toThrow()
  })
})

describe('HrvEngine — stop() is safe to call without start()', () => {
  it('does not throw when called before start (idempotent teardown)', () => {
    const engine = new HrvEngine()
    expect(() => engine.stop()).not.toThrow()
  })

  it('leaves the engine in a clean state after stop() with no start()', () => {
    const engine = new HrvEngine()
    engine.stop()
    expect(engine.getLatest()).toBeNull()
    expect(engine.getStream()).toBeNull()
    expect(engine.isCalibrating()).toBe(true)
  })
})
