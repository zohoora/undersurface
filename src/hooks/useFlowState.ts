import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useGlobalConfig } from '../store/globalConfig'

// Module-level state so recordFlowKeystroke can be called from
// event handlers without causing React re-renders
let lastKeystrokeTime = 0
let firstKeystrokeTime = 0
let flowActive = false

const FLOW_BREAK_GAP_MS = 10_000
const KEYSTROKE_GAP_MS = 3_000

// External store for flow state — avoids setState inside effects
let flowSnapshot = { inFlow: false, flowIntensity: 0 }
const flowListeners = new Set<() => void>()

function notifyFlowListeners() {
  for (const fn of flowListeners) fn()
}

function subscribeFlow(callback: () => void) {
  flowListeners.add(callback)
  return () => { flowListeners.delete(callback) }
}

function getFlowSnapshot() {
  return flowSnapshot
}

function updateFlowSnapshot(inFlow: boolean, intensity: number) {
  if (flowSnapshot.inFlow !== inFlow || flowSnapshot.flowIntensity !== intensity) {
    flowSnapshot = { inFlow, flowIntensity: intensity }
    notifyFlowListeners()
  }
}

export function recordFlowKeystroke(): void {
  const now = Date.now()

  // If gap since last keystroke exceeds 3s, reset the flow window
  if (lastKeystrokeTime > 0 && now - lastKeystrokeTime > KEYSTROKE_GAP_MS) {
    firstKeystrokeTime = now
    flowActive = false
  }

  if (firstKeystrokeTime === 0) {
    firstKeystrokeTime = now
  }

  lastKeystrokeTime = now
}

interface FlowStateResult {
  inFlow: boolean
  flowIntensity: number
}

export function useFlowState(): FlowStateResult {
  const config = useGlobalConfig()
  const enabled = config?.features?.flowStateVisuals === true
  const snapshot = useSyncExternalStore(subscribeFlow, getFlowSnapshot)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!enabled) {
      // Reset module-level state
      lastKeystrokeTime = 0
      firstKeystrokeTime = 0
      flowActive = false
      updateFlowSnapshot(false, 0)
      document.documentElement.removeAttribute('data-flow')
      document.documentElement.style.removeProperty('--flow-intensity')
      return
    }

    const thresholdMs = (config?.atmosphere?.flowThresholdSeconds ?? 60) * 1000

    const tick = () => {
      const now = Date.now()

      // Check for flow break: 10+ second pause
      if (lastKeystrokeTime > 0 && now - lastKeystrokeTime > FLOW_BREAK_GAP_MS) {
        if (flowActive) {
          flowActive = false
          firstKeystrokeTime = 0
          lastKeystrokeTime = 0
          updateFlowSnapshot(false, 0)
          document.documentElement.removeAttribute('data-flow')
          document.documentElement.style.removeProperty('--flow-intensity')
        }
        return
      }

      // No keystrokes yet
      if (firstKeystrokeTime === 0 || lastKeystrokeTime === 0) return

      // Check if gap since last keystroke is too large (not actively typing)
      if (now - lastKeystrokeTime > KEYSTROKE_GAP_MS) {
        return
      }

      const elapsed = now - firstKeystrokeTime
      const intensity = Math.min(1, elapsed / thresholdMs)
      const isInFlow = elapsed >= thresholdMs

      if (isInFlow && !flowActive) {
        flowActive = true
      }

      updateFlowSnapshot(isInFlow, intensity)

      if (isInFlow) {
        document.documentElement.setAttribute('data-flow', 'true')
        document.documentElement.style.setProperty('--flow-intensity', String(intensity))
      }
    }

    // Check every 500ms
    tickRef.current = setInterval(tick, 500)

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
      document.documentElement.removeAttribute('data-flow')
      document.documentElement.style.removeProperty('--flow-intensity')
      flowActive = false
      firstKeystrokeTime = 0
      lastKeystrokeTime = 0
    }
  }, [enabled, config?.atmosphere?.flowThresholdSeconds])

  if (!enabled) {
    return { inFlow: false, flowIntensity: 0 }
  }

  return snapshot
}
