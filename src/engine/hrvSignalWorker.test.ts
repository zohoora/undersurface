import { describe, it, expect } from 'vitest'
import {
  extractGreenChannel,
  chromPulseExtraction,
  findHeartRateFFT,
  butterworthBandpass,
  detectPeaks,
  computeHrvMetrics,
  classifyAutonomicState,
  computeRRFromSignal,
  fuseRespiratoryRate,
  variance,
  chestPresent,
  CHEST_VARIANCE_MIN,
} from './hrvSignalWorker'

// --- extractGreenChannel ---

describe('extractGreenChannel', () => {
  it('extracts average green from skin-colored pixels', () => {
    // 4x4 image: all pixels are skin-toned (R>G>B)
    const width = 4
    const height = 4
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      data[i * 4 + 0] = 180  // R (skin-like)
      data[i * 4 + 1] = 140  // G
      data[i * 4 + 2] = 100  // B
      data[i * 4 + 3] = 255  // A
    }
    const result = extractGreenChannel(data, width, height)
    expect(result).toBeCloseTo(140, 1)
  })

  it('ignores non-skin pixels', () => {
    // 4x4 image: mix of skin and non-skin (blue wall)
    const width = 4
    const height = 4
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      if (i < 8) {
        // Skin pixels: green=140
        data[i * 4 + 0] = 180
        data[i * 4 + 1] = 140
        data[i * 4 + 2] = 100
      } else {
        // Blue wall: should be ignored
        data[i * 4 + 0] = 80
        data[i * 4 + 1] = 100
        data[i * 4 + 2] = 180
      }
      data[i * 4 + 3] = 255
    }
    const result = extractGreenChannel(data, width, height)
    // Should only average skin pixels (green=140), not blue wall
    expect(result).toBeCloseTo(140, 0)
  })

  it('returns 0 when no skin pixels found', () => {
    const width = 4
    const height = 4
    const data = new Uint8ClampedArray(width * height * 4)
    // All blue (non-skin)
    for (let i = 0; i < width * height; i++) {
      data[i * 4 + 0] = 50
      data[i * 4 + 1] = 50
      data[i * 4 + 2] = 200
      data[i * 4 + 3] = 255
    }
    const result = extractGreenChannel(data, width, height)
    expect(result).toBe(0)
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

// --- classifyAutonomicState (rmssd, baseline) ---

describe('classifyAutonomicState', () => {
  it('returns "calm" when rmssd > 1.3x baseline', () => {
    expect(classifyAutonomicState(80, 50)).toBe('calm')   // ratio = 1.6
    expect(classifyAutonomicState(70, 50)).toBe('calm')   // ratio = 1.4
  })

  it('returns "activated" when rmssd < 0.7x baseline', () => {
    expect(classifyAutonomicState(30, 50)).toBe('activated')  // ratio = 0.6
    expect(classifyAutonomicState(20, 50)).toBe('activated')  // ratio = 0.4
  })

  it('returns "transitioning" when rmssd is near baseline', () => {
    expect(classifyAutonomicState(50, 50)).toBe('transitioning')  // ratio = 1.0
    expect(classifyAutonomicState(55, 50)).toBe('transitioning')  // ratio = 1.1
    expect(classifyAutonomicState(40, 50)).toBe('transitioning')  // ratio = 0.8
  })

  it('returns "transitioning" for zero baseline', () => {
    expect(classifyAutonomicState(50, 0)).toBe('transitioning')
  })
})

// --- CHROM pulse extraction ---

describe('chromPulseExtraction', () => {
  it('returns pulse signal of same length as input', () => {
    const r = Array.from({ length: 100 }, () => 150 + Math.random())
    const g = Array.from({ length: 100 }, () => 120 + Math.random())
    const b = Array.from({ length: 100 }, () => 90 + Math.random())
    const pulse = chromPulseExtraction(r, g, b, 30)
    expect(pulse).toHaveLength(100)
  })

  it('returns empty for single-sample input', () => {
    expect(chromPulseExtraction([150], [120], [90], 30)).toHaveLength(0)
  })

  it('extracts periodic signal from synthetic pulse in green channel', () => {
    const fps = 60
    const n = fps * 5
    const freq = 1.2 // 72 BPM
    const r = Array.from({ length: n }, () => 150)
    const g = Array.from({ length: n }, (_, i) => 120 + 0.5 * Math.sin(2 * Math.PI * freq * i / fps))
    const b = Array.from({ length: n }, () => 90)
    const pulse = chromPulseExtraction(r, g, b, fps)
    // Pulse should have non-zero variance (detected the oscillation)
    const mean = pulse.reduce((a, c) => a + c, 0) / pulse.length
    const variance = pulse.reduce((a, c) => a + (c - mean) ** 2, 0) / pulse.length
    expect(variance).toBeGreaterThan(0)
  })
})

// --- FFT heart rate detection ---

describe('findHeartRateFFT', () => {
  it('detects 72 BPM from a 1.2 Hz sine wave', () => {
    const fps = 60
    const n = fps * 10
    const signal = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 1.2 * i / fps))
    const result = findHeartRateFFT(signal, fps)
    expect(result).not.toBeNull()
    expect(result!.hr).toBeGreaterThan(65)
    expect(result!.hr).toBeLessThan(80)
  })

  it('returns null for flat signal', () => {
    const signal = Array.from({ length: 256 }, () => 0)
    const result = findHeartRateFFT(signal, 60)
    expect(result).toBeNull()
  })

  it('returns confidence > 0 for clean signal', () => {
    const fps = 60
    const signal = Array.from({ length: fps * 10 }, (_, i) => Math.sin(2 * Math.PI * 1.0 * i / fps))
    const result = findHeartRateFFT(signal, fps)
    expect(result).not.toBeNull()
    expect(result!.confidence).toBeGreaterThan(0)
  })
})

