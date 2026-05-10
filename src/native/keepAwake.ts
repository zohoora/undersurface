// Cross-platform screen wake lock. No-ops where unsupported (older browsers,
// some embedded WebViews). Capacitor native bridge would slot in here later
// — for now this is a web-only implementation that fails closed.
//
// Refcounted so multiple callers (e.g. dev-mode StrictMode double-mount, or
// rapid surface switching) don't release each other's locks. The platform
// only exposes one sentinel at a time, but tracking acquire/release pairs
// per caller prevents a "release while still wanted" bug.

let sentinel: WakeLockSentinel | null = null
let refCount = 0

function getApi(): WakeLock | null {
  // The DOM lib types navigator.wakeLock as required, but it's missing in
  // older browsers and some WebViews. Cast to optional then check at runtime.
  const nav = navigator as Navigator & { wakeLock?: WakeLock }
  return nav.wakeLock ?? null
}

export async function acquireWakeLock(): Promise<void> {
  refCount += 1
  if (sentinel && !sentinel.released) return
  const api = getApi()
  if (!api) return
  try {
    sentinel = await api.request('screen')
    sentinel.addEventListener('release', () => { sentinel = null })
  } catch (err) {
    console.warn('[wakeLock] acquire failed', err)
    sentinel = null
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (refCount > 0) refCount -= 1
  if (refCount > 0) return
  const s = sentinel
  if (!s) return
  sentinel = null
  try {
    await s.release()
  } catch {
    // already released or revoked — fine
  }
}

// Reacquire on visibility resume — wake lock is dropped by the platform
// when the page is hidden. Caller should invoke this on `visibilitychange → visible`.
// Doesn't change refCount (acquireWakeLock would double-count).
export async function reacquireWakeLockIfVisible(): Promise<void> {
  if (typeof document === 'undefined') return
  if (document.hidden) return
  if (refCount === 0) return
  if (sentinel && !sentinel.released) return
  const api = getApi()
  if (!api) return
  try {
    sentinel = await api.request('screen')
    sentinel.addEventListener('release', () => { sentinel = null })
  } catch (err) {
    console.warn('[wakeLock] reacquire failed', err)
    sentinel = null
  }
}
