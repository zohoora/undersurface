import { describe, it, expect } from 'vitest'
import {
  extractGreenChannel,
  butterworthBandpass,
  detectPeaks,
  computeHrvMetrics,
  classifyAutonomicState,
} from './hrvSignalWorker'

// --- extractGreenChannel ---

describe('extractGreenChannel', () => {
  it('extracts average green value from RGBA pixel data', () => {
    // 4x4 image, RGBA format: all pixels have green=100
    const width = 4
    const height = 4
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      data[i * 4 + 0] = 50   // R
      data[i * 4 + 1] = 100  // G
      data[i * 4 + 2] = 30   // B
      data[i * 4 + 3] = 255  // A
    }
    const result = extractGreenChannel(data, width, height)
    expect(result).toBeCloseTo(100, 1)
  })

  it('samples only the center ROI (0.2 margin)', () => {
    // 10x10 image: center pixels have green=200, border pixels have green=0
    const width = 10
    const height = 10
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const inCenter = x >= 2 && x < 8 && y >= 2 && y < 8
        data[idx + 1] = inCenter ? 200 : 0  // G channel
        data[idx + 3] = 255
      }
    }
    const result = extractGreenChannel(data, width, height)
    // Center ROI averages ~200, border averages 0 — result must be clearly above 100
    expect(result).toBeGreaterThan(100)
  })

  it('returns a number between 0 and 255', () => {
    const width = 4
    const height = 4
    const data = new Uint8ClampedArray(width * height * 4).fill(128)
    const result = extractGreenChannel(data, width, height)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(255)
  })
})

// --- butterworthBandpass ---

describe('butterworthBandpass', () => {
  const SAMPLE_RATE = 30 // 30 fps

  it('returns a signal of the same length', () => {
    const signal = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1))
    const filtered = butterworthBandpass(signal, SAMPLE_RATE)
    expect(filtered).toHaveLength(signal.length)
  })

  it('attenuates DC offset', () => {
    // Pure DC signal — should be nearly zeroed out by the highpass component
    const signal = Array.from({ length: 300 }, () => 100)
    const filtered = butterworthBandpass(signal, SAMPLE_RATE)
    // After filter settles (skip transient), DC should be suppressed
    const settled = filtered.slice(100)
    const mean = settled.reduce((a, b) => a + b, 0) / settled.length
    expect(Math.abs(mean)).toBeLessThan(5)
  })

  it('passes a 1 Hz signal (within 0.7–4 Hz passband)', () => {
    // 1 Hz sine wave at 30 fps
    const signal = Array.from({ length: 300 }, (_, i) => Math.sin(2 * Math.PI * 1 * (i / SAMPLE_RATE)))
    const filtered = butterworthBandpass(signal, SAMPLE_RATE)
    // Skip transient, measure amplitude in the settled region
    const settled = filtered.slice(100)
    const maxAmp = Math.max(...settled.map(Math.abs))
    // Should preserve significant amplitude (at least 50% of input)
    expect(maxAmp).toBeGreaterThan(0.3)
  })

  it('attenuates a 10 Hz signal (above 4 Hz stopband)', () => {
    // 10 Hz sine wave at 30 fps — well above the 4 Hz cutoff
    const signal = Array.from({ length: 300 }, (_, i) => Math.sin(2 * Math.PI * 10 * (i / SAMPLE_RATE)))
    const filtered = butterworthBandpass(signal, SAMPLE_RATE)
    const settled = filtered.slice(50)
    const maxAmp = Math.max(...settled.map(Math.abs))
    // Should be heavily attenuated
    expect(maxAmp).toBeLessThan(0.5)
  })

  it('returns all finite numbers', () => {
    const signal = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.2) * 50)
    const filtered = butterworthBandpass(signal, SAMPLE_RATE)
    for (const v of filtered) {
      expect(isFinite(v)).toBe(true)
    }
  })
})

// --- detectPeaks ---

