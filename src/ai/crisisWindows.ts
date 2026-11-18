// The standalone L2 crisis check used to read only the last 1,000 characters
// of a turn (`text.slice(-1000)` in checkCrisisRisk). Distress stated earlier
// in a long Talk or Speak turn, or in a Journal page added to a session, got no
// L2 reading; only L1 (explicit plans) and the companion's fail-open in-band
// risk read covered it. Folio already checks every window of at most 1,000
// characters (src/folio/safety/samples.ts: SAMPLE_MAX, OVERLAP), and the owner
// chose the same for Sessions on 2026-11-18.

export const CRISIS_WINDOW_MAX = 1000
/** Same overlap as Folio's samples, so a sentence on a boundary is read whole. */
export const CRISIS_WINDOW_OVERLAP = 150

// Never start a window on the second half of a surrogate pair.
function safeStart(text: string, index: number): number {
  const code = text.charCodeAt(index)
  return index > 0 && code >= 0xdc00 && code <= 0xdfff ? index - 1 : index
}

/**
 * Windows of at most 1,000 characters that together cover all of `text`,
 * newest first. The first is exactly the last 1,000 characters (what the single
 * check always read, so a turn of 1,000 characters or fewer is one window, as
 * before); each earlier window overlaps the next by 150 characters.
 */
export function crisisWindows(text: string): string[] {
  if (text.length <= CRISIS_WINDOW_MAX) return [text]
  const step = CRISIS_WINDOW_MAX - CRISIS_WINDOW_OVERLAP
  const windows: string[] = []
  for (let end = text.length; ; end -= step) {
    const start = safeStart(text, Math.max(0, end - CRISIS_WINDOW_MAX))
    windows.push(text.slice(start, Math.min(text.length, start + CRISIS_WINDOW_MAX)))
    if (start === 0) break
  }
  return windows
}
