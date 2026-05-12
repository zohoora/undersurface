// Per-instance rate limiters for the soundscape API. Two-tier:
//
// 1. checkSoundscapeGenerate — only counts cache misses (real ElevenLabs
//    calls). Bounds direct cost.
// 2. checkSoundscapeRequest — counts every request (hits + misses). Bounds
//    abuse (e.g. scraping signed URLs).

import { makeRateLimiter } from '../shared/rateLimit.js'

export interface SoundscapeLimiters {
  generate: (key: string) => boolean
  request: (key: string) => boolean
}

export function buildSoundscapeLimiters(): SoundscapeLimiters {
  return {
    generate: makeRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 }),
    request: makeRateLimiter({ windowMs: 60 * 60 * 1000, max: 60 }),
  }
}
