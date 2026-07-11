import { apiUrl } from '../api/apiBase'
import { getAuthToken } from '../api/authedFetch'
import { CRISIS_CLASSIFIER_PROMPT } from './crisisClassifierPrompt'
import { SIGNAL_CLASSIFIER_PROMPT } from './signalClassifierPrompt'
import { engineLog } from '../services/diagnostics'
import type { AmbientTurnAssessment } from '../types'

export type CrisisRisk = 0 | 1 | 2

export interface CrisisRiskResult {
  risk: CrisisRisk
  reason?: string
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Turn a non-2xx chat response into a user-facing message. The proxy sends a
// JSON body with a human-readable `error` (e.g. the monthly-quota notice); use
// it verbatim when present so the UI shows the real reason instead of a raw
// "API error: 429". Falls back to a generic status string.
export function friendlyApiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed.error === 'string' && parsed.error.length > 0) {
      return parsed.error
    }
  } catch {
    // non-JSON body — fall through to the generic form
  }
  return `API error: ${status}${body ? ` — ${body}` : ''}`
}

interface StreamCallbacks {
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
  // Fires at most once per call. Missing preamble → risk=0 (fail-open).
  onRisk?: (risk: CrisisRisk) => void
  onAmbientAssessment?: (assessment: AmbientTurnAssessment) => void
}

