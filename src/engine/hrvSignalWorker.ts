import type { AutonomicState, HrvDerivedMetrics, HrvMeasurement, HrvTrend } from '../types/hrv'

// ---------------------------------------------------------------------------
// Pure signal-processing functions (exported for testing)
// ---------------------------------------------------------------------------

/** Test if a pixel is likely skin using RGB heuristics. */
function isSkinPixel(r: number, g: number, b: number): boolean {
  if (r < 60 || g < 40 || b < 20) return false
  if (r <= g || g <= b) return false
  if (r - g < 15) return false
  if (r > 240 && g > 240 && b > 240) return false
  if (r - b < 20) return false
  return true
}

/** Extract average R, G, B from skin pixels in the ROI. */
export function extractRGBFromSkin(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  roi?: { x: number; y: number; width: number; height: number } | null,
): { r: number; g: number; b: number; skinCount: number } {
  let xStart: number, xEnd: number, yStart: number, yEnd: number

  if (roi && roi.width > 0 && roi.height > 0) {
    xStart = Math.max(0, Math.floor(roi.x))
    yStart = Math.max(0, Math.floor(roi.y))
    xEnd = Math.min(width, Math.floor(roi.x + roi.width))
    yEnd = Math.min(height, Math.floor(roi.y + roi.height))
  } else {
    const margin = 0.2
    xStart = Math.floor(width * margin)
    xEnd = Math.floor(width * (1 - margin))
    yStart = Math.floor(height * margin)
    yEnd = Math.floor(height * (1 - margin))
  }

  let sumR = 0, sumG = 0, sumB = 0, count = 0

  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      if (isSkinPixel(r, g, b)) {
        sumR += r
        sumG += g
        sumB += b
        count++
      }
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0, skinCount: 0 }
  return { r: sumR / count, g: sumG / count, b: sumB / count, skinCount: count }
}

// Keep backward compat for tests
export function extractGreenChannel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  roi?: { x: number; y: number; width: number; height: number } | null,
): number {
  return extractRGBFromSkin(data, width, height, roi).g
}

export function countSkinPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const margin = 0.2
  const xStart = Math.floor(width * margin)
  const xEnd = Math.floor(width * (1 - margin))
  const yStart = Math.floor(height * margin)
  const yEnd = Math.floor(height * (1 - margin))

  let count = 0
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * width + x) * 4
      if (isSkinPixel(data[idx], data[idx + 1], data[idx + 2])) count++
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// CHROM algorithm: Chrominance-based rPPG (de Haan & Jeanne, 2013)
// Reference: rPPG-Toolbox (NeurIPS 2023) — 1.6s windows, 50% overlap, Hann OLA
// ---------------------------------------------------------------------------

/**
 * Windowed CHROM pulse extraction following the reference implementation.
 * Processes RGB in sliding 1.6s windows with 50% overlap.
 * Each window: normalize RGB by window mean, compute chrominance, adaptive alpha.
 * Windows are Hann-windowed and overlap-added for smooth output.
 */
