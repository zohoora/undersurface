// The chat function rejects a request outright when it breaks one of its size
// limits (functions/src/chat.ts, validateChatMessages): a user message over
// 8,000 characters is a 400, and so is more than 50 messages; over 512 KiB of
// UTF-8 is a 413. Nothing trimmed on the way out, so one long Talk message (a
// pasted letter, a long Journal page) made every later turn in that session
// fail until it left the 48-turn window, and Journal parts went silent on a
// long page. fitToServerLimits is applied to every /api/chat request built by
// chatCompletion and streamChatCompletion.
//
// These mirror the server's values; requestLimits.test.ts pins them to
// functions/src/chat.ts so the two cannot drift apart.
export const SERVER_MAX_USER_CHARS = 8_000
export const SERVER_MAX_ASSISTANT_CHARS = 32_000
export const SERVER_MAX_MESSAGES = 50
export const SERVER_MAX_REQUEST_BYTES = 512 * 1024

// Headroom so a message trimmed here is never the one the server rejects.
const USER_BUDGET = SERVER_MAX_USER_CHARS - 100
const ASSISTANT_BUDGET = SERVER_MAX_ASSISTANT_CHARS - 100
const REQUEST_BYTES_BUDGET = SERVER_MAX_REQUEST_BYTES - 8 * 1024
// The opening sets the context; the ending is what the writer said last.
const HEAD_SHARE = 0.3

export interface LimitedMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const omittedNote = (count: number) => `\n\n[… ${count} characters left out here to fit the request …]\n\n`

// Never cut between the two halves of a surrogate pair (an emoji, many CJK
// extension characters): a lone half would reach the model as garbage.
function safeCut(text: string, index: number): number {
  const code = text.charCodeAt(index)
  return code >= 0xdc00 && code <= 0xdfff ? index - 1 : index
}

/** Keep the opening and the ending of `content` within `budget` characters. */
export function trimToBudget(content: string, budget: number): string {
  if (content.length <= budget) return content
  // The note's own length depends on the count it reports; size it for the
  // largest count it could show.
  const room = budget - omittedNote(content.length).length
  const head = safeCut(content, Math.floor(room * HEAD_SHARE))
  const tailStart = safeCut(content, content.length - (room - head))
  return content.slice(0, head) + omittedNote(tailStart - head) + content.slice(tailStart)
}

const encoder = new TextEncoder()
const bytesOf = (messages: LimitedMessage[]) =>
  messages.reduce((sum, m) => sum + encoder.encode(m.content).length, 0)

/**
 * Fit a chat request inside the server's limits: trim over-long user and
 * assistant messages, then drop the oldest history (never a system message,
 * never the last message) while the request has too many messages or bytes.
 * Returns the same array when nothing needed changing.
 */
export function fitToServerLimits<T extends LimitedMessage>(messages: T[]): T[] {
  let changed = false
  const fitted = messages.map((m) => {
    const budget = m.role === 'user' ? USER_BUDGET : m.role === 'assistant' ? ASSISTANT_BUDGET : Infinity
    if (m.content.length <= budget) return m
    changed = true
    return { ...m, content: trimToBudget(m.content, budget) }
  })

  let bytes = bytesOf(fitted)
  while (fitted.length > 2 && (fitted.length > SERVER_MAX_MESSAGES || bytes > REQUEST_BYTES_BUDGET)) {
    const oldest = fitted.findIndex((m) => m.role !== 'system')
    if (oldest === -1 || oldest === fitted.length - 1) break
    bytes -= encoder.encode(fitted[oldest].content).length
    fitted.splice(oldest, 1)
    changed = true
  }
  return changed ? fitted : messages
}
