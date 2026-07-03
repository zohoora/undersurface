import type { HrvMeasurement, HrvTrend } from '../types/hrv'
import {
  computeHrvMetrics,
  classifyAutonomicState,
  computeDerivedMetrics,
  respiratoryBandpass,
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
  // Looser than the lib.dom BufferSource type so a Uint8Array passes
  // through without copying. The browser accepts both per the spec.
  writeValueWithResponse(value: ArrayBuffer | ArrayBufferView): Promise<void>
  readValue(): Promise<DataView>
}

/** Whether the current browser supports Web Bluetooth. */
export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

/** Counter for the first-N raw-frame console traces during the PMD trial. */
let pmdLogCount = 0

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Hex-dump helper for trial-mode console diagnostics. */
function toHex(buffer: DataView | Uint8Array): string {
  const bytes = buffer instanceof DataView
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : buffer
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ')
}

// ---------------------------------------------------------------------------
// PMD ACC frame parsing
//
// Frame layout (Polar BLE SDK):
//   [0]    measurement type (0x02 = ACC)
//   [1-8]  timestamp uint64 LE (device-clock nanoseconds)
//   [9]    frame type
//            0x00 = raw int16 (X,Y,Z) tuples
//            0x80 = delta-encoded — first sample full, subsequent samples
//                   encoded as bit-packed deltas in variable-bit-width blocks
//   [10+]  samples
// ---------------------------------------------------------------------------

export type AccSample = { x: number; y: number; z: number }

export interface ParsedAccFrame {
  samples: AccSample[]
  /** Device-clock timestamp of the *last* sample in this frame, in ns. */
  endTimestampNs: bigint
}

/** Parse a PMD data frame. Returns null if it isn't an ACC frame we can handle. */
export function parsePmdAccFrame(view: DataView): ParsedAccFrame | null {
  if (view.byteLength < 10) return null
  if (view.getUint8(0) !== 0x02) return null  // not ACC

  const endTimestampNs = view.getBigUint64(1, /* LE */ true)
  const frameType = view.getUint8(9)

  // Polar PMD frame_type encoding for ACC:
  //   0x00 = 8-bit raw
  //   0x01 = 16-bit raw signed (H10 default for ACC at ≤100 Hz)
  //   0x02 = 24-bit raw
  //   0x80+ = delta-compressed with bit-size in the low nibble
  if (frameType === 0x01) return parseAccRaw16(view, endTimestampNs)
  if (frameType === 0x00) return parseAccRaw16(view, endTimestampNs)  // legacy alias
  if ((frameType & 0x80) !== 0) return parseAccDelta(view, frameType, endTimestampNs)
  return null
}

function parseAccRaw16(view: DataView, endTimestampNs: bigint): ParsedAccFrame {
  const samples: AccSample[] = []
  let offset = 10
  while (offset + 6 <= view.byteLength) {
    samples.push({
      x: view.getInt16(offset + 0, true),
      y: view.getInt16(offset + 2, true),
      z: view.getInt16(offset + 4, true),
    })
    offset += 6
  }
  return { samples, endTimestampNs }
}

/**
 * Delta-encoded ACC. Reference sample is a full 3×int16 LE; each subsequent
 * block declares a bit-size and sample count, then packs N×3 signed deltas
 * little-endian-within-bytes. Deltas accumulate onto the running X/Y/Z.
 */
function parseAccDelta(view: DataView, _frameType: number, endTimestampNs: bigint): ParsedAccFrame {
  const samples: AccSample[] = []
  if (view.byteLength < 16) return { samples, endTimestampNs }

  let x = view.getInt16(10, true)
  let y = view.getInt16(12, true)
  let z = view.getInt16(14, true)
  samples.push({ x, y, z })

  let byteIdx = 16
  while (byteIdx + 2 <= view.byteLength) {
    const bitSize = view.getUint8(byteIdx++)
    const sampleCount = view.getUint8(byteIdx++)
    if (bitSize === 0 || sampleCount === 0) break

    const bitsPerSample = bitSize * 3  // X,Y,Z deltas
    const totalBits = bitsPerSample * sampleCount
    const totalBytes = Math.ceil(totalBits / 8)
    if (byteIdx + totalBytes > view.byteLength) break

    const deltas = unpackSignedDeltas(view, byteIdx, bitSize, sampleCount * 3)
    byteIdx += totalBytes

    for (let i = 0; i < sampleCount; i++) {
      x += deltas[i * 3 + 0]
      y += deltas[i * 3 + 1]
      z += deltas[i * 3 + 2]
      samples.push({ x, y, z })
    }
  }
  return { samples, endTimestampNs }
}

