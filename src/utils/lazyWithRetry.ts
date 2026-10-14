import { lazy, type LazyExoticComponent } from 'react'

// After a deploy, the new service worker claims open tabs and cleans the old
// precache; Hosting rewrites every unknown path to index.html. A tab still
// running the previous bundle then fails to import an old-hash chunk. Retry
// the import once (transient network), then reload the page once per chunk so
// it picks up the new build. The reload guard lives in sessionStorage so a
// genuinely broken chunk cannot cause a reload loop; after that the error
// reaches the nearest error boundary.

const RELOAD_KEY_PREFIX = 'undersurface:chunk-reload:'
const RELOAD_WINDOW_MS = 60_000
const RETRY_DELAY_MS = 400

function readStamp(key: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

function writeStamp(key: string, value: number | null): boolean {
  try {
    if (value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, String(value))
    return true
  } catch {
    return false
  }
}

/**
 * Reload the page at most once per `reason` within a minute. Returns true when
 * a reload was started. Without sessionStorage there is no loop guard, so it
 * never reloads.
 */
export function reloadOnce(reason: string, now: number = Date.now()): boolean {
  const key = `${RELOAD_KEY_PREFIX}${reason}`
  const last = readStamp(key)
  if (last !== null && Number.isFinite(last) && now - last < RELOAD_WINDOW_MS) return false
  if (!writeStamp(key, now)) return false
  window.location.reload()
  return true
}

export async function importWithRetry<T>(
  factory: () => Promise<T>,
  chunkName: string,
  delay: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  try {
    const module = await factory()
    writeStamp(`${RELOAD_KEY_PREFIX}${chunkName}`, null)
    return module
  } catch (firstError) {
    await delay(RETRY_DELAY_MS)
    try {
      const module = await factory()
      writeStamp(`${RELOAD_KEY_PREFIX}${chunkName}`, null)
      return module
    } catch {
      if (reloadOnce(chunkName)) {
        // The page is going away; never settle so nothing renders a fallback
        // for a split second before the reload.
        return new Promise<T>(() => {})
      }
      throw firstError
    }
  }
}

// React.lazy's own component constraint, derived rather than restated so no
// explicit `any` is needed.
type LazyComponent = Awaited<ReturnType<Parameters<typeof lazy>[0]>>['default']

export function lazyWithRetry<T extends LazyComponent>(
  factory: () => Promise<{ default: T }>,
  chunkName: string,
): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(factory, chunkName))
}
