# Webcam HRV Biofeedback Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add webcam-based HRV monitoring to session/companion mode, providing autonomic state data to the therapist AI for more physiologically attuned responses.

**Architecture:** A Web Worker extracts heart rate variability from webcam video via remote photoplethysmography (rPPG). An HRV timeline tracks measurements alongside conversation events, detecting shifts correlated with specific messages. The therapist prompt receives rich biometric context. All gated behind feature flag + explicit consent.

**Tech Stack:** TypeScript, Web Workers, Canvas API, getUserMedia, Vitest, Firestore

**Spec:** `docs/superpowers/specs/2026-03-17-webcam-hrv-biofeedback-design.md`

**Note:** Line numbers referenced in this plan are approximate and may shift as earlier tasks modify files. Use the surrounding code context (function names, variable names) to locate insertion points rather than relying on exact line numbers.

**Note:** Firestore security rules do NOT need modification — the existing wildcard rule `match /users/{userId}/{document=**}` at `firestore.rules:4` already covers `hrvSessions` and `consent` subcollections with owner-only access.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/types/hrv.ts` | All HRV type definitions (measurement, timeline event, shift, session data, consent, errors) |
| `src/engine/hrvSignalWorker.ts` | Web Worker: receives ImageData frames, runs bandpass filter + peak detection, emits HrvMeasurement |
| `src/engine/hrvEngine.ts` | Main-thread engine: manages camera, captures frames to canvas, posts to worker, emits measurements + errors |
| `src/engine/hrvTimeline.ts` | Timeline class: accumulates measurements + conversation events, detects shifts, builds prompt context string |
| `src/components/Session/HrvConsentDialog.tsx` | One-time consent modal for camera + biometric data |
| `src/components/Session/HrvAmbientBar.tsx` | Live HRV trace bar + camera thumbnail + state label |
| `src/components/Session/SessionView.tsx` | (modify) Wire HRV toggle, ambient bar, timeline events, prompt injection, session end cleanup |
| `src/ai/therapistPrompts.ts` | (modify) Accept `hrvContext` option, inject into system prompt with behavior guidance |
| `src/store/db.ts` | (modify) Add `hrvSessions` proxy, add to `exportAllData` |
| `src/admin/adminTypes.ts` | (modify) Add `webcamHrv` feature flag |
| `firebase.json` | (modify) Update `Permissions-Policy` to `camera=(self)` |
| `functions/src/index.ts` | (modify) Add `hrvSessions` to `deleteAccount` |

---

## Task 1: Types and Feature Flag

**Files:**
- Create: `src/types/hrv.ts`
- Modify: `src/types/index.ts`
- Modify: `src/admin/adminTypes.ts`

- [ ] **Step 1: Create HRV type definitions**

Create `src/types/hrv.ts` with all the types from the spec:

```typescript
export type AutonomicState = 'calm' | 'activated' | 'transitioning'
export type HrvTrend = 'rising' | 'falling' | 'steady'

export interface HrvMeasurement {
  timestamp: number
  hr: number
  rmssd: number
  autonomicState: AutonomicState
  trend: HrvTrend
  confidence: number
}

export type HrvError =
  | { type: 'camera_denied' }
  | { type: 'camera_unavailable' }
  | { type: 'camera_lost' }
  | { type: 'worker_error'; message: string }

export type HrvConversationEventType = 'user_message' | 'ai_response_start' | 'ai_response_complete'

export interface HrvTimelineEvent {
  timestamp: number
  type: 'measurement' | HrvConversationEventType
  measurement?: HrvMeasurement
  messageIndex?: number
}

export interface HrvShift {
  timestamp: number
  fromState: AutonomicState
  toState: AutonomicState
  trigger: 'user_message' | 'ai_response' | 'unknown'
  triggerMessageIndex: number | null
  magnitude: number
}

export interface HrvSessionData {
  id: string
  startedAt: number
  endedAt: number
  calibrationBaseline: number
  measurements: HrvMeasurement[]
  shifts: HrvShift[]
  summary: {
    dominantState: AutonomicState
    averageHr: number
    averageRmssd: number
    shiftCount: number
    avgConfidence: number
  }
}

export interface CameraHrvConsent {
  id: 'camera-hrv'
  acceptedAt: number
  acceptedVersion: string
  cameraAccepted: boolean
  biometricDataAccepted: boolean
}
```

- [ ] **Step 2: Export HRV types from index**

Add to the end of `src/types/index.ts`:

```typescript
export type {
  AutonomicState, HrvTrend, HrvMeasurement, HrvError,
  HrvConversationEventType, HrvTimelineEvent, HrvShift,
  HrvSessionData, CameraHrvConsent,
} from './hrv'
```

- [ ] **Step 3: Add feature flag**

In `src/admin/adminTypes.ts`, add `webcamHrv?: boolean` to the `features` object inside `GlobalConfig`, in the "Safety & Guidance" section (after `guidedExplorations`):

```typescript
    // Biometric
    webcamHrv?: boolean
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/types/hrv.ts src/types/index.ts src/admin/adminTypes.ts
git commit -m "feat(hrv): add HRV type definitions and webcamHrv feature flag"
```

---

## Task 2: HRV Signal Worker

The Web Worker that processes video frames and extracts heart rate / HRV metrics. This is pure signal processing with no DOM or React dependencies.

**Files:**
- Create: `src/engine/hrvSignalWorker.ts`
- Create: `src/engine/hrvSignalWorker.test.ts`

- [ ] **Step 1: Write tests for the signal processing functions**

Create `src/engine/hrvSignalWorker.test.ts`. Since the worker communicates via `postMessage`, test the exported pure functions directly rather than the worker message handler. The worker file will export its processing functions for testability alongside the `self.onmessage` handler.

```typescript
import { describe, it, expect } from 'vitest'
import {
  extractGreenChannel,
  butterworthBandpass,
  detectPeaks,
  computeHrvMetrics,
  classifyAutonomicState,
} from './hrvSignalWorker'

describe('extractGreenChannel', () => {
  it('returns average green value from RGBA pixel data', () => {
    // 2x2 image: RGBA values
    const data = new Uint8ClampedArray([
      255, 100, 0, 255,  // pixel 1: green=100
      255, 200, 0, 255,  // pixel 2: green=200
      255, 150, 0, 255,  // pixel 3: green=150
      255, 50, 0, 255,   // pixel 4: green=50
    ])
    const result = extractGreenChannel(data, 2, 2)
    // Center ROI on 2x2 = all pixels, average green = (100+200+150+50)/4 = 125
    expect(result).toBeCloseTo(125, 0)
  })

  it('uses center ROI when image is larger', () => {
    // 4x4 image, ROI should be center portion
    const data = new Uint8ClampedArray(4 * 4 * 4)
    // Fill all pixels with green=100
    for (let i = 0; i < 4 * 4; i++) {
      data[i * 4 + 1] = 100 // green channel
    }
    const result = extractGreenChannel(data, 4, 4)
    expect(result).toBeCloseTo(100, 0)
  })
})

