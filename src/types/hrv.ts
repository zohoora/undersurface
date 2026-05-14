export type AutonomicState = 'calm' | 'activated' | 'transitioning'
export type HrvTrend = 'rising' | 'falling' | 'steady'

export interface HrvDerivedMetrics {
  sdnn: number             // overall HRV — std deviation of IBIs (ms)
  pnn50: number            // parasympathetic index — % of successive IBIs differing >50ms
  lfHfRatio: number | null // sympathetic/parasympathetic balance (LF 0.04-0.15 Hz / HF 0.15-0.4 Hz)
  stressIndex: number      // Baevsky stress index — higher = more stress
  coherence: number        // cardiac coherence 0-1 — how regular/sinusoidal HRV is
}

/** A single RR estimate paired with its FFT-peak confidence. */
export interface RespiratoryEstimate {
  rr: number
  confidence: number
}

/**
 * State of the facial-landmark tracker that feeds the motion RR channel.
 * Distinct from "channel quality" — this is *why* the motion channel may
 * be dark, so the user can act on it:
 *   loading   — face detector is still initializing (first 1–3 seconds)
 *   detecting — landmarks streaming, motion channel active
 *   no_face   — detector loaded but can't see a face (lighting/framing)
 *   failed    — detector failed to load (CDN/CSP/network); won't recover
 */
export type LandmarkerState = 'loading' | 'detecting' | 'no_face' | 'failed'

/**
 * Per-source breakdown of every respiratory-rate estimate that feeds the
 * fused output. Five candidate sources spanning rPPG-derived modulations
 * (pulse-low-freq, per-beat amplitude RIAV, per-beat baseline RIIV) and
 * mechanical-motion derived signals (face landmark tracking, chest ROI).
 *
 * Each source is null when its buffer is too short, the bandpass cannot
 * find a plausible peak, or its enable-gate (e.g. chestPresent, landmark
 * availability) blocks contribution.
 *
 * Lazaro et al. (PMC6058306) showed that RIAV/RIIV pick up respiration
 * when the pulse-modulation (RSA-like) channel is buried in noise, and
 * vice versa — fusion is what makes it robust.
 */
export interface HrvRespiratoryDiagnostics {
  /** Low-frequency modulation of CHROM pulse signal (formerly "rsa"). */
  pulse: RespiratoryEstimate | null
  /** Per-beat pulse amplitude series (RIAV). */
  riav: RespiratoryEstimate | null
  /** Per-beat baseline / DC envelope series (RIIV). */
  riiv: RespiratoryEstimate | null
  /** Sparse facial-landmark median Y motion (philtrum, nose, chin, nostrils). */
  face: RespiratoryEstimate | null
  /** Chest ROI intensity, adaptive ROI gated by chestPresent. */
  chest: RespiratoryEstimate | null
  chestPresent: boolean
  /** User-facing state of the face landmarker (why motion may be dark). */
  landmarkerState: LandmarkerState
  fused: RespiratoryEstimate | null
}

export interface HrvMeasurement {
  timestamp: number
  hr: number
  rmssd: number
  autonomicState: AutonomicState
  trend: HrvTrend
  confidence: number
  respiratoryRate: number | null
  /** Per-source RR breakdown for debug; null until first compute tick fires. */
  respiratoryDiagnostics?: HrvRespiratoryDiagnostics | null
  derived: HrvDerivedMetrics | null
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

/** Raw signal snapshot from the worker for offline algorithm analysis */
export interface HrvSignalDump {
  timestamp: number
  fps: number
  rBuffer: number[]
  gBuffer: number[]
  bBuffer: number[]
  chromPulse: number[]
  filteredPulse: number[]
  fftPowerSpectrum: { freqHz: number; power: number }[]
  fftPeakHz: number | null
  fftPeakBpm: number | null
  peaks: number[]
  ibis: number[]
  /** Per-channel respiratory estimates from the latest compute tick. */
  respiratory?: HrvRespiratoryDiagnostics | null
}

export interface HrvSessionData {
  id: string
  startedAt: number
  endedAt: number
  calibrationBaseline: number
  measurements: HrvMeasurement[]
  shifts: HrvShift[]
  signalDumps: HrvSignalDump[]
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