/** Extract N signed integers of `bitSize` bits each, packed LE-within-byte. */
function unpackSignedDeltas(view: DataView, startByte: number, bitSize: number, count: number): number[] {
  const out: number[] = new Array(count)
  const signMask = 1 << (bitSize - 1)
  const valueMask = (1 << bitSize) - 1
  let bitPos = startByte * 8

  for (let i = 0; i < count; i++) {
    let value = 0
    let bitsRead = 0
    while (bitsRead < bitSize) {
      const byte = view.getUint8(Math.floor(bitPos / 8))
      const bitOffset = bitPos % 8
      const bitsAvailable = 8 - bitOffset
      const bitsToRead = Math.min(bitsAvailable, bitSize - bitsRead)
      const chunk = (byte >> bitOffset) & ((1 << bitsToRead) - 1)
      value |= chunk << bitsRead
      bitsRead += bitsToRead
      bitPos += bitsToRead
    }
    value &= valueMask
    if (value & signMask) value -= 1 << bitSize  // sign-extend
    out[i] = value
  }
  return out
}

const PMD_ERROR_LABELS: Record<number, string> = {
  0x00: 'SUCCESS',
  0x01: 'INVALID_OP_CODE',
  0x02: 'INVALID_MEASUREMENT_TYPE',
  0x03: 'NOT_SUPPORTED',
  0x04: 'INVALID_LENGTH',
  0x05: 'INVALID_PARAMETER',
  0x06: 'INVALID_STATE',
  0x07: 'DEVICE_IN_CHARGER',
}

const PMD_SETTING_LABELS: Record<number, string> = {
  0x00: 'SAMPLE_RATE',
  0x01: 'RESOLUTION',
  0x02: 'RANGE',
  0x03: 'RANGE_MILLI_UNIT',
  0x04: 'CHANNELS',
  0x05: 'FACTOR',
}

/**
 * Decode the TLV settings list that follows a GET_MEASUREMENT_SETTINGS
 * response. Each entry: [setting_id, count, (value uint16 LE) × count].
 */
function decodeSupportedSettings(view: DataView, offset: number): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  let i = offset
  while (i + 2 <= view.byteLength) {
    const id = view.getUint8(i++)
    const count = view.getUint8(i++)
    if (i + count * 2 > view.byteLength) break
    const values: number[] = []
    for (let k = 0; k < count; k++) {
      values.push(view.getUint16(i, /* LE */ true))
      i += 2
    }
    out[PMD_SETTING_LABELS[id] ?? `setting_${id}`] = values
  }
  return out
}

/** Log PMD control-point responses with decoded error labels + settings. */
function logPmdControlResponse(event: Event): void {
  const view = (event.target as BluetoothRemoteGATTCharacteristic | null)?.value
  if (!view) return
  const hex = toHex(view)
  if (view.byteLength >= 4 && view.getUint8(0) === 0xf0) {
    const op = view.getUint8(1)
    const type = view.getUint8(2)
    const err = view.getUint8(3)
    const label = PMD_ERROR_LABELS[err] ?? `unknown(${err})`
    if (op === 0x01 && err === 0x00 && view.byteLength > 5) {
      // GET_MEASUREMENT_SETTINGS response: body starts at byte 5 (after a
      // MORE_FRAME flag at byte 4 — single-frame responses set it to 0).
      const supported = decodeSupportedSettings(view, 5)
      console.log(`[Polar PMD] supported settings (op=${op} type=${type}):`, supported, '| raw:', hex)
    } else {
      console.log(`[Polar PMD] control response: op=${op} type=${type} err=${err} ${label} | raw: ${hex}`)
    }
  } else {
    console.log('[Polar PMD] control response:', hex)
  }
}

