import type { HrvMeasurement, HrvError, HrvSignalDump, LandmarkerState } from '../types/hrv'
import { engineLog } from '../services/diagnostics'
import type { WorkerEngineLogMessage } from '../services/diagnostics'
import type { FaceLandmarker as FaceLandmarkerType } from '@mediapipe/tasks-vision'

// Module-level HR accessor for cross-component use (like isGroundingActive)
let currentHeartRate: number | null = null
export function getCurrentHeartRate(): number | null {
  return currentHeartRate
}

type MeasurementCallback = (m: HrvMeasurement) => void
type CalibrationCallback = (baseline: number) => void
type ErrorCallback = (error: HrvError) => void

/**
 * MediaPipe FaceMesh landmark IDs whose Y coordinates we average per
 * frame for the respiratory motion signal. Chosen because they sit
 * near the lower-mid face where breath-driven motion is most visible
 * and head pose has the least leverage:
 *   1   — nose tip
 *   164 — philtrum (centre, under nose)
 *   0   — upper lip vermillion border
 *   17  — lower lip
 *   152 — chin (mental protuberance)
 * Tracking multiple points and taking the median makes the signal
 * robust to single-landmark jitter that plagued the old "Y centroid
 * of all skin pixels" approach.
 */
const BREATH_LANDMARK_IDS = [1, 164, 0, 17, 152]
const CHIN_LANDMARK_ID = 152