export function chromPulseExtraction(
  rSignal: number[],
  gSignal: number[],
  bSignal: number[],
  sampleRate: number,
): number[] {
  const n = rSignal.length
  if (n < 2) return []

  const winLen = Math.round(sampleRate * 1.6) // 1.6 second windows (reference standard)
  if (n < winLen) {
    // Buffer too short for windowed processing — fall back to single-window
    return chromSingleWindow(rSignal, gSignal, bSignal)
  }

  const stepLen = Math.floor(winLen / 2) // 50% overlap
  const output = new Array(n).fill(0)
  const weights = new Array(n).fill(0) // for overlap-add normalization

  // Precompute Hann window
  const hann = new Array(winLen)
  for (let i = 0; i < winLen; i++) {
    hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (winLen - 1)))
  }

  for (let start = 0; start + winLen <= n; start += stepLen) {
    const rWin = rSignal.slice(start, start + winLen)
    const gWin = gSignal.slice(start, start + winLen)
    const bWin = bSignal.slice(start, start + winLen)

    // Per-window normalization: divide by window mean
    const rMean = rWin.reduce((a, b) => a + b, 0) / winLen
    const gMean = gWin.reduce((a, b) => a + b, 0) / winLen
    const bMean = bWin.reduce((a, b) => a + b, 0) / winLen

    if (rMean === 0 || gMean === 0 || bMean === 0) continue

    // Chrominance signals per window
    const xs = new Array(winLen)
    const ys = new Array(winLen)
    for (let i = 0; i < winLen; i++) {
      const rn = rWin[i] / rMean
      const gn = gWin[i] / gMean
      const bn = bWin[i] / bMean
      xs[i] = 3 * rn - 2 * gn
      ys[i] = 1.5 * rn + gn - 1.5 * bn
    }

    // Per-window adaptive alpha = std(X) / std(Y)
    const xMean = xs.reduce((a: number, b: number) => a + b, 0) / winLen
    const yMean = ys.reduce((a: number, b: number) => a + b, 0) / winLen
    const xStd = Math.sqrt(xs.reduce((a: number, b: number) => a + (b - xMean) ** 2, 0) / winLen)
    const yStd = Math.sqrt(ys.reduce((a: number, b: number) => a + (b - yMean) ** 2, 0) / winLen)
    const alpha = yStd > 0.0001 ? xStd / yStd : 1

    // Combine with Hann window and overlap-add
    for (let i = 0; i < winLen; i++) {
      const val = (xs[i] - alpha * ys[i]) * hann[i]
      output[start + i] += val
      weights[start + i] += hann[i]
    }
  }

  // Normalize by overlap weight
  for (let i = 0; i < n; i++) {
    if (weights[i] > 0) output[i] /= weights[i]
  }

  return output
}

/** Fallback: single-window CHROM for short buffers */
function chromSingleWindow(rSignal: number[], gSignal: number[], bSignal: number[]): number[] {
  const n = rSignal.length
  const rMean = rSignal.reduce((a, b) => a + b, 0) / n
  const gMean = gSignal.reduce((a, b) => a + b, 0) / n
  const bMean = bSignal.reduce((a, b) => a + b, 0) / n

  if (rMean === 0 || gMean === 0 || bMean === 0) return new Array(n).fill(0)

  const xs = new Array(n)
  const ys = new Array(n)
  for (let i = 0; i < n; i++) {
    const rn = rSignal[i] / rMean
    const gn = gSignal[i] / gMean
    const bn = bSignal[i] / bMean
    xs[i] = 3 * rn - 2 * gn
    ys[i] = 1.5 * rn + gn - 1.5 * bn
  }

  const xMean = xs.reduce((a: number, b: number) => a + b, 0) / n
  const yMean = ys.reduce((a: number, b: number) => a + b, 0) / n
  const xStd = Math.sqrt(xs.reduce((a: number, b: number) => a + (b - xMean) ** 2, 0) / n)
  const yStd = Math.sqrt(ys.reduce((a: number, b: number) => a + (b - yMean) ** 2, 0) / n)
  const alpha = yStd > 0.0001 ? xStd / yStd : 1

  return xs.map((x, i) => x - alpha * ys[i])
}

// ---------------------------------------------------------------------------
// FFT-based heart rate extraction
// ---------------------------------------------------------------------------

/** Simple radix-2 FFT (in-place, Cooley-Tukey). Input length must be power of 2. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1
    const angle = -2 * Math.PI / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0
      for (let j = 0; j < halfLen; j++) {
        const a = i + j
        const b = a + halfLen
        const tRe = curRe * re[b] - curIm * im[b]
        const tIm = curRe * im[b] + curIm * re[b]
        re[b] = re[a] - tRe
        im[b] = im[a] - tIm
        re[a] += tRe
        im[a] += tIm
        const newCurRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = newCurRe
      }
    }
  }
}

/**
 * Find dominant frequency in a given range using FFT.
 * No sub-harmonic switching — rely on the restricted frequency band instead
 * (research shows sub-harmonic switching can cause false corrections).
 */
