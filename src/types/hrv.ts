export type AutonomicState = 'calm' | 'activated' | 'transitioning'
export type HrvTrend = 'rising' | 'falling' | 'steady'

export interface HrvMeasurement {
  timestamp: number
  hr: number
  rmssd: number
  autonomicState: AutonomicState
  trend: HrvTrend
  confidence: number
  respiratoryRate: number | null
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
