// Companion-promise markers. The companion COMMITS via:
//   [phrase](#promise)              — due next session
//   [phrase](#promise:2026-08-01)   — due near a date
// and DELIVERS via:
//   [phrase](#kept-promise:<id>)
// No consent card — these are the companion's own commitments, recorded from
// the finalized message. Phrases render as plain text.
// Spec: docs/superpowers/specs/2026-07-04-companion-depth-program.md

const MAKE_PATTERN = /\[([^\]]+)\]\(#promise(?::(\d{4}-\d{2}-\d{2}))?\)/g
const KEPT_PATTERN = /\[([^\]]+)\]\(#kept-promise:([\w-]+)\)/g

export interface PromiseExtraction {
  cleanText: string
  made: { text: string; dueDate?: string }[]
  keptIds: string[]
}

export function extractPromiseMarkers(text: string): PromiseExtraction {
  const made: { text: string; dueDate?: string }[] = []
  const keptIds: string[] = []
  let cleanText = text.replace(MAKE_PATTERN, (_f, phrase: string, dueDate?: string) => {
    made.push({ text: phrase, dueDate })
    return phrase
  })
  cleanText = cleanText.replace(KEPT_PATTERN, (_f, phrase: string, id: string) => {
    keptIds.push(id)
    return phrase
  })
  return { cleanText, made, keptIds }
}