export function findHeartRateFFT(
  signal: number[],
  sampleRate: number,
  minHz = 0.75,
  maxHz = 2.5,
): { hr: number; confidence: number } | null {
  let fftSize = 1
  while (fftSize < signal.length) fftSize <<= 1

  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)

  // Apply Hann window
  for (let i = 0; i < signal.length; i++) {
    const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (signal.length - 1)))
    re[i] = signal[i] * window
  }

  fft(re, im)

  const minBin = Math.floor(minHz * fftSize / sampleRate)
  const maxBin = Math.ceil(maxHz * fftSize / sampleRate)

  let peakPower = 0
  let peakBin = 0
  let totalPower = 0

  for (let i = minBin; i <= maxBin && i < fftSize / 2; i++) {
    const power = re[i] * re[i] + im[i] * im[i]
    totalPower += power
    if (power > peakPower) {
      peakPower = power
      peakBin = i
    }
  }

  if (peakBin === 0 || totalPower === 0) return null

  // Parabolic interpolation for sub-bin accuracy
  const prevPower = peakBin > 0 ? re[peakBin - 1] ** 2 + im[peakBin - 1] ** 2 : 0
  const nextPower = peakBin < fftSize / 2 - 1 ? re[peakBin + 1] ** 2 + im[peakBin + 1] ** 2 : 0
  const denom = 2 * peakPower - prevPower - nextPower
  const shift = denom > 0 ? (nextPower - prevPower) / (2 * denom) : 0
  const exactBin = peakBin + Math.max(-0.5, Math.min(0.5, shift))

  const freqHz = exactBin * sampleRate / fftSize
  const hr = freqHz * 60

  // SNR-based confidence
  const avgPower = totalPower / (maxBin - minBin + 1)
  const snr = avgPower > 0 ? peakPower / avgPower : 0
  const confidence = Math.min(1, Math.max(0, (snr - 1) / 10))

  return { hr, confidence }
}

// ---------------------------------------------------------------------------
// Bandpass filters
// ---------------------------------------------------------------------------

interface BiquadCoeffs { b0: number; b1: number; b2: number; a1: number; a2: number }

function designButterworthLowpass(cutoffHz: number, sampleRate: number): BiquadCoeffs {
  const omega = 2 * Math.PI * cutoffHz / sampleRate
  const c = 1 / Math.tan(omega / 2)
  const b0 = 1 / (1 + Math.SQRT2 * c + c * c)
  return { b0, b1: 2 * b0, b2: b0, a1: 2 * b0 * (1 - c * c), a2: b0 * (1 - Math.SQRT2 * c + c * c) }
}

function designButterworthHighpass(cutoffHz: number, sampleRate: number): BiquadCoeffs {
  const omega = 2 * Math.PI * cutoffHz / sampleRate
  const c = Math.tan(omega / 2)
  const norm = 1 + Math.SQRT2 * c + c * c
  return { b0: 1 / norm, b1: -2 / norm, b2: 1 / norm, a1: 2 * (c * c - 1) / norm, a2: (1 - Math.SQRT2 * c + c * c) / norm }
}

function applyBiquad(signal: number[], coeffs: BiquadCoeffs): number[] {
  const { b0, b1, b2, a1, a2 } = coeffs
  const out = new Array(signal.length)
  let w1 = 0, w2 = 0
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i]
    const y = b0 * x + w1
    w1 = b1 * x - a1 * y + w2
    w2 = b2 * x - a2 * y
    out[i] = y
  }
  return out
}

/** Cardiac bandpass: 1.2-2.5 Hz (72-150 BPM)
 * Aggressive high-pass at 1.2 Hz to suppress environmental noise (lighting flicker,
 * auto-exposure artifacts, aliased fluorescent harmonics) that dominate 0.5-1.1 Hz.
 * Uses 2 cascaded highpass stages (4th order) for steeper rolloff.
 * 72 BPM lower bound is safe — resting HR while sitting is typically 60-100 BPM,
 * and the filter transition band still passes 65+ BPM with reduced gain. */