// Anchored — a stray `<<RISK:2>>` quoted later in the response does not
// retroactively trigger grounding. Tolerant of contents: matches any 1–8
// char payload between the colon and `>>`, then optional trailing
// whitespace. The marker is unambiguously complete at `>>` (the payload
// cannot contain `>`), so the match deliberately does NOT require a
// trailing newline — a leak shipped live on 2026-06-12 when the model
// emitted `<<RISK:N>> <response>` on one line and the then-required `\n+`
// could never match, sending the marker to the chat via fail-open. If the
// captured payload isn't '0' / '1' / '2' (e.g., the model echoed the
// literal placeholder `N`, or emitted an out-of-range digit), we still
// strip the preamble and fail open to risk=0 — the L1 regex in
// sessionOrchestrator is the deterministic safety floor, so falling open
// here doesn't disable safety. Malformations go to engineLog so model
// misbehavior is observable.
const RISK_PREAMBLE_PATTERN = /^<<RISK:([^;>]{1,8})(?:;FIT:([^;>]{1,16});MOVE:([^;>]{1,16});AGENCY:([^;>]{1,16});CONF:([^;>]{1,12});STATE:([^;>]{1,16});CAP:([^;>]{1,16});NEED:([^;>]{1,16}))?>>[ \t]*\n*/
// Last-resort scrub, applied only to the buffered stream prefix at
// fail-open flush time (never to later content, so quoted markers
// mid-response are untouched). Broader than the anchored pattern: tolerates
// markdown wrapping and longer payloads so a recognizable-but-mangled
// marker never reaches the chat window. A cleanly parseable digit still
// fires as the real risk — discarding a crisis signal the model actually
// produced would be worse than the formatting noise.
const RISK_MARKER_SCRUB = /^[\s`*_]{0,8}<<RISK:([^>]{1,240})>>[`*_]{0,8}[ \t]*\n*/
// A stream can end cleanly at the transport layer while the model is still
// halfway through its hidden preamble (for example because it reached its
// output cap). Treat that as a failed completion, not user-visible prose.
const INCOMPLETE_RISK_PREAMBLE = /^[\s`*_]{0,8}<<RISK:[^>]{0,320}$/
const PREAMBLE_FAIL_OPEN_CHARS = 320
// Abort a stream only after this long with no incoming data. Re-armed on every
// chunk, so it caps idle time (a stalled connection), not total duration.
const STREAM_IDLE_MS = 30000

// Display-time scrub for markers that escaped older parsers and were
// persisted to Firestore (e.g. the 2026-06-12 `<<RISK:N>>` leak), and for
// transcript sources that have no streaming parser (voice). Anchored to the
// start of the message — a marker quoted mid-text is untouched.
export function scrubLeakedRiskMarker(text: string): string {
  const match = text.match(RISK_MARKER_SCRUB)
  if (!match) return INCOMPLETE_RISK_PREAMBLE.test(text) ? '' : text
  return text.slice(match[0].length).replace(/^\s+/, '')
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

// Map a user-facing "response speed" multiplier (0.5 slow ↔ 2.0 fast) to a
// gpt-5.5 reasoning_effort tier. Faster = less hidden reasoning before output,
// so the response starts streaming sooner (at the cost of less deliberation).
// Default 1.0 lands in 'low' — same behavior as before this slider was wired.
export function reasoningForSpeed(speed: number): ReasoningEffort {
  if (speed <= 0.8) return 'medium'
  if (speed >= 1.5) return 'none'
  return 'low'
}

export async function chatCompletion(
  messages: Message[],
  timeoutMs: number = 10000,
  maxTokens: number = 150,
  reasoningEffort?: ReasoningEffort,
): Promise<string> {
  const token = await getAuthToken()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        max_tokens: maxTokens,
        temperature: 0.9,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(friendlyApiError(response.status, body))
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty response from OpenAI')
    return content
  } finally {
    clearTimeout(timeout)
  }
}

export async function streamChatCompletion(
  messages: Message[],
  callbacks: StreamCallbacks,
  maxTokens: number = 150,
  reasoningEffort?: ReasoningEffort,
  externalSignal?: AbortSignal,
): Promise<void> {
  try {
    const token = await getAuthToken()
    const controller = new AbortController()
    // Inactivity timeout, not a fixed wall-clock cap: a healthy long response
    // (or a reasoning model that pauses before its first token) must not be
    // aborted just for taking a while. The timer is re-armed on every chunk
    // that arrives, so it only fires after STREAM_IDLE_MS of genuine silence.
    let timeout!: ReturnType<typeof setTimeout>
    const armIdleTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => controller.abort(), STREAM_IDLE_MS)
    }
    armIdleTimeout()
    // External abort (e.g. crisis detected mid-stream) chains into the
    // internal controller so the in-flight fetch is cancelled cleanly.
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort()
      else externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    let response: Response
    try {
      response = await fetch(apiUrl('/api/chat'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages,
          max_tokens: maxTokens,
          temperature: 0.9,
          stream: true,
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        }),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      throw err
    }

    if (!response.ok) {
      clearTimeout(timeout)
      const body = await response.text().catch(() => '')
      throw new Error(friendlyApiError(response.status, body))
    }

    const reader = response.body?.getReader()
    if (!reader) {
      clearTimeout(timeout)
      throw new Error('No reader available')
    }

    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    let loopDetected = false
    let truncationError: string | null = null

    // Parser for the `<<RISK:N>>` preamble emitted by the therapist (see
    // RISK_PREAMBLE_INSTRUCTIONS). Buffer until match or fail-open threshold.
    // Only the session/therapist path passes onRisk AND instructs the model to
    // emit the marker; diary/parts prompts do neither. On those paths, start
    // "consumed" so short responses stream immediately instead of buffering up
    // to PREAMBLE_FAIL_OPEN_CHARS (an <80-char nudge otherwise appeared only at
    // stream end). Safe because those prompts never produce a marker to strip.
    let preambleConsumed = !callbacks.onRisk
    let preambleBuffer = ''
    // The match no longer consumes the preamble's trailing newlines when they
    // arrive in a later chunk, so the response is left-trimmed until its
    // first visible character.
    let contentStarted = false

    const fireRisk = (risk: CrisisRisk): void => {
      if (preambleConsumed) return
      preambleConsumed = true
      callbacks.onRisk?.(risk)
    }

    const parseRiskPayload = (captured: string): CrisisRisk | null =>
      captured.split(';')[0] === '0' || captured.split(';')[0] === '1' || captured.split(';')[0] === '2'
        ? parseInt(captured.split(';')[0], 10) as CrisisRisk
        : null

    const parseAmbientAssessment = (values: string[]): AmbientTurnAssessment | null => {
      const [fit, movement, agency, confidence, state, capacity, need] = values
      if (!['landed', 'partial', 'missed', 'unclear'].includes(fit)) return null
      if (!['deepened', 'clarified', 'settled', 'mobilized', 'stayed', 'withdrew', 'unclear'].includes(movement)) return null
      if (!['more', 'same', 'less', 'unclear'].includes(agency)) return null
      if (!['low', 'medium', 'high'].includes(confidence)) return null
      if (!['stirred', 'flat', 'looping', 'open', 'unclear'].includes(state)) return null
      if (!['brief', 'few_minutes', 'stay', 'unclear'].includes(capacity)) return null
      if (!['witness', 'settle', 'perspective', 'action', 'unclear'].includes(need)) return null
      return { fit, movement, agency, confidence, state, capacity, need } as AmbientTurnAssessment
    }

    // Categorize rather than log raw bytes — EngineLogContext.extra
    // contract forbids model output. Categories are enough to triage:
    // a spike in `literal_placeholder` means the prompt needs another
    // pass; `out_of_range_digit` means the model is hallucinating tiers.
    const logMalformed = (captured: string): void => {
      const lower = captured.trim().toLowerCase()
      const category = lower === 'n'
        ? 'literal_placeholder'
        : /^\d+$/.test(lower)
          ? 'out_of_range_digit'
          : 'other'
      engineLog('warn', 'stream.preamble_malformed', 'risk preamble had unexpected contents; stripping and failing open', {
        extra: { category, length: captured.length },
      })
    }

    const forward = (chunk: string): void => {
      if (!contentStarted) {
        chunk = chunk.replace(/^\s+/, '')
        if (!chunk) return
        contentStarted = true
      }
      fullText += chunk
      callbacks.onToken(chunk)
    }

    // Fail-open flush. Before surfacing the buffer, scrub any
    // recognizable-but-mangled marker prefix the anchored pattern could not
    // parse (markdown-wrapped, oversized payload, leading junk) — this is
    // the path the 2026-06-12 leak escaped through.
    const flushPreamble = (): void => {
      const scrub = preambleBuffer.match(RISK_MARKER_SCRUB)
      if (scrub) {
        logMalformed(scrub[1])
        fireRisk(parseRiskPayload(scrub[1].trim()) ?? 0)
        preambleBuffer = preambleBuffer.slice(scrub[0].length)
      } else {
        fireRisk(0)
      }
      if (controller.signal.aborted) return
      if (preambleBuffer) {
        forward(preambleBuffer)
        preambleBuffer = ''
      }
    }

    const processContent = (chunk: string): void => {
      if (controller.signal.aborted) return

      if (preambleConsumed) {
        forward(chunk)
        return
      }

      preambleBuffer += chunk
      const match = preambleBuffer.match(RISK_PREAMBLE_PATTERN)
      if (match) {
        const risk = parseRiskPayload(match[1])
        if (risk === null) logMalformed(match[1])
        if (match[2]) {
          const assessment = parseAmbientAssessment(match.slice(2, 9))
          if (assessment) callbacks.onAmbientAssessment?.(assessment)
          else engineLog('warn', 'stream.preamble_malformed', 'ambient preamble had unexpected enum values; ignoring assessment', { extra: { category: 'ambient_enum' } })
        }
        fireRisk(risk ?? 0)
        if (controller.signal.aborted) return
        const remainder = preambleBuffer.slice(match[0].length)
        preambleBuffer = ''
        if (remainder) forward(remainder)
        return
      }
      if (preambleBuffer.length > PREAMBLE_FAIL_OPEN_CHARS) {
        flushPreamble()
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // Data (or at least a live chunk) arrived — the stream isn't stalled.
        armIdleTimeout()

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            // The chat proxy emits `{ error: { type } }` when it truncates the
            // stream (length cap, upstream error) — surface it as a real failure
            // instead of letting a cut-off response look like a clean finish.
            // Flag it (the inner catch would swallow a throw here) and break.
            if (parsed.error) {
              truncationError = typeof parsed.error?.type === 'string' ? parsed.error.type : 'unknown'
              break
            }
            const token = parsed.choices?.[0]?.delta?.content
            if (token) {
              processContent(token)

              // Repetition loop detection: if the last 40 chars appear
              // earlier in the text, the model is stuck in a loop — abort.
              // fullText excludes the stripped preamble.
              if (fullText.length > 100) {
                const tail = fullText.slice(-40)
                const searchArea = fullText.slice(0, -40)
                if (searchArea.includes(tail)) {
                  engineLog('warn', 'stream.loop_detected', `repetition loop at ${fullText.length} chars; aborting stream`, {
                    extra: { textLength: fullText.length },
                  })
                  loopDetected = true
                  controller.abort()
                  break
                }
              }
            }
          } catch {
            // skip malformed JSON chunks
          }
        }

        if (loopDetected || truncationError) break
      }
    } finally {
      clearTimeout(timeout)
    }

    // A truncation frame from the proxy is a hard failure — route it to onError
    // (via the outer catch) rather than delivering the partial text as complete.
    if (truncationError) {
      throw new Error(`stream truncated by server: ${truncationError}`)
    }

    // A recognizable partial marker is never content. A nominally clean SSE
    // ending can still mean the model exhausted its output budget while
    // writing metadata; routing this through onError lets the session layer
    // make its existing empty-completion retry instead of persisting gibberish.
    if (!preambleConsumed && INCOMPLETE_RISK_PREAMBLE.test(preambleBuffer)) {
      engineLog('warn', 'stream.preamble_malformed', 'stream ended during risk preamble; retrying', {
        extra: { category: 'truncated_preamble', length: preambleBuffer.length },
      })
      throw new Error('stream ended during risk preamble')
    }

    // Fail-open if preamble never matched and we ended below the threshold.
    flushPreamble()

    // If loop detected, trim the repeated content
    if (loopDetected && fullText.length > 100) {
      const tail = fullText.slice(-40)
      const firstOccurrence = fullText.indexOf(tail)
      if (firstOccurrence >= 0 && firstOccurrence < fullText.length - 40) {
        fullText = fullText.slice(0, firstOccurrence + tail.length).trimEnd()
      }
    }

    callbacks.onComplete(fullText)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)))
  }
}

export async function analyzeEmotionAndDistress(text: string): Promise<{ emotion: string; distressLevel: number }> {
  const response = await chatCompletion([
    {
      role: 'system',
      content: `You analyze the emotional tone and distress level of diary writing. This is a journaling app where people process difficult emotions — that is normal and healthy, not distress. This writing may be in any language. Respond with valid JSON only, no other text:
{"emotion": "<one of: neutral, tender, anxious, angry, sad, joyful, contemplative, fearful, hopeful, conflicted>", "distress": <0-3>}

Distress scale (err on the side of LOW scores — processing hard feelings is not distress):
0 = no distress — normal writing, even if exploring sadness, anger, fear, or painful memories
1 = mild distress — venting frustration, expressing worry or unease, processing grief
2 = elevated distress — writer seems genuinely overwhelmed right now (not reflecting on past overwhelm), expressing hopelessness about the future, or describing an active panic episode
3 = safety concern — explicit mention of suicidal thoughts, self-harm urges, or intent to harm others. ONLY use 3 for clear safety-relevant language, not metaphor or dark imagery`,
    },
    {
      role: 'user',
      content: text.slice(-500),
    },
  ], 10000, 150, 'none')

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { emotion?: string; distress?: number }
      return {
        emotion: typeof parsed.emotion === 'string' ? parsed.emotion.trim().toLowerCase() : 'neutral',
        distressLevel: typeof parsed.distress === 'number' ? Math.min(3, Math.max(0, Math.round(parsed.distress))) : 0,
      }
    }
  } catch {
    // Parse failure — fall back to extracting emotion word
  }

  // Fallback: try to extract just an emotion word
  const lower = response.trim().toLowerCase()
  const validEmotions = ['neutral', 'tender', 'anxious', 'angry', 'sad', 'joyful', 'contemplative', 'fearful', 'hopeful', 'conflicted']
  const found = validEmotions.find((e) => lower.includes(e))
  return { emotion: found ?? 'neutral', distressLevel: 0 }
}

/**
 * Synchronous L2 crisis classifier — multilingual, narrow-by-construction.
 *
 * Calls the chat function with `task: 'crisis_check'`, which routes to a
 * smaller/faster model with structured-output enforcement. Risk tier semantics
 * are documented in crisisClassifierPrompt.ts.
 *
 * Fails open on timeout / network error / parse failure: returns {risk: 0}.
 * The L1 regex layer in sessionOrchestrator already ran by the time we get
 * here, so falling open leaves the existing safety net intact. The
 * alternative — bricking message send on transient API failure — is worse.
 *
 * Used by partOrchestrator for diary-mode crisis classification. In session
 * mode, L2 is folded into the therapist stream as a `<<RISK:N>>` preamble.
 */
export async function classifyCrisisRisk(
  text: string,
  language?: string,
): Promise<CrisisRiskResult> {
  const token = await getAuthToken()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  // Recent slice is enough — explicit ideation tends to appear in the most
  // recent paragraph, and a tighter input keeps latency + cost down.
  const sample = text.slice(-1000)
  const userContent = language && language !== 'en'
    ? `Language: ${language}\n\nText:\n${sample}`
    : sample

  try {
    const response = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task: 'crisis_check',
        messages: [
          { role: 'system', content: CRISIS_CLASSIFIER_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) return { risk: 0 }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return { risk: 0 }

    const parsed = JSON.parse(content) as { risk?: unknown; reason?: unknown }
    const risk = parsed.risk
    if (risk !== 0 && risk !== 1 && risk !== 2) return { risk: 0 }
    return {
      risk: risk as CrisisRisk,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    }
  } catch {
    return { risk: 0 }
  } finally {
    clearTimeout(timeout)
  }
}

export type SignalLevel = 0 | 1 | 2

export interface SessionSignalsResult {
  withdrawal: SignalLevel
  rumination: SignalLevel
  theme?: string
}

const SIGNAL_FAIL_OPEN: SessionSignalsResult = { withdrawal: 0, rumination: 0 }
const SIGNAL_MAX_MESSAGES = 6
const SIGNAL_MAX_CHARS = 2400
const SIGNAL_THEME_MAX_CHARS = 60

/**
 * Per-turn withdrawal/rumination classifier (task: 'signal_check' →
 * gpt-5-nano, structured output enforced server-side). Mirrors
 * classifyCrisisRisk's shape: 5s abort, fail-open to zeros — a missed signal
 * just means the companion carries on normally. Fire-and-forget from the
 * session stream; must never block or delay therapist generation.
 */
export async function classifySessionSignals(
  recentUserMessages: string[],
): Promise<SessionSignalsResult> {
  const token = await getAuthToken()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  // Last few messages, oldest→newest so the model reads the trend forward.
  const sample = recentUserMessages
    .slice(-SIGNAL_MAX_MESSAGES)
    .map((m, i) => `[${i + 1}] ${m}`)
    .join('\n')
    .slice(-SIGNAL_MAX_CHARS)

  try {
    const response = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task: 'signal_check',
        messages: [
          { role: 'system', content: SIGNAL_CLASSIFIER_PROMPT },
          { role: 'user', content: sample },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) return SIGNAL_FAIL_OPEN

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return SIGNAL_FAIL_OPEN

    const parsed = JSON.parse(content) as { withdrawal?: unknown; rumination?: unknown; theme?: unknown }
    const isLevel = (v: unknown): v is SignalLevel => v === 0 || v === 1 || v === 2
    if (!isLevel(parsed.withdrawal) || !isLevel(parsed.rumination)) return SIGNAL_FAIL_OPEN

    const theme = typeof parsed.theme === 'string' && parsed.theme.trim().length > 0
      ? parsed.theme.trim().slice(0, SIGNAL_THEME_MAX_CHARS)
      : undefined
    return { withdrawal: parsed.withdrawal, rumination: parsed.rumination, theme }
  } catch {
    return SIGNAL_FAIL_OPEN
  } finally {
    clearTimeout(timeout)
  }
}
