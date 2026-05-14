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
  computeRRFromIrregular,
  fuseRespiratoryRate,
  peakConditionedFuse,
  nlmsFilter,
  extractRIAV,
  extractRIIV,
  resampleUniform,
  recentValidRatio,
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

// --- nlmsFilter ---

describe('nlmsFilter', () => {
  it('returns input length and finite values for typical input', () => {
    const target = Array.from({ length: 200 }, (_, i) => Math.sin(i * 0.1) + Math.random() * 0.1)
    const reference = Array.from({ length: 200 }, (_, i) => Math.cos(i * 0.05))
    const out = nlmsFilter(target, reference)
    expect(out).toHaveLength(target.length)
    for (const v of out) expect(isFinite(v)).toBe(true)
  })

  it('returns target unchanged when reference length mismatches', () => {
    const target = [1, 2, 3, 4, 5]
    const reference = [1, 2, 3]
    const out = nlmsFilter(target, reference)
    expect(out).toEqual(target)
  })

  it('suppresses a perfectly-correlated reference (motion-only target)', () => {
    // target = reference (purely correlated noise, no breath component).
    // After NLMS convergence the residual should be much smaller than target.
    const n = 400
    const noise = Array.from({ length: n }, (_, i) => Math.sin(i * 0.2))
    const out = nlmsFilter(noise, noise, 0.1, 8)
    const targetEnergy = noise.slice(100).reduce((s, v) => s + v * v, 0)
    const residualEnergy = out.slice(100).reduce((s, v) => s + v * v, 0)
    expect(residualEnergy).toBeLessThan(targetEnergy * 0.5)
  })

  it('preserves an independent signal even when noise is present', () => {
    // target = breath signal + correlated noise; reference = noise.
    // NLMS should remove the noise and leave the breath signal.
    const n = 400
    const breath = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 0.25 * i / 4))
    const noise = Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i * 0.05))
    const target = breath.map((b, i) => b + noise[i])
    const out = nlmsFilter(target, noise, 0.1, 8)
    // The residual after convergence should correlate strongly with the breath signal
    const settled = out.slice(150)
    const breathSettled = breath.slice(150)
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < settled.length; i++) {
      dot += settled[i] * breathSettled[i]
      normA += settled[i] * settled[i]
      normB += breathSettled[i] * breathSettled[i]
    }
    const correlation = dot / Math.sqrt(normA * normB)
    expect(correlation).toBeGreaterThan(0.5)
  })
})

// --- extractRIAV / extractRIIV ---

describe('extractRIAV', () => {
  it('returns empty for fewer than 2 peaks', () => {
    expect(extractRIAV([1, 2, 3], [], 30)).toEqual([])
    expect(extractRIAV([1, 2, 3], [1], 30)).toEqual([])
  })

  it('returns amplitude samples timestamped at trough indices', () => {
    // Build a simple pulse: peaks at index 10, 30; troughs at 0, 20
    // Pulse: rising from 0 to 1 by index 10, falling to 0 by 20, rising to 1 by 30
    const pulse: number[] = []
    for (let i = 0; i < 40; i++) {
      pulse.push(Math.sin(2 * Math.PI * i / 20))
    }
    const peaks = [5, 25] // sin peaks at i=5 and i=25 (sin(π/2) and sin(5π/2))
    const samples = extractRIAV(pulse, peaks, 30)
    expect(samples).toHaveLength(1) // peaks.length - 1
    expect(samples[0].value).toBeGreaterThan(1.5) // amplitude ~2 for a sine
    expect(samples[0].time).toBeGreaterThan(0)
  })

  it('skips beats with too-close peaks', () => {
    const pulse = Array.from({ length: 20 }, (_, i) => Math.sin(i))
    const peaks = [5, 6, 10, 15] // 5 and 6 are too close (diff < 4)
    const samples = extractRIAV(pulse, peaks, 30)
    // First pair (5,6) skipped; pairs (6,10) and (10,15) produce 2 samples
    expect(samples.length).toBeLessThanOrEqual(2)
  })
})

describe('extractRIIV', () => {
  it('returns empty for fewer than 2 peaks', () => {
    expect(extractRIIV([1, 2], [0], 30)).toEqual([])
  })

  it('returns mean-over-beat samples', () => {
    const pulse = Array.from({ length: 40 }, () => 5) // constant
    const peaks = [5, 25]
    const samples = extractRIIV(pulse, peaks, 30)
    expect(samples).toHaveLength(1)
    expect(samples[0].value).toBeCloseTo(5, 1)
  })

  it('tracks slow envelope drift', () => {
    // Pulse with linear drift over time
    const pulse = Array.from({ length: 60 }, (_, i) => i * 0.1)
    const peaks = [10, 30, 50]
    const samples = extractRIIV(pulse, peaks, 30)
    expect(samples).toHaveLength(2)
    expect(samples[1].value).toBeGreaterThan(samples[0].value)
  })
})

// --- resampleUniform ---