/**
 * Build the PMD START_MEASUREMENT command for the accelerometer.
 *
 *   [op=0x02, type=0x02 ACC,
 *    0x00 SAMPLE_RATE  | count=1 | uint16 LE Hz,
 *    0x01 RESOLUTION   | count=1 | uint16 LE bits,
 *    0x02 RANGE        | count=1 | uint16 LE G]
 *
 * No CHANNELS setting — the H10 doesn't expose it in its supported-settings
 * response, and including it triggers PMD error 5 (INVALID_PARAMETER).
 * (Other Polar sensors like Verity Sense's PPG do accept CHANNELS.)
 */
function buildAccStartCommand({ sampleRate, resolution, rangeG }: {
  sampleRate: number
  resolution: number
  rangeG: number
}): Uint8Array {
  const cmd = new Uint8Array(14)
  let i = 0
  cmd[i++] = 0x02  // START
  cmd[i++] = 0x02  // ACC
  cmd[i++] = 0x00; cmd[i++] = 0x01; cmd[i++] = sampleRate & 0xff; cmd[i++] = (sampleRate >> 8) & 0xff
  cmd[i++] = 0x01; cmd[i++] = 0x01; cmd[i++] = resolution & 0xff; cmd[i++] = (resolution >> 8) & 0xff
  cmd[i++] = 0x02; cmd[i++] = 0x01; cmd[i++] = rangeG & 0xff;     cmd[i++] = (rangeG >> 8) & 0xff
  return cmd
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

// Polar Measurement Data — proprietary, documented in Polar's open BLE SDK.
// Exposes accelerometer (and ECG/PPG/PPI) streams beyond the standard HR
// service. We use it here for chest-motion-derived respiration.
const PMD_SERVICE: BluetoothServiceUUID = 'fb005c80-02e7-f387-1cad-8acd2d8df0c8'
const PMD_CONTROL_POINT: BluetoothServiceUUID = 'fb005c81-02e7-f387-1cad-8acd2d8df0c8'
const PMD_DATA_MTU: BluetoothServiceUUID = 'fb005c82-02e7-f387-1cad-8acd2d8df0c8'

// ACC start settings (TLV) — 50 Hz, 16-bit, ±2 G, 3 channels. 2G is the
// universally-supported range across H10 firmware; some revisions reject
// 4/8 G with PMD error 5 (INVALID_PARAMETER). 2G is plenty of headroom for
// chest motion during breathing (typical amplitude is <50 mG).
const PMD_ACC_SAMPLE_RATE_HZ = 50
const PMD_ACC_RESOLUTION_BITS = 16
const PMD_ACC_RANGE_G = 2

// Breathing-signal windowing. 30s of accel magnitudes (at 50 Hz = 1500
// samples) gives the bandpass enough history to see 2-3 full breath cycles.
const ACC_WINDOW_SECONDS = 30
const ACC_WINDOW_SAMPLES = PMD_ACC_SAMPLE_RATE_HZ * ACC_WINDOW_SECONDS
// Re-run the bandpass every 5 accel samples (= 100 ms at 50 Hz). Caps the
// animation lag at one filter stride.
const ACC_FILTER_STRIDE = 5
// Envelope normalization horizon — running min/max over ~15s adapts to
// breathing depth without smearing across long-term posture changes.
const ENVELOPE_HORIZON_SAMPLES = PMD_ACC_SAMPLE_RATE_HZ * 15

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

  private pmdControl: BluetoothRemoteGATTCharacteristic | null = null
  private pmdData: BluetoothRemoteGATTCharacteristic | null = null
  private pmdAvailable = false

  // Streaming breathing extractor state.
  private accMagBuffer: number[] = []
  private samplesSinceFilter = 0
  private filteredLatest = 0
  private filteredPrevious = 0
  private envelopeMin = 0
  private envelopeMax = 0
  private breathingScale = 0.5  // normalized 0..1; 0=trough, 1=peak
  private latestRespiratoryRate: number | null = null  // BPM
  // Rising zero-crossings: same-direction → consecutive breath onsets, so
  // the inter-crossing interval is one full breath period.
  private crossingTimestampsMs: number[] = []

  private boundNotification = (e: Event): void => this.handleNotification(e)
  private boundDisconnect = (): void => { void this.handleUnexpectedDisconnect() }
  private boundPmdData = (e: Event): void => this.handlePmdData(e)
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
        // Declare PMD so the user's consent covers chest-motion accelerometer
        // streaming. Web Bluetooth scopes permission per-service at pair time.
        optionalServices: [PMD_SERVICE],
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
      // Clear any prior tick before re-arming: a reconnect re-enters this path
      // without a teardown (teardown only runs on intentional disconnect), so
      // without this each auto-reconnect stacked another setInterval.
      if (this.tickHandle != null) clearInterval(this.tickHandle)
      this.tickHandle = setInterval(() => this.tick(Date.now()), TICK_INTERVAL_MS)
      this.setStatus('streaming')
      // Fire-and-forget: PMD streaming is best-effort. HR/RR still works
      // even if the H10's PMD service isn't available (older firmware,
      // missing permission scope, busy with another app, etc.).
      void this.openPmdAcc()
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

  /**
   * Open Polar's proprietary PMD service and start the accelerometer stream.
   * Best-effort: failures (older firmware, busy device, missing permission)
   * leave the HR stream intact. Trial mode — incoming frames are console-
   * logged for parsing-development iteration.
   */
  private async openPmdAcc(): Promise<void> {
    if (!this.device?.gatt?.connected) return
    try {
      const service = await this.device.gatt.getPrimaryService(PMD_SERVICE)
      const control = await service.getCharacteristic(PMD_CONTROL_POINT)
      const data = await service.getCharacteristic(PMD_DATA_MTU)

      // Subscribe to control-point responses first so we see error codes
      // from the START command. Polar replies with a status frame on this
      // characteristic after every command.
      control.addEventListener('characteristicvaluechanged', logPmdControlResponse)
      await control.startNotifications()

      data.addEventListener('characteristicvaluechanged', this.boundPmdData)
      await data.startNotifications()

      // Authoritative: ask the device what ACC settings it accepts. Response
      // arrives async on the control-point notification listener; we kick
      // this off before START so the supported-set log appears first.
      const querySettings = new Uint8Array([0x01, 0x02])  // GET_MEASUREMENT_SETTINGS, ACC
      console.log('[Polar PMD] querying supported ACC settings:', toHex(querySettings))
      await control.writeValueWithResponse(querySettings)

      const startCmd = buildAccStartCommand({
        sampleRate: PMD_ACC_SAMPLE_RATE_HZ,
        resolution: PMD_ACC_RESOLUTION_BITS,
        rangeG: PMD_ACC_RANGE_G,
      })
      console.log('[Polar PMD] writing ACC start command:', toHex(startCmd))
      await control.writeValueWithResponse(startCmd)

      this.pmdControl = control
      this.pmdData = data
      this.pmdAvailable = true
      console.log('[Polar PMD] ACC streaming requested @ 50 Hz')
    } catch (err) {
      console.warn('[Polar PMD] setup failed; continuing with HR-only stream:', err)
      this.pmdAvailable = false
    }
  }

  private handlePmdData(event: Event): void {
    const target = event.target as BluetoothRemoteGATTCharacteristic | null
    const view = target?.value
    if (!view) return
    pmdLogCount++
    if (pmdLogCount <= 3) {
      console.log(`[Polar PMD] data frame #${pmdLogCount} (${view.byteLength} bytes):`, toHex(view))
    }
    const parsed = parsePmdAccFrame(view)
    if (!parsed) return
    for (const sample of parsed.samples) this.ingestAccSample(sample)
  }

  /**
   * Ingest one accel sample into the breathing extractor: compute magnitude,
   * push into the sliding window, re-run the bandpass every ACC_FILTER_STRIDE
   * samples (~100 ms), and update the live `breathingScale` envelope.
   */
  private ingestAccSample(s: AccSample): void {
    const mag = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z)
    this.accMagBuffer.push(mag)
    if (this.accMagBuffer.length > ACC_WINDOW_SAMPLES) this.accMagBuffer.shift()

    this.samplesSinceFilter++
    if (this.samplesSinceFilter < ACC_FILTER_STRIDE) return
    this.samplesSinceFilter = 0

    // Need at least ~5s of data for the 0.1 Hz highpass to settle.
    if (this.accMagBuffer.length < PMD_ACC_SAMPLE_RATE_HZ * 5) return

    const filtered = respiratoryBandpass(this.accMagBuffer, PMD_ACC_SAMPLE_RATE_HZ)
    this.filteredPrevious = this.filteredLatest
    this.filteredLatest = filtered[filtered.length - 1]

    // Adaptive normalization: running min/max over the last
    // ENVELOPE_HORIZON_SAMPLES of the filtered signal.
    const horizon = filtered.slice(-ENVELOPE_HORIZON_SAMPLES)
    let lo = horizon[0]
    let hi = horizon[0]
    for (let i = 1; i < horizon.length; i++) {
      const v = horizon[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    this.envelopeMin = lo
    this.envelopeMax = hi
    const range = Math.max(hi - lo, 1e-6)
    this.breathingScale = clamp01((this.filteredLatest - lo) / range)

    // Rising zero-crossing → one breath onset. Use a small hysteresis
    // (10% of envelope range) so noise around zero doesn't double-trigger.
    const hysteresis = range * 0.1
    if (
      this.filteredPrevious < -hysteresis &&
      this.filteredLatest >= 0
    ) {
      const nowMs = Date.now()
      this.crossingTimestampsMs.push(nowMs)
      // Keep last ~60s of crossings.
      const cutoff = nowMs - 60_000
      while (this.crossingTimestampsMs.length > 0 && this.crossingTimestampsMs[0] < cutoff) {
        this.crossingTimestampsMs.shift()
      }
      this.recomputeRespiratoryRate()
    }
  }

  private recomputeRespiratoryRate(): void {
    const ts = this.crossingTimestampsMs
    if (ts.length < 2) return
    // Median of recent inter-crossing intervals → robust to a missed beat
    // or a sigh. 6 intervals = ~30s of breath history.
    const intervals: number[] = []
    for (let i = 1; i < ts.length; i++) intervals.push(ts[i] - ts[i - 1])
    const recent = intervals.slice(-6).sort((a, b) => a - b)
    const median = recent[Math.floor(recent.length / 2)]
    if (median <= 0) return
    const bpm = 60_000 / median
    if (bpm < 4 || bpm > 40) return  // physiologically implausible
    this.latestRespiratoryRate = Math.round(bpm * 10) / 10
  }

  /** Live 0..1 breathing position, suitable for polling at rAF cadence. */
  getBreathingScale(): number {
    return this.breathingScale
  }

  /** Latest respiratory rate in breaths per minute, or null when unknown. */
  getRespiratoryRate(): number | null {
    return this.latestRespiratoryRate
  }

  /** Whether the PMD accelerometer stream is up. */
  isPmdActive(): boolean {
    return this.pmdAvailable
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
    // Splice in the live RR derived from chest-motion accel. Stays null
    // when PMD isn't streaming, so consumers can distinguish "no signal"
    // from "0 BPM".
    measurement.respiratoryRate = this.latestRespiratoryRate

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

    if (this.pmdData) {
      this.pmdData.removeEventListener('characteristicvaluechanged', this.boundPmdData)
      void this.pmdData.stopNotifications().catch(() => {})
      this.pmdData = null
    }
    if (this.pmdControl) {
      this.pmdControl.removeEventListener('characteristicvaluechanged', logPmdControlResponse)
      void this.pmdControl.stopNotifications().catch(() => {})
      this.pmdControl = null
    }
    this.pmdAvailable = false
    pmdLogCount = 0

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


