import { isGroundingActive } from '../store/groundingState'
import { reloadOnce } from './lazyWithRetry'

// A page the service worker served runs that worker's build. On the first
// visit after a deploy, the old worker serves the old build while the browser
// fetches the new worker; with skipWaiting + clientsClaim the new one
// activates within seconds, deletes the old build's precached chunks and takes
// control of this page. Every chunk the old build has not loaded yet is then
// gone (Hosting answers the old URL with index.html), so its next lazy import
// fails with "Failed to fetch dynamically imported module".
//
// Reloading at the takeover moves the page onto the new build before that
// happens, but only while nothing is at stake (shouldReloadForNewBuild).
// lazyWithRetry's reload-once still covers every later failure.

export interface TakeoverContext {
  /** A service worker served this page, so it may be running an older build. */
  hadController: boolean
  /** The writer has pressed a key, clicked or tapped since the page loaded. */
  interacted: boolean
  /** Grounding (crisis support) is active at the moment of the takeover. */
  grounding: boolean
  /** Milliseconds since navigation start (`performance.now()`). */
  sinceLoadMs: number
}

// The takeover normally lands a few seconds after load (main.tsx asks for an
// update on `load`). Past this, someone may be reading, and a reload would
// flash the page and lose their place; lazyWithRetry covers that page instead.
export const TAKEOVER_RELOAD_WINDOW_MS = 30_000

/** Whether a new worker taking over this page should reload it right away. */
export function shouldReloadForNewBuild(ctx: TakeoverContext): boolean {
  // A page loaded from the network is already the current build.
  if (!ctx.hadController) return false
  // Never under the writer's hands: a reload would drop unsent words.
  if (ctx.interacted || ctx.grounding) return false
  return ctx.sinceLoadMs < TAKEOVER_RELOAD_WINDOW_MS
}

export interface StaleShellOptions {
  container?: ServiceWorkerContainer
  target?: EventTarget
  now?: () => number
  grounding?: () => boolean
  decide?: (ctx: TakeoverContext) => boolean
  reload?: (reason: string) => boolean
}

const INTERACTIONS = ['pointerdown', 'keydown'] as const

/**
 * Watches for a new service worker taking control of this page and reloads
 * onto its build when `decide` allows. Call once, before the app renders.
 * Returns a function that removes the listeners.
 */
export function installStaleShellReload(options: StaleShellOptions = {}): () => void {
  const container = options.container ?? navigator.serviceWorker
  const target = options.target ?? window
  const now = options.now ?? (() => performance.now())
  const grounding = options.grounding ?? isGroundingActive
  const decide = options.decide ?? shouldReloadForNewBuild
  const reload = options.reload ?? reloadOnce

  // Read at startup: by the time the worker changes, `controller` is the new one.
  const hadController = container.controller !== null
  let interacted = false
  const markInteracted = () => { interacted = true }
  for (const type of INTERACTIONS) {
    target.addEventListener(type, markInteracted, { capture: true, passive: true })
  }

  const onControllerChange = () => {
    const ctx: TakeoverContext = { hadController, interacted, grounding: grounding(), sinceLoadMs: now() }
    if (decide(ctx)) reload('sw-takeover')
  }
  container.addEventListener('controllerchange', onControllerChange)

  return () => {
    for (const type of INTERACTIONS) target.removeEventListener(type, markInteracted, { capture: true })
    container.removeEventListener('controllerchange', onControllerChange)
  }
}
