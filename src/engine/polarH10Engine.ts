import type { HrvMeasurement, HrvTrend } from '../types/hrv'
import {
  computeHrvMetrics,
  classifyAutonomicState,
  computeDerivedMetrics,
} from './hrvSignalWorker'

/**
 * Polar H10 (and any standard Bluetooth GATT heart-rate monitor) integration.
 *
 * Pipeline mirror to the webcam path:
 *   Web Bluetooth → HR Measurement characteristic (0x2A37) → RR intervals
 *   → rolling 30s IBI buffer → HrvMeasurement every 5s → HrvTimeline.
 *
 * v1 deliberately stops at the standard heart-rate GATT service. Polar's
 * proprietary PMD service (ECG @ 130 Hz, accelerometer @ 200 Hz) — and the
 * accelerometer-derived respiration rate it would enable — is reserved for
 * v2. See plans/build-out-device-connect-jaunty-kettle.md.
 */

// Minimal Web Bluetooth typings. The full surface isn't in lib.dom (Safari
// doesn't ship Web Bluetooth, so TC39/whatwg haven't standardized it into
// lib.dom). Rolling our own keeps us off a third-party DefinitelyTyped dep.
declare global {
  interface Navigator {
    bluetooth?: BluetoothApi
  }
}

interface BluetoothApi {
  requestDevice(options: {
    filters?: Array<{ services?: BluetoothServiceUUID[] }>
    optionalServices?: BluetoothServiceUUID[]
    acceptAllDevices?: boolean
  }): Promise<BluetoothDevice>
  getAvailability?(): Promise<boolean>
}

type BluetoothServiceUUID = number | string

interface BluetoothDevice {
  readonly id: string
  readonly name?: string
  readonly gatt?: BluetoothRemoteGATTServer
  addEventListener(type: 'gattserverdisconnected', listener: (e: Event) => void): void
  removeEventListener(type: 'gattserverdisconnected', listener: (e: Event) => void): void
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(uuid: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>
}

interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: BluetoothServiceUUID): Promise<BluetoothRemoteGATTCharacteristic>
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly value?: DataView
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
}

/** Whether the current browser supports Web Bluetooth. */
export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

export type PolarH10Status =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'streaming'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

export type PolarH10ErrorType =
  | 'unsupported'         // no navigator.bluetooth
  | 'denied'              // user dismissed the picker
  | 'no_device'           // user picked nothing
  | 'gatt_failed'         // GATT connect/service/characteristic call threw
  | 'characteristic_failed' // notifications couldn't start
  | 'lost'                // mid-session disconnect that didn't recover

export interface PolarH10Error {
  type: PolarH10ErrorType
  message?: string
}

/** Parsed payload of a single HR Measurement notification. */
export interface ParsedHRM {
  /** Heart rate in BPM. */
  hr: number
  /** RR intervals in milliseconds, preserving 1/1024-second resolution. */
  rrIntervals: number[]
}

/**
 * Parse a Bluetooth SIG Heart Rate Measurement (0x2A37) payload.
 *
 * Layout per spec:
 *   byte 0: flags
 *     bit 0  — HR Value Format (0 = uint8, 1 = uint16)
 *     bit 1-2 — Sensor Contact Status (informational; we ignore)
 *     bit 3  — Energy Expended present (2 bytes after HR)
 *     bit 4  — RR-Interval present (2 bytes each, uint16 LE, 1/1024 s units)
 *     bit 5-7 — reserved
 *   bytes after flags:
 *     HR: 1 or 2 bytes (LE)
 *     Energy: 2 bytes if present (skipped — not used here)
 *     RR list: remaining bytes, uint16 LE pairs
 *
 * Defensive: stops reading at end of buffer if upstream truncated a payload.
 */
export function parseHeartRateMeasurement(view: DataView): ParsedHRM {
  if (view.byteLength < 2) {
    return { hr: 0, rrIntervals: [] }
  }

  const flags = view.getUint8(0)
  const hr16Bit = (flags & 0b0000_0001) !== 0
  const energyPresent = (flags & 0b0000_1000) !== 0
  const rrPresent = (flags & 0b0001_0000) !== 0

  let offset = 1
  let hr = 0

  if (hr16Bit) {
    if (offset + 2 > view.byteLength) return { hr: 0, rrIntervals: [] }
    hr = view.getUint16(offset, /* littleEndian */ true)
    offset += 2
  } else {
    hr = view.getUint8(offset)
    offset += 1
  }

  if (energyPresent) {
    // Skip energy-expended (uint16 kJ); not used for HRV.
    offset += 2
  }

  const rrIntervals: number[] = []
  if (rrPresent) {
    while (offset + 2 <= view.byteLength) {
      const ticks = view.getUint16(offset, /* littleEndian */ true)
      // Convert 1/1024-second ticks to milliseconds, preserving precision.
      rrIntervals.push((ticks * 1000) / 1024)
      offset += 2
    }
  }

  return { hr, rrIntervals }
}

