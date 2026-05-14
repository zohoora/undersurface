import type { HrvMeasurement, HrvError, HrvSignalDump } from '../types/hrv'
import { engineLog } from '../services/diagnostics'
import type { WorkerEngineLogMessage } from '../services/diagnostics'

// Module-level HR accessor for cross-component use (like isGroundingActive)
let currentHeartRate: number | null = null
export function getCurrentHeartRate(): number | null {
  return currentHeartRate
}

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

  private signalDumps: HrvSignalDump[] = []
  private currentSessionId: string | null = null

  setSessionId(id: string | null): void {
    this.currentSessionId = id
  }

  private measurementCallbacks: MeasurementCallback[] = []
  private calibrationCallbacks: CalibrationCallback[] = []
  private errorCallbacks: ErrorCallback[] = []

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError') {
        throw { type: 'camera_denied' } as HrvError
      }
      throw { type: 'camera_unavailable' } as HrvError
    }

    // Lock camera auto-exposure and white balance to prevent slow color drift
    // that overpowers the rPPG signal (research shows this is critical)
    const track = this.stream.getVideoTracks()[0]
    try {
      const capabilities = track.getCapabilities() as Record<string, unknown>
      const constraints: Record<string, unknown> = {}

      if ('exposureMode' in capabilities) {
        constraints.exposureMode = 'manual'
      }
      if ('whiteBalanceMode' in capabilities) {
        constraints.whiteBalanceMode = 'manual'
      }

      if (Object.keys(constraints).length > 0) {
        await track.applyConstraints({ advanced: [constraints] } as MediaTrackConstraints)
      }
    } catch (err) {
      console.warn('[HRV Engine] Could not lock camera exposure:', err)
    }

    // Monitor for stream ending unexpectedly
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

    const vw = this.video.videoWidth
    const vh = this.video.videoHeight

    // Canvas matches video dimensions for full-res pixel access
    this.canvas = new OffscreenCanvas(vw, vh)
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!

    // Start worker
    try {
      this.worker = new Worker(
        new URL('./hrvSignalWorker.ts', import.meta.url),
        { type: 'module' },
      )

      this.worker.onmessage = (e: MessageEvent) => {
        const { type, data, signalDump } = e.data
        if (type === 'engine-log') {
          const { severity, code, msg, extra } = (e.data as WorkerEngineLogMessage).payload
          engineLog(severity, code, msg, {
            sessionId: this.currentSessionId ?? undefined,
            extra,
          })
          return
        }
        if (type === 'measurement' && data) {
          const m = data as HrvMeasurement
          this.latest = m
          currentHeartRate = m.hr
          this.measurementCallbacks.forEach(cb => cb(this.latest!))
          // Capture signal dump for offline analysis
          if (signalDump) {
            this.signalDumps.push(signalDump as HrvSignalDump)
            // Keep last 60 dumps (~5 minutes at 5s interval)
            if (this.signalDumps.length > 60) this.signalDumps.shift()
          }
        }
        if (type === 'calibration_complete') {
          this.calibrating = false
          this.calibrationCallbacks.forEach(cb => cb(data?.baseline ?? 50))
        }
        if (type === 'calibration_progress') {
          // calibration progress handled silently
        }
      }

      this.worker.onerror = (err) => {
        console.error('[HRV Engine] Worker error:', err)
        this.errorCallbacks.forEach(cb => cb({ type: 'worker_error', message: err.message }))
      }

    } catch (err) {
      console.warn('[HRV Engine] Failed to create worker, running on main thread:', err)
    }

    this.captureFrames()

    // Request computation every 5 seconds
    this.computeInterval = setInterval(() => {
      if (document.hidden) return // don't compute on stale data when tab is backgrounded

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
            autonomicState: classifyAutonomicState(metrics.rmssd, this.baseline ?? 50),
            trend: 'steady',
            confidence: Math.round(confidence * 100) / 100,
            respiratoryRate: null,
            derived: null,
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
    currentHeartRate = null
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

  getVideoSize(): { width: number; height: number } | null {
    if (!this.video) return null
    return { width: this.video.videoWidth, height: this.video.videoHeight }
  }

  getSignalDumps(): HrvSignalDump[] {
    return this.signalDumps
  }

  private captureFrames(): void {
    if (!this.video || !this.ctx || !this.canvas) return

    // Skip capture when tab is hidden
    if (document.hidden) {
      this.animFrameId = requestAnimationFrame(() => this.captureFrames())
      return
    }

    const vw = this.canvas.width
    const vh = this.canvas.height

    this.ctx.drawImage(this.video, 0, 0, vw, vh)

    // Single getImageData covering face (top) + chest (bottom). Combined to
    // halve per-frame canvas→JS readbacks (the dominant per-frame cost).
    // Layout (combined-local y):
    //   y in [0, faceRoiH)        — face ROI; skin-pixel sub-regions iterate here
    //   y in [chestY0, roiH)      — chest ROI; linear subsampled sweep over bytes
    const x0 = Math.floor(vw * 0.2)
    const x1 = Math.floor(vw * 0.8)
    const y0 = Math.floor(vh * 0.2)
    const yEnd = Math.floor(vh * 0.95)
    const roiW = x1 - x0
    const roiH = yEnd - y0
    const faceRoiH = Math.floor(vh * 0.6)
    const chestY0 = Math.floor(vh * 0.5) // = vh*0.7 - vh*0.2, in combined-local y
    if (roiW <= 0 || roiH <= 0 || faceRoiH <= 0 || chestY0 >= roiH) {
      this.animFrameId = requestAnimationFrame(() => this.captureFrames())
      return
    }

    const imageData = this.ctx.getImageData(x0, y0, roiW, roiH)
    const pixels = imageData.data

    // Face sub-regions, skin-color filtered.
    // Forehead: top 30%, middle 80% horizontally
    // Cheeks: middle 40% vertically, outer thirds horizontally
    // ry/rh are fractions of faceRoiH (the face portion of the combined ROI).
    const regions = [
      { name: 'forehead', ry: 0, rh: 0.3, rx: 0.1, rw: 0.8 },
      { name: 'leftCheek', ry: 0.3, rh: 0.4, rx: 0, rw: 0.33 },
      { name: 'rightCheek', ry: 0.3, rh: 0.4, rx: 0.67, rw: 0.33 },
    ]

    const rgbRegions: Array<{ region: string; r: number; g: number; b: number; pixels: number }> = []

    // Global skin-pixel Y centroid across face sub-regions — feeds the
    // face-landmark respiratory signal (subtle head bob with breath).
    let globalSumY = 0
    let globalSkinCount = 0

    for (const reg of regions) {
      const sx = Math.floor(roiW * reg.rx)
      const sy = Math.floor(faceRoiH * reg.ry)
      const sw = Math.floor(roiW * reg.rw)
      const sh = Math.floor(faceRoiH * reg.rh)
      if (sw <= 0 || sh <= 0) continue

      let sumR = 0, sumG = 0, sumB = 0, count = 0, sumY = 0
      for (let py = sy; py < sy + sh && py < faceRoiH; py++) {
        for (let px = sx; px < sx + sw && px < roiW; px++) {
          const idx = (py * roiW + px) * 4
          const r = pixels[idx]
          const g = pixels[idx + 1]
          const b = pixels[idx + 2]
          // Skin color filter: R>G>B, sufficient warmth, not too bright
          if (r >= 60 && g >= 40 && b >= 20 && r > g && g > b && r - g >= 15 && r - b >= 20 && !(r > 240 && g > 240 && b > 240)) {
            sumR += r
            sumG += g
            sumB += b
            sumY += py
            count++
          }
        }
      }

      if (count > 10) { // need at least some skin pixels
        rgbRegions.push({
          region: reg.name,
          r: sumR / count,
          g: sumG / count,
          b: sumB / count,
          pixels: count,
        })
        globalSumY += sumY
        globalSkinCount += count
      }
    }

    const faceCentroidY = globalSkinCount > 0 ? globalSumY / globalSkinCount : null

    // Chest portion of the combined buffer. Direct mechanical breathing
    // motion when the chest is in frame; worker variance-gates this to zero
    // weight when framing or posture puts it out of view.
    let chestIntensity: number | null = null
    let chestSum = 0
    let chestSampled = 0
    const chestStartByte = chestY0 * roiW * 4
    const chestEndByte = roiH * roiW * 4
    // Step 16 = every 4th pixel (RGBA stride 4 × subsample 4).
    for (let i = chestStartByte; i < chestEndByte; i += 16) {
      chestSum += pixels[i + 1] // green channel
      chestSampled++
    }
    if (chestSampled > 0) chestIntensity = chestSum / chestSampled

    if (this.worker && rgbRegions.length > 0) {
      this.worker.postMessage({
        type: 'rgb_multi',
        data: { regions: rgbRegions, faceCentroidY, chestIntensity },
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