export function butterworthBandpass(signal: number[], sampleRate: number): number[] {
  const hp = designButterworthHighpass(1.2, sampleRate)
  const stage1 = applyBiquad(signal, hp)
  const stage2 = applyBiquad(stage1, hp)
  return applyBiquad(stage2, designButterworthLowpass(2.5, sampleRate))
}

/** Respiratory bandpass: 0.1-0.5 Hz (6-30 breaths/min) */
export function respiratoryBandpass(signal: number[], sampleRate: number): number[] {
  return applyBiquad(applyBiquad(signal, designButterworthHighpass(0.1, sampleRate)), designButterworthLowpass(0.5, sampleRate))
}

// ---------------------------------------------------------------------------
// Peak detection (for IBI-based RMSSD)
// ---------------------------------------------------------------------------

export function detectPeaks(signal: number[], sampleRate: number): number[] {
  const minDist = Math.round(0.3 * sampleRate)
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length
  const variance = signal.reduce((a, b) => a + (b - mean) ** 2, 0) / signal.length
  const std = Math.sqrt(variance)
  if (std < 0.0001) return []
  const threshold = mean + 0.4 * std

  const peaks: number[] = []
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > threshold && signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist) {
        peaks.push(i)
      } else if (signal[i] > signal[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i
      }
    }
  }
  return peaks
}

export function computeHrvMetrics(ibis: number[]): { hr: number; rmssd: number } | null {
  if (ibis.length < 2) return null
  const avgIbi = ibis.reduce((a, b) => a + b, 0) / ibis.length
  const hr = 60000 / avgIbi
  let sumSqDiff = 0
  for (let i = 1; i < ibis.length; i++) sumSqDiff += (ibis[i] - ibis[i - 1]) ** 2
  return { hr, rmssd: Math.sqrt(sumSqDiff / (ibis.length - 1)) }
}

export function classifyAutonomicState(rmssd: number, baseline: number): AutonomicState {
  if (baseline <= 0) return 'transitioning'
  const ratio = rmssd / baseline
  if (ratio > 1.3) return 'calm'
  if (ratio < 0.7) return 'activated'
  return 'transitioning'
}

// ---------------------------------------------------------------------------
// Derived HRV metrics (computed from IBI series)
// ---------------------------------------------------------------------------

/** Compute advanced HRV metrics from inter-beat intervals */
export function computeDerivedMetrics(ibis: number[]): HrvDerivedMetrics | null {
  if (ibis.length < 4) return null

  // SDNN: standard deviation of all IBIs
  const mean = ibis.reduce((a, b) => a + b, 0) / ibis.length
  const sdnn = Math.sqrt(ibis.reduce((a, b) => a + (b - mean) ** 2, 0) / ibis.length)

  // pNN50: percentage of successive IBI differences > 50ms
  let nn50Count = 0
  for (let i = 1; i < ibis.length; i++) {
    if (Math.abs(ibis[i] - ibis[i - 1]) > 50) nn50Count++
  }
  const pnn50 = (nn50Count / (ibis.length - 1)) * 100

  // LF/HF ratio via FFT on the IBI series
  // Resample IBIs to evenly-spaced series at 4 Hz (standard for HRV frequency analysis)
  const lfHfRatio = computeLfHfRatio(ibis)

  // Baevsky Stress Index: AMo / (2 * Mo * MxDMn)
  // AMo = amplitude of the mode (% of IBIs in the modal bin)
  // Mo = mode value (most common IBI)
  // MxDMn = range (max - min IBI)
  const stressIndex = computeStressIndex(ibis)

  // Cardiac coherence: how sinusoidal the IBI variation is (0-1)
  const coherence = computeCoherence(ibis)

  return {
    sdnn: Math.round(sdnn * 10) / 10,
    pnn50: Math.round(pnn50 * 10) / 10,
    lfHfRatio,
    stressIndex: Math.round(stressIndex * 10) / 10,
    coherence: Math.round(coherence * 100) / 100,
  }
}

