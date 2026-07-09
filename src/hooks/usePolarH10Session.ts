import { useState, useCallback, useRef } from 'react'
import {
  PolarH10Engine,
  isWebBluetoothSupported,
  type PolarH10Status,
  type PolarH10ErrorType,
} from '../engine/polarH10Engine'
import { HrvTimeline } from '../engine/hrvTimeline'
import { buildHrvSessionArchive } from '../engine/hrvArchive'
import { db } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { trackEvent } from '../services/analytics'
import { engineLog } from '../services/diagnostics'
import type { HrvMeasurement, HrvConversationEventType } from '../types'

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
  const flushInFlightRef = useRef(false)

  const flushData = useCallback(async () => {
    const currentSessionId = sessionIdRef.current
    const timeline = timelineRef.current
    if (!currentSessionId || flushInFlightRef.current) return
    const data = buildHrvSessionArchive({
      id: currentSessionId,
      startedAt: startTimeRef.current,
      endedAt: Date.now(),
      timeline,
      source: 'polarH10',
    })
    if (!data) return

    flushInFlightRef.current = true
    try {
      await db.hrvSessions.add(data)
    } catch {
      engineLog('error', 'hrv.persistence_failed', 'Could not persist the bounded Polar HRV archive', {
        sessionId: currentSessionId,
        extra: { source: 'polarH10', measurements: data.measurements.length },
      })
    } finally {
      flushInFlightRef.current = false
    }
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
    // Chest-strap IBIs are accurate — surface the full HRV-derived block.
    return timelineRef.current.buildPromptContext('polarH10') || undefined
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

  const clearError = useCallback(() => setError(null), [])

  return {
    enabled,
    latestMeasurement,
    measurementCount,
    calibrating,
    status,
    deviceName,
    error,
    clearError,
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
