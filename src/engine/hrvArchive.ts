import type { HrvSessionData, HrvSignalDump, HrvSource } from '../types/hrv'
import type { HrvTimeline } from './hrvTimeline'

export const MAX_ARCHIVED_MEASUREMENTS = 360
export const MAX_ARCHIVED_SHIFTS = 100
export const MAX_ARCHIVED_SIGNAL_DUMPS = 3
const MAX_SIGNAL_SAMPLES = 150
const MAX_SPECTRUM_BINS = 256

function trimSignalDump(dump: HrvSignalDump): HrvSignalDump {
  return {
    ...dump,
    rBuffer: dump.rBuffer.slice(-MAX_SIGNAL_SAMPLES),
    gBuffer: dump.gBuffer.slice(-MAX_SIGNAL_SAMPLES),
    bBuffer: dump.bBuffer.slice(-MAX_SIGNAL_SAMPLES),
    chromPulse: dump.chromPulse.slice(-MAX_SIGNAL_SAMPLES),
    filteredPulse: dump.filteredPulse.slice(-MAX_SIGNAL_SAMPLES),
    fftPowerSpectrum: dump.fftPowerSpectrum.slice(-MAX_SPECTRUM_BINS),
    peaks: dump.peaks.slice(-MAX_SIGNAL_SAMPLES),
    ibis: dump.ibis.slice(-MAX_SIGNAL_SAMPLES),
  }
}

export function buildHrvSessionArchive(options: {
  id: string
  startedAt: number
  endedAt: number
  timeline: HrvTimeline
  signalDumps?: HrvSignalDump[]
  source?: HrvSource
}): HrvSessionData | null {
  const { id, startedAt, endedAt, timeline, source } = options
  const summary = timeline.getSummary()
  if (!summary) return null

  return {
    id,
    startedAt,
    endedAt,
    calibrationBaseline: timeline.baselineRmssd || 0,
    measurements: timeline.getMeasurements().slice(-MAX_ARCHIVED_MEASUREMENTS),
    shifts: timeline.getShifts().slice(-MAX_ARCHIVED_SHIFTS),
    signalDumps: (options.signalDumps ?? []).slice(-MAX_ARCHIVED_SIGNAL_DUMPS).map(trimSignalDump),
    totalMeasurementCount: summary.measurementCount,
    archiveVersion: 2,
    summary: {
      dominantState: summary.dominantState,
      averageHr: Math.round(summary.averageHr),
      averageRmssd: Math.round(summary.averageRmssd * 10) / 10,
      shiftCount: summary.shiftCount,
      avgConfidence: Math.round(summary.avgConfidence * 100) / 100,
    },
    ...(source && { source }),
  }
}
