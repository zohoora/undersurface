// Known targets that the therapist prompt teaches and SessionView dispatches on.
// `string & {}` preserves the union for autocomplete without collapsing to `string`,
// so the parser stays forward-compatible with unknown targets while the named members
// serve as inline documentation.
export type RecommendationTarget =
  | 'real-talk-on' | 'journal' | 'speak' | 'relax'
  | 'journal-arc' | 'speak-arc' | 'relax-arc' | 'drift-arc'
  | 'end-session'
  | (string & {})

export type RecommendationSegment =
  | { type: 'text'; text: string }
  | { type: 'recommendation'; phrase: string; target: RecommendationTarget }

const PATTERN = /\[([^\]]+)\]\(#(?:(?:switch:([\w-]+))|(end:session))\)/g

export function parseRecommendations(input: string): RecommendationSegment[] {
  const segments: RecommendationSegment[] = []
  let cursor = 0
  for (const match of input.matchAll(PATTERN)) {
    const start = match.index ?? 0
    if (start > cursor) {
      segments.push({ type: 'text', text: input.slice(cursor, start) })
    }
    segments.push({
      type: 'recommendation',
      phrase: match[1],
      target: match[3] ? 'end-session' : match[2],
    })
    cursor = start + match[0].length
  }
  if (cursor < input.length) {
    segments.push({ type: 'text', text: input.slice(cursor) })
  }
  return segments.length > 0 ? segments : [{ type: 'text', text: input }]
}