/**
 * Manages the Web Bluetooth connection to a Polar H10 (or any standard GATT
 * heart-rate monitor). Emits raw HR + RR intervals on each notification. The
 * HRV math layer composes this into HrvMeasurement objects.
 *
 * Lifecycle:
 *   const engine = new PolarH10Engine()
 *   engine.onSample((rrIntervals, hr) => ...)
 *   engine.onStatus(s => ...)
 *   await engine.requestAndConnect()    // user-gesture entry point
 *   ...
 *   engine.disconnect()
 *
 * Reconnect: a single auto-reconnect attempt fires on gattserverdisconnected;
 * if that fails, status becomes 'disconnected' and the caller decides whether
 * to surface a retry button or fall back.
 */

const HEART_RATE_SERVICE: BluetoothServiceUUID = 'heart_rate'        // 0x180D
const HR_MEASUREMENT_CHARACTERISTIC: BluetoothServiceUUID = 'heart_rate_measurement' // 0x2A37

export interface PolarH10SampleCallback {
  (rrIntervals: number[], hr: number, receivedAt: number): void
}

export class PolarH10Engine {
  private device: BluetoothDevice | null = null
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null
  private status: PolarH10Status = 'idle'
  private deviceName: string | null = null

  private sampleCallbacks: PolarH10SampleCallback[] = []
  private statusCallbacks: Array<(s: PolarH10Status) => void> = []
  private errorCallbacks: Array<(e: PolarH10Error) => void> = []
  private measurementCallbacks: Array<(m: HrvMeasurement) => void> = []
  private calibrationCallbacks: Array<(baseline: number) => void> = []

  private rrBuffer: RrSample[] = []
  private recentRmssds: number[] = []
  private baselineRmssd: number | null = null
  private streamingStartedAt: number | null = null
  private tickHandle: ReturnType<typeof setInterval> | null = null
  private latestMeasurement: HrvMeasurement | null = null

  private boundNotification = (e: Event): void => this.handleNotification(e)
  private boundDisconnect = (): void => { void this.handleUnexpectedDisconnect() }
  /** Once true, gattserverdisconnected during teardown is ignored. */
  private intentionalDisconnect = false

