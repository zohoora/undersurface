import type { AutonomicState, HrvMeasurement, HrvTrend } from '../types/hrv'

// ---------------------------------------------------------------------------
// Pure signal-processing functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Extract the average green channel value from an RGBA pixel buffer,
 * sampling only the center 60% ROI (0.2 margin on each side).
 */
export function extractGreenChannel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const margin = 0.2
  const xStart = Math.floor(width * margin)
  const xEnd = Math.floor(width * (1 - margin))
  const yStart = Math.floor(height * margin)
  const yEnd = Math.floor(height * (1 - margin))

  let sum = 0
  let count = 0

  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * width + x) * 4
      sum += data[idx + 1] // G channel
      count++
    }
  }

  return count > 0 ? sum / count : 0
}

/**
 * 2nd-order Butterworth bandpass filter (0.7–4 Hz), direct form II transposed.
 * Cascades a highpass (0.7 Hz) and lowpass (4 Hz) biquad.
 */
export function butterworthBandpass(signal: number[], sampleRate: number): number[] {
  // Design coefficients for 2nd-order Butterworth lowpass at 4 Hz
  const lpCoeffs = designButterworthLowpass(4, sampleRate)
  // Design coefficients for 2nd-order Butterworth highpass at 0.7 Hz
  const hpCoeffs = designButterworthHighpass(0.7, sampleRate)

  // Apply highpass then lowpass (cascade)
  const afterHp = applyBiquad(signal, hpCoeffs)
  return applyBiquad(afterHp, lpCoeffs)
}

interface BiquadCoeffs {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

function designButterworthLowpass(cutoffHz: number, sampleRate: number): BiquadCoeffs {
  // Bilinear transform of 2nd-order Butterworth lowpass
  const omega = 2 * Math.PI * cutoffHz / sampleRate
  const c = 1 / Math.tan(omega / 2)
  const sqrt2 = Math.SQRT2

  const b0 = 1 / (1 + sqrt2 * c + c * c)
  const b1 = 2 * b0
  const b2 = b0
  const a1 = 2 * b0 * (1 - c * c)
  const a2 = b0 * (1 - sqrt2 * c + c * c)

  return { b0, b1, b2, a1, a2 }
}

function designButterworthHighpass(cutoffHz: number, sampleRate: number): BiquadCoeffs {
  // Bilinear transform of 2nd-order Butterworth highpass
  const omega = 2 * Math.PI * cutoffHz / sampleRate
  const c = Math.tan(omega / 2)
  const sqrt2 = Math.SQRT2

  const norm = 1 + sqrt2 * c + c * c
  const b0 = 1 / norm
  const b1 = -2 / norm
  const b2 = 1 / norm
  const a1 = 2 * (c * c - 1) / norm
  const a2 = (1 - sqrt2 * c + c * c) / norm

  return { b0, b1, b2, a1, a2 }
}

function applyBiquad(signal: number[], coeffs: BiquadCoeffs): number[] {
  const { b0, b1, b2, a1, a2 } = coeffs
  const out: number[] = new Array(signal.length)
  let w1 = 0
  let w2 = 0

  for (let i = 0; i < signal.length; i++) {
    const x = signal[i]
    const y = b0 * x + w1
    w1 = b1 * x - a1 * y + w2
    w2 = b2 * x - a2 * y
    out[i] = y
  }

  return out
}

/**
 * Detect peaks in a signal using an adaptive threshold.
 * Threshold = mean + 0.3 * std of positive values.
 * Enforces a minimum distance of 0.3s between peaks.
 */
export function detectPeaks(signal: number[], sampleRate: number): number[] {
  const minDist = Math.round(0.3 * sampleRate)
  const positives = signal.filter(v => v > 0)

  if (positives.length === 0) return []

  const mean = positives.reduce((a, b) => a + b, 0) / positives.length
  const variance = positives.reduce((a, b) => a + (b - mean) ** 2, 0) / positives.length
  const std = Math.sqrt(variance)
  const threshold = mean + 0.3 * std

  const peaks: number[] = []

  for (let i = 1; i < signal.length - 1; i++) {
    if (
      signal[i] > threshold &&
      signal[i] > signal[i - 1] &&
      signal[i] > signal[i + 1]
    ) {
      // Enforce minimum distance from last accepted peak
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist) {
        peaks.push(i)
      } else if (signal[i] > signal[peaks[peaks.length - 1]]) {
        // Replace last peak if this one is taller and within min distance
        peaks[peaks.length - 1] = i
      }
    }
  }

  return peaks
}

/**
 * Compute HRV metrics from a list of inter-beat intervals (ms).
 * Returns null if fewer than 2 IBIs are provided.
 */
export function computeHrvMetrics(ibis: number[]): { hr: number; rmssd: number } | null {
  if (ibis.length < 2) return null

  const avgIbi = ibis.reduce((a, b) => a + b, 0) / ibis.length
  const hr = 60000 / avgIbi

  const successiveDiffs: number[] = []
  for (let i = 1; i < ibis.length; i++) {
    successiveDiffs.push((ibis[i] - ibis[i - 1]) ** 2)
  }
  const rmssd = Math.sqrt(successiveDiffs.reduce((a, b) => a + b, 0) / successiveDiffs.length)

  return { hr, rmssd }
}

