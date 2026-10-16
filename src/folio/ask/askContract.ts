import type { CrisisCheck } from '../../ai/openrouter'

// The Ask contract (draft 4 §5.4): race the generation, gate the display.
// 1. L1 runs on the selection. A hit activates grounding; nothing is sent.
// 2. The L2 check and the reply start together; the reply is buffered, unseen.
// 3. The reply is shown only when L2 is classified below 2, or unavailable
//    (the shared fail-open).
// 4. Risk 2 before the reply is shown: the reply is discarded, grounding
//    activates, and a new reply is requested, built grounded. (The display
//    waits for L2, so a risk can't arrive after a note is shown.)
// 5. Grounding is read at call time and again before display.

export type AskOutcome =
  | { kind: 'note'; text: string; grounded: boolean }
  /** L1 matched: grounding is active and nothing was sent. */
  | { kind: 'grounded' }
  | { kind: 'failed' }
  | { kind: 'cancelled' }

export interface AskDeps {
  selection: string
  language: string
  l1: (text: string) => boolean
  check: (sample: string, language: string) => Promise<CrisisCheck>
  /** Generate the whole note into a buffer (never shown while generating). */
  generate: (grounded: boolean, signal: AbortSignal) => Promise<string>
  /** The shared grounding state, read at the moment it's needed. */
  isGrounding: () => boolean
  /** The Recent overlay: the grounded register without grounding (§5.5). */
  isRecent: () => boolean
  activate: () => void
  signal?: AbortSignal
}

export async function askForNote(d: AskDeps): Promise<AskOutcome> {
  if (d.signal?.aborted) return { kind: 'cancelled' }
  if (d.l1(d.selection)) {
    d.activate()
    return { kind: 'grounded' }
  }

  const groundedNow = () => d.isGrounding() || d.isRecent()
  const run = (grounded: boolean) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    d.signal?.addEventListener('abort', abort, { once: true })
    const text = d.generate(grounded, controller.signal).finally(() => d.signal?.removeEventListener('abort', abort))
    // A discarded reply's rejection is expected; never surface it.
    text.catch(() => {})
    return { text, controller, grounded }
  }

  let reply = run(groundedNow())
  const risk = await d.check(d.selection, d.language).catch((): CrisisCheck => ({ status: 'unavailable', cause: 'network' }))
  if (d.signal?.aborted) { reply.controller.abort(); return { kind: 'cancelled' } }

  if (risk.status === 'classified' && risk.risk === 2) {
    reply.controller.abort()
    d.activate()
    reply = run(true)
  }

  let text: string
  try {
    text = (await reply.text).trim()
  } catch {
    return d.signal?.aborted ? { kind: 'cancelled' } : { kind: 'failed' }
  }
  if (d.signal?.aborted) return { kind: 'cancelled' }

  // Before display: if grounding began while this reply was generated in the
  // normal register, it's replaced by a grounded one.
  if (!reply.grounded && groundedNow()) {
    reply = run(true)
    try {
      text = (await reply.text).trim()
    } catch {
      return d.signal?.aborted ? { kind: 'cancelled' } : { kind: 'failed' }
    }
  }
  if (!text) return { kind: 'failed' }
  return { kind: 'note', text, grounded: reply.grounded }
}
