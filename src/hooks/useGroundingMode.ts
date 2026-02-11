import { useEffect, useSyncExternalStore } from 'react'
import { getGlobalConfig } from '../store/globalConfig'
import { trackEvent } from '../services/analytics'

// Module-level state (like useFlowState pattern)
let groundingActive = false
let autoExitTimer: ReturnType<typeof setTimeout> | null = null

const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

function getSnapshot(): boolean {
  return groundingActive
}

export function activateGrounding(trigger: 'auto' | 'manual' = 'auto'): void {
  if (groundingActive) {
    // Re-trigger resets the auto-exit timer
    resetAutoExit()
    return
  }
  groundingActive = true
  document.documentElement.setAttribute('data-grounding', 'true')
  trackEvent('grounding_activated', { trigger })
  notify()
  resetAutoExit()
}

export function deactivateGrounding(): void {
  if (!groundingActive) return
  groundingActive = false
  document.documentElement.removeAttribute('data-grounding')
  if (autoExitTimer) {
    clearTimeout(autoExitTimer)
    autoExitTimer = null
  }
  notify()
}

export function isGroundingActive(): boolean {
  return groundingActive
}

function resetAutoExit() {
  if (autoExitTimer) clearTimeout(autoExitTimer)
  const config = getGlobalConfig()
  const minutes = config?.grounding?.autoExitMinutes ?? 5
  autoExitTimer = setTimeout(() => {
    deactivateGrounding()
  }, minutes * 60 * 1000)
}

export function useGroundingMode(): boolean {
  const active = useSyncExternalStore(subscribe, getSnapshot)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoExitTimer) {
        clearTimeout(autoExitTimer)
        autoExitTimer = null
      }
    }
  }, [])

  return active
}
