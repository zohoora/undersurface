import type { HrvMeasurement, HrvError, HrvSignalDump } from '../types/hrv'

// Module-level HR accessor for cross-component use (like isGroundingActive)
let currentHeartRate: number | null = null
export function getCurrentHeartRate(): number | null {
  return currentHeartRate
}

type MeasurementCallback = (m: HrvMeasurement) => void
type CalibrationCallback = (baseline: number) => void
type ErrorCallback = (error: HrvError) => void

// Face bounding box for ROI targeting
interface FaceROI {
  x: number
  y: number
  width: number
  height: number
}

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

  // Face detection
  private faceDetector: unknown = null
  private faceROI: FaceROI | null = null
  private faceDetectInterval: ReturnType<typeof setInterval> | null = null
  private lastFaceLog = 0
  private frameSkipToggle = false
  private signalDumps: HrvSignalDump[] = []


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

    // Face detection disabled — skin color filtering handles ROI selection
    // await this.initFaceDetector()

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
    this.faceROI = null
    if (this.faceDetectInterval) {
      clearInterval(this.faceDetectInterval)
      this.faceDetectInterval = null
    }
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

  getFaceROI(): FaceROI | null {
    return this.faceROI
  }

  hasFaceDetection(): boolean {
    return this.faceDetector !== null
  }

  getVideoSize(): { width: number; height: number } | null {
    if (!this.video) return null
    return { width: this.video.videoWidth, height: this.video.videoHeight }
  }


  getSignalDumps(): HrvSignalDump[] {
    return this.signalDumps
  }

  private async initFaceDetector(): Promise<void> {
    // FaceDetector is part of Chrome's Shape Detection API
    // Available in Chrome 94+ on macOS/Windows/ChromeOS (uses platform vision APIs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FaceDetectorClass = (window as any).FaceDetector

    if (!FaceDetectorClass) {
      console.warn(
        '[HRV Engine] FaceDetector API not available.',
        'Using skin-color filter as fallback.',
        'To enable face detection: chrome://flags/#enable-experimental-web-platform-features',
      )
      return
    }

    try {
      this.faceDetector = new FaceDetectorClass()

      // Run face detection periodically (every 200ms for responsive tracking)
      this.faceDetectInterval = setInterval(() => this.detectFace(), 200)
      // Run once immediately
      await this.detectFace()
    } catch (err) {
      console.warn('[HRV Engine] FaceDetector failed to initialize:', err)
      this.faceDetector = null
    }
  }

  private async detectFace(): Promise<void> {
    if (!this.faceDetector || !this.video) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detector = this.faceDetector as any
      const faces = await detector.detect(this.video) as Array<{ boundingBox: DOMRectReadOnly }>

      if (faces.length > 0) {
        const face = faces[0].boundingBox
        // Face detection runs on the video element at native resolution
        // but we store ROI in 320x240 coordinate space for consistency
        const videoW = this.video.videoWidth || 320
        const videoH = this.video.videoHeight || 240
        const scaleX = 320 / videoW
        const scaleY = 240 / videoH

        // Use the full face bounding box with small margin
        // (more skin pixels = better signal averaging)
        const faceX = face.x * scaleX
        const faceY = face.y * scaleY
        const faceW = face.width * scaleX
        const faceH = face.height * scaleY

        const targetROI = {
          x: faceX + faceW * 0.1,
          y: faceY + faceH * 0.05,
          width: faceW * 0.8,
          height: faceH * 0.85,
        }

        // Smooth the ROI position with exponential moving average
        // Balances responsive tracking with signal stability
        const alpha = 0.35
        if (this.faceROI) {
          this.faceROI = {
            x: Math.round(this.faceROI.x + alpha * (targetROI.x - this.faceROI.x)),
            y: Math.round(this.faceROI.y + alpha * (targetROI.y - this.faceROI.y)),
            width: Math.round(this.faceROI.width + alpha * (targetROI.width - this.faceROI.width)),
            height: Math.round(this.faceROI.height + alpha * (targetROI.height - this.faceROI.height)),
          }
        } else {
          // First detection — snap to position
          this.faceROI = {
            x: Math.round(targetROI.x),
            y: Math.round(targetROI.y),
            width: Math.round(targetROI.width),
            height: Math.round(targetROI.height),
          }
        }

        const now = Date.now()
        if (now - this.lastFaceLog > 5000) {
          this.lastFaceLog = now
        }
      } else {
        // No face — clear ROI so worker falls back to center
        if (this.faceROI) {
          this.faceROI = null
        }
      }
    } catch (err) {
      // Silently ignore — face detection is best-effort
      console.warn('[HRV Engine] Face detection error:', err)
    }
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

    // Extract RGB averages from skin pixels on the main thread
    // Only read the face ROI region (not the full frame) for performance
    const roi = this.faceROI
    let x0: number, y0: number, x1: number, y1: number

    if (roi && roi.width > 0 && roi.height > 0) {
      // Scale face ROI from 320x240 detection space to actual resolution
      const scaleX = vw / 320
      const scaleY = vh / 240
      x0 = Math.max(0, Math.floor(roi.x * scaleX))
      y0 = Math.max(0, Math.floor(roi.y * scaleY))
      x1 = Math.min(vw, Math.floor((roi.x + roi.width) * scaleX))
      y1 = Math.min(vh, Math.floor((roi.y + roi.height) * scaleY))
    } else {
      // Fallback: center 60%
      const margin = 0.2
      x0 = Math.floor(vw * margin)
      y0 = Math.floor(vh * margin)
      x1 = Math.floor(vw * (1 - margin))
      y1 = Math.floor(vh * (1 - margin))
    }

    const roiW = x1 - x0
    const roiH = y1 - y0
    if (roiW <= 0 || roiH <= 0) {
      this.animFrameId = requestAnimationFrame(() => this.captureFrames())
      return
    }

    // Read the full face ROI once
    const imageData = this.ctx.getImageData(x0, y0, roiW, roiH)
    const pixels = imageData.data

    // Split face into 3 sub-regions, skin-color filtered
    // Forehead: top 30%, middle 80% horizontally
    // Cheeks: middle 40% vertically, outer thirds horizontally
    const regions = [
      { name: 'forehead', ry: 0, rh: 0.3, rx: 0.1, rw: 0.8 },
      { name: 'leftCheek', ry: 0.3, rh: 0.4, rx: 0, rw: 0.33 },
      { name: 'rightCheek', ry: 0.3, rh: 0.4, rx: 0.67, rw: 0.33 },
    ]

    const rgbRegions: Array<{ region: string; r: number; g: number; b: number; pixels: number }> = []

    for (const reg of regions) {
      const sx = Math.floor(roiW * reg.rx)
      const sy = Math.floor(roiH * reg.ry)
      const sw = Math.floor(roiW * reg.rw)
      const sh = Math.floor(roiH * reg.rh)
      if (sw <= 0 || sh <= 0) continue

      let sumR = 0, sumG = 0, sumB = 0, count = 0
      for (let py = sy; py < sy + sh && py < roiH; py++) {
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
      }
    }

    if (this.worker && rgbRegions.length > 0) {
      this.worker.postMessage({
        type: 'rgb_multi',
        data: { regions: rgbRegions },
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
