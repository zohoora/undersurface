import type { AutonomicState, HrvMeasurement, HrvTrend } from '../types/hrv'

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
// ---------------------------------------------------------------------------

/**
 * Compute CHROM pulse signal from R, G, B time series.
 * X = 3R - 2G (chrominance channel 1)
 * Y = 1.5R + G - 1.5B (chrominance channel 2)
 * Pulse = X - alpha*Y, where alpha = std(X)/std(Y)
 */
export function chromPulseExtraction(
  rSignal: number[],
  gSignal: number[],
  bSignal: number[],
): number[] {
  const n = rSignal.length
  if (n < 2) return []

  // Temporal normalization: divide each channel by its running mean
  const rMean = rSignal.reduce((a, b) => a + b, 0) / n
  const gMean = gSignal.reduce((a, b) => a + b, 0) / n
  const bMean = bSignal.reduce((a, b) => a + b, 0) / n

  if (rMean === 0 || gMean === 0 || bMean === 0) return new Array(n).fill(0)

  const rNorm = rSignal.map(v => v / rMean)
  const gNorm = gSignal.map(v => v / gMean)
  const bNorm = bSignal.map(v => v / bMean)

  // Chrominance signals
  const xs = new Array(n)
  const ys = new Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = 3 * rNorm[i] - 2 * gNorm[i]
    ys[i] = 1.5 * rNorm[i] + gNorm[i] - 1.5 * bNorm[i]
  }

  // Adaptive alpha = std(X) / std(Y)
  const xMean = xs.reduce((a: number, b: number) => a + b, 0) / n
  const yMean = ys.reduce((a: number, b: number) => a + b, 0) / n
  const xStd = Math.sqrt(xs.reduce((a: number, b: number) => a + (b - xMean) ** 2, 0) / n)
  const yStd = Math.sqrt(ys.reduce((a: number, b: number) => a + (b - yMean) ** 2, 0) / n)
  const alpha = yStd > 0.0001 ? xStd / yStd : 1

  // Combined pulse signal
  const pulse = new Array(n)
  for (let i = 0; i < n; i++) {
    pulse[i] = xs[i] - alpha * ys[i]
  }

  return pulse
}

// ---------------------------------------------------------------------------
// FFT-based heart rate extraction
// ---------------------------------------------------------------------------

/** Simple radix-2 FFT (in-place, Cooley-Tukey). Input length must be power of 2. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  // FFT butterfly
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

/** Find dominant frequency in the cardiac range using FFT. */
export function findHeartRateFFT(
  signal: number[],
  sampleRate: number,
  minHz = 0.65,
  maxHz = 3.5,
): { hr: number; confidence: number } | null {
  // Pad to next power of 2
  let fftSize = 1
  while (fftSize < signal.length) fftSize <<= 1

  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)

  // Apply Hann window and copy signal
  for (let i = 0; i < signal.length; i++) {
    const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (signal.length - 1)))
    re[i] = signal[i] * window
  }

  fft(re, im)

  // Compute power spectrum
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
  const shift = (nextPower - prevPower) / (2 * (2 * peakPower - prevPower - nextPower) || 1)
  const exactBin = peakBin + Math.max(-0.5, Math.min(0.5, shift))

  const freqHz = exactBin * sampleRate / fftSize
  const hr = freqHz * 60

  // Confidence: ratio of peak power to total power in cardiac range (SNR proxy)
  const snr = peakPower / (totalPower / (maxBin - minBin + 1))
  const confidence = Math.min(1, Math.max(0, (snr - 1) / 10))

  return { hr, confidence }
}

// ---------------------------------------------------------------------------
// Bandpass filter (kept for IBI-based RMSSD computation)
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

export function butterworthBandpass(signal: number[], sampleRate: number): number[] {
  return applyBiquad(applyBiquad(signal, designButterworthHighpass(0.65, sampleRate)), designButterworthLowpass(4, sampleRate))
}

