// Per-instance rate limiters for the soundscape API. Two-tier:
//
// 1. checkSoundscapeGenerate — only counts cache misses (real ElevenLabs
//    calls). Bounds direct cost.
// 2. checkSoundscapeRequest — counts every request (hits + misses). Bounds
//    abuse (e.g. scraping signed URLs).
//
// The makeRateLimiter factory lives in functions/src/index.ts. We re-export
// from there to keep the limiter implementation single-sourced.

interface RateLimiter {
  (key: string): boolean
}

export interface SoundscapeLimiters {
  generate: RateLimiter
  request: RateLimiter
}

export function buildSoundscapeLimiters(makeRateLimiter: (opts: { windowMs: number; max: number }) => RateLimiter): SoundscapeLimiters {
  return {
    generate: makeRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 }),
    request: makeRateLimiter({ windowMs: 60 * 60 * 1000, max: 60 }),
  }
}