describe('butterworthBandpass', () => {
  it('returns filtered signal of same length', () => {
    const signal = Array.from({ length: 150 }, (_, i) => Math.sin(i * 0.1))
    const filtered = butterworthBandpass(signal, 30) // 30 fps
    expect(filtered).toHaveLength(signal.length)
  })

  it('attenuates DC component', () => {
    // Constant signal (DC) should be near zero after bandpass
    const signal = Array.from({ length: 300 }, () => 100)
    const filtered = butterworthBandpass(signal, 30)
    const lastValues = filtered.slice(-50)
    const avgMagnitude = lastValues.reduce((s, v) => s + Math.abs(v), 0) / lastValues.length
    expect(avgMagnitude).toBeLessThan(1)
  })

  it('passes signal in heart rate frequency range', () => {
    // 1.2 Hz = 72 BPM, well within 0.7-4 Hz passband
    const fps = 30
    const signal = Array.from({ length: 300 }, (_, i) => Math.sin(2 * Math.PI * 1.2 * i / fps))
    const filtered = butterworthBandpass(signal, fps)
    // After settling, filtered signal should have significant amplitude
    const lastValues = filtered.slice(-60)
    const maxAmp = Math.max(...lastValues.map(Math.abs))
    expect(maxAmp).toBeGreaterThan(0.3)
  })
})

describe('detectPeaks', () => {
  it('finds peaks in sinusoidal signal', () => {
    const fps = 30
    const freq = 1.2 // 72 BPM
    const signal = Array.from({ length: 150 }, (_, i) => Math.sin(2 * Math.PI * freq * i / fps))
    const peaks = detectPeaks(signal, fps)
    // ~6 cycles in 5 seconds at 1.2 Hz
    expect(peaks.length).toBeGreaterThanOrEqual(4)
    expect(peaks.length).toBeLessThanOrEqual(8)
  })

  it('returns empty for flat signal', () => {
    const signal = Array.from({ length: 150 }, () => 0)
    const peaks = detectPeaks(signal, 30)
    expect(peaks).toHaveLength(0)
  })
})

describe('computeHrvMetrics', () => {
  it('computes HR and RMSSD from IBIs', () => {
    // Regular 800ms intervals = 75 BPM, RMSSD should be low (regular)
    const ibis = [800, 800, 800, 800, 800]
    const metrics = computeHrvMetrics(ibis)
    expect(metrics.hr).toBeCloseTo(75, 0)
    expect(metrics.rmssd).toBeCloseTo(0, 1) // perfectly regular = 0 RMSSD
  })

  it('computes higher RMSSD for variable intervals', () => {
    // Variable intervals = higher HRV
    const ibis = [750, 850, 730, 870, 760, 840]
    const metrics = computeHrvMetrics(ibis)
    expect(metrics.hr).toBeGreaterThan(60)
    expect(metrics.hr).toBeLessThan(90)
    expect(metrics.rmssd).toBeGreaterThan(50)
  })

  it('returns null for insufficient data', () => {
    const metrics = computeHrvMetrics([800])
    expect(metrics).toBeNull()
  })
})

describe('classifyAutonomicState', () => {
  it('classifies high RMSSD relative to baseline as calm', () => {
    const state = classifyAutonomicState(80, 60) // rmssd=80, baseline=60
    expect(state).toBe('calm')
  })

  it('classifies low RMSSD relative to baseline as activated', () => {
    const state = classifyAutonomicState(30, 60) // rmssd=30, baseline=60
    expect(state).toBe('activated')
  })

  it('classifies near-baseline as transitioning', () => {
    const state = classifyAutonomicState(58, 60) // rmssd≈baseline
    expect(state).toBe('transitioning')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/hrvSignalWorker.test.ts`
Expected: FAIL — functions not found

- [ ] **Step 3: Implement signal processing functions**

Create `src/engine/hrvSignalWorker.ts`:

```typescript
import type { AutonomicState, HrvMeasurement, HrvTrend } from '../types/hrv'

// --- Pure signal processing functions (exported for testing) ---

/** Extract average green channel intensity from center ROI of RGBA pixel data */
export function extractGreenChannel(data: Uint8ClampedArray, width: number, height: number): number {
  // Use center 60% of frame as ROI (user centers face via thumbnail)
  const roiMargin = 0.2
  const x0 = Math.floor(width * roiMargin)
  const x1 = Math.floor(width * (1 - roiMargin))
  const y0 = Math.floor(height * roiMargin)
  const y1 = Math.floor(height * (1 - roiMargin))

  let sum = 0
  let count = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4
      sum += data[idx + 1] // green channel
      count++
    }
  }
  return count > 0 ? sum / count : 0
}

/** 2nd-order IIR Butterworth bandpass filter (0.7-4 Hz at given sample rate) */
export function butterworthBandpass(signal: number[], sampleRate: number): number[] {
  // Pre-compute coefficients for 0.7-4 Hz bandpass
  const lowCut = 0.7
  const highCut = 4.0
  const nyquist = sampleRate / 2

  // Normalized frequencies
  const wLow = Math.tan(Math.PI * lowCut / sampleRate)
  const wHigh = Math.tan(Math.PI * highCut / sampleRate)

  // 2nd-order Butterworth bandpass coefficients
  const bw = wHigh - wLow
  const w0sq = wLow * wHigh
  const q = Math.sqrt(w0sq) / bw

  const k = Math.sqrt(w0sq)
  const norm = 1 + bw / (2 * q) + w0sq

  // Simplified 2nd-order bandpass via cascaded biquad
  // Using direct form II transposed
  const a0 = bw / norm
  const a1 = 0
  const a2 = -a0
  const b1 = 2 * (w0sq - 1) / norm
  const b2 = (1 - bw / (2 * q) + w0sq) / norm

  const output = new Array(signal.length).fill(0)
  let z1 = 0, z2 = 0

  for (let i = 0; i < signal.length; i++) {
    const input = signal[i]
    const out = a0 * input + z1
    z1 = a1 * input - b1 * out + z2
    z2 = a2 * input - b2 * out
    output[i] = out
  }

  return output
}

/** Detect peaks in filtered signal, returns indices */
export function detectPeaks(signal: number[], sampleRate: number): number[] {
  const peaks: number[] = []
  const minDistance = Math.floor(sampleRate * 0.3) // 200 BPM max

  // Compute adaptive threshold (mean + 0.5 * std of positive values)
  const positiveValues = signal.filter(v => v > 0)
  if (positiveValues.length === 0) return peaks

  const mean = positiveValues.reduce((s, v) => s + v, 0) / positiveValues.length
  const std = Math.sqrt(positiveValues.reduce((s, v) => s + (v - mean) ** 2, 0) / positiveValues.length)
  const threshold = mean + 0.3 * std

  let lastPeak = -minDistance
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]
      && signal[i] > threshold && (i - lastPeak) >= minDistance) {
      peaks.push(i)
      lastPeak = i
    }
  }
  return peaks
}

