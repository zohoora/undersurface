import { describe, expect, it } from 'vitest'
import type { HrvMeasurement, HrvSignalDump } from '../types/hrv'
import { HrvTimeline } from './hrvTimeline'
import {
  buildHrvSessionArchive,
  MAX_ARCHIVED_MEASUREMENTS,
  MAX_ARCHIVED_SIGNAL_DUMPS,
} from './hrvArchive'

function measurement(index: number): HrvMeasurement {
  return {
    timestamp: index * 5_000,
    hr: 60 + (index % 20),
    rmssd: 40 + (index % 10),
    autonomicState: index % 2 === 0 ? 'calm' : 'transitioning',
    trend: 'steady',
    confidence: 0.8,
    respiratoryRate: null,
    derived: null,
  }
}

function dump(index: number): HrvSignalDump {
  const long = Array.from({ length: 500 }, (_, i) => i)
  return {
    timestamp: index,
    fps: 30,
    rBuffer: long,
    gBuffer: long,
    bBuffer: long,
    chromPulse: long,
    filteredPulse: long,
    fftPowerSpectrum: long.map(i => ({ freqHz: i, power: i })),
    fftPeakHz: 1.2,
    fftPeakBpm: 72,
    peaks: long,
    ibis: long,
  }
}

describe('buildHrvSessionArchive', () => {
  it('keeps a bounded rolling payload and lifetime summary', () => {
    const timeline = new HrvTimeline()
    const total = MAX_ARCHIVED_MEASUREMENTS + 500
    for (let i = 0; i < total; i++) timeline.addMeasurement(measurement(i))

    const archive = buildHrvSessionArchive({
      id: 'session-1',
      startedAt: 1,
      endedAt: 2,
      timeline,
      signalDumps: Array.from({ length: 8 }, (_, i) => dump(i)),
      source: 'camera',
    })

    expect(archive).not.toBeNull()
    expect(archive?.measurements).toHaveLength(MAX_ARCHIVED_MEASUREMENTS)
    expect(archive?.totalMeasurementCount).toBe(total)
    expect(archive?.signalDumps).toHaveLength(MAX_ARCHIVED_SIGNAL_DUMPS)
    expect(archive?.signalDumps[0].rBuffer.length).toBeLessThanOrEqual(150)
    expect(archive?.signalDumps[0].chromPulse.length).toBeLessThanOrEqual(150)
    expect(archive?.signalDumps[0].fftPowerSpectrum.length).toBeLessThanOrEqual(256)
    expect(archive?.archiveVersion).toBe(2)
  })

  it('returns null before the first measurement', () => {
    expect(buildHrvSessionArchive({
      id: 'session-1',
      startedAt: 1,
      endedAt: 2,
      timeline: new HrvTimeline(),
    })).toBeNull()
  })
})
