// L1 is deliberately narrower than the contextual L2 classifier. It catches
// explicit first-person methods/plans and unmistakable farewell-note framing;
// ambiguous language remains for L2 so grief, metaphor, recovery narratives,
// and ordinary hyperbole are not hard-grounded.
//
// Precision contract (TECH_ISSUES_2026-10-14 #5): L1 replaces a whole SMS reply
// with the fixed emergency text and hard-grounds a Talk session, so it must
// only fire on sincere, present, first-person method/plan statements. Three
// narrow guards send everything else on to L2 (which still runs on every
// path):
//   1. Pill patterns require an intent or overdose form ("going to take all
//      the pills", "took all my pills"), never routine medication talk.
//   2. Negation directly governing the method ("I would never kill myself",
//      "I'm not going to end my life") defers, unless the negation is itself
//      doubted ("not sure I won't…", "if I don't…").
//   3. Clearly historical attempts ("Five years ago I tried to end my life")
//      defer: past framing plus a temporal-distance marker in the same
//      sentence, no time word ("today", "tonight") in that sentence, and no
//      re-engagement ("again", "this time") anywhere in the text.
// Any other match of a method pattern still trips L1.

interface MethodPattern {
  re: RegExp
  /** The match is itself past tense ("took all my pills"), so the
   * distant-past guard needs only a distance marker, not separate past framing. */
  inherentlyPast?: boolean
}

const PILLS_OBJECT = String.raw`all\s+(?:of\s+)?(?:the|my|these|those)\s+(?:sleeping\s+)?pills\b`

// Routine adherence context right after a past-tense pill form. "I took all
// my pills this morning" is medication talk, not an overdose. Kept narrow on
// purpose: "all the pills for my anxiety" or "like candy" stay on L1.
const PILL_ADHERENCE_CONTEXT = String.raw`(?!\s+(?:today|yesterday|this\s+(?:morning|afternoon|evening|week)|on\s+time|as\s+(?:prescribed|directed|instructed)|for\s+the\s+(?:day|week)|like\s+(?:i|the\s+doctor)\b|as\s+(?:the|my)\s+doctor\b))`

const METHOD_PATTERNS: readonly MethodPattern[] = [
  { re: /\bkill\s+myself\b/gi },
  // "I want to kill me" (non-native phrasing) only with a first-person
  // subject: "my mom is going to want to kill me" is hyperbole about someone else.
  { re: /\bi\s+(?:(?:really|just|honestly|seriously|still|so|kinda|sometimes|often)\s+)*want\s+to\s+kill\s+me\b/gi },
  { re: /\bend\s+my\s+life\b/gi },
  { re: /\bcut\s+(?:myself|my\s+wrists?)\b/gi },
  { re: /\bhang\s+myself\b/gi },
  { re: /\bshoot\s+myself\b/gi },
  { re: /\bslit\s+(?:my\s+)?wrists?\b/gi },
  { re: /\bdrown\s+myself\b/gi },
  // Intent to overdose: an intent/modal/conditional verb + take/swallow + ALL
  // the pills. Bare "take the pills" ("I forgot to take the pills this
  // morning") is routine medication language and defers to L2.
  {
    re: new RegExp(
      String.raw`\b(?:going\s+to|gonna|about\s+to|want\s+to|wanna|plan(?:ning)?\s+to|ready\s+to|decided\s+to|will|would|['’]ll|['’]d|could|might|if\s+i)\s+(?:just\s+)?(?:take|swallow)\s+${PILLS_OBJECT}`,
      'gi',
    ),
  },
  // Overdose report: "I took / just swallowed all my pills".
  {
    re: new RegExp(
      String.raw`\bi\s+(?:(?:just|already)\s+)?(?:took|swallowed)\s+${PILLS_OBJECT}${PILL_ADHERENCE_CONTEXT}`,
      'gi',
    ),
    inherentlyPast: true,
  },
]

const FAREWELL_NOTE_PATTERN = /\bif\s+(?:anyone|you)\s+(?:ever\s+)?reads?\s+this(?:\s+(?:some\s*day|later))?\b(?=[\s\S]{0,240}\b(?:wasn['’]?t|isn['’]?t)\s+(?:your|their)\s+fault\b)(?=[\s\S]{0,240}\bi\s+(?:made|have\s+made)\s+(?:the|my)\s+(?:choice|decision)\b)/i

// Words that may sit between a negator and the method without changing who
// is doing what: "never ever", "not going to", "don't want to".
const GOVERNING_FILLERS = String.raw`(?:ever|really|actually|even|seriously|honestly|truly|want\s+to|wanna|going\s+to|gonna|plan(?:ning)?\s+to|try(?:ing)?\s+to|intend\s+to|be\s+able\s+to)`

// A negator that directly governs the text right before the match. `can't`,
// `shouldn't` and `didn't` are deliberately absent: "I can't even kill myself
// right" and "why didn't I just…" are not denials of intent.
const NEGATED_TAIL = new RegExp(
  String.raw`(?:\bnever|\bnot|\bno\s+longer|\bdon['’]?t|\bwon['’]?t|\bwouldn['’]?t)(?:[\s,]+${GOVERNING_FILLERS})*[\s,]*$`,
  'i',
)

