import { useState, useCallback, useRef } from 'react'
import {
  PolarH10Engine,
  isWebBluetoothSupported,
  type PolarH10Status,
  type PolarH10ErrorType,
} from '../engine/polarH10Engine'
import { HrvTimeline } from '../engine/hrvTimeline'
import { db } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { trackEvent } from '../services/analytics'
import type { HrvMeasurement, HrvSessionData, HrvConversationEventType } from '../types'

const POLAR_ERROR_MESSAGES: Record<PolarH10ErrorType, string> = {
  unsupported: 'Bluetooth not available in this browser',
  denied: 'Bluetooth permission denied',
  no_device: 'No device selected',
  gatt_failed: 'Could not connect to the device',
  characteristic_failed: 'Could not read heart-rate data',
  lost: 'Device disconnected',
}

/**
 * Manages a Polar H10 biometric session: lifecycle, measurement collection,
 * Firestore persistence, and consent flow.
 *
 * Mirrors useHrvSession's surface so SessionView can mount one of two paths
 * (camera or chest strap) with similar wiring. The two are mutually exclusive
 * at the SessionView layer — whichever is `enabled` provides hrvContext.
 */
export function usePolarH10Session(sessionIdRef: React.RefObject<string | null>) {
  const [enabled, setEnabled] = useState(false)
  const [latestMeasurement, setLatestMeasurement] = useState<HrvMeasurement | null>(null)
  const [measurementCount, setMeasurementCount] = useState(0)
  const [calibrating, setCalibrating] = useState(true)
  const [status, setStatus] = useState<PolarH10Status>('idle')
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConsent, setShowConsent] = useState(false)

  const engineRef = useRef<PolarH10Engine | null>(null)
  const timelineRef = useRef(new HrvTimeline())
  const startTimeRef = useRef<number>(0)
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const responseStartedRef = useRef(false)

  const flushData = useCallback(async () => {
    const currentSessionId = sessionIdRef.current
    const timeline = timelineRef.current
    if (!currentSessionId || timeline.getMeasurements().length === 0) return

    const measurements = timeline.getMeasurements()
    const shifts = timeline.getRecentShifts(99_999)

    const avgHr = measurements.reduce((s, m) => s + m.hr, 0) / measurements.length
    const avgRmssd = measurements.reduce((s, m) => s + m.rmssd, 0) / measurements.length
    const avgConf = measurements.reduce((s, m) => s + m.confidence, 0) / measurements.length

    const stateCounts: Record<string, number> = {}
    for (const m of measurements) {
      stateCounts[m.autonomicState] = (stateCounts[m.autonomicState] || 0) + 1
    }
    const dominantState = Object.entries(stateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'transitioning'

    const data: HrvSessionData = {
      id: currentSessionId,
      startedAt: startTimeRef.current,
      endedAt: Date.now(),
      calibrationBaseline: timeline.baselineRmssd || 0,
      measurements,
      shifts,
      // No raw signal buffers for the H10 — the device emits RR intervals
      // directly so there's nothing rPPG-shaped to capture. Reserved for v2
      // once accelerometer (PMD) data is added.
      signalDumps: [],
      summary: {
        dominantState: dominantState as HrvSessionData['summary']['dominantState'],
        averageHr: Math.round(avgHr),
        averageRmssd: Math.round(avgRmssd * 10) / 10,
        shiftCount: shifts.length,
        avgConfidence: Math.round(avgConf * 100) / 100,
      },
      source: 'polarH10',
    }

    await db.hrvSessions.add(data)
  }, [sessionIdRef])

  const start = useCallback(async () => {
    if (!isWebBluetoothSupported()) {
      setError('Bluetooth not supported in this browser')
      return
    }

    const engine = new PolarH10Engine()
    engineRef.current = engine
    timelineRef.current = new HrvTimeline()
    startTimeRef.current = Date.now()

    engine.onMeasurement((m) => {
      timelineRef.current.addMeasurement(m)
      setLatestMeasurement(m)
      setMeasurementCount(c => c + 1)
    })

    engine.onCalibrationComplete((baseline) => {
      timelineRef.current.setBaseline(baseline)
      setCalibrating(false)
    })

    engine.onStatus((s) => {
      setStatus(s)
      setDeviceName(engine.getDeviceName())
      if (s === 'streaming') {
        setEnabled(true)
        setError(null)
      } else if (s === 'idle' || s === 'disconnected') {
        setEnabled(false)
      }
    })

    engine.onError(e => setError(POLAR_ERROR_MESSAGES[e.type]))

    await engine.requestAndConnect()

    // Flush every 10 seconds — matches webcam cadence.
    flushIntervalRef.current = setInterval(() => {
      flushData().catch(console.error)
    }, 10_000)

    trackEvent('hrv_enabled', {
      session_id: sessionIdRef.current ?? '',
      source: 'polarH10',
    })
  }, [flushData, sessionIdRef])

  const toggle = useCallback(async () => {
    const config = getGlobalConfig()
    if (config?.features?.polarH10 !== true) return

    if (enabled || engineRef.current) {
      engineRef.current?.disconnect()
      engineRef.current = null
      setEnabled(false)
      setLatestMeasurement(null)
      setMeasurementCount(0)
      setCalibrating(true)
      setError(null)
      setDeviceName(null)
      setStatus('idle')
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current)
        flushIntervalRef.current = null
      }
      return
    }

    const consent = await db.consent.get('polar-h10')
    if (!consent) {
      setShowConsent(true)
      return
    }

    await start()
  }, [enabled, start])

  const stopAndFlush = useCallback(async () => {
    if (!engineRef.current) return
    await flushData()
    engineRef.current.disconnect()
    engineRef.current = null
    setEnabled(false)
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current)
      flushIntervalRef.current = null
    }
  }, [flushData])

  const addConversationEvent = useCallback((type: HrvConversationEventType, messageIndex: number) => {
    timelineRef.current.addConversationEvent(type, messageIndex)
  }, [])

  const buildPromptContext = useCallback((): string | undefined => {
    if (!enabled) return undefined
    return timelineRef.current.buildPromptContext() || undefined
  }, [enabled])

  const resetResponseStarted = useCallback(() => {
    responseStartedRef.current = false
  }, [])

  const markResponseStarted = useCallback((): boolean => {
    if (responseStartedRef.current) return false
    responseStartedRef.current = true
    return true
  }, [])

  const cleanupEngine = useCallback(() => {
    engineRef.current?.disconnect()
    engineRef.current = null
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current)
    }
  }, [])

  /**
   * Stable getter for the live chest-motion breathing scale (0..1) the
   * H10's accelerometer is producing right now. Designed for rAF polling
   * inside animations — avoids per-frame React re-renders. Returns null
   * when PMD isn't streaming (older firmware, browser without
   * permission, mid-pairing, etc.).
   */
  const getBreathingScale = useCallback((): number | null => {
    const engine = engineRef.current
    if (!engine || !engine.isPmdActive()) return null
    return engine.getBreathingScale()
  }, [])

  return {
    enabled,
    latestMeasurement,
    measurementCount,
    calibrating,
    status,
    deviceName,
    error,
    showConsent,
    setShowConsent,
    toggle,
    start,
    stopAndFlush,
    addConversationEvent,
    buildPromptContext,
    resetResponseStarted,
    markResponseStarted,
    cleanupEngine,
    getBreathingScale,
  }
}