  /** Request a device via the Web Bluetooth picker. Must be called from a user gesture. */
  async requestAndConnect(): Promise<void> {
    if (!isWebBluetoothSupported()) {
      this.emitError({ type: 'unsupported' })
      this.setStatus('error')
      return
    }

    this.setStatus('requesting')
    let device: BluetoothDevice
    try {
      device = await navigator.bluetooth!.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE] }],
      })
    } catch (err) {
      // User dismissed the picker or chose nothing — both surface as NotFoundError.
      const name = (err as { name?: string })?.name ?? ''
      this.emitError({ type: name === 'NotFoundError' ? 'no_device' : 'denied', message: String(err) })
      this.setStatus('idle')
      return
    }

    this.device = device
    this.deviceName = device.name ?? null
    device.addEventListener('gattserverdisconnected', this.boundDisconnect)
    await this.openCharacteristic()
  }

  disconnect(): void {
    this.intentionalDisconnect = true
    this.teardown()
    this.setStatus('idle')
  }

  getStatus(): PolarH10Status {
    return this.status
  }

  getDeviceName(): string | null {
    return this.deviceName
  }

  onSample(cb: PolarH10SampleCallback): () => void {
    this.sampleCallbacks.push(cb)
    return () => { this.sampleCallbacks = this.sampleCallbacks.filter(c => c !== cb) }
  }

  onStatus(cb: (s: PolarH10Status) => void): () => void {
    this.statusCallbacks.push(cb)
    // Fire immediately with the current status so subscribers don't miss state.
    cb(this.status)
    return () => { this.statusCallbacks = this.statusCallbacks.filter(c => c !== cb) }
  }

  onError(cb: (e: PolarH10Error) => void): () => void {
    this.errorCallbacks.push(cb)
    return () => { this.errorCallbacks = this.errorCallbacks.filter(c => c !== cb) }
  }

  onMeasurement(cb: (m: HrvMeasurement) => void): () => void {
    this.measurementCallbacks.push(cb)
    return () => { this.measurementCallbacks = this.measurementCallbacks.filter(c => c !== cb) }
  }

  onCalibrationComplete(cb: (baseline: number) => void): () => void {
    this.calibrationCallbacks.push(cb)
    return () => { this.calibrationCallbacks = this.calibrationCallbacks.filter(c => c !== cb) }
  }

  getLatestMeasurement(): HrvMeasurement | null {
    return this.latestMeasurement
  }

  /**
   * Test-only entry point: inject an RR/HR sample as if it had come from the
   * device. Drives the same path that real notifications do. Exposed (not
   * `private`) so unit tests can compose realistic sample streams without a
   * BLE stack. Production code goes through `handleNotification`.
   */
  feedSampleForTest(rrIntervals: number[], hr: number, t: number): void {
    this.ingestSample(rrIntervals, hr, t)
  }

  /**
   * Test-only entry point: run one composition tick at the given wall-clock
   * time. Mirrors the timer-driven `tick()` so tests can drive the timeline
   * without `setInterval`.
   */
  tickForTest(now: number): void {
    this.tick(now)
  }

  private async openCharacteristic(): Promise<void> {
    if (!this.device?.gatt) {
      this.emitError({ type: 'gatt_failed', message: 'GATT unavailable on device' })
      this.setStatus('error')
      return
    }
    this.setStatus('connecting')
    let char: BluetoothRemoteGATTCharacteristic | null = null
    try {
      const server = await this.device.gatt.connect()
      const service = await server.getPrimaryService(HEART_RATE_SERVICE)
      char = await service.getCharacteristic(HR_MEASUREMENT_CHARACTERISTIC)
      char.addEventListener('characteristicvaluechanged', this.boundNotification)
      await char.startNotifications()
      this.characteristic = char
      this.intentionalDisconnect = false
      // Reset math state on every fresh stream — baseline measured during a
      // noisy prior session shouldn't carry across a reconnect.
      this.rrBuffer = []
      this.recentRmssds = []
      this.baselineRmssd = null
      this.streamingStartedAt = Date.now()
      this.tickHandle = setInterval(() => this.tick(Date.now()), TICK_INTERVAL_MS)
      this.setStatus('streaming')
    } catch (err) {
      if (char) char.removeEventListener('characteristicvaluechanged', this.boundNotification)
      this.emitError({
        type: 'characteristic_failed',
        message: err instanceof Error ? err.message : String(err),
      })
      this.setStatus('error')
    }
  }

  private handleNotification(event: Event): void {
    const target = event.target as BluetoothRemoteGATTCharacteristic | null
    const view = target?.value
    if (!view) return
    const parsed = parseHeartRateMeasurement(view)
    if (parsed.hr === 0 && parsed.rrIntervals.length === 0) return
    this.ingestSample(parsed.rrIntervals, parsed.hr, Date.now())
  }

  private ingestSample(rrIntervals: number[], hr: number, t: number): void {
    for (const rr of rrIntervals) {
      this.rrBuffer.push({ rr, t })
    }
    for (const cb of this.sampleCallbacks) cb(rrIntervals, hr, t)
  }

  private tick(now: number): void {
    trimRrBuffer(this.rrBuffer, now, RR_WINDOW_MS)
    const measurement = composeMeasurement(
      this.rrBuffer,
      this.baselineRmssd,
      this.recentRmssds,
      now,
    )
    if (!measurement) return

    if (
      this.baselineRmssd == null &&
      this.streamingStartedAt != null &&
      now - this.streamingStartedAt >= CALIBRATION_MS &&
      this.recentRmssds.length >= 3
    ) {
      // Median — robust to a single noisy reading during calibration.
      const sorted = [...this.recentRmssds].sort((a, b) => a - b)
      const baseline = sorted[Math.floor(sorted.length / 2)]
      this.baselineRmssd = baseline
      for (const cb of this.calibrationCallbacks) cb(baseline)
    }

    this.recentRmssds.push(measurement.rmssd)
    if (this.recentRmssds.length > TREND_SAMPLE_COUNT) this.recentRmssds.shift()

    this.latestMeasurement = measurement
    for (const cb of this.measurementCallbacks) cb(measurement)
  }

  private async handleUnexpectedDisconnect(): Promise<void> {
    if (this.intentionalDisconnect) return
    this.setStatus('reconnecting')
    try {
      await this.openCharacteristic()
    } catch {
      this.emitError({ type: 'lost', message: 'Could not reconnect to device' })
      this.setStatus('disconnected')
    }
  }

  private teardown(): void {
    if (this.tickHandle != null) {
      clearInterval(this.tickHandle)
      this.tickHandle = null
    }
    const char = this.characteristic
    if (char) {
      char.removeEventListener('characteristicvaluechanged', this.boundNotification)
      // Best-effort — if already disconnected the promise rejects; ignore.
      void char.stopNotifications().catch(() => {})
    }
    this.characteristic = null
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.boundDisconnect)
      if (this.device.gatt?.connected) this.device.gatt.disconnect()
    }
    this.device = null
  }

  private setStatus(status: PolarH10Status): void {
    if (this.status === status) return
    this.status = status
    for (const cb of this.statusCallbacks) cb(status)
  }

  private emitError(err: PolarH10Error): void {
    for (const cb of this.errorCallbacks) cb(err)
  }
}