/** Compute HR and RMSSD from inter-beat intervals (in ms) */
export function computeHrvMetrics(ibis: number[]): { hr: number; rmssd: number } | null {
  if (ibis.length < 2) return null

  const avgIbi = ibis.reduce((s, v) => s + v, 0) / ibis.length
  const hr = 60000 / avgIbi

  // RMSSD: root mean square of successive differences
  let sumSqDiff = 0
  for (let i = 1; i < ibis.length; i++) {
    const diff = ibis[i] - ibis[i - 1]
    sumSqDiff += diff * diff
  }
  const rmssd = Math.sqrt(sumSqDiff / (ibis.length - 1))

  return { hr, rmssd }
}

/** Classify autonomic state based on RMSSD relative to baseline */
export function classifyAutonomicState(rmssd: number, baseline: number): AutonomicState {
  const ratio = rmssd / baseline
  if (ratio > 1.2) return 'calm'
  if (ratio < 0.7) return 'activated'
  return 'transitioning'
}

// --- Worker state and message handler ---

// Only attach worker message handler if running inside a Worker context
// (not during tests where `self` is the window/global)
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  let greenBuffer: number[] = []
  let sampleRate = 30
  let baseline: number | null = null
  let calibrating = true
  let calibrationStart = 0
  let previousMeasurements: HrvMeasurement[] = []

  self.onmessage = (e: MessageEvent) => {
    const { type, data } = e.data

    if (type === 'frame') {
      const { imageData, width, height, fps } = data
      sampleRate = fps || 30
      const green = extractGreenChannel(new Uint8ClampedArray(imageData), width, height)
      greenBuffer.push(green)

      // Keep last 10 seconds of samples
      const maxSamples = sampleRate * 10
      if (greenBuffer.length > maxSamples) {
        greenBuffer = greenBuffer.slice(-maxSamples)
      }
    }

    if (type === 'compute') {
      if (greenBuffer.length < sampleRate * 3) {
        // Not enough data yet
        self.postMessage({ type: 'measurement', data: null })
        return
      }

      const filtered = butterworthBandpass(greenBuffer, sampleRate)
      const peaks = detectPeaks(filtered, sampleRate)

      // Convert peak indices to IBIs (in ms)
      const ibis: number[] = []
      for (let i = 1; i < peaks.length; i++) {
        const ibi = ((peaks[i] - peaks[i - 1]) / sampleRate) * 1000
        if (ibi > 250 && ibi < 1500) { // 40-240 BPM range
          ibis.push(ibi)
        }
      }

      const metrics = computeHrvMetrics(ibis)
      if (!metrics) {
        self.postMessage({ type: 'measurement', data: null })
        return
      }

      // Confidence based on number of valid IBIs and consistency
      const confidence = Math.min(1, ibis.length / 8)

      // Calibration
      if (calibrating) {
        if (calibrationStart === 0) calibrationStart = Date.now()
        const elapsed = Date.now() - calibrationStart

        if (confidence >= 0.3 && elapsed >= 60000) {
          baseline = metrics.rmssd
          calibrating = false
          self.postMessage({ type: 'calibration_complete', data: { baseline } })
        } else if (elapsed >= 120000) {
          // Max calibration time — use whatever we have
          baseline = metrics.rmssd || 50
          calibrating = false
          self.postMessage({ type: 'calibration_complete', data: { baseline } })
        }
      }

      // Determine trend from recent measurements
      let trend: HrvTrend = 'steady'
      if (previousMeasurements.length >= 3) {
        const recent = previousMeasurements.slice(-5)
        const first = recent.slice(0, Math.ceil(recent.length / 2))
        const second = recent.slice(Math.ceil(recent.length / 2))
        const avgFirst = first.reduce((s, m) => s + m.rmssd, 0) / first.length
        const avgSecond = second.reduce((s, m) => s + m.rmssd, 0) / second.length
        const change = (avgSecond - avgFirst) / avgFirst
        if (change > 0.15) trend = 'rising'
        else if (change < -0.15) trend = 'falling'
      }

      const measurement: HrvMeasurement = {
        timestamp: Date.now(),
        hr: Math.round(metrics.hr),
        rmssd: Math.round(metrics.rmssd * 10) / 10,
        autonomicState: baseline ? classifyAutonomicState(metrics.rmssd, baseline) : 'transitioning',
        trend,
        confidence: Math.round(confidence * 100) / 100,
      }

      previousMeasurements.push(measurement)
      if (previousMeasurements.length > 20) {
        previousMeasurements = previousMeasurements.slice(-20)
      }

      self.postMessage({ type: 'measurement', data: measurement })
    }

    if (type === 'reset') {
      greenBuffer = []
      baseline = null
      calibrating = true
      calibrationStart = 0
      previousMeasurements = []
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/hrvSignalWorker.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/hrvSignalWorker.ts src/engine/hrvSignalWorker.test.ts
git commit -m "feat(hrv): implement signal processing worker with bandpass filter and peak detection"
```

---

## Task 3: HRV Timeline

Tracks measurements alongside conversation events, detects shifts, builds prompt context.

**Files:**
- Create: `src/engine/hrvTimeline.ts`
- Create: `src/engine/hrvTimeline.test.ts`

- [ ] **Step 1: Write tests for HrvTimeline**

Create `src/engine/hrvTimeline.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { HrvTimeline } from './hrvTimeline'
import type { HrvMeasurement } from '../types/hrv'

function makeMeasurement(overrides: Partial<HrvMeasurement> = {}): HrvMeasurement {
  return {
    timestamp: Date.now(),
    hr: 72,
    rmssd: 55,
    autonomicState: 'calm',
    trend: 'steady',
    confidence: 0.8,
    ...overrides,
  }
}

describe('HrvTimeline', () => {
  let timeline: HrvTimeline

  beforeEach(() => {
    timeline = new HrvTimeline()
  })

  describe('addMeasurement', () => {
    it('stores measurements in events array', () => {
      const m = makeMeasurement()
      timeline.addMeasurement(m)
      expect(timeline.events).toHaveLength(1)
      expect(timeline.events[0].type).toBe('measurement')
      expect(timeline.events[0].measurement).toBe(m)
    })
  })

  describe('addConversationEvent', () => {
    it('stores conversation events with message index', () => {
      timeline.addConversationEvent('user_message', 3)
      expect(timeline.events).toHaveLength(1)
      expect(timeline.events[0].type).toBe('user_message')
      expect(timeline.events[0].messageIndex).toBe(3)
    })
  })

  describe('shift detection', () => {
    it('detects shift when autonomic state changes', () => {
      const now = Date.now()
      // Build up baseline of calm measurements
      for (let i = 0; i < 12; i++) {
        timeline.addMeasurement(makeMeasurement({
          timestamp: now - (60 - i * 5) * 1000,
          rmssd: 60,
          autonomicState: 'calm',
        }))
      }
      // Add a user message
      timeline.addConversationEvent('user_message', 4)
      // Now activated measurement
      timeline.addMeasurement(makeMeasurement({
        timestamp: now,
        rmssd: 25,
        autonomicState: 'activated',
      }))

      const shifts = timeline.getRecentShifts(300)
      expect(shifts.length).toBeGreaterThanOrEqual(1)
      expect(shifts[0].fromState).toBe('calm')
      expect(shifts[0].toState).toBe('activated')
      expect(shifts[0].trigger).toBe('user_message')
      expect(shifts[0].triggerMessageIndex).toBe(4)
    })

    it('returns empty shifts when state is stable', () => {
      for (let i = 0; i < 5; i++) {
        timeline.addMeasurement(makeMeasurement({ autonomicState: 'calm', rmssd: 60 }))
      }
      expect(timeline.getRecentShifts()).toHaveLength(0)
    })
  })

  describe('buildPromptContext', () => {
    it('returns empty string when no measurements', () => {
      expect(timeline.buildPromptContext()).toBe('')
    })

    it('includes current state and heart rate', () => {
      timeline.setBaseline(55)
      timeline.addMeasurement(makeMeasurement({ hr: 78, autonomicState: 'calm', trend: 'steady', confidence: 0.9 }))
      const context = timeline.buildPromptContext()
      expect(context).toContain('calm')
      expect(context).toContain('78')
    })

    it('excludes low-confidence measurements', () => {
      timeline.setBaseline(55)
      timeline.addMeasurement(makeMeasurement({ confidence: 0.2 }))
      const context = timeline.buildPromptContext()
      expect(context).toBe('')
    })

    it('includes notable shifts', () => {
      const now = Date.now()
      timeline.setBaseline(55)
      for (let i = 0; i < 12; i++) {
        timeline.addMeasurement(makeMeasurement({
          timestamp: now - (60 - i * 5) * 1000,
          rmssd: 60,
          autonomicState: 'calm',
        }))
      }
      timeline.addConversationEvent('user_message', 2)
      timeline.addMeasurement(makeMeasurement({
        timestamp: now,
        rmssd: 25,
        autonomicState: 'activated',
        confidence: 0.8,
      }))

      const context = timeline.buildPromptContext()
      expect(context).toContain('Notable shifts')
      expect(context).toContain('activated')
    })
  })

  describe('getMeasurements / getShifts', () => {
    it('returns all measurement events', () => {
      timeline.addMeasurement(makeMeasurement())
      timeline.addConversationEvent('user_message', 0)
      timeline.addMeasurement(makeMeasurement())
      expect(timeline.getMeasurements()).toHaveLength(2)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/hrvTimeline.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement HrvTimeline**

Create `src/engine/hrvTimeline.ts`:

```typescript
import type {
  HrvMeasurement, HrvTimelineEvent, HrvShift,
  HrvConversationEventType, AutonomicState,
} from '../types/hrv'

export class HrvTimeline {
  events: HrvTimelineEvent[] = []
  shifts: HrvShift[] = []
  baselineRmssd: number | null = null

  setBaseline(rmssd: number): void {
    this.baselineRmssd = rmssd
  }

  addMeasurement(m: HrvMeasurement): void {
    this.events.push({ timestamp: m.timestamp, type: 'measurement', measurement: m })
    this.detectShift(m)
  }

  addConversationEvent(type: HrvConversationEventType, messageIndex: number): void {
    this.events.push({ timestamp: Date.now(), type, messageIndex })
  }

  getRecentShifts(windowSeconds = 120): HrvShift[] {
    const cutoff = Date.now() - windowSeconds * 1000
    return this.shifts.filter(s => s.timestamp > cutoff)
  }

  getMeasurements(): HrvMeasurement[] {
    return this.events
      .filter(e => e.type === 'measurement' && e.measurement)
      .map(e => e.measurement!)
  }

  buildPromptContext(): string {
    const measurements = this.getMeasurements()
    const latest = measurements.filter(m => m.confidence >= 0.3).at(-1)
    if (!latest) return ''

    const lines: string[] = ['[Biometric context]']

    // Current state
    const trendDuration = this.getTrendDuration(latest.trend)
    lines.push(`Current autonomic state: ${latest.autonomicState} (trend: ${latest.trend}${trendDuration ? `, ${trendDuration}` : ''})`)
    lines.push(`Heart rate: ${latest.hr} bpm`)

    // Baseline
    if (this.baselineRmssd) {
      const baselineState = latest.rmssd > this.baselineRmssd * 1.2 ? 'calm'
        : latest.rmssd < this.baselineRmssd * 0.7 ? 'activated' : 'near baseline'
      lines.push(`Session baseline: ${baselineState}`)
    }

    // Notable shifts
    const recentShifts = this.getRecentShifts(300)
    if (recentShifts.length > 0) {
      lines.push('Notable shifts:')
      for (const shift of recentShifts.slice(-5)) {
        const ago = Math.round((Date.now() - shift.timestamp) / 1000)
        const agoStr = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}min ago`
        const triggerStr = shift.trigger === 'unknown' ? ''
          : shift.trigger === 'user_message' ? ` after user message #${shift.triggerMessageIndex}`
          : ` during therapist response #${shift.triggerMessageIndex}`
        lines.push(`- Shifted from ${shift.fromState} → ${shift.toState}${triggerStr} (${agoStr})`)
      }
    }

    // Confidence
    const confLabel = latest.confidence >= 0.7 ? 'high'
      : latest.confidence >= 0.4 ? 'medium' : 'low'
    lines.push(`Signal confidence: ${confLabel}`)

    return lines.join('\n')
  }

  private getTrendDuration(currentTrend: string): string {
    const measurements = this.getMeasurements()
    if (measurements.length < 2) return ''

    let count = 0
    for (let i = measurements.length - 1; i >= 0; i--) {
      if (measurements[i].trend === currentTrend) count++
      else break
    }
    const seconds = count * 5 // ~5s between measurements
    if (seconds < 15) return ''
    return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}min`
  }

  private detectShift(current: HrvMeasurement): void {
    const measurements = this.getMeasurements()
    if (measurements.length < 3) return

    // Get previous state (majority of last 5 measurements, excluding current)
    const recent = measurements.slice(-6, -1)
    if (recent.length < 2) return

    const stateCounts: Record<AutonomicState, number> = { calm: 0, activated: 0, transitioning: 0 }
    for (const m of recent) stateCounts[m.autonomicState]++

    const prevState = (Object.entries(stateCounts) as [AutonomicState, number][])
      .sort((a, b) => b[1] - a[1])[0][0]

    if (current.autonomicState === prevState || current.autonomicState === 'transitioning') return

    // Find most recent conversation event before this measurement
    let trigger: 'user_message' | 'ai_response' | 'unknown' = 'unknown'
    let triggerMessageIndex: number | null = null

    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]
      if (e.type === 'user_message') {
        trigger = 'user_message'
        triggerMessageIndex = e.messageIndex ?? null
        break
      }
      if (e.type === 'ai_response_start' || e.type === 'ai_response_complete') {
        trigger = 'ai_response'
        triggerMessageIndex = e.messageIndex ?? null
        break
      }
    }

    // Compute magnitude as RMSSD deviation from rolling average
    const avgRmssd = recent.reduce((s, m) => s + m.rmssd, 0) / recent.length
    const magnitude = Math.abs(current.rmssd - avgRmssd) / avgRmssd

    this.shifts.push({
      timestamp: current.timestamp,
      fromState: prevState,
      toState: current.autonomicState,
      trigger,
      triggerMessageIndex,
      magnitude: Math.round(magnitude * 100) / 100,
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/hrvTimeline.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/hrvTimeline.ts src/engine/hrvTimeline.test.ts
git commit -m "feat(hrv): implement HRV timeline with shift detection and prompt context builder"
```

---

## Task 4: HRV Engine (Main Thread)

Manages camera, captures frames to canvas, communicates with worker, emits measurements.

**Files:**
- Create: `src/engine/hrvEngine.ts`

- [ ] **Step 1: Implement HrvEngine**

Create `src/engine/hrvEngine.ts`:

```typescript
import type { HrvMeasurement, HrvError } from '../types/hrv'

type MeasurementCallback = (m: HrvMeasurement) => void
type CalibrationCallback = (baseline: number) => void
type ErrorCallback = (error: HrvError) => void

export class HrvEngine {
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private canvas: OffscreenCanvas | null = null
  private ctx: OffscreenCanvasRenderingContext2D | null = null
  private worker: Worker | null = null
  private animFrameId: number | null = null
  private computeInterval: ReturnType<typeof setInterval> | null = null
  private latest: HrvMeasurement | null = null
  private calibrating = true
  private baseline: number | null = null
  private greenBuffer: number[] = []

  private measurementCallbacks: MeasurementCallback[] = []
  private calibrationCallbacks: CalibrationCallback[] = []
  private errorCallbacks: ErrorCallback[] = []

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 320, height: 240 },
      })
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError') {
        throw { type: 'camera_denied' } as HrvError
      }
      throw { type: 'camera_unavailable' } as HrvError
    }

    // Monitor for stream ending unexpectedly
    const track = this.stream.getVideoTracks()[0]
    track.addEventListener('ended', () => {
      this.errorCallbacks.forEach(cb => cb({ type: 'camera_lost' }))
      this.stopProcessing()
    })

    // Set up video element (offscreen, not added to DOM)
    this.video = document.createElement('video')
    this.video.srcObject = this.stream
    this.video.playsInline = true
    this.video.muted = true
    await this.video.play()

    // Set up offscreen canvas
    this.canvas = new OffscreenCanvas(320, 240)
    this.ctx = this.canvas.getContext('2d')!

    // Start worker
    try {
      this.worker = new Worker(
        new URL('./hrvSignalWorker.ts', import.meta.url),
        { type: 'module' },
      )

      this.worker.onmessage = (e: MessageEvent) => {
        const { type, data } = e.data
        if (type === 'measurement' && data) {
          this.latest = data as HrvMeasurement
          this.measurementCallbacks.forEach(cb => cb(this.latest!))
        }
        if (type === 'calibration_complete') {
          this.calibrating = false
          this.calibrationCallbacks.forEach(cb => cb(data.baseline))
        }
      }

      this.worker.onerror = (err) => {
        console.warn('HRV worker error, falling back to main thread:', err)
        this.errorCallbacks.forEach(cb => cb({ type: 'worker_error', message: err.message }))
      }
    } catch {
      console.warn('Failed to create HRV worker, running on main thread')
    }

    // Start frame capture loop
    this.captureFrames()

    // Request computation every 5 seconds
    this.computeInterval = setInterval(() => {
      if (this.worker) {
        this.worker.postMessage({ type: 'compute' })
      } else {
        // Main-thread fallback: import and run signal processing directly
        import('./hrvSignalWorker').then(({ butterworthBandpass, detectPeaks, computeHrvMetrics, classifyAutonomicState }) => {
          if (this.greenBuffer.length < 90) return // need 3s of data
          const filtered = butterworthBandpass(this.greenBuffer, 30)
          const peaks = detectPeaks(filtered, 30)
          const ibis: number[] = []
          for (let i = 1; i < peaks.length; i++) {
            const ibi = ((peaks[i] - peaks[i - 1]) / 30) * 1000
            if (ibi > 250 && ibi < 1500) ibis.push(ibi)
          }
          const metrics = computeHrvMetrics(ibis)
          if (!metrics) return
          const confidence = Math.min(1, ibis.length / 8)
          const measurement: HrvMeasurement = {
            timestamp: Date.now(),
            hr: Math.round(metrics.hr),
            rmssd: Math.round(metrics.rmssd * 10) / 10,
            autonomicState: this.baseline ? classifyAutonomicState(metrics.rmssd, this.baseline) : 'transitioning',
            trend: 'steady',
            confidence: Math.round(confidence * 100) / 100,
          }
          this.latest = measurement
          this.measurementCallbacks.forEach(cb => cb(measurement))
        })
      }
    }, 5000)
  }

  stop(): void {
    this.stopProcessing()

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop())
      this.stream = null
    }

    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }

    this.worker?.postMessage({ type: 'reset' })
    this.worker?.terminate()
    this.worker = null
    this.canvas = null
    this.ctx = null
    this.latest = null
    this.calibrating = true
  }

  getLatest(): HrvMeasurement | null {
    return this.latest
  }

  getStream(): MediaStream | null {
    return this.stream
  }

  isCalibrating(): boolean {
    return this.calibrating
  }

  onMeasurement(cb: MeasurementCallback): void {
    this.measurementCallbacks.push(cb)
  }

  onCalibrationComplete(cb: CalibrationCallback): void {
    this.calibrationCallbacks.push(cb)
  }

  onError(cb: ErrorCallback): void {
    this.errorCallbacks.push(cb)
  }

  private captureFrames(): void {
    if (!this.video || !this.ctx || !this.canvas) return

    this.ctx.drawImage(this.video, 0, 0, 320, 240)
    const imageData = this.ctx.getImageData(0, 0, 320, 240)

    if (this.worker) {
      this.worker.postMessage({
        type: 'frame',
        data: {
          imageData: imageData.data.buffer,
          width: 320,
          height: 240,
          fps: 30,
        },
      }, [imageData.data.buffer])
    } else {
      // Main-thread fallback: extract green channel directly
      import('./hrvSignalWorker').then(({ extractGreenChannel }) => {
        const green = extractGreenChannel(imageData.data, 320, 240)
        this.greenBuffer.push(green)
        if (this.greenBuffer.length > 300) this.greenBuffer = this.greenBuffer.slice(-300)
      })
    }

    this.animFrameId = requestAnimationFrame(() => this.captureFrames())
  }

  private stopProcessing(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }
    if (this.computeInterval) {
      clearInterval(this.computeInterval)
      this.computeInterval = null
    }
  }
}
```

**Worker fallback:** If the Worker fails to instantiate, the engine falls back to main-thread processing. The `captureFrames` method imports the signal processing functions directly and runs them inline. This is implemented via the `this.worker` null check — when worker is null, frames are processed in the `computeInterval` callback using the exported functions from `hrvSignalWorker.ts`.

Note: This class relies heavily on browser APIs (getUserMedia, Worker, Canvas) which are difficult to unit test. It will be tested via the integration in SessionView. The pure signal processing logic is tested in Task 2.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/engine/hrvEngine.ts
git commit -m "feat(hrv): implement main-thread HRV engine with camera management and worker communication"
```

---

## Task 5: Therapist Prompt Integration

**Files:**
- Modify: `src/ai/therapistPrompts.ts`
- Modify: `src/ai/therapistPrompts.test.ts`

- [ ] **Step 1: Write test for HRV context in prompt**

Add to `src/ai/therapistPrompts.test.ts`:

```typescript
  it('includes HRV context when provided', () => {
    const prompt = buildTherapistSystemPrompt({
      phase: 'deepening',
      hrvContext: '[Biometric context]\nCurrent autonomic state: activated (trend: rising, 45s)\nHeart rate: 82 bpm',
    })
    expect(prompt).toContain('[Biometric context]')
    expect(prompt).toContain('autonomic state: activated')
    expect(prompt).toContain('Heart rate: 82 bpm')
    expect(prompt).toContain('biometric data as fact')
  })

  it('omits HRV section when no context provided', () => {
    const prompt = buildTherapistSystemPrompt({ phase: 'opening' })
    expect(prompt).not.toContain('[Biometric context]')
    expect(prompt).not.toContain('biometric')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ai/therapistPrompts.test.ts`
Expected: FAIL — hrvContext not recognized / biometric text not in output

- [ ] **Step 3: Implement prompt integration**

In `src/ai/therapistPrompts.ts`:

Add `hrvContext?: string` to the `TherapistPromptOptions` interface (line 53-60):

```typescript
export interface TherapistPromptOptions {
  phase: SessionPhase
  recentSessionNotes?: { note: string; date: number }[]
  relevantMemories?: PartMemory[]
  profile?: UserProfile | null
  currentEmotion?: string
  isGrounding?: boolean
  hrvContext?: string
}
```

In `buildTherapistSystemPrompt`, add HRV context injection before the language directive (around line 125, before `const langDirective`):

```typescript
  if (options.hrvContext) {
    parts.push(options.hrvContext)
    parts.push(`When biometric context is available:
- Use it to notice what the user might not be saying ("I notice you might be feeling more activated right now — does that resonate?")
- Never state biometric data as fact about emotions ("Your heart rate shows you're anxious") — offer it as an invitation to explore
- If a shift correlates with a specific topic, gently name the connection
- Don't reference biometrics every message — use sparingly when it adds genuine insight
- During grounding: note if biometrics show the user is settling (or not), adjust approach accordingly`)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ai/therapistPrompts.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/therapistPrompts.ts src/ai/therapistPrompts.test.ts
git commit -m "feat(hrv): inject HRV biometric context into therapist prompts"
```

---

## Task 6: Data Persistence

**Files:**
- Modify: `src/store/db.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Add hrvSessions proxy to db.ts**

In `src/store/db.ts`, add to the `db` object literal (line 110-125), after `apiKeys`:

```typescript
  hrvSessions: createCollectionProxy('hrvSessions'),
```

- [ ] **Step 2: Add to exportAllData**

In `src/store/db.ts`, add `'hrvSessions'` to the `collectionNames` array in `exportAllData()` (line 421-425). **Important:** Step 1 (adding the proxy) must be done first — the `as const` array is used to index into the `db` object, so `'hrvSessions'` must exist as a key on `db` before it appears in `collectionNames`:

```typescript
  const collectionNames = [
    'entries', 'parts', 'memories', 'thoughts', 'interactions',
    'entrySummaries', 'userProfile', 'fossils', 'letters',
    'sessionLog', 'innerWeather', 'consent', 'sessions',
    'hrvSessions',
  ] as const
```

- [ ] **Step 3: Add to deleteAccount in Cloud Function**

In `functions/src/index.ts`, add `'hrvSessions'` to the collections array (line 975-979):

```typescript
          const collections = [
            'entries', 'parts', 'memories', 'thoughts', 'interactions',
            'entrySummaries', 'userProfile', 'fossils', 'letters',
            'sessionLog', 'innerWeather', 'consent', 'sessions',
            'hrvSessions',
          ]
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/store/db.ts functions/src/index.ts
git commit -m "feat(hrv): add hrvSessions to Firestore proxy, data export, and account deletion"
```

---

## Task 7: UI Components — Consent Dialog and Ambient Bar

**Files:**
- Create: `src/components/Session/HrvConsentDialog.tsx`
- Create: `src/components/Session/HrvAmbientBar.tsx`

- [ ] **Step 1: Create HrvConsentDialog**

Create `src/components/Session/HrvConsentDialog.tsx`:

```typescript
import { useState } from 'react'
import { db } from '../../store/db'
import type { CameraHrvConsent } from '../../types'

interface Props {
  onAccept: () => void
  onDecline: () => void
}

export function HrvConsentDialog({ onAccept, onDecline }: Props) {
  const [cameraAccepted, setCameraAccepted] = useState(false)
  const [biometricAccepted, setBiometricAccepted] = useState(false)

  const canAccept = cameraAccepted && biometricAccepted

  const handleAccept = async () => {
    const consent: CameraHrvConsent = {
      id: 'camera-hrv',
      acceptedAt: Date.now(),
      acceptedVersion: '1.0',
      cameraAccepted: true,
      biometricDataAccepted: true,
    }
    await db.consent.add(consent)
    onAccept()
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
      zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--bg-primary)',
        borderRadius: 16,
        padding: '32px',
        maxWidth: 480,
        width: '90%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <h3 style={{
          margin: '0 0 16px',
          fontFamily: "'Inter', sans-serif",
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          Enable Biometric Sensing
        </h3>

        <p style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          marginBottom: 24,
        }}>
          This feature uses your camera to detect subtle changes in skin color caused by blood flow,
          measuring your heart rate variability to understand your autonomic state.
          No video is stored or transmitted — only derived metrics are saved to your account.
        </p>

        <label style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 16,
          cursor: 'pointer',
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          color: 'var(--text-primary)',
        }}>
          <input
            type="checkbox"
            checked={cameraAccepted}
            onChange={e => setCameraAccepted(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          I understand my camera will be used to capture video for heart rate analysis
        </label>

        <label style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 24,
          cursor: 'pointer',
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          color: 'var(--text-primary)',
        }}>
          <input
            type="checkbox"
            checked={biometricAccepted}
            onChange={e => setBiometricAccepted(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          I agree to the collection of biometric data (heart rate, HRV metrics)
        </label>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onDecline}
            style={{
              padding: '10px 20px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Not now
          </button>
          <button
            onClick={handleAccept}
            disabled={!canAccept}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: 8,
              background: canAccept ? 'var(--accent-primary, #6b8f71)' : 'var(--border-subtle)',
              color: canAccept ? '#fff' : 'var(--text-tertiary)',
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              fontWeight: 600,
              cursor: canAccept ? 'pointer' : 'default',
              opacity: canAccept ? 1 : 0.6,
            }}
          >
            Enable
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create HrvAmbientBar**

Create `src/components/Session/HrvAmbientBar.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react'
import type { HrvMeasurement } from '../../types'

interface Props {
  measurements: HrvMeasurement[]
  stream: MediaStream | null
  isCalibrating: boolean
  error: string | null
}

export function HrvAmbientBar({ measurements, stream, isCalibrating, error }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [, setTick] = useState(0)

  // Attach camera stream to video thumbnail
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(() => {})
    }
  }, [stream])

  // Draw HRV trace on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || measurements.length < 2) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Draw RMSSD trace (last 60 values)
    const recent = measurements.slice(-60)
    const rmssdValues = recent.map(m => m.rmssd)
    const min = Math.min(...rmssdValues) - 5
    const max = Math.max(...rmssdValues) + 5
    const range = max - min || 1

    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 1.5
    ctx.beginPath()

    for (let i = 0; i < recent.length; i++) {
      const x = (i / (recent.length - 1)) * w
      const y = h - ((recent[i].rmssd - min) / range) * h * 0.8 - h * 0.1
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    setTick(t => t + 1) // force re-render for color transitions
  }, [measurements])

  const latest = measurements.at(-1)
  const stateColor = !latest || isCalibrating ? 'rgba(120,120,120,0.3)'
    : latest.autonomicState === 'calm' ? 'rgba(107,143,113,0.3)'
    : latest.autonomicState === 'activated' ? 'rgba(178,132,93,0.3)'
    : 'rgba(150,140,120,0.3)'

  const stateLabel = error ? error
    : isCalibrating ? 'Calibrating...'
    : latest ? `${latest.autonomicState} · ${latest.hr} bpm`
    : 'Starting...'

  const confidenceWarn = latest && !isCalibrating && latest.confidence < 0.3

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 16px',
      borderRadius: 10,
      background: stateColor,
      transition: 'background 2s ease',
      marginBottom: 16,
      minHeight: 48,
    }}>
      {/* State label */}
      <div style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
        minWidth: 100,
      }}>
        {confidenceWarn ? 'Weak signal' : stateLabel}
      </div>

      {/* HRV trace */}
      <canvas
        ref={canvasRef}
        width={200}
        height={32}
        style={{ flex: 1, maxWidth: 300, opacity: 0.8 }}
      />

      {/* Camera thumbnail */}
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '2px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      />
    </div>
  )
}
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/Session/HrvConsentDialog.tsx src/components/Session/HrvAmbientBar.tsx
git commit -m "feat(hrv): add consent dialog and ambient bar UI components"
```

---

## Task 8: SessionView Integration

Wire everything together in SessionView: toggle, engine lifecycle, timeline events, prompt injection, persistence.

**Files:**
- Modify: `src/components/Session/SessionView.tsx`

- [ ] **Step 1: Add imports and HRV state**

At the top of `src/components/Session/SessionView.tsx`, add imports:

```typescript
import { HrvEngine } from '../../engine/hrvEngine'
import { HrvTimeline } from '../../engine/hrvTimeline'
import { HrvAmbientBar } from './HrvAmbientBar'
import { HrvConsentDialog } from './HrvConsentDialog'
import type { HrvMeasurement, HrvError, HrvSessionData } from '../../types'
```

Inside the `SessionView` component, after the existing refs (around line 47), add HRV state:

```typescript
  // HRV biometric state
  const [hrvEnabled, setHrvEnabled] = useState(false)
  const [hrvMeasurements, setHrvMeasurements] = useState<HrvMeasurement[]>([])
  const [hrvCalibrating, setHrvCalibrating] = useState(true)
  const [hrvError, setHrvError] = useState<string | null>(null)
  const [showHrvConsent, setShowHrvConsent] = useState(false)
  const hrvEngineRef = useRef<HrvEngine | null>(null)
  const hrvTimelineRef = useRef(new HrvTimeline())
  const hrvStartTimeRef = useRef<number>(0)
  const hrvFlushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
