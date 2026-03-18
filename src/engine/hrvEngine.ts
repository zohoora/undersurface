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
            autonomicState: classifyAutonomicState(metrics.hr, metrics.rmssd),
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