function computeLfHfRatio(ibis: number[]): number | null {
  if (ibis.length < 10) return null

  // Interpolate IBIs to 4 Hz evenly-spaced signal
  // Build cumulative time axis
  const times: number[] = [0]
  for (let i = 0; i < ibis.length; i++) {
    times.push(times[i] + ibis[i] / 1000) // seconds
  }

  const totalTime = times[times.length - 1]
  const interpRate = 4 // Hz
  const n = Math.floor(totalTime * interpRate)
  if (n < 16) return null

  // Linear interpolation of IBI values
  const interp: number[] = []
  let ibiIdx = 0
  for (let i = 0; i < n; i++) {
    const t = i / interpRate
    while (ibiIdx < times.length - 2 && times[ibiIdx + 1] < t) ibiIdx++
    interp.push(ibis[Math.min(ibiIdx, ibis.length - 1)])
  }

  // Detrend
  const interpMean = interp.reduce((a, b) => a + b, 0) / interp.length
  const detrended = interp.map(v => v - interpMean)

  // FFT
  let fftSize = 1
  while (fftSize < detrended.length) fftSize <<= 1
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  for (let i = 0; i < detrended.length; i++) {
    re[i] = detrended[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (detrended.length - 1)))
  }
  fft(re, im)

  // Sum power in LF (0.04-0.15 Hz) and HF (0.15-0.4 Hz)
  let lfPower = 0, hfPower = 0
  for (let i = 1; i < fftSize / 2; i++) {
    const freq = i * interpRate / fftSize
    const power = re[i] * re[i] + im[i] * im[i]
    if (freq >= 0.04 && freq < 0.15) lfPower += power
    else if (freq >= 0.15 && freq <= 0.4) hfPower += power
  }

  if (hfPower === 0) return null
  return Math.round((lfPower / hfPower) * 100) / 100
}

function computeStressIndex(ibis: number[]): number {
  // Histogram with 50ms bins
  const binWidth = 50
  const minIbi = Math.min(...ibis)
  const maxIbi = Math.max(...ibis)
  const range = maxIbi - minIbi
  if (range === 0) return 0

  const nBins = Math.max(1, Math.ceil(range / binWidth))
  const bins = new Array(nBins).fill(0)
  for (const ibi of ibis) {
    const bin = Math.min(nBins - 1, Math.floor((ibi - minIbi) / binWidth))
    bins[bin]++
  }

  // Mode: most common bin
  let maxCount = 0, modeBin = 0
  for (let i = 0; i < nBins; i++) {
    if (bins[i] > maxCount) { maxCount = bins[i]; modeBin = i }
  }

  const amo = (maxCount / ibis.length) * 100 // amplitude of mode (%)
  const mo = (minIbi + modeBin * binWidth + binWidth / 2) / 1000 // mode value (seconds)
  const mxdmn = range / 1000 // range (seconds)

  if (mo === 0 || mxdmn === 0) return 0
  return amo / (2 * mo * mxdmn)
}

function computeCoherence(ibis: number[]): number {
  if (ibis.length < 8) return 0

  // Coherence = power of dominant frequency / total power in 0.04-0.4 Hz
  // High coherence = very regular, sinusoidal HRV (sign of good autonomic regulation)
  const mean = ibis.reduce((a, b) => a + b, 0) / ibis.length
  const detrended = ibis.map(v => v - mean)

  let fftSize = 1
  while (fftSize < detrended.length) fftSize <<= 1
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  for (let i = 0; i < detrended.length; i++) {
    re[i] = detrended[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (detrended.length - 1)))
  }
  fft(re, im)

  // Approximate sample rate of IBI series (~1 per heartbeat)
  const ibiRate = 1000 / mean // beats per second

  let peakPower = 0, totalPower = 0
  for (let i = 1; i < fftSize / 2; i++) {
    const freq = i * ibiRate / fftSize
    const power = re[i] * re[i] + im[i] * im[i]
    if (freq >= 0.04 && freq <= 0.4) {
      totalPower += power
      if (power > peakPower) peakPower = power
    }
  }

  return totalPower > 0 ? Math.min(1, peakPower / totalPower) : 0
}

