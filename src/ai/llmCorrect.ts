import { getAuth } from 'firebase/auth'

// Hardcoded model for autocorrect — cheap, fast, good at following instructions.
// NOT getModel() — autocorrect always uses a small model regardless of user settings.
const AUTOCORRECT_MODEL = 'qwen/qwen-2.5-7b-instruct'

const SYSTEM_PROMPT = `Fix ONLY spelling errors, capitalization, and missing apostrophes in contractions.
Return ONLY the corrected text. If no corrections needed, return the input exactly.
Do NOT rephrase, add words, remove words, or add commentary.`

const MIN_CALL_INTERVAL_MS = 3000
const TIMEOUT_MS = 5000

// Known abbreviations that end with a period but aren't sentence endings
const ABBREVIATIONS = new Set([
  'dr.', 'mr.', 'mrs.', 'ms.', 'jr.', 'sr.',
  'etc.', 'i.e.', 'e.g.', 'vs.',
  'a.m.', 'p.m.',
  'u.s.', 'd.c.',
  'st.', 'ave.', 'blvd.',
  'prof.', 'gen.', 'sgt.', 'cpl.',
  'inc.', 'ltd.', 'co.',
  'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'oct.', 'nov.', 'dec.',
])

let lastCallTime = 0
let inFlight = false

/** Reset throttle state — exposed for tests only */
export function _resetThrottle() {
  lastCallTime = 0
  inFlight = false
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

/**
 * Extracts the last completed sentence from text before the cursor.
 * A sentence is "completed" when it ends with sentence-ending punctuation
 * followed by a space (the cursor is after that space).
 */
export function extractCompletedSentence(
  textBefore: string,
): { sentence: string; start: number; end: number } | null {
  // Find the last sentence-ending char that has a space after it
  const sentenceEndPattern = /[.!?。！？]\s/g
  let lastEndMatch: { index: number; length: number } | null = null

  let m
  while ((m = sentenceEndPattern.exec(textBefore)) !== null) {
    lastEndMatch = { index: m.index, length: m[0].length }
  }

  if (!lastEndMatch) return null

  const sentenceEndPos = lastEndMatch.index + 1 // position after the punctuation char

  // Check for ellipsis: if the char before this period is also a period
  if (textBefore[lastEndMatch.index] === '.') {
    const idx = lastEndMatch.index
    if (idx >= 1 && textBefore[idx - 1] === '.') return null
    if (idx + 1 < textBefore.length && textBefore[idx + 1] === '.') return null
  }

  // Now find sentence start: look backward from the sentence end
  // for a previous sentence-end+space, or use start of text
  let sentenceStart = 0
  const textUpToSentence = textBefore.slice(0, lastEndMatch.index)

  // Find the last sentence boundary before our sentence
  const prevEndPattern = /[.!?。！？]\s/g
  let prevMatch
  while ((prevMatch = prevEndPattern.exec(textUpToSentence)) !== null) {
    sentenceStart = prevMatch.index + prevMatch[0].length
  }

  const sentence = textBefore.slice(sentenceStart, sentenceEndPos).trim()

  // Skip short sentences (< 3 words)
  if (wordCount(sentence) < 3) return null

  // Check if the "sentence end" is actually an abbreviation
  const lowerSentence = sentence.toLowerCase()
  for (const abbr of ABBREVIATIONS) {
    if (lowerSentence.endsWith(abbr)) return null
  }

  return { sentence, start: sentenceStart, end: sentenceEndPos }
}

/**
 * Sends a sentence to the LLM for spelling/capitalization correction.
 * Returns the corrected text, or null if no correction is needed or on error.
 */
export async function correctSentence(sentence: string): Promise<string | null> {
  // Throttle: skip if another call is in-flight or too recent
  const now = Date.now()
  if (inFlight || now - lastCallTime < MIN_CALL_INTERVAL_MS) return null

  inFlight = true
  lastCallTime = now

  try {
    const user = getAuth().currentUser
    if (!user) return null
    const token = await user.getIdToken()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: AUTOCORRECT_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: sentence },
          ],
          temperature: 0,
          max_tokens: 200,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) return null

    const data = await response.json()
    let corrected: string = data.choices?.[0]?.message?.content ?? ''

    // Clean up: trim whitespace, strip markdown backticks/quotes
    corrected = corrected.trim()
    corrected = corrected.replace(/^```[\s\S]*?\n?|```$/g, '').trim()
    corrected = corrected.replace(/^["'`]+|["'`]+$/g, '').trim()

    // Validation
    if (corrected === sentence) return null
    if (wordCount(corrected) !== wordCount(sentence)) return null
    if (Math.abs(corrected.length - sentence.length) / sentence.length > 0.3) return null

    return corrected
  } catch {
    return null
  } finally {
    inFlight = false
  }
}
