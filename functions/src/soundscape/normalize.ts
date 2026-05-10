import { createHash } from 'crypto'

// Normalize a user-supplied prompt for content-addressed caching. The intent
// is that "  Rain on TIN  Roof " and "rain on tin roof" produce the same
// cache key — but "rain on tin roof, distant thunder" should NOT collide
// with the simpler prompt.
//
// Steps:
// 1. NFC unicode normalization (so accented characters are bit-identical)
// 2. trim leading/trailing whitespace
// 3. collapse internal whitespace runs to a single space
// 4. lowercase
//
// We deliberately do not strip punctuation. Two prompts that differ only in
// punctuation likely produce different soundscapes from ElevenLabs and should
// have separate cache entries.
export function normalize(prompt: string): string {
  return prompt
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function hashPrompt(normalizedPrompt: string): string {
  return createHash('sha256').update(normalizedPrompt).digest('hex')
}

// Convenience: normalize + hash in one step.
export function promptHash(prompt: string): string {
  return hashPrompt(normalize(prompt))
}

// Returns true if the prompt is acceptable for generation. Rejects:
// - empty / pure-whitespace
// - too long (>200 chars after trim)
// - all-punctuation (likely junk)
// - looks like URL or email (cheap prompt-injection guard)
export function isValidPrompt(prompt: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = prompt.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length > 200) return { ok: false, reason: 'too_long' }
  if (!/[a-zA-Z0-9]/.test(trimmed)) return { ok: false, reason: 'no_alphanumeric' }
  // Cheap URL/email guard — prevents trivial prompt-injection attempts that
  // ask the model to fetch a remote resource. ElevenLabs SFX doesn't fetch,
  // but rejecting these tightens the threat model.
  if (/https?:\/\//i.test(trimmed)) return { ok: false, reason: 'url' }
  if (/\S+@\S+\.\S+/.test(trimmed)) return { ok: false, reason: 'email' }
  return { ok: true }
}
