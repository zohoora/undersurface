import type { PartAnnotations } from '../types'

const DELIMITER = '---annotations---'
const MAX_HIGHLIGHTS = 5
const MAX_GHOST_LENGTH = 80

export function parseAnnotations(fullText: string): {
  thoughtText: string
  annotations: PartAnnotations | null
} {
  const delimIndex = fullText.indexOf(DELIMITER)
  if (delimIndex === -1) {
    return { thoughtText: fullText, annotations: null }
  }

  const thoughtText = fullText.slice(0, delimIndex).trim()
  const jsonPart = fullText.slice(delimIndex + DELIMITER.length).trim()

  try {
    const jsonMatch = jsonPart.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { thoughtText, annotations: null }
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const annotations: PartAnnotations = {}

    if (Array.isArray(parsed.highlights)) {
      annotations.highlights = parsed.highlights
        .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
        .slice(0, MAX_HIGHLIGHTS)
    }

    if (typeof parsed.ghostText === 'string' && parsed.ghostText.trim().length > 0) {
      // Preserve leading space (for proper sentence spacing), trim trailing only
      let ghost = parsed.ghostText.replace(/\s+$/, '')
      // Ensure it starts with a space so it doesn't jam against the previous text
      if (!ghost.startsWith(' ')) ghost = ' ' + ghost
      annotations.ghostText = ghost.slice(0, MAX_GHOST_LENGTH)
    }

    const hasContent = (annotations.highlights && annotations.highlights.length > 0) || annotations.ghostText
    return { thoughtText, annotations: hasContent ? annotations : null }
  } catch {
    return { thoughtText, annotations: null }
  }
}

// Sentence-ending punctuation across supported languages:
// Latin/Cyrillic: . ! ?    CJK: 。！？    Hindi: । (purna viram)
// Period/。 must NOT be preceded by another period (excludes ellipsis "...")
// Optionally followed by closing quotes/brackets/parens
const SENTENCE_END_RE = /(?:(?<!\.)[.。]|[!?！？।])['""'»)\]]*$/

/**
 * Fix ghost text capitalization based on how the writer's text ends.
 * Deterministic — removes this burden from the AI.
 *
 * For scripts without capitalization (CJK, Thai, Hindi, Korean),
 * the Unicode letter match won't find a casing letter, so the
 * ghost text passes through unchanged — which is correct.
 */
export function fixGhostCapitalization(ghost: string, writerText: string): string {
  if (!ghost) return ghost

  const trimmedWriter = writerText.trimEnd()
  const endsWithSentenceEnd = SENTENCE_END_RE.test(trimmedWriter)

  // Match leading whitespace, then the first Unicode letter (covers Latin, Cyrillic, etc.)
  const match = ghost.match(/^(\s*)(\p{L})(.*)$/su)
  if (!match) return ghost

  const [, leading, firstChar, rest] = match

  // Only apply case change if the character actually has distinct upper/lower forms.
  // Scripts like CJK, Thai, Devanagari have no case — toUpperCase() === toLowerCase(),
  // so they pass through unchanged regardless.
  if (endsWithSentenceEnd) {
    return leading + firstChar.toUpperCase() + rest
  } else {
    return leading + firstChar.toLowerCase() + rest
  }
}

export function isDelimiterPrefix(buffer: string): boolean {
  if (buffer.length > DELIMITER.length) return false
  return DELIMITER.startsWith(buffer)
}

export { DELIMITER }