// ---------------------------------------------------------------------------
// Worker state & message handler
// ---------------------------------------------------------------------------

const CALIBRATION_MIN_MS = 30_000
const BUFFER_SECONDS = 20
const REGION_NAMES = ['forehead', 'leftCheek', 'rightCheek'] as const

interface RegionBuffer {
  r: number[]
  g: number[]
  b: number[]
}

interface WorkerState {
  regions: Record<string, RegionBuffer>
  timestamps: number[]
  ibis: number[]
  calibrated: boolean
  calibrationStart: number | null
  baselineRmssd: number
  recentRmssds: number[]
  actualFps: number
  smoothedHr: number | null
  smoothedRR: number | null
  recentHrs: number[]
}

function makeEmptyRegions(): Record<string, RegionBuffer> {
  const regions: Record<string, RegionBuffer> = {}
  for (const name of REGION_NAMES) {
    regions[name] = { r: [], g: [], b: [] }
  }
  return regions
}

const state: WorkerState = {
  regions: makeEmptyRegions(),
  timestamps: [],
  ibis: [],
  calibrated: false,
  calibrationStart: null,
  baselineRmssd: 50,
  recentRmssds: [],
  actualFps: 60,
  smoothedHr: null,
  smoothedRR: null,
  recentHrs: [],
}

function resetState(): void {
  state.regions = makeEmptyRegions()
  state.timestamps = []
  state.ibis = []
  state.calibrated = false
  state.calibrationStart = null
  state.baselineRmssd = 50
  state.recentRmssds = []
  state.actualFps = 60
  state.smoothedHr = null
  state.smoothedRR = null
  state.recentHrs = []
}