describe('detectPeaks', () => {
  const SAMPLE_RATE = 30

  it('finds peaks in a sinusoidal signal', () => {
    // 1 Hz sine at 30 fps: peaks every 30 samples → ~3 peaks in 3 seconds
    const signal = Array.from({ length: 90 }, (_, i) => Math.sin(2 * Math.PI * 1 * (i / SAMPLE_RATE)))
    const peaks = detectPeaks(signal, SAMPLE_RATE)
    expect(peaks.length).toBeGreaterThanOrEqual(2)
  })

  it('returns empty array for a flat signal', () => {
    const signal = Array.from({ length: 90 }, () => 0.5)
    const peaks = detectPeaks(signal, SAMPLE_RATE)
    expect(peaks).toHaveLength(0)
  })

  it('returns empty array for near-zero signal', () => {
    const signal = Array.from({ length: 90 }, () => 0.001)
    const peaks = detectPeaks(signal, SAMPLE_RATE)
    expect(peaks).toHaveLength(0)
  })

  it('respects minimum distance between peaks (0.3s)', () => {
    // 5 Hz sine — peaks at 6-sample intervals, but min distance is 0.3s = 9 samples
    const signal = Array.from({ length: 90 }, (_, i) => Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)))
    const peaks = detectPeaks(signal, SAMPLE_RATE)
    // Adjacent peaks should be at least 9 samples apart
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i] - peaks[i - 1]).toBeGreaterThanOrEqual(9)
    }
  })

  it('returns sample indices (numbers)', () => {
    const signal = Array.from({ length: 90 }, (_, i) => Math.sin(2 * Math.PI * 1 * (i / SAMPLE_RATE)))
    const peaks = detectPeaks(signal, SAMPLE_RATE)
    for (const p of peaks) {
      expect(typeof p).toBe('number')
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(90)
    }
  })
})

// --- computeHrvMetrics ---

describe('computeHrvMetrics', () => {
  it('returns null for an empty IBI list', () => {
    expect(computeHrvMetrics([])).toBeNull()
  })

  it('returns null for a single IBI', () => {
    expect(computeHrvMetrics([800])).toBeNull()
  })

  it('computes HR from average IBI', () => {
    // IBIs of 800ms → HR = 60000 / 800 = 75 bpm
    const ibis = [800, 800, 800, 800]
    const result = computeHrvMetrics(ibis)
    expect(result).not.toBeNull()
    expect(result!.hr).toBeCloseTo(75, 0)
  })

  it('computes RMSSD from successive IBI differences', () => {
    // Alternating 800/900ms: successive diffs all 100ms
    // RMSSD = sqrt(mean([100^2, 100^2, 100^2])) = 100
    const ibis = [800, 900, 800, 900, 800]
    const result = computeHrvMetrics(ibis)
    expect(result).not.toBeNull()
    expect(result!.rmssd).toBeCloseTo(100, 0)
  })

  it('returns zero RMSSD for perfectly regular IBIs', () => {
    const ibis = [800, 800, 800, 800, 800]
    const result = computeHrvMetrics(ibis)
    expect(result).not.toBeNull()
    expect(result!.rmssd).toBeCloseTo(0, 1)
  })

  it('returns object with hr and rmssd fields', () => {
    const ibis = [750, 820, 790, 810]
    const result = computeHrvMetrics(ibis)
    expect(result).not.toBeNull()
    expect(result).toHaveProperty('hr')
    expect(result).toHaveProperty('rmssd')
    expect(typeof result!.hr).toBe('number')
    expect(typeof result!.rmssd).toBe('number')
  })
})

// --- classifyAutonomicState ---

describe('classifyAutonomicState', () => {
  it('returns "calm" when ratio > 1.2', () => {
    // High RMSSD relative to HR → parasympathetic dominance → calm
    expect(classifyAutonomicState(60, 80)).toBe('calm')   // ratio = 80/60 ≈ 1.33
    expect(classifyAutonomicState(50, 100)).toBe('calm')  // ratio = 100/50 = 2.0
  })

  it('returns "activated" when ratio < 0.7', () => {
    // Low RMSSD relative to HR → sympathetic dominance → activated
    expect(classifyAutonomicState(100, 60)).toBe('activated')  // ratio = 60/100 = 0.6
    expect(classifyAutonomicState(80, 40)).toBe('activated')   // ratio = 40/80 = 0.5
  })

  it('returns "transitioning" when ratio is between 0.7 and 1.2', () => {
    expect(classifyAutonomicState(70, 70)).toBe('transitioning')   // ratio = 1.0
    expect(classifyAutonomicState(100, 90)).toBe('transitioning')  // ratio = 0.9
    expect(classifyAutonomicState(60, 70)).toBe('transitioning')   // ratio ≈ 1.17
  })

  it('handles edge cases at boundaries', () => {
    // Exactly 1.2 ratio — boundary; calm requires strictly > 1.2
    const at1_2 = classifyAutonomicState(100, 120) // ratio = 1.2
    expect(['calm', 'transitioning']).toContain(at1_2)

    // Exactly 0.7 ratio — boundary
    const at0_7 = classifyAutonomicState(100, 70) // ratio = 0.7
    expect(['activated', 'transitioning']).toContain(at0_7)
  })
})