// ---------------------------------------------------------------------------
// Peak detection (for IBI-based RMSSD, not HR)
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
// Worker state & message handler
// ---------------------------------------------------------------------------

const CALIBRATION_MIN_MS = 30_000 // reduced to 30s for faster feedback
const BUFFER_SECONDS = 15

interface WorkerState {
  rBuffer: number[]
  gBuffer: number[]
  bBuffer: number[]
  timestamps: number[]
  ibis: number[]
  calibrated: boolean
  calibrationStart: number | null
  baselineRmssd: number
  recentRmssds: number[]
  actualFps: number
  smoothedHr: number | null
  recentHrs: number[]
}

const state: WorkerState = {
  rBuffer: [],
  gBuffer: [],
  bBuffer: [],
  timestamps: [],
  ibis: [],
  calibrated: false,
  calibrationStart: null,
  baselineRmssd: 50,
  recentRmssds: [],
  actualFps: 60,
  smoothedHr: null,
  recentHrs: [],
}

function resetState(): void {
  state.rBuffer = []
  state.gBuffer = []
  state.bBuffer = []
  state.timestamps = []
  state.ibis = []
  state.calibrated = false
  state.calibrationStart = null
  state.baselineRmssd = 50
  state.recentRmssds = []
  state.actualFps = 60
  state.smoothedHr = null
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

  console.log('[HRV Worker] CHROM algorithm initialized')

  self.onmessage = (event: MessageEvent) => {
    const { type, data } = event.data as { type: string; data: unknown }

    if (type === 'rgb') {
      // Engine sends pre-extracted RGB averages from skin pixels (main thread did the pixel work)
      const { r, g, b, skinCount, roiPixels } = data as { r: number; g: number; b: number; skinCount: number; roiPixels: number }

      const now = Date.now()
      state.rBuffer.push(r)
      state.gBuffer.push(g)
      state.bBuffer.push(b)
      state.timestamps.push(now)
      frameCount++

      if (state.calibrationStart === null) {
        state.calibrationStart = now
        console.log('[HRV Worker] Calibration started (CHROM)')
      }

      // Compute actual FPS
      if (state.timestamps.length >= 30) {
        const recent = state.timestamps.slice(-30)
        const dt = (recent[recent.length - 1] - recent[0]) / 1000
        if (dt > 0) state.actualFps = Math.round((recent.length - 1) / dt)
      }

      // Keep buffer at BUFFER_SECONDS
      const maxBuf = state.actualFps * BUFFER_SECONDS
      while (state.rBuffer.length > maxBuf) {
        state.rBuffer.shift()
        state.gBuffer.shift()
        state.bBuffer.shift()
        state.timestamps.shift()
      }

      // Log every 300 frames
      if (frameCount % 300 === 0) {
        const elapsed = now - state.calibrationStart
        const skinPct = roiPixels > 0 ? Math.round(skinCount / roiPixels * 100) : 0
        console.log(`[HRV Worker] Frame ${frameCount}: buf=${state.rBuffer.length}, fps=${state.actualFps}, R=${r.toFixed(1)} G=${g.toFixed(1)} B=${b.toFixed(1)}, skin=${skinCount}px (${skinPct}% of ROI), elapsed=${(elapsed / 1000).toFixed(1)}s, cal=${state.calibrated}`)
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
          console.log(`[HRV Worker] Calibration complete! baseline RMSSD=${state.baselineRmssd.toFixed(1)}, fps=${state.actualFps}`)
          self.postMessage({ type: 'calibration_complete', data: { baseline: state.baselineRmssd } })
        }
      }
    }

    if (type === 'compute') {
      computeCount++
      const fps = state.actualFps
      const bufLen = state.rBuffer.length
      const needed = fps * 5 // need 5 seconds minimum for CHROM + FFT

      if (bufLen < needed) {
        console.log(`[HRV Worker] Compute #${computeCount}: Need more data (${bufLen}/${needed})`)
        return
      }

      // --- CHROM pulse extraction ---
      const pulse = chromPulseExtraction(state.rBuffer, state.gBuffer, state.bBuffer)
      if (pulse.length === 0) return

      // Bandpass filter the CHROM pulse
      const filtered = butterworthBandpass(pulse, fps)

      // Skip transient (first 2 seconds)
      const skip = Math.min(fps * 2, Math.floor(filtered.length * 0.2))
      const stable = filtered.slice(skip)

      if (stable.length < fps * 3) return // need 3s of stable signal

      // --- FFT for heart rate (restricted to 0.7-2.5 Hz = 42-150 BPM to avoid harmonics) ---
      const fftResult = findHeartRateFFT(stable, fps, 0.7, 2.5)

      // --- Peak detection for RMSSD (HRV) ---
      const peaks = detectPeaks(stable, fps)
      const newIbis: number[] = []
      for (let i = 1; i < peaks.length; i++) {
        const dt = (peaks[i] - peaks[i - 1]) / fps * 1000
        if (dt > 400 && dt < 1500) newIbis.push(dt) // 40-150 BPM valid range
      }
      if (newIbis.length > 0) {
        state.ibis = [...state.ibis, ...newIbis].slice(-50)
      }

      // Use FFT for HR (more robust), peaks for RMSSD
      const rawHr = fftResult ? fftResult.hr : null
      const ibiMetrics = computeHrvMetrics(state.ibis)
      const rmssd = ibiMetrics ? ibiMetrics.rmssd : 0

      if (!rawHr) {
        console.log(`[HRV Worker] Compute #${computeCount}: FFT found no cardiac peak. stable=${stable.length}, peaks=${peaks.length}`)
        return
      }

      // Temporal smoothing: reject outliers and apply EMA
      // Reject readings that are > 40% different from recent median
      state.recentHrs.push(rawHr)
      if (state.recentHrs.length > 8) state.recentHrs.shift()

      let hr = rawHr
      if (state.recentHrs.length >= 3) {
        const sorted = [...state.recentHrs].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        // Reject if > 30% from median
        if (Math.abs(rawHr - median) / median > 0.3) {
          hr = median // use median instead
          console.log(`[HRV Worker] Rejected outlier HR ${rawHr.toFixed(1)}, using median ${median.toFixed(1)}`)
        }
      }

      // Confidence-weighted exponential moving average
      // Higher confidence readings pull the average more aggressively
      const fftConf = fftResult?.confidence ?? 0
      if (state.smoothedHr === null) {
        state.smoothedHr = hr
      } else {
        // alpha scales with confidence: low conf (0.1) → alpha=0.05, high conf (0.8) → alpha=0.4
        const alpha = 0.05 + fftConf * 0.45
        state.smoothedHr = state.smoothedHr + alpha * (hr - state.smoothedHr)
      }

      state.recentRmssds.push(rmssd)
      if (state.recentRmssds.length > 12) state.recentRmssds.shift()

      const autonomicState = classifyAutonomicState(rmssd, state.baselineRmssd)
      const trend = computeTrend(state.recentRmssds)

      // Confidence from FFT SNR
      const confidence = Math.round(Math.min(1, fftConf) * 100) / 100

      const measurement: HrvMeasurement = {
        timestamp: Date.now(),
        hr: Math.round(state.smoothedHr * 10) / 10,
        rmssd: Math.round(rmssd * 10) / 10,
        autonomicState,
        trend,
        confidence,
      }

      console.log(`[HRV Worker] CHROM #${computeCount}: rawHR=${rawHr.toFixed(1)} → smoothed=${state.smoothedHr.toFixed(1)}bpm, conf=${fftConf.toFixed(2)}, RMSSD=${measurement.rmssd}ms, skin=${peaks.length}peaks`)

      self.postMessage({ type: 'measurement', data: measurement })
    }

    if (type === 'reset') {
      console.log('[HRV Worker] Reset')
      frameCount = 0
      computeCount = 0
      resetState()
    }
  }
}