```

- [ ] **Step 2: Add HRV toggle handler**

After the existing `handleEndSession` callback (around line 365), add:

```typescript
  const handleHrvToggle = useCallback(async () => {
    const config = getGlobalConfig()
    if (config?.features?.webcamHrv !== true) return

    if (hrvEnabled) {
      // Disable
      hrvEngineRef.current?.stop()
      hrvEngineRef.current = null
      setHrvEnabled(false)
      setHrvMeasurements([])
      setHrvCalibrating(true)
      setHrvError(null)
      if (hrvFlushIntervalRef.current) {
        clearInterval(hrvFlushIntervalRef.current)
        hrvFlushIntervalRef.current = null
      }
      return
    }

    // Check consent
    const consent = await db.consent.get('camera-hrv')
    if (!consent) {
      setShowHrvConsent(true)
      return
    }

    await startHrvEngine()
  }, [hrvEnabled, startHrvEngine])

  const startHrvEngine = useCallback(async () => {
    const engine = new HrvEngine()
    hrvEngineRef.current = engine
    hrvTimelineRef.current = new HrvTimeline()
    hrvStartTimeRef.current = Date.now()

    engine.onMeasurement((m) => {
      hrvTimelineRef.current.addMeasurement(m)
      setHrvMeasurements(prev => [...prev, m])
    })

    engine.onCalibrationComplete((baseline) => {
      hrvTimelineRef.current.setBaseline(baseline)
      setHrvCalibrating(false)
    })

    engine.onError((err) => {
      if (err.type === 'camera_lost') {
        setHrvError('Camera disconnected')
      } else if (err.type === 'worker_error') {
        console.warn('HRV worker error:', err.message)
      }
    })

    try {
      await engine.start()
      setHrvEnabled(true)
      setHrvError(null)

      // Safety flush every 5 minutes
      hrvFlushIntervalRef.current = setInterval(() => {
        flushHrvData().catch(console.error)
      }, 5 * 60 * 1000)

      trackEvent('hrv_enabled', { session_id: sessionRef.current?.id })
    } catch (err) {
      const hrvErr = err as HrvError
      if (hrvErr.type === 'camera_denied') {
        setHrvError('Camera access denied')
      } else {
        setHrvError('Camera not available')
      }
      hrvEngineRef.current = null
    }
  }, [])

  const flushHrvData = useCallback(async () => {
    const session = sessionRef.current
    const timeline = hrvTimelineRef.current
    if (!session || timeline.getMeasurements().length === 0) return

    const measurements = timeline.getMeasurements()
    const shifts = timeline.getRecentShifts(99999)

    const avgHr = measurements.reduce((s, m) => s + m.hr, 0) / measurements.length
    const avgRmssd = measurements.reduce((s, m) => s + m.rmssd, 0) / measurements.length
    const avgConf = measurements.reduce((s, m) => s + m.confidence, 0) / measurements.length

    const stateCounts: Record<string, number> = {}
    for (const m of measurements) {
      stateCounts[m.autonomicState] = (stateCounts[m.autonomicState] || 0) + 1
    }
    const dominantState = Object.entries(stateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'transitioning'

    const data: HrvSessionData = {
      id: session.id,
      startedAt: hrvStartTimeRef.current,
      endedAt: Date.now(),
      calibrationBaseline: timeline.baselineRmssd || 0,
      measurements,
      shifts,
      summary: {
        dominantState: dominantState as HrvSessionData['summary']['dominantState'],
        averageHr: Math.round(avgHr),
        averageRmssd: Math.round(avgRmssd * 10) / 10,
        shiftCount: shifts.length,
        avgConfidence: Math.round(avgConf * 100) / 100,
      },
    }

    await db.hrvSessions.add(data)
  }, [])
```

- [ ] **Step 3: Wire timeline events to message flow**

In `handleSend` (around line 264), after the `await sessionMessagesDb.add(currentSession.id, userMessage)` line, add:

```typescript
    // Record HRV timeline event
    if (hrvEnabled) {
      hrvTimelineRef.current.addConversationEvent('user_message', updatedMessages.length - 1)
    }
```

In `generateTherapistMessage` (around line 158), modify the `promptMessages` construction to include HRV context. Replace the `buildTherapistMessages` call (lines 170-176):

```typescript
    const hrvContext = hrvEnabled ? hrvTimelineRef.current.buildPromptContext() : undefined
    const promptMessages = buildTherapistMessages(currentMessages, {
      phase,
      recentSessionNotes: context?.recentSessionNotes,
      relevantMemories: context?.relevantMemories,
      profile: context?.userProfile,
      isGrounding: isGroundingActive(),
      hrvContext,
    })
```

In the `streamChatCompletion` `onToken` callback (line 234), add the timeline event for AI response start. Use a ref flag to only fire once per response:

Add a ref at the top with other refs:
```typescript
  const hrvResponseStartedRef = useRef(false)
```

In `generateTherapistMessage`, before the `streamChatCompletion` call, add:
```typescript
    hrvResponseStartedRef.current = false
```

In the `onToken` callback:
```typescript
        onToken: (token) => {
          streamBufferRef.current += token
          if (!typingTimerRef.current) {
            revealNextChar()
          }
          // Track HRV timeline: first token = response start
          if (hrvEnabled && !hrvResponseStartedRef.current) {
            hrvResponseStartedRef.current = true
            hrvTimelineRef.current.addConversationEvent('ai_response_start', currentMessages.length)
          }
        },
```

In the `onComplete` callback:
```typescript
        onComplete: () => {
          onStreamCompleteRef.current = finalizeMessage
          if (!typingTimerRef.current) {
            revealNextChar()
          }
          // Track HRV timeline: response complete
          if (hrvEnabled) {
            hrvTimelineRef.current.addConversationEvent('ai_response_complete', currentMessages.length)
          }
        },
```

- [ ] **Step 4: Wire session end to HRV cleanup**

In `handleEndSession` (line 322), add HRV cleanup AFTER `generateTherapistMessage` has been called (so the closing message gets HRV context) but BEFORE the final `trackEvent('session_closed', ...)`. Place this after the `weatherEngineRef.current.persist()` call:

```typescript
    // Save HRV data and stop engine
    if (hrvEnabled && hrvEngineRef.current) {
      if (!hrvEngineRef.current.isCalibrating()) {
        await flushHrvData()
      }
      hrvEngineRef.current.stop()
      hrvEngineRef.current = null
      setHrvEnabled(false)
      if (hrvFlushIntervalRef.current) {
        clearInterval(hrvFlushIntervalRef.current)
        hrvFlushIntervalRef.current = null
      }
    }
```

- [ ] **Step 5: Add HRV toggle and ambient bar to JSX**

In the return JSX, add the HRV toggle button before the messages list. After the session note card block (around line 556) and before `{/* Messages list */}`:

```tsx
      {/* HRV Controls */}
      {getGlobalConfig()?.features?.webcamHrv === true && !isClosed && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: hrvEnabled ? 8 : 16 }}>
            <button
              onClick={handleHrvToggle}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: hrvEnabled ? 'rgba(107,143,113,0.15)' : 'transparent',
                color: 'var(--text-secondary)',
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
                {!hrvEnabled && <line x1="1" y1="1" x2="23" y2="23" />}
              </svg>
              HRV {hrvEnabled ? 'On' : 'Off'}
            </button>
          </div>

          {hrvEnabled && (
            <HrvAmbientBar
              measurements={hrvMeasurements}
              stream={hrvEngineRef.current?.getStream() ?? null}
              isCalibrating={hrvCalibrating}
              error={hrvError}
            />
          )}
        </>
      )}

      {/* HRV Consent Dialog */}
      {showHrvConsent && (
        <HrvConsentDialog
          onAccept={() => {
            setShowHrvConsent(false)
            startHrvEngine()
          }}
          onDecline={() => setShowHrvConsent(false)}
        />
      )}