/**
 * Classify autonomic state from HR and RMSSD.
 * ratio = rmssd / hr
 *   > 1.2  → calm (parasympathetic)
 *   < 0.7  → activated (sympathetic)
 *   else   → transitioning
 */
export function classifyAutonomicState(hr: number, rmssd: number): AutonomicState {
  const ratio = rmssd / hr
  if (ratio > 1.2) return 'calm'
  if (ratio < 0.7) return 'activated'
  return 'transitioning'
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

const CALIBRATION_MIN_MS = 60_000
const CALIBRATION_MAX_MS = 120_000
const SAMPLE_RATE = 30  // expected fps
const BUFFER_SECONDS = 10
const BUFFER_SIZE = SAMPLE_RATE * BUFFER_SECONDS

interface WorkerState {
  greenBuffer: number[]
  timestamps: number[]
  ibis: number[]
  calibrated: boolean
  calibrationStart: number | null
  lastMeasurement: HrvMeasurement | null
  recentHrs: number[]
  recentRmssds: number[]
}

const state: WorkerState = {
  greenBuffer: [],
  timestamps: [],
  ibis: [],
  calibrated: false,
  calibrationStart: null,
  lastMeasurement: null,
  recentHrs: [],
  recentRmssds: [],
}

function resetState() {
  state.greenBuffer = []
  state.timestamps = []
  state.ibis = []
  state.calibrated = false
  state.calibrationStart = null
  state.lastMeasurement = null
  state.recentHrs = []
  state.recentRmssds = []
}

function computeTrend(recent: number[]): HrvTrend {
  if (recent.length < 4) return 'steady'
  const half = Math.floor(recent.length / 2)
  const firstHalf = recent.slice(0, half)
  const secondHalf = recent.slice(half)
  const firstMean = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
  const secondMean = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
  const delta = (secondMean - firstMean) / (firstMean || 1)
  if (delta > 0.05) return 'rising'
  if (delta < -0.05) return 'falling'
  return 'steady'
}

function computeConfidence(ibis: number[]): number {
  // Confidence based on IBI count (more IBIs = more confident)
  const base = Math.min(ibis.length / 20, 1)
  // Penalise high variability (coefficient of variation)
  if (ibis.length < 2) return base * 0.5
  const mean = ibis.reduce((a, b) => a + b, 0) / ibis.length
  const std = Math.sqrt(ibis.reduce((a, b) => a + (b - mean) ** 2, 0) / ibis.length)
  const cv = std / (mean || 1)
  const variabilityPenalty = Math.max(0, 1 - cv * 2)
  return base * variabilityPenalty
}

// ---------------------------------------------------------------------------
// Worker message handler (only attached in a Worker context)
// ---------------------------------------------------------------------------

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (event: MessageEvent) => {
    const { type, data } = event.data as { type: string; data: unknown }

    if (type === 'frame') {
      const { imageData, timestamp } = data as { imageData: ImageData; timestamp: number }
      const green = extractGreenChannel(imageData.data, imageData.width, imageData.height)

      state.greenBuffer.push(green)
      state.timestamps.push(timestamp)

      if (state.calibrationStart === null) {
        state.calibrationStart = timestamp
      }

      // Keep buffer at fixed size
      if (state.greenBuffer.length > BUFFER_SIZE) {
        state.greenBuffer.shift()
        state.timestamps.shift()
      }

      // Check calibration progress
      const elapsed = timestamp - state.calibrationStart
      if (!state.calibrated) {
        const progress = Math.min(elapsed / CALIBRATION_MIN_MS, 1)
        self.postMessage({ type: 'calibration_progress', data: { progress } })

        if (elapsed >= CALIBRATION_MIN_MS) {
          state.calibrated = true
          self.postMessage({ type: 'calibration_complete' })
        }
      }
    }

    if (type === 'compute') {
      if (state.greenBuffer.length < SAMPLE_RATE * 2) return

      const filtered = butterworthBandpass(state.greenBuffer, SAMPLE_RATE)
      const peaks = detectPeaks(filtered, SAMPLE_RATE)

      if (peaks.length < 2) return

      // Compute IBIs from peak positions
      const newIbis: number[] = []
      for (let i = 1; i < peaks.length; i++) {
        const dt = (peaks[i] - peaks[i - 1]) / SAMPLE_RATE * 1000
        if (dt > 300 && dt < 2000) newIbis.push(dt) // valid heart rate range: 30–200 bpm
      }

      if (newIbis.length > 0) {
        state.ibis = [...state.ibis, ...newIbis].slice(-50)
      }

      const metrics = computeHrvMetrics(state.ibis)
      if (!metrics) return

      const { hr, rmssd } = metrics

      state.recentHrs.push(hr)
      state.recentRmssds.push(rmssd)
      if (state.recentHrs.length > 10) state.recentHrs.shift()
      if (state.recentRmssds.length > 10) state.recentRmssds.shift()

      const autonomicState = classifyAutonomicState(hr, rmssd)
      const trend: HrvTrend = computeTrend(state.recentRmssds)
      const confidence = computeConfidence(state.ibis)

      const measurement: HrvMeasurement = {
        timestamp: Date.now(),
        hr: Math.round(hr * 10) / 10,
        rmssd: Math.round(rmssd * 10) / 10,
        autonomicState,
        trend,
        confidence,
      }

      state.lastMeasurement = measurement
      self.postMessage({ type: 'measurement', data: measurement })
    }

    if (type === 'reset') {
      resetState()
    }
  }
}