// Doubt or condition wrapped around the negation turns it back into risk:
// "not sure I won't", "can't promise I won't", "if I don't…", "why not…".
const NEGATION_CANCELLERS = /\b(?:not\s+sure|unsure|don['’]?t\s+know|can['’]?t\s+promise|cannot\s+promise|no\s+guarantee|doubt|wonder(?:ing)?|if|unless|why|whether|what\s+if)\b/i

// Past framing that directly governs the match ("I tried to end my life").
const PAST_FRAMING_TAIL = new RegExp(
  String.raw`\b(?:tried|attempted|wanted|planned|thought\s+about|used\s+to(?:\s+want)?|almost|nearly)(?:[\s,]+(?:to|${GOVERNING_FILLERS}))*[\s,]*$`,
  'i',
)

// Clear temporal distance. Kept to unambiguous forms: bare "in college" is
// excluded because "I'm in college and…" is present tense.
const DISTANCE_MARKERS = /\b(?:(?:\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|many|several|a\s+few|a\s+couple(?:\s+of)?|some)\s+years?\s+ago|years\s+ago|decades?\s+ago|long\s+ago|used\s+to|back\s+(?:in|when|then)|when\s+i\s+was\s+(?:a\s+)?(?:kid|child|teen(?:ager)?|young(?:er)?|little|\d+|in\s+(?:high\s+school|middle\s+school|college|university))|as\s+a\s+(?:kid|child|teen(?:ager)?)|in\s+my\s+(?:teens|twenties|thirties|\d0s)|growing\s+up)\b/i

// Re-engagement anywhere in the text pulls a historical statement back into
// the present ("…and now I want to do it again", "This time I'll get it right").
const REENGAGEMENT_MARKERS = /\b(?:again|this\s+time)\b/i

// A time word keeps L1 only in the attempt's own sentence. "Ten years ago I
// tried to end my life. Today I ran my first half marathon." is a recovery
// story and defers to L2 (owner decision, folio-build-plan §8.G, 2026-10-16).
const RECENCY_MARKERS = /\b(?:tonight|today|yesterday|this\s+(?:morning|afternoon|evening|week)|last\s+(?:night|week)|right\s+now|just\s+now)\b/i

const CLAUSE_BREAK = /[.!?;\n]/
// A sentence for the time-word check: a semicolon doesn't end it.
const SENTENCE_BREAK = /[.!?\n]/

/** Normalize compatibility forms and defeat zero-width whitespace evasions. */
export function normalizeForCrisisDetection(text: string): string {
  // ZWJ/ZWNJ are deliberate here: they are an evasion class, not grapheme
  // joiners that need preserving for the narrow English hard floor.
  const evasiveWhitespace = /\u00A0|\u200B|\u200C|\u200D|\uFEFF|\u2060/g
  return text.normalize('NFKC').replace(evasiveWhitespace, ' ')
}

function lastBreakBefore(text: string, index: number, breaks: RegExp = CLAUSE_BREAK): number {
  for (let i = index - 1; i >= 0; i--) {
    if (breaks.test(text[i])) return i
  }
  return -1
}

function nextBreakFrom(text: string, index: number, breaks: RegExp = CLAUSE_BREAK): number {
  for (let i = index; i < text.length; i++) {
    if (breaks.test(text[i])) return i
  }
  return text.length
}

function isNegated(clauseBefore: string): boolean {
  const negatorIndex = clauseBefore.search(NEGATED_TAIL)
  if (negatorIndex < 0) return false
  const prefix = clauseBefore.slice(0, negatorIndex)
  const lastComma = prefix.lastIndexOf(',')
  const governingPrefix = lastComma >= 0 ? prefix.slice(lastComma + 1) : prefix
  return !NEGATION_CANCELLERS.test(governingPrefix)
}

function isDistantPast(
  text: string,
  clauseBefore: string,
  sentenceStart: number,
  matchEnd: number,
  inherentlyPast: boolean,
): boolean {
  if (!inherentlyPast && !PAST_FRAMING_TAIL.test(clauseBefore)) return false
  const sentence = text.slice(sentenceStart, nextBreakFrom(text, matchEnd))
  if (!DISTANCE_MARKERS.test(sentence)) return false
  if (REENGAGEMENT_MARKERS.test(text)) return false
  const fullSentence = text.slice(
    lastBreakBefore(text, sentenceStart, SENTENCE_BREAK) + 1,
    nextBreakFrom(text, matchEnd, SENTENCE_BREAK),
  )
  return !RECENCY_MARKERS.test(fullSentence)
}

function isUnguardedMethodMatch(
  text: string,
  matchStart: number,
  matchEnd: number,
  inherentlyPast: boolean,
): boolean {
  const sentenceStart = lastBreakBefore(text, matchStart) + 1
  const clauseBefore = text.slice(sentenceStart, matchStart)
  if (isNegated(clauseBefore)) return false
  if (isDistantPast(text, clauseBefore, sentenceStart, matchEnd, inherentlyPast)) return false
  return true
}

export function detectCrisisKeywords(text: string): boolean {
  const normalized = normalizeForCrisisDetection(text)
  if (FAREWELL_NOTE_PATTERN.test(normalized)) return true
  for (const { re, inherentlyPast } of METHOD_PATTERNS) {
    for (const match of normalized.matchAll(re)) {
      const start = match.index ?? 0
      if (isUnguardedMethodMatch(normalized, start, start + match[0].length, inherentlyPast === true)) {
        return true
      }
    }
  }
  return false
}
