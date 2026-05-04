import { useState, useCallback, useRef, useEffect } from 'react'
import { HrvEngine } from '../engine/hrvEngine'
import { db } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { trackEvent } from '../services/analytics'
import type { HrvMeasurement, HrvError, AutonomicState } from '../types'

const CONFIDENCE_FLOOR = 0.3

/**
 * Lightweight HRV hook for ambient sensing in non-session contexts (diary).
 * Exposes live measurements + autonomic state — no Firestore persistence.
 * For full session capture use useHrvSession instead.
 */
export function useHrvAmbient() {
  const [enabled, setEnabled] = useState(false)
  const [latest, setLatest] = useState<HrvMeasurement | null>(null)
  const [calibrating, setCalibrating] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConsent, setShowConsent] = useState(false)
  const engineRef = useRef<HrvEngine | null>(null)
  const consentCachedRef = useRef<boolean | null>(null)

  const start = useCallback(async () => {
    const engine = new HrvEngine()
    engineRef.current = engine

    engine.onMeasurement(setLatest)
    engine.onCalibrationComplete(() => setCalibrating(false))
    engine.onError((err) => {
      if (err.type === 'camera_lost') setError('Camera disconnected')
    })

    try {
      await engine.start()
      setEnabled(true)
      setError(null)
      trackEvent('hrv_enabled', { context: 'diary' })
    } catch (err) {
      const e = err as HrvError
      setError(e.type === 'camera_denied' ? 'Camera access denied' : 'Camera not available')
      engineRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    engineRef.current?.stop()
    engineRef.current = null
    setEnabled(false)
    setLatest(null)
    setCalibrating(true)
    setError(null)
  }, [])

  const toggle = useCallback(async () => {
    if (getGlobalConfig()?.features?.webcamHrv !== true) return
    if (enabled) { stop(); return }
    if (consentCachedRef.current === null) {
      consentCachedRef.current = !!(await db.consent.get('camera-hrv'))
    }
    if (!consentCachedRef.current) { setShowConsent(true); return }
    await start()
  }, [enabled, start, stop])

  const acceptConsent = useCallback(async () => {
    consentCachedRef.current = true
    setShowConsent(false)
    await start()
  }, [start])

  const declineConsent = useCallback(() => {
    setShowConsent(false)
  }, [])

  useEffect(() => () => { engineRef.current?.stop() }, [])

  // Only surface state when signal confidence clears the floor — noisy
  // measurements should not bias part orchestration.
  const autonomicState: AutonomicState | null =
    latest && latest.confidence >= CONFIDENCE_FLOOR ? latest.autonomicState : null

  return {
    enabled,
    latest,
    autonomicState,
    calibrating,
    error,
    showConsent,
    toggle,
    start,
    stop,
    acceptConsent,
    declineConsent,
  }
}