// HRV math — pure functions, testable without a fake Bluetooth stack.

/** RR interval sample with arrival time (epoch ms). */
export interface RrSample {
  /** Interval in ms. */
  rr: number
  /** Time the sample arrived from the device. */
  t: number
}

/** Drop samples outside [now - windowMs, now]. Mutates the array in place. */
export function trimRrBuffer(buffer: RrSample[], now: number, windowMs: number): void {
  const cutoff = now - windowMs
  while (buffer.length > 0 && buffer[0].t < cutoff) buffer.shift()
}

/**
 * Confidence of an HrvMeasurement (0..1).
 *
 * The Polar H10 produces near-perfect RR intervals when worn correctly, so
 * confidence is dominated by *signal sufficiency* (enough samples in the
 * window) and *physiological plausibility* (HR in a reasonable range).
 *
 *  - Below 5 samples in the window: 0 (not enough to compute RMSSD)
 *  - 5..15 samples: ramps linearly from 0.4 → 1.0
 *  - 15+ samples: 1.0
 *  - HR outside [40, 200] BPM: clamped to 0.3 (likely motion artifact or strap slip)
 */
export function computeConfidence(sampleCount: number, hr: number): number {
  if (sampleCount < 5) return 0
  const plausible = hr >= 40 && hr <= 200
  const sampleScore = sampleCount >= 15
    ? 1.0
    : 0.4 + ((sampleCount - 5) / 10) * 0.6
  return plausible ? sampleScore : Math.min(sampleScore, 0.3)
}

/**
 * Direction of RMSSD movement over recent measurements. Mirrors the webcam
 * worker's `computeTrend` exactly so the timeline + prompt builder don't see
 * source-specific drift.
 */
export function computeTrend(recentRmssds: number[]): HrvTrend {
  if (recentRmssds.length < 4) return 'steady'
  const half = Math.floor(recentRmssds.length / 2)
  const first = recentRmssds.slice(0, half)
  const second = recentRmssds.slice(half)
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const firstAvg = avg(first)
  const delta = (avg(second) - firstAvg) / (firstAvg || 1)
  if (delta > 0.1) return 'rising'
  if (delta < -0.1) return 'falling'
  return 'steady'
}

/**
 * Compose an HrvMeasurement from a windowed RR buffer. Returns null when the
 * buffer is too short to produce meaningful HR/RMSSD (< 2 samples).
 *
 * Respiratory rate is intentionally null in v1 — the cleanest path to RR
 * from a chest strap is the accelerometer in Polar's PMD service, which
 * v2 will add. RSA-derived respiration is an option but not done here to
 * keep the v1 surface honest about what the H10 alone gives us.
 */
export function composeMeasurement(
  buffer: RrSample[],
  baselineRmssd: number | null,
  recentRmssds: number[],
  now: number,
): HrvMeasurement | null {
  const ibis = buffer.map(s => s.rr)
  const metrics = computeHrvMetrics(ibis)
  if (!metrics) return null

  // Baseline of 50ms is the worker's fallback when no calibration has run yet.
  // We mirror that so classify() doesn't return 'transitioning' for every
  // measurement during the first 30s of streaming.
  const effectiveBaseline = baselineRmssd ?? 50
  const autonomicState = classifyAutonomicState(metrics.rmssd, effectiveBaseline)
  const trend = computeTrend(recentRmssds)
  const confidence = computeConfidence(ibis.length, metrics.hr)
  const derived = computeDerivedMetrics(ibis)

  return {
    timestamp: now,
    hr: metrics.hr,
    rmssd: metrics.rmssd,
    autonomicState,
    trend,
    confidence,
    respiratoryRate: null,
    derived,
    source: 'polarH10',
  }
}

const RR_WINDOW_MS = 30_000
const TICK_INTERVAL_MS = 5_000
const CALIBRATION_MS = 30_000
const TREND_SAMPLE_COUNT = 6