// --- variance ---

describe('variance', () => {
  it('returns 0 for empty / single-sample input', () => {
    expect(variance([])).toBe(0)
    expect(variance([5])).toBe(0)
  })
  it('returns 0 for a constant signal', () => {
    expect(variance([3, 3, 3, 3, 3])).toBe(0)
  })
  it('matches the textbook definition for a small example', () => {
    // mean = 3, deviations 4, 1, 0, 1, 4, sum 10, /5 = 2
    expect(variance([1, 2, 3, 4, 5])).toBe(2)
  })
})

// --- chestPresent ---

describe('chestPresent', () => {
  it('is false for a flat signal (chest out of frame)', () => {
    expect(chestPresent(Array.from({ length: 100 }, () => 120))).toBe(false)
  })
  it('is false for signal with imperceptible variance', () => {
    // Camera noise ~±0.3 around mean. Below the threshold by design.
    expect(chestPresent(Array.from({ length: 100 }, (_, i) => 120 + 0.2 * Math.sin(i))))
      .toBe(false)
  })
  it('is true for an oscillating signal at chest-motion amplitude', () => {
    // Amplitude 2 → variance ~2, comfortably above CHEST_VARIANCE_MIN (0.5)
    expect(chestPresent(Array.from({ length: 100 }, (_, i) => 120 + 2 * Math.sin(i))))
      .toBe(true)
  })
  it('threshold constant is exported for tuning visibility', () => {
    expect(CHEST_VARIANCE_MIN).toBeGreaterThan(0)
  })
})

// --- computeRRFromSignal ---

describe('computeRRFromSignal', () => {
  const fps = 30
  function sinusoid(freqHz: number, durationSec: number, amplitude = 1): number[] {
    const n = Math.round(fps * durationSec)
    return Array.from({ length: n }, (_, i) => amplitude * Math.sin(2 * Math.PI * freqHz * i / fps))
  }

  it('returns null when buffer is shorter than RR_MIN_BUFFER_SECONDS', () => {
    expect(computeRRFromSignal(sinusoid(0.25, 10), fps)).toBeNull()
  })

  it('finds the correct rate for a synthetic 15 BPM signal', () => {
    // 15 BPM = 0.25 Hz, well inside 0.15-0.45 Hz band
    const result = computeRRFromSignal(sinusoid(0.25, 30), fps)
    expect(result).not.toBeNull()
    expect(result!.rr).toBeGreaterThan(13)
    expect(result!.rr).toBeLessThan(17)
    expect(result!.confidence).toBeGreaterThan(0)
  })

  it('returns null for a flat signal (no spectral peak)', () => {
    expect(computeRRFromSignal(Array.from({ length: fps * 30 }, () => 0), fps)).toBeNull()
  })

  it('finds a rate at the upper band edge (27 BPM = 0.45 Hz)', () => {
    const result = computeRRFromSignal(sinusoid(0.45, 30), fps)
    expect(result).not.toBeNull()
    expect(result!.rr).toBeGreaterThan(25)
    expect(result!.rr).toBeLessThan(29)
  })
})

// --- fuseRespiratoryRate ---

describe('fuseRespiratoryRate', () => {
  it('returns null when every source is null', () => {
    expect(fuseRespiratoryRate([null, null, null])).toBeNull()
  })

  it('returns the single non-null source unchanged', () => {
    const result = fuseRespiratoryRate([null, { rr: 14, confidence: 0.5 }, null])
    expect(result).not.toBeNull()
    expect(result!.rr).toBeCloseTo(14, 5)
    expect(result!.confidence).toBe(0.5)
  })

  it('biases the fused rate toward the higher-confidence source', () => {
    // Source A: rr=10 conf=0.9 (w=0.81), Source B: rr=20 conf=0.3 (w=0.09)
    // Expected weighted mean: (10*0.81 + 20*0.09) / 0.9 = 11.0
    const result = fuseRespiratoryRate([
      { rr: 10, confidence: 0.9 },
      { rr: 20, confidence: 0.3 },
    ])
    expect(result).not.toBeNull()
    expect(result!.rr).toBeCloseTo(11, 1)
    expect(result!.confidence).toBe(0.9)
  })

  it('lets a single high-confidence source dominate two low-confidence ones', () => {
    // RSA noisy at conf 0.15, two strong signals agree at 12
    const result = fuseRespiratoryRate([
      { rr: 18, confidence: 0.15 },
      { rr: 12, confidence: 0.7 },
      { rr: 12, confidence: 0.8 },
    ])
    expect(result).not.toBeNull()
    expect(result!.rr).toBeGreaterThan(11.5)
    expect(result!.rr).toBeLessThan(13)
  })

  it('skips null sources in the input array', () => {
    const result = fuseRespiratoryRate([null, { rr: 15, confidence: 0.5 }, null, { rr: 15, confidence: 0.5 }])
    expect(result).not.toBeNull()
    expect(result!.rr).toBeCloseTo(15, 5)
  })

  it('emits zero total weight as null (defensive)', () => {
    expect(fuseRespiratoryRate([
      { rr: 12, confidence: 0 },
      { rr: 14, confidence: 0 },
    ])).toBeNull()
  })
})
