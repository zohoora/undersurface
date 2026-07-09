import { useState, useCallback, useRef } from 'react'
import { HrvEngine } from '../engine/hrvEngine'
import { HrvTimeline } from '../engine/hrvTimeline'
import { buildHrvSessionArchive } from '../engine/hrvArchive'
import { db } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { trackEvent } from '../services/analytics'
import { engineLog } from '../services/diagnostics'
import type { HrvMeasurement, HrvError, HrvConversationEventType } from '../types'

/**
 * Manages HRV biometric session lifecycle: engine start/stop,
 * measurement collection, data flushing, and consent flow.
 */
export function useHrvSession(sessionIdRef: React.RefObject<string | null>) {
  const [enabled, setEnabled] = useState(false)
  const [latestMeasurement, setLatestMeasurement] = useState<HrvMeasurement | null>(null)
  const [measurementCount, setMeasurementCount] = useState(0)
  const [calibrating, setCalibrating] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConsent, setShowConsent] = useState(false)

  const hrvEngineRef = useRef<HrvEngine | null>(null)
  const hrvTimelineRef = useRef(new HrvTimeline())
  const hrvStartTimeRef = useRef<number>(0)
  const hrvFlushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hrvResponseStartedRef = useRef(false)
  const hrvFlushInFlightRef = useRef(false)

  const flushHrvData = useCallback(async () => {
    const currentSessionId = sessionIdRef.current
    const timeline = hrvTimelineRef.current
    if (!currentSessionId || hrvFlushInFlightRef.current) return
    const data = buildHrvSessionArchive({
      id: currentSessionId,
      startedAt: hrvStartTimeRef.current,
      endedAt: Date.now(),
      timeline,
      signalDumps: hrvEngineRef.current?.getSignalDumps() ?? [],
      source: 'camera',
    })
    if (!data) return

    hrvFlushInFlightRef.current = true
    try {
      await db.hrvSessions.add(data)
    } catch {
      engineLog('error', 'hrv.persistence_failed', 'Could not persist the bounded camera HRV archive', {
        sessionId: currentSessionId,
        extra: { source: 'camera', measurements: data.measurements.length },
      })
    } finally {
      hrvFlushInFlightRef.current = false
    }
  }, [sessionIdRef])

  const start = useCallback(async () => {
    const engine = new HrvEngine()
    engine.setSessionId(sessionIdRef.current)
    hrvEngineRef.current = engine
    hrvTimelineRef.current = new HrvTimeline()
    hrvStartTimeRef.current = Date.now()

    engine.onMeasurement((m) => {
      hrvTimelineRef.current.addMeasurement(m)
      setLatestMeasurement(m)
      setMeasurementCount(c => c + 1)
    })

    engine.onCalibrationComplete((baseline) => {
      hrvTimelineRef.current.setBaseline(baseline)
      setCalibrating(false)
    })

    engine.onError((err) => {
      if (err.type === 'camera_lost') {
        setError('Camera disconnected')
      } else if (err.type === 'worker_error') {
        console.warn('HRV worker error:', err.message)
      }
    })

    try {
      await engine.start()
      setEnabled(true)
      setError(null)

      // Flush HRV data every 10 seconds for debugging/analysis
      hrvFlushIntervalRef.current = setInterval(() => {
        flushHrvData().catch(console.error)
      }, 10_000)

      trackEvent('hrv_enabled', { session_id: sessionIdRef.current ?? '' })
    } catch (err) {
      const hrvErr = err as HrvError
      if (hrvErr.type === 'camera_denied') {
        setError('Camera access denied')
      } else {
        setError('Camera not available')
      }
      hrvEngineRef.current = null
    }
  }, [flushHrvData, sessionIdRef])

  const toggle = useCallback(async () => {
    const config = getGlobalConfig()
    if (config?.features?.webcamHrv !== true) return

    if (enabled) {
      // Disable
      hrvEngineRef.current?.stop()
      hrvEngineRef.current = null
      setEnabled(false)
      setLatestMeasurement(null)
      setMeasurementCount(0)
      setCalibrating(true)
      setError(null)
      if (hrvFlushIntervalRef.current) {
        clearInterval(hrvFlushIntervalRef.current)
        hrvFlushIntervalRef.current = null
      }
      return
    }

    // Check consent
    const consent = await db.consent.get('camera-hrv')
    if (!consent) {
      setShowConsent(true)
      return
    }

    await start()
  }, [enabled, start])

  const stopAndFlush = useCallback(async () => {
    if (!hrvEngineRef.current) return
    await flushHrvData()
    hrvEngineRef.current.stop()
    hrvEngineRef.current = null
    setEnabled(false)
    if (hrvFlushIntervalRef.current) {
      clearInterval(hrvFlushIntervalRef.current)
      hrvFlushIntervalRef.current = null
    }
  }, [flushHrvData])

  const addConversationEvent = useCallback((type: HrvConversationEventType, messageIndex: number) => {
    hrvTimelineRef.current.addConversationEvent(type, messageIndex)
  }, [])

  const buildPromptContext = useCallback((): string | undefined => {
    if (!enabled) return undefined
    // Webcam source: only hedged HR + trend reach the prompt (see HrvTimeline).
    return hrvTimelineRef.current.buildPromptContext('camera') || undefined
  }, [enabled])

  /** Reset the response-started flag (call before each AI generation) */
  const resetResponseStarted = useCallback(() => {
    hrvResponseStartedRef.current = false
  }, [])

  /** Mark that the first token of an AI response was received */
  const markResponseStarted = useCallback((): boolean => {
    if (hrvResponseStartedRef.current) return false
    hrvResponseStartedRef.current = true
    return true
  }, [])

  const cleanupEngine = useCallback(() => {
    hrvEngineRef.current?.stop()
    if (hrvFlushIntervalRef.current) {
      clearInterval(hrvFlushIntervalRef.current)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return {
    enabled,
    latestMeasurement,
    measurementCount,
    calibrating,
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
  }
}
