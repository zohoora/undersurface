// Best-effort per-instance rate limiter (not shared across Cloud Function instances).
// Each limiter owns its Map and sweeps expired entries on access to avoid
// unbounded growth from one-shot callers.
export function makeRateLimiter({ windowMs, max }: { windowMs: number; max: number }) {
  const entries = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = 0
  return function check(key: string): boolean {
    const now = Date.now()
    // Cheap amortized sweep — at most once per window, bounded cost.
    if (now - lastSweep > windowMs) {
      for (const [k, v] of entries) {
        if (now > v.resetAt) entries.delete(k)
      }
      lastSweep = now
    }
    const entry = entries.get(key)
    if (!entry || now > entry.resetAt) {
      entries.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    entry.count++
    return entry.count <= max
  }
}