// Adaptive chest ROI. The chest channel only contributes when the chin
// landmark sits in the upper part of the frame — otherwise the band we'd
// sample below it is desk/keyboard, not chest. The band itself starts
// just below the chin and runs down to ~30% of frame height to catch the
// upper chest where breath-driven reflection is largest.
const CHEST_CHIN_Y_MAX = 0.62
const CHEST_BAND_TOP_OFFSET = 0.06
const CHEST_BAND_BOTTOM_OFFSET = 0.30

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
  private faceLandmarker: FaceLandmarkerType | null = null
  private landmarkerInitStarted = false
  private landmarkerInitFailed = false

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

    // Kick off MediaPipe FaceLandmarker init in parallel. Don't await it —
    // capture can run without landmarks (motion channel is gated downstream
    // by recentValidRatio when landmark data is sparse).
    this.initFaceLandmarker()

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

    if (this.faceLandmarker) {
      try { this.faceLandmarker.close() } catch { /* noop */ }
      this.faceLandmarker = null
    }
    this.landmarkerInitStarted = false
    this.landmarkerInitFailed = false
  }

  /**
   * Lazily load MediaPipe FaceLandmarker. WASM is fetched from the
   * jsDelivr CDN to keep our bundle small; the model file is hosted on
   * Google's mediapipe-models bucket (already allowed by our CSP under
   * the *.googleapis.com wildcard). Init is fire-and-forget — capture
   * begins immediately and the motion channel comes online once init
   * resolves (typically 1–3 seconds, well before calibration ends).
   *
   * The `landmarkerInitStarted` guard doubles as a cancellation flag:
   * if `stop()` clears it while init is still awaiting, we close the
   * landmarker and drop the result rather than assigning to a stopped
   * engine (which would leak the instance across start/stop cycles).
   */
  private async initFaceLandmarker(): Promise<void> {
    if (this.landmarkerInitStarted) return
    this.landmarkerInitStarted = true
    try {
      const mp = await import('@mediapipe/tasks-vision')
      if (!this.landmarkerInitStarted) return
      const filesetResolver = await mp.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
      )
      if (!this.landmarkerInitStarted) return
      // Confidence thresholds are tuned low (0.3 vs library default 0.5)
      // because typical webcam sessions are indoor / off-axis / mixed
      // lighting — defaults reject too many marginally-lit faces.
      // GPU delegate falls back to CPU automatically when unavailable.
      const landmarker = await mp.FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })
      if (!this.landmarkerInitStarted) {
        try { landmarker.close() } catch { /* noop */ }
        return
      }
      this.faceLandmarker = landmarker
      console.info('[HRV Engine] FaceLandmarker ready (GPU delegate, conf=0.3)')
    } catch (err) {
      console.warn('[HRV Engine] FaceLandmarker init failed; motion channel disabled:', err)
      this.faceLandmarker = null
      this.landmarkerInitFailed = true
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

    // FaceLandmarker runs against the live video element. The model is
    // fed full-resolution frames at the rAF cadence; MediaPipe internally
    // throttles to its model rate (~30 Hz on most hardware) and returns
    // the latest result, so we can call every frame without backpressure.
    let landmarkMotionY: number | null = null
    let chinYAbs: number | null = null
    if (this.faceLandmarker) {
      try {
        const result = this.faceLandmarker.detectForVideo(this.video, performance.now())
        const lms = result.faceLandmarks[0]
        if (lms) {
          const yValues: number[] = []
          for (const id of BREATH_LANDMARK_IDS) {
            const p = lms[id]
            if (p && isFinite(p.y)) yValues.push(p.y * vh)
          }
          if (yValues.length > 0) {
            yValues.sort((a, b) => a - b)
            landmarkMotionY = yValues[Math.floor(yValues.length / 2)]
          }
          const chin = lms[CHIN_LANDMARK_ID]
          if (chin && isFinite(chin.y)) chinYAbs = chin.y * vh
        }
      } catch {
        // detectForVideo can throw on some frames during init; ignore single failures
      }
    }

    // Single getImageData covering face (top) + chest band. Even though
    // chest extraction is now adaptive, the bytes already in `pixels`
    // cover y ∈ [0.2*vh, 0.95*vh] so the chest sweep is free given the
    // face read.
    const x0 = Math.floor(vw * 0.2)
    const x1 = Math.floor(vw * 0.8)
    const y0 = Math.floor(vh * 0.2)
    const yEnd = Math.floor(vh * 0.95)
    const roiW = x1 - x0
    const roiH = yEnd - y0
    const faceRoiH = Math.floor(vh * 0.6)
    if (roiW <= 0 || roiH <= 0 || faceRoiH <= 0) {
      this.animFrameId = requestAnimationFrame(() => this.captureFrames())
      return
    }

    const imageData = this.ctx.getImageData(x0, y0, roiW, roiH)
    const pixels = imageData.data

    const regions = [
      { name: 'forehead', ry: 0, rh: 0.3, rx: 0.1, rw: 0.8 },
      { name: 'leftCheek', ry: 0.3, rh: 0.4, rx: 0, rw: 0.33 },
      { name: 'rightCheek', ry: 0.3, rh: 0.4, rx: 0.67, rw: 0.33 },
    ]

    const rgbRegions: Array<{ region: string; r: number; g: number; b: number; pixels: number }> = []

    // Non-skin pixel intensity sweep across the face ROI. Provides the
    // NLMS reference signal — non-skin pixels move with camera shake and
    // ambient lighting changes but not with the breath/heartbeat signals.
    let bgSum = 0
    let bgCount = 0

    for (const reg of regions) {
      const sx = Math.floor(roiW * reg.rx)
      const sy = Math.floor(faceRoiH * reg.ry)
      const sw = Math.floor(roiW * reg.rw)
      const sh = Math.floor(faceRoiH * reg.rh)
      if (sw <= 0 || sh <= 0) continue

      let sumR = 0, sumG = 0, sumB = 0, count = 0
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
            count++
          } else {
            // Background pixel — track grey-equivalent intensity for NLMS
            bgSum += (r + g + b) / 3
            bgCount++
          }
        }
      }

      if (count > 10) {
        rgbRegions.push({
          region: reg.name,
          r: sumR / count,
          g: sumG / count,
          b: sumB / count,
          pixels: count,
        })
      }
    }

    const backgroundIntensity = bgCount > 0 ? bgSum / bgCount : null

    // Adaptive chest ROI driven by the chin landmark. When the chin sits
    // too low in the frame the band below it is desk/keyboard, not chest,
    // so we don't sample.
    let chestIntensity: number | null = null
    if (chinYAbs !== null && chinYAbs < vh * CHEST_CHIN_Y_MAX) {
      const chestY0Local = Math.floor(chinYAbs + vh * CHEST_BAND_TOP_OFFSET) - y0
      const chestY1Local = Math.min(yEnd, Math.floor(chinYAbs + vh * CHEST_BAND_BOTTOM_OFFSET)) - y0
      if (chestY1Local > chestY0Local && chestY0Local >= 0 && chestY1Local <= roiH) {
        let chestSum = 0
        let chestSampled = 0
        const endByte = chestY1Local * roiW * 4
        for (let i = chestY0Local * roiW * 4; i < endByte; i += 16) {
          chestSum += pixels[i + 1] // green channel
          chestSampled++
        }
        if (chestSampled > 0) chestIntensity = chestSum / chestSampled
      }
    }

    const landmarkerState: LandmarkerState = this.landmarkerInitFailed
      ? 'failed'
      : this.faceLandmarker === null
        ? 'loading'
        : landmarkMotionY !== null
          ? 'detecting'
          : 'no_face'

    if (this.worker && rgbRegions.length > 0) {
      this.worker.postMessage({
        type: 'rgb_multi',
        data: {
          regions: rgbRegions,
          landmarkMotionY,
          chestIntensity,
          backgroundIntensity,
          landmarkerState,
        },
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