function computeTrend(recent: number[]): HrvTrend {
  if (recent.length < 4) return 'steady'
  const half = Math.floor(recent.length / 2)
  const first = recent.slice(0, half)
  const second = recent.slice(half)
  const delta = (second.reduce((a, b) => a + b, 0) / second.length - first.reduce((a, b) => a + b, 0) / first.length) / (first.reduce((a, b) => a + b, 0) / first.length || 1)
  if (delta > 0.1) return 'rising'
  if (delta < -0.1) return 'falling'
  return 'steady'
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (typeof document === 'undefined' && typeof self !== 'undefined' && 'postMessage' in self) {
  let frameCount = 0
  let computeCount = 0

  self.onmessage = (event: MessageEvent) => {
    const { type, data } = event.data as { type: string; data: unknown }

    if (type === 'rgb_multi') {
      const { regions } = data as { regions: Array<{ region: string; r: number; g: number; b: number; pixels: number }> }
      const now = Date.now()

      // Gap detection
      if (state.timestamps.length > 0 && now - state.timestamps[state.timestamps.length - 1] > 2000) {
        state.regions = makeEmptyRegions()
        state.timestamps = []
        state.ibis = []
      }

      // Push RGB data for each region
      for (const reg of regions) {
        const buf = state.regions[reg.region]
        if (buf) {
          buf.r.push(reg.r)
          buf.g.push(reg.g)
          buf.b.push(reg.b)
        }
      }
      state.timestamps.push(now)
      frameCount++

      if (state.calibrationStart === null) {
        state.calibrationStart = now
      }

      // Compute FPS
      if (state.timestamps.length >= 20) {
        const recent = state.timestamps.slice(-20)
        const dt = (recent[recent.length - 1] - recent[0]) / 1000
        if (dt > 0) state.actualFps = Math.round((recent.length - 1) / dt)
      }

      // Trim buffers
      const maxBuf = state.actualFps * BUFFER_SECONDS
      while (state.timestamps.length > maxBuf) {
        state.timestamps.shift()
        for (const name of REGION_NAMES) {
          const buf = state.regions[name]
          if (buf.r.length > maxBuf) { buf.r.shift(); buf.g.shift(); buf.b.shift() }
        }
      }

      // Calibration progress
      const elapsed = now - state.calibrationStart
      if (!state.calibrated) {
        const progress = Math.min(elapsed / CALIBRATION_MIN_MS, 1)
        self.postMessage({ type: 'calibration_progress', data: { progress } })
        if (elapsed >= CALIBRATION_MIN_MS) {
          state.calibrated = true
          state.baselineRmssd = state.recentRmssds.length > 0
            ? state.recentRmssds.reduce((a, b) => a + b, 0) / state.recentRmssds.length
            : 50
          self.postMessage({ type: 'calibration_complete', data: { baseline: state.baselineRmssd } })
        }
      }
    }

    // Legacy single-ROI support
    if (type === 'rgb') {
      const { r, g, b } = data as { r: number; g: number; b: number; skinCount: number; roiPixels: number }
      // Route to forehead region as fallback
      self.onmessage!(new MessageEvent('message', {
        data: { type: 'rgb_multi', data: { regions: [{ region: 'forehead', r, g, b, pixels: 1 }] } },
      }))
      return
    }

    if (type === 'compute') {
      computeCount++
      const fps = state.actualFps
      const bufLen = state.timestamps.length
      const needed = fps * 5

      if (bufLen < needed) {
        return
      }

      // --- Run CHROM + FFT for each region independently ---
      const regionResults: Array<{ region: string; hr: number; confidence: number; pulse: number[] }> = []

      for (const name of REGION_NAMES) {
        const buf = state.regions[name]
        if (buf.r.length < needed) continue

        const pulse = chromPulseExtraction(buf.r, buf.g, buf.b, fps)
        if (pulse.length === 0) continue

        const filtered = butterworthBandpass(pulse, fps)
        const skip = Math.min(fps * 2, Math.floor(filtered.length * 0.15))
        const stable = filtered.slice(skip)
        if (stable.length < fps * 3) continue

        const result = findHeartRateFFT(stable, fps, 1.2, 2.5)
        if (result) {
          regionResults.push({ region: name, hr: result.hr, confidence: result.confidence, pulse })
        }
      }

      if (regionResults.length === 0) {
        return
      }

      // --- Confidence-weighted merge of HR from all regions ---
      let totalWeight = 0
      let weightedHr = 0
      let bestConfidence = 0
      let bestPulse = regionResults[0].pulse

      for (const r of regionResults) {
        const weight = r.confidence * r.confidence // square confidence for stronger weighting
        weightedHr += r.hr * weight
        totalWeight += weight
        if (r.confidence > bestConfidence) {
          bestConfidence = r.confidence
          bestPulse = r.pulse
        }
      }

      const rawHr = totalWeight > 0 ? weightedHr / totalWeight : regionResults[0].hr
      const mergedConf = bestConfidence

      // --- FFT power spectrum from best region for signal dump ---
      let fftPowerSpectrum: { freqHz: number; power: number }[] = []
      {
        const filtered = butterworthBandpass(bestPulse, fps)
        const skip = Math.min(fps * 2, Math.floor(filtered.length * 0.15))
        const stable = filtered.slice(skip)
        if (stable.length > 0) {
          let dumpSize = 1
          while (dumpSize < stable.length) dumpSize <<= 1
          const dumpRe = new Float64Array(dumpSize)
          const dumpIm = new Float64Array(dumpSize)
          for (let i = 0; i < stable.length; i++) {
            dumpRe[i] = stable[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (stable.length - 1)))
          }
          fft(dumpRe, dumpIm)
          const specMinBin = Math.floor(0.5 * dumpSize / fps)
          const specMaxBin = Math.ceil(3.0 * dumpSize / fps)
          for (let i = specMinBin; i <= specMaxBin && i < dumpSize / 2; i++) {
            fftPowerSpectrum.push({
              freqHz: Math.round(i * fps / dumpSize * 1000) / 1000,
              power: Math.round((dumpRe[i] * dumpRe[i] + dumpIm[i] * dumpIm[i]) * 1000) / 1000,
            })
          }
        }
      }

      // --- Peak detection for RMSSD from best pulse ---
      const filteredBest = butterworthBandpass(bestPulse, fps)
      const skipBest = Math.min(fps * 2, Math.floor(filteredBest.length * 0.15))
      const stableBest = filteredBest.slice(skipBest)
      const peaks = detectPeaks(stableBest, fps)
      const newIbis: number[] = []
      for (let i = 1; i < peaks.length; i++) {
        const dt = (peaks[i] - peaks[i - 1]) / fps * 1000
        if (dt > 400 && dt < 1500) newIbis.push(dt)
      }
      if (newIbis.length > 0) {
        state.ibis = [...state.ibis, ...newIbis].slice(-50)
      }

      const ibiMetrics = computeHrvMetrics(state.ibis)
      let rmssd = ibiMetrics ? ibiMetrics.rmssd : 0
      const rmssdIsNoise = rmssd > 200
      if (rmssdIsNoise) rmssd = 0

      // Temporal smoothing
      state.recentHrs.push(rawHr)
      if (state.recentHrs.length > 8) state.recentHrs.shift()

      let hr = rawHr
      if (state.recentHrs.length >= 3) {
        const sorted = [...state.recentHrs].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        if (Math.abs(rawHr - median) / median > 0.3) {
          hr = median
        }
      }

      if (state.smoothedHr === null) {
        state.smoothedHr = hr
      } else {
        const alpha = 0.05 + mergedConf * 0.45
        state.smoothedHr = state.smoothedHr + alpha * (hr - state.smoothedHr)
      }

      state.recentRmssds.push(rmssd)
      if (state.recentRmssds.length > 12) state.recentRmssds.shift()

      const autonomicState = classifyAutonomicState(rmssd, state.baselineRmssd)
      const trend = computeTrend(state.recentRmssds)
      const confidence = Math.round(Math.min(1, mergedConf) * 100) / 100

      // Respiratory rate from best pulse
      let respiratoryRate: number | null = null
      if (bestPulse.length >= fps * 20) {
        const breathFiltered = respiratoryBandpass(bestPulse, fps)
        const breathSkip = Math.min(fps * 5, Math.floor(breathFiltered.length * 0.2))
        const breathStable = breathFiltered.slice(breathSkip)
        if (breathStable.length >= fps * 10) {
          const breathResult = findHeartRateFFT(breathStable, fps, 0.15, 0.45)
          if (breathResult && breathResult.confidence > 0.1) {
            const rawRR = breathResult.hr
            if (rawRR >= 8 && rawRR <= 30) {
              if (state.smoothedRR === null) state.smoothedRR = rawRR
              else state.smoothedRR = state.smoothedRR + 0.2 * (rawRR - state.smoothedRR)
              respiratoryRate = Math.round(state.smoothedRR * 10) / 10
            }
          }
        }
      }

      // Compute derived HRV metrics from IBI series
      const derived = computeDerivedMetrics(state.ibis)

      const measurement: HrvMeasurement = {
        timestamp: Date.now(),
        hr: Math.round(state.smoothedHr * 10) / 10,
        rmssd: Math.round(rmssd * 10) / 10,
        autonomicState,
        trend,
        confidence,
        respiratoryRate,
        derived,
      }

      // Signal dump (from best region)
      const bestBuf = state.regions[regionResults.find(r => r.confidence === bestConfidence)?.region ?? 'forehead']
      const signalDump = {
        timestamp: Date.now(),
        fps,
        rBuffer: bestBuf.r.slice(-150),
        gBuffer: bestBuf.g.slice(-150),
        bBuffer: bestBuf.b.slice(-150),
        chromPulse: bestPulse.slice(-Math.min(bestPulse.length, fps * 10)),
        filteredPulse: stableBest.slice(-Math.min(stableBest.length, fps * 10)),
        fftPowerSpectrum,
        fftPeakHz: rawHr / 60,
        fftPeakBpm: rawHr,
        peaks: [...peaks],
        ibis: [...state.ibis],
      }

      self.postMessage({ type: 'measurement', data: measurement, signalDump })
    }

    if (type === 'reset') {
      frameCount = 0
      computeCount = 0
      resetState()
    }
  }
}