describe('resampleUniform', () => {
  it('returns null for too-few samples', () => {
    expect(resampleUniform([], 4, 12)).toBeNull()
    expect(resampleUniform([{ time: 0, value: 1 }], 4, 12)).toBeNull()
  })

  it('returns null when total duration is below minDurationSec', () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({ time: i, value: 1 }))
    expect(resampleUniform(samples, 4, 12)).toBeNull() // 5s span, need 12s
  })

  it('produces a uniformly-spaced signal at the requested rate', () => {
    // 15 samples spaced 1s apart → 14s span
    const samples = Array.from({ length: 15 }, (_, i) => ({ time: i, value: Math.sin(i * 0.5) }))
    const result = resampleUniform(samples, 4, 12)
    expect(result).not.toBeNull()
    expect(result!.rateHz).toBe(4)
    expect(result!.signal.length).toBe(14 * 4) // 14s × 4 Hz
  })

  it('preserves a periodic signal under resampling', () => {
    // 0.25 Hz signal sampled at 1 Hz over 30s, resampled to 4 Hz
    const samples = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      value: Math.sin(2 * Math.PI * 0.25 * i),
    }))
    const result = resampleUniform(samples, 4, 12)
    expect(result).not.toBeNull()
    // FFT should still find peak at 0.25 Hz
    const peak = findHeartRateFFT(result!.signal, result!.rateHz, 0.1, 0.5)
    expect(peak).not.toBeNull()
    expect(peak!.hr).toBeGreaterThan(13)
    expect(peak!.hr).toBeLessThan(17)
  })
})

// --- computeRRFromIrregular ---

describe('computeRRFromIrregular', () => {
  it('returns null for too-few samples', () => {
    expect(computeRRFromIrregular([])).toBeNull()
  })

  it('finds RR from per-beat amplitude-style irregular samples', () => {
    // Synthesize per-beat samples (one per heartbeat ~1.2s apart) over 30s,
    // amplitude modulated by 0.25 Hz breath
    const samples: Array<{ time: number; value: number }> = []
    let t = 0
    while (t < 30) {
      samples.push({ time: t, value: 1 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t) })
      t += 1.0 + Math.random() * 0.2 // ~1s IBI with jitter
    }
    const rr = computeRRFromIrregular(samples)
    expect(rr).not.toBeNull()
    expect(rr!.rr).toBeGreaterThan(12)
    expect(rr!.rr).toBeLessThan(18)
  })
})

// --- peakConditionedFuse ---

describe('peakConditionedFuse', () => {
  it('returns null when every source is null', () => {
    expect(peakConditionedFuse([null, null, null], null)).toBeNull()
  })

  it('returns a single source unchanged when others are null', () => {
    const result = peakConditionedFuse([null, { rr: 14, confidence: 0.5 }, null], null)
    expect(result).not.toBeNull()
    expect(result!.rr).toBeCloseTo(14, 5)
    expect(result!.contributors).toBe(1)
    expect(result!.agreement).toBe(1)
  })

  it('biases toward sources within the peak-conditioning tolerance of the prior', () => {
    // Prior = 14. Source A=16 conf=0.5, Source B=20 conf=0.5.
    // A is within ±3 of prior, B is not. A should dominate.
    const result = peakConditionedFuse([
      { rr: 16, confidence: 0.5 },
      { rr: 20, confidence: 0.5 },
    ], 14)
    expect(result).not.toBeNull()
    expect(result!.rr).toBeLessThan(18) // A pulled fusion toward 16
  })

  it('penalizes confidence when sources strongly disagree', () => {
    // Two sources, very different rates, no prior.
    const result = peakConditionedFuse([
      { rr: 10, confidence: 0.8 },
      { rr: 25, confidence: 0.8 },
    ], null)
    expect(result).not.toBeNull()
    expect(result!.confidence).toBeLessThan(0.8) // penalty applied
    expect(result!.agreement).toBeLessThan(1) // spread > 0
  })

  it('reports full agreement when sources agree closely', () => {
    const result = peakConditionedFuse([
      { rr: 14, confidence: 0.6 },
      { rr: 14.5, confidence: 0.7 },
      { rr: 13.8, confidence: 0.5 },
    ], 14)
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(0.7) // no penalty
    expect(result!.agreement).toBeGreaterThan(0.9)
    expect(result!.contributors).toBe(3)
  })
})

// --- recentValidRatio ---

describe('recentValidRatio', () => {
  it('returns 0 for empty input', () => {
    expect(recentValidRatio([], 10)).toBe(0)
  })

  it('returns 0 for non-positive lookback', () => {
    expect(recentValidRatio([true, true, true], 0)).toBe(0)
  })

  it('counts ratio over the last `lookback` flags only', () => {
    const flags = [false, false, false, true, true, true, true] // last 4 all true
    expect(recentValidRatio(flags, 4)).toBe(1)
    expect(recentValidRatio(flags, 7)).toBeCloseTo(4 / 7)
  })

  it('returns 1 when all flags are true', () => {
    expect(recentValidRatio([true, true, true], 3)).toBe(1)
  })
})
