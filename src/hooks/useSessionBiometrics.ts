import { useCallback, useEffect } from 'react'
import { useHrvSession } from './useHrvSession'
import { usePolarH10Session } from './usePolarH10Session'
import type { BiometricSource } from './useSessionStream'

/**
 * Owns biometric source selection for a session. The shell should not need to
 * understand camera/Polar mutual exclusion, which source feeds prompts, or how
 * both engines are torn down at a session boundary.
 */
export function useSessionBiometrics(sessionIdRef: React.RefObject<string | null>) {
  const camera = useHrvSession(sessionIdRef)
  const polar = usePolarH10Session(sessionIdRef)

  const cameraStopAndFlush = camera.stopAndFlush
  useEffect(() => {
    if (polar.enabled && camera.enabled) {
      cameraStopAndFlush().catch(console.error)
    }
  }, [polar.enabled, camera.enabled, cameraStopAndFlush])

  const active = polar.enabled ? polar : camera.enabled ? camera : null
  const enabled = polar.enabled || camera.enabled
  const startupError = !active ? (polar.error ?? camera.error ?? null) : null

  useEffect(() => {
    document.body.classList.toggle('biometrics-active', enabled)
    return () => document.body.classList.remove('biometrics-active')
  }, [enabled])

  const source: BiometricSource = {
    enabled: !!active,
    buildPromptContext: () => active?.buildPromptContext(),
    addConversationEvent: (type, index) => active?.addConversationEvent(type, index),
    resetResponseStarted: () => { active?.resetResponseStarted() },
    markResponseStarted: () => active?.markResponseStarted() ?? false,
  }

  const cleanup = useCallback(() => {
    camera.cleanupEngine()
    polar.cleanupEngine()
  }, [camera, polar])

  const stopAndFlush = useCallback(async () => {
    await camera.stopAndFlush()
    await polar.stopAndFlush()
  }, [camera, polar])

  return {
    camera,
    polar,
    active,
    enabled,
    startupError,
    source,
    cleanup,
    stopAndFlush,
  }
}