```

- [ ] **Step 6: Clean up HRV on unmount**

In the existing init `useEffect` cleanup (line 111-117), add HRV cleanup:

```typescript
    return () => {
      cancelled = true
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current)
        typingTimerRef.current = null
      }
      // Clean up HRV engine
      hrvEngineRef.current?.stop()
      if (hrvFlushIntervalRef.current) {
        clearInterval(hrvFlushIntervalRef.current)
      }
    }
```

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/components/Session/SessionView.tsx
git commit -m "feat(hrv): wire HRV engine, timeline, and UI into SessionView"
```

---

## Task 9: Infrastructure — Permissions Policy

**Files:**
- Modify: `firebase.json`

- [ ] **Step 1: Update Permissions-Policy**

In `firebase.json`, change `camera=()` to `camera=(self)`:

```json
{ "key": "Permissions-Policy", "value": "camera=(self), microphone=(), geolocation=()" }
```

- [ ] **Step 2: Commit**

```bash
git add firebase.json
git commit -m "feat(hrv): enable camera permission for self origin in Permissions-Policy"
```

---

## Task 10: Full Test Suite and Build Verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new HRV tests)

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: Successful build

- [ ] **Step 5: Build functions**

Run: `cd functions && npx tsc && cd ..`
Expected: Successful build

- [ ] **Step 6: Commit any fixes**

If any of the above steps required fixes, commit them:

```bash
git add -A
git commit -m "fix(hrv): address lint/type/test issues from full verification"
```
