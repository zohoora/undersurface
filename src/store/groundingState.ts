import { getGlobalConfig } from './globalConfig'
import { engineLog } from '../services/diagnostics'

// Module-level state
let groundingActive = false
let autoExitTimer: ReturnType<typeof setTimeout> | null = null

const listeners = new Set<() => void>()
// Fired on EVERY activation request (first activation and re-triggers alike),
// regardless of which layer detected distress: L1 floor, raced L2 classifier,
// in-stream <<RISK:N>> preamble, voice/Room transcripts. Used to persist a
// server-readable crisis timestamp. Sinks run best-effort and can never throw
// into the crisis path.
type ActivationSink = (at: number) => void | Promise<unknown>
const activationSinks = new Set<ActivationSink>()

export function onGroundingActivated(sink: ActivationSink): () => void {
  activationSinks.add(sink)
  return () => { activationSinks.delete(sink) }
}

function notifyActivation() {
  const at = Date.now()
  for (const sink of activationSinks) {
    try {
      const result = sink(at)
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        void (result as Promise<unknown>).catch(() => { /* best-effort */ })
      }
    } catch {
      // A sink failure must never reach the caller that detected distress.
    }
  }
}

function notify() {
  for (const fn of listeners) fn()
}

export function subscribeGrounding(callback: () => void) {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

function resetAutoExit() {
  if (autoExitTimer) clearTimeout(autoExitTimer)
  const config = getGlobalConfig()
  const minutes = config?.grounding?.autoExitMinutes ?? 5
  autoExitTimer = setTimeout(() => {
    deactivateGrounding()
  }, minutes * 60 * 1000)
}

export function activateGrounding(trigger: 'auto' | 'manual' = 'auto'): void {
  if (groundingActive) {
    // Re-trigger resets the auto-exit timer
    resetAutoExit()
    notifyActivation()
    return
  }
  groundingActive = true
  document.documentElement.setAttribute('data-grounding', 'true')
  // First-party diagnostics only. Crisis-state signals must never reach
  // Google Analytics: GA is keyed to the user id and shares a property with
  // Ads conversions, so a grounding event there attaches sensitive-category
  // health data to an advertising identifier.
  engineLog('info', 'grounding.activated', 'grounding mode activated', { extra: { trigger } })
  notify()
  resetAutoExit()
  notifyActivation()
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

export function clearAutoExitTimer(): void {
  if (autoExitTimer) {
    clearTimeout(autoExitTimer)
    autoExitTimer = null
  }
}
