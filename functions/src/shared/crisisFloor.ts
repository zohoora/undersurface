// L1 is deliberately narrower than the contextual L2 classifier. It catches
// explicit first-person methods/plans and unmistakable farewell-note framing;
// ambiguous language remains for L2 so grief, metaphor, recovery narratives,
// and ordinary hyperbole are not hard-grounded.
const HARD_FLOOR_CRISIS_PATTERNS = [
  /\bwant\s+to\s+kill\s+(myself|me)\b/i,
  /\bkill\s+myself\b/i,
  /\bend\s+my\s+life\b/i,
  /\bcut\s+(myself|my\s+wrists?)\b/i,
  /\btake\s+(all\s+)?(the\s+)?pills\b/i,
  /\bswallow\s+(all\s+)?(the\s+)?pills\b/i,
  /\bhang\s+myself\b/i,
  /\bshoot\s+myself\b/i,
  /\bslit\s+(my\s+)?wrists?\b/i,
  /\bdrown\s+myself\b/i,
  /\bif\s+(?:anyone|you)\s+(?:ever\s+)?reads?\s+this(?:\s+(?:some\s*day|later))?\b(?=[\s\S]{0,240}\b(?:wasn['’]?t|isn['’]?t)\s+(?:your|their)\s+fault\b)(?=[\s\S]{0,240}\bi\s+(?:made|have\s+made)\s+(?:the|my)\s+(?:choice|decision)\b)/i,
]

/** Normalize compatibility forms and defeat zero-width whitespace evasions. */
export function normalizeForCrisisDetection(text: string): string {
  // ZWJ/ZWNJ are deliberate here: they are an evasion class, not grapheme
  // joiners that need preserving for the narrow English hard floor.
  const evasiveWhitespace = /\u00A0|\u200B|\u200C|\u200D|\uFEFF|\u2060/g
  return text.normalize('NFKC').replace(evasiveWhitespace, ' ')
}

export function detectCrisisKeywords(text: string): boolean {
  const normalized = normalizeForCrisisDetection(text)
  return HARD_FLOOR_CRISIS_PATTERNS.some(pattern => pattern.test(normalized))
}
