import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { ALLOWED_ORIGINS } from './shared/cors.js'
import { makeRateLimiter } from './shared/rateLimit.js'
import { OPENAI_CHAT_MODEL } from './shared/models.js'
import { openAiKey } from './shared/secrets.js'
import { verifyAuthWithRole } from './shared/auth.js'
import { checkAndReserve, reconcile, type QuotaConfig } from './shared/quota.js'
import { CRISIS_RESPONSE_FORMAT, classifyByConsensus, parseCrisisVote, type CrisisVote } from './shared/crisisClassifier.js'

// Smaller/faster model for the crisis classifier (task: 'crisis_check'). Sized
// for a near-binary judgment with minimal latency — the safety path runs in
// parallel with therapist generation, so cold-start + reasoning slack on the
// main model is unacceptable here.
const OPENAI_CRISIS_MODEL = 'gpt-5-nano'

// Structured-output schema for the session signal classifier (task:
// 'signal_check'). Withdrawal/rumination tiers are documented in
// src/ai/signalClassifierPrompt.ts. Entirely separate from the crisis route —
// same model + limits, different prompt/schema, so the crisis calibration
// can't drift.
const SIGNAL_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'session_signals',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        withdrawal: { type: 'integer', enum: [0, 1, 2] },
        rumination: { type: 'integer', enum: [0, 1, 2] },
        theme: { type: 'string' },
      },
      required: ['withdrawal', 'rumination', 'theme'],
    },
  },
} as const

// gpt-5 reasoning models budget hidden reasoning + visible output against the
// SAME max_completion_tokens. With reasoning_effort='minimal' the model still
// uses some reasoning tokens; 500 leaves comfortable headroom for the small
// JSON output. 80 was empirically too tight — output came back empty with
// finish_reason='length' because reasoning consumed the entire budget.
const CRISIS_MAX_TOKENS = 500

// Crisis classifier always requests minimal reasoning. The classification is
// near-binary; spending tokens on hidden reasoning starves the visible output.
// gpt-5-nano rejects 'none' here — supported values are minimal/low/medium/high.
const CRISIS_REASONING = 'minimal' as const

// On reasoning models (gpt-5.x), max_completion_tokens budgets BOTH hidden
// reasoning tokens and visible output. 500 was enough for Claude Sonnet's JSON
// reflection output, but gpt-5.5 burns 1k–3k reasoning tokens before emitting
// any output, so reflection-style calls were silently truncated. 4000 leaves
// comfortable headroom for the largest reflection JSON plus reasoning.
const MAX_TOKENS_CAP = 4000
const MAX_MESSAGE_CHARS = 8000
const MAX_MESSAGES = 50

// Request-size bounds (TECH_ISSUES_2026-10-14 #17). Input tokens are billed,
// so app-built system/assistant content needs a ceiling too. Sized well above
// real traffic: the therapist system prompt is ~20-30k chars (Room voice
// instructions built from it were observed at ~24k), history is windowed to
// 48 turns, and user turns are already capped at MAX_MESSAGE_CHARS.
export const MAX_SYSTEM_CHARS = 64_000
export const MAX_ASSISTANT_CHARS = 32_000
// UTF-8 bytes across all message contents. Bytes, not chars, so CJK-heavy
// sessions are measured by what is actually sent.
export const MAX_REQUEST_BYTES = 512 * 1024

// Classifier routes (crisis_check / signal_check) stay quota-exempt, so their
// shape is pinned: exactly [system, user]. The crisis prompt is ~11k chars and
// the client samples at most ~1k (crisis) / 2.4k (signal) chars of writing.
// The crisis prompt must stay under CLASSIFIER_MAX_SYSTEM_CHARS or L2 would
// fail open; crisisClassifier size is pinned by a test.
export const CLASSIFIER_MAX_SYSTEM_CHARS = 24_000
export const CLASSIFIER_MAX_USER_CHARS = 4_000

// Autocorrect (task: 'autocorrect') corrects one finished sentence on the
// small model. Same pinned [system, user] shape as the classifiers, sized for
// its short prompt (~450 chars plus a language line) and one sentence of at
// most ~1k chars inside <user_sentence> tags (src/ai/llmCorrect.ts).
export const AUTOCORRECT_MAX_SYSTEM_CHARS = 1_200
export const AUTOCORRECT_MAX_USER_CHARS = 1_200
// Minimal reasoning still spends some hidden tokens; 600 covers that plus a
// corrected sentence. A cut-off reply fails the client's length check and is
// dropped, never applied.
export const AUTOCORRECT_MAX_TOKENS = 600

/** A route whose request shape is pinned to exactly [system, user]. */
export interface PinnedShape {
  maxSystemChars: number
  maxUserChars: number
  /** Error code for a request that is not exactly [system, user]. */
  invalidCode: string
}

export const CLASSIFIER_SHAPE: PinnedShape = {
  maxSystemChars: CLASSIFIER_MAX_SYSTEM_CHARS,
  maxUserChars: CLASSIFIER_MAX_USER_CHARS,
  invalidCode: 'invalid_classifier_request',
}

export const AUTOCORRECT_SHAPE: PinnedShape = {
  maxSystemChars: AUTOCORRECT_MAX_SYSTEM_CHARS,
  maxUserChars: AUTOCORRECT_MAX_USER_CHARS,
  invalidCode: 'invalid_autocorrect_request',
}

type ChatRole = 'system' | 'user' | 'assistant'
interface ChatMessage {
  role: ChatRole
  content: string
}
const CHAT_ROLES: ReadonlySet<string> = new Set<ChatRole>(['system', 'user', 'assistant'])

export type ChatValidation =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; status: number; body: { error: string; code?: string } }

function reject(status: number, error: string, code?: string): ChatValidation {
  return { ok: false, status, body: code ? { error, code } : { error } }
}

// Pure request validation. Returns sanitized {role, content} messages so extra
// client-supplied fields never reach OpenAI.
//
// Role order: exactly one system message, first; the last message must come
// from the user. Strict user/assistant alternation is deliberately NOT
// enforced: the companion does not answer every pause, so real sessions
// contain consecutive user turns (and deterministic companion messages create
// consecutive assistant turns). buildTherapistMessages forwards them as-is.
export function validateChatMessages(raw: unknown, pinned: PinnedShape | null): ChatValidation {
  if (!Array.isArray(raw) || raw.length === 0) return reject(400, 'Invalid messages')
  if (raw.length > MAX_MESSAGES) return reject(400, `Too many messages (max ${MAX_MESSAGES})`)

  const messages: ChatMessage[] = []
  for (const msg of raw as unknown[]) {
    const candidate = msg as { role?: unknown; content?: unknown } | null
    if (!candidate || typeof candidate.role !== 'string' || typeof candidate.content !== 'string') {
      return reject(400, 'Invalid message format')
    }
    if (!CHAT_ROLES.has(candidate.role)) return reject(400, 'Invalid message format', 'invalid_role')
    // User-authored turns keep their original limit and error.
    if (candidate.role === 'user' && candidate.content.length > MAX_MESSAGE_CHARS) {
      return reject(400, `Message too long (max ${MAX_MESSAGE_CHARS} chars)`)
    }
    messages.push({ role: candidate.role as ChatRole, content: candidate.content })
  }

  if (pinned) {
    if (messages.length !== 2 || messages[0].role !== 'system' || messages[1].role !== 'user') {
      return reject(400, 'Invalid request shape', pinned.invalidCode)
    }
    if (messages[0].content.length > pinned.maxSystemChars
      || messages[1].content.length > pinned.maxUserChars) {
      return reject(413, 'Request too large', 'request_too_large')
    }
    return { ok: true, messages }
  }

  let totalBytes = 0
  for (const msg of messages) {
    if (msg.role === 'system' && msg.content.length > MAX_SYSTEM_CHARS) {
      return reject(413, 'Request too large', 'request_too_large')
    }
    if (msg.role === 'assistant' && msg.content.length > MAX_ASSISTANT_CHARS) {
      return reject(413, 'Request too large', 'request_too_large')
    }
    totalBytes += Buffer.byteLength(msg.content, 'utf8')
  }
  if (totalBytes > MAX_REQUEST_BYTES) return reject(413, 'Request too large', 'request_too_large')

  const systemCount = messages.filter(m => m.role === 'system').length
  if (messages[0].role !== 'system' || systemCount !== 1 || messages[messages.length - 1].role !== 'user') {
    return reject(400, 'Invalid message order', 'invalid_message_order')
  }
  return { ok: true, messages }
}

const checkRateLimit = makeRateLimiter({ windowMs: 60_000, max: 30 })
// The pinned classifier routes (crisis_check, signal_check) have their own
// per-user limiter. With one shared limiter, classifier traffic and companion
// traffic could starve each other, and a 429 on Talk's standalone crisis check
// fails open to risk 0 on the client. A tripped limit returns RATE_LIMITED_CODE
// so callers can tell it apart from other failures and back off.
const checkClassifierRateLimit = makeRateLimiter({ windowMs: 60_000, max: 20 })
export const RATE_LIMITED_CODE = 'rate_limited'

// Quota config is read from appConfig/global and cached in-instance so we don't
// add a Firestore read to every chat request. 60s TTL: admin changes propagate
// within a minute, which is fine for a monthly cost cap.
const QUOTA_CONFIG_TTL_MS = 60_000
let quotaConfigCache: { value: QuotaConfig; fetchedAt: number } | null = null
async function loadQuotaConfig(nowMs: number): Promise<QuotaConfig> {
  if (quotaConfigCache && nowMs - quotaConfigCache.fetchedAt < QUOTA_CONFIG_TTL_MS) {
    return quotaConfigCache.value
  }
  let value: QuotaConfig = { enabled: false, monthlyTokenCap: 0 }
  try {
    const snap = await getFirestore().collection('appConfig').doc('global').get()
    const q = snap.get('quota') as Partial<QuotaConfig> | undefined
    if (q && typeof q.enabled === 'boolean') {
      value = {
        enabled: q.enabled,
        monthlyTokenCap: typeof q.monthlyTokenCap === 'number' ? q.monthlyTokenCap : 0,
        perRoleCaps: q.perRoleCaps,
      }
    }
  } catch {
    // Fail open: a config read error must never block chat. Default disabled.
  }
  quotaConfigCache = { value, fetchedAt: nowMs }
  return value
}

export interface StreamCounters {
  contentTokens: number
  finishReason: string | null
  completionTokens: number | null
  promptTokens: number | null
  reasoningTokens: number | null
}

// Updates the counters in-place from one parsed SSE data line. Silently
// ignores malformed JSON — the raw bytes are forwarded to the client
// regardless. The `usage` frame only arrives because streamed requests set
// stream_options.include_usage; it carries the real completion and prompt
// token counts that settle the quota reservation.
export function ingestStreamLine(line: string, counters: StreamCounters): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data: ')) return
  const data = trimmed.slice(6)
  if (data === '[DONE]') return

  let parsed: {
    choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      completion_tokens_details?: { reasoning_tokens?: number }
    } | null
  }
  try {
    parsed = JSON.parse(data)
  } catch {
    return
  }

  const delta = parsed.choices?.[0]?.delta?.content
  if (typeof delta === 'string' && delta.length > 0) counters.contentTokens++

  const fr = parsed.choices?.[0]?.finish_reason
  if (fr) counters.finishReason = fr

  const usage = parsed.usage
  if (!usage) return
  if (typeof usage.completion_tokens === 'number') {
    counters.completionTokens = usage.completion_tokens
  }
  if (typeof usage.prompt_tokens === 'number') {
    counters.promptTokens = usage.prompt_tokens
  }
  const rt = usage.completion_tokens_details?.reasoning_tokens
  if (typeof rt === 'number') counters.reasoningTokens = rt
}

// The crisis check asks three times at once and answers with the majority
// (`classifyByConsensus`, folio-build-plan §8.G). The client still reads one
// completion: the decided vote as its message content. The deadline sits
// under the browser's 5 s abort, so the votes in hand are always returned
// before the client gives up.
export const CRISIS_DEADLINE_MS = 4_000

export interface CrisisCheckOutcome {
  vote: CrisisVote | null
  votes: number
  failures: number
  /** The first non-OK upstream status, for the all-failed response. */
  upstreamStatus: number | null
}

export async function runCrisisCheck(
  messages: unknown,
  apiKey: string,
  signal: AbortSignal,
  deadlineMs = CRISIS_DEADLINE_MS,
): Promise<CrisisCheckOutcome> {
  let votes = 0
  let failures = 0
  let upstreamStatus: number | null = null
  const body = JSON.stringify({
    model: OPENAI_CRISIS_MODEL,
    messages,
    max_completion_tokens: CRISIS_MAX_TOKENS,
    stream: false,
    reasoning_effort: CRISIS_REASONING,
    response_format: CRISIS_RESPONSE_FORMAT,
  })
  const vote = await classifyByConsensus(async (callSignal) => {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: callSignal,
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
      })
      if (!response.ok) {
        upstreamStatus ??= response.status
        failures += 1
        return null
      }
      const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
      const parsed = parseCrisisVote(data?.choices?.[0]?.message?.content)
      if (parsed) votes += 1
      else failures += 1
      return parsed
    } catch {
      if (!callSignal.aborted) failures += 1
      return null
    }
  }, { signal, deadlineMs })
  return { vote, votes, failures, upstreamStatus }
}

export const chat = onRequest(
  {
    secrets: [openAiKey],
    cors: ALLOWED_ORIGINS,
    memory: '512MiB',
    minInstances: 1,
    // 300s — gpt-5.5 reasoning calls are unpredictable. Diagnostic logging tells
    // us actual latency; bumping the ceiling here removes server timeout as a suspect.
    timeoutSeconds: 300,
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const authed = await verifyAuthWithRole(req.headers.authorization)
    if (!authed) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { uid, role } = authed

    // Rate limit: classifier routes and everything else are counted separately.
    const requestedTask = (req.body || {}).task
    const isClassifierRoute = requestedTask === 'crisis_check' || requestedTask === 'signal_check'
    const withinLimit = isClassifierRoute ? checkClassifierRateLimit(uid) : checkRateLimit(uid)
    if (!withinLimit) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.', code: RATE_LIMITED_CODE })
      return
    }

    // Validate request body. Client-supplied `model` is ignored — model is fixed
    // server-side. `temperature` is also ignored: GPT-5.x reasoning models only
    // accept the default (1.0), and OpenAI rejects custom values for this family.
    //
    // `task` is an optional routing parameter. 'crisis_check' switches to the
    // smaller classifier model with structured-output enforcement, forces
    // non-streaming and asks three times (runCrisisCheck). 'autocorrect' also runs on the small model, non-streamed,
    // with minimal reasoning and a small token cap. Anything else falls
    // through to the standard chat path.
    const { messages, max_tokens, stream, reasoning_effort, task } = req.body || {}
    const ALLOWED_REASONING = new Set(['none', 'low', 'medium', 'high', 'xhigh'])
    const resolvedReasoning = typeof reasoning_effort === 'string' && ALLOWED_REASONING.has(reasoning_effort)
      ? reasoning_effort
      : undefined
    const isCrisisCheck = task === 'crisis_check'
    // signal_check routes like crisis_check (nano, minimal reasoning, strict
    // schema, non-streaming) but with its own prompt + schema.
    const isSignalCheck = task === 'signal_check'
    const isClassifierTask = isCrisisCheck || isSignalCheck
    // Autocorrect used to send a client `model` this function ignores, so it
    // ran on the main model and spent quota on gpt-5.5. Unlike the
    // classifiers it is a user-facing convenience, so it stays quota-counted.
    const isAutocorrect = task === 'autocorrect'
    const isSmallModelTask = isClassifierTask || isAutocorrect
    const validation = validateChatMessages(
      messages,
      isClassifierTask ? CLASSIFIER_SHAPE : isAutocorrect ? AUTOCORRECT_SHAPE : null,
    )
    if (!validation.ok) {
      if (validation.body.code) {
        console.warn(`[chat] rejected uid=${uid.slice(0, 8)} task=${task ?? 'chat'} code=${validation.body.code ?? 'invalid'}`)
      }
      res.status(validation.status).json(validation.body)
      return
    }
    const sanitizedMessages = validation.messages

    const modelForRequest = isSmallModelTask ? OPENAI_CRISIS_MODEL : OPENAI_CHAT_MODEL
    const streamForRequest = !isSmallModelTask && !!stream
    const resolvedMaxTokens = isClassifierTask
      ? CRISIS_MAX_TOKENS
      : isAutocorrect
        ? AUTOCORRECT_MAX_TOKENS
        : Math.min(
          typeof max_tokens === 'number' && max_tokens > 0 ? max_tokens : 150,
          MAX_TOKENS_CAP,
        )
    const reqStart = Date.now()
    const tag = `uid=${uid.slice(0, 8)} model=${modelForRequest} task=${task ?? 'chat'} stream=${streamForRequest} max_tokens=${resolvedMaxTokens} reasoning=${resolvedReasoning ?? 'default'}`
    console.log(`[chat] start ${tag}`)

    // Durable monthly token quota. Crisis checks are ALWAYS exempt — a safety
    // classification must never be blocked by a spend cap. Signal checks are
    // exempt too: app-initiated, server-bounded (nano + 500 cap), still behind
    // the rate limiter, and only ever fired alongside quota-gated chat turns.
    // Reserve this request's maximum completion-token spend up front;
    // reconcile the unused portion after the response so the cap is a hard
    // ceiling under concurrency.
    const now = new Date()
    let quotaReservation: Awaited<ReturnType<typeof checkAndReserve>> | null = null
    if (!isClassifierTask) {
      const quotaConfig = await loadQuotaConfig(now.getTime())
      if (quotaConfig.enabled) {
        quotaReservation = await checkAndReserve({
          uid, role, config: quotaConfig, reserveTokens: resolvedMaxTokens, now,
        })
        if (!quotaReservation.allowed) {
          console.warn(`[chat] quota-block ${tag} used=${quotaReservation.used} cap=${quotaReservation.cap}`)
          res.status(429).json({
            error: 'You have reached your monthly usage limit. It resets at the start of next month.',
            code: 'quota_exceeded',
          })
          return
        }
      }
    }
    // Refund the unused part of the reservation once we know actual usage,
    // and meter the prompt tokens (tracked separately, not capped; see
    // shared/quota.ts). Unknown completion usage (client disconnect before
    // the usage frame) keeps the full reservation, the safe direction.
    const settleQuota = (actualCompletionTokens: number | null, promptTokens: number | null) => {
      if (!quotaReservation?.reserved) return
      void reconcile({
        uid,
        reservedTokens: quotaReservation.reserved,
        actualTokens: actualCompletionTokens ?? quotaReservation.reserved,
        promptTokens,
        now,
      })
    }

    // Abort the upstream OpenAI request if the client goes away. Without this,
    // an abandoned tab (or a client-side crisis abort) still billed the model to
    // completion. `res.on('close')` fires when the HTTP connection ends before
    // we finish writing.
    const upstreamAbort = new AbortController()
    let clientGone = false
    // `res` is a Node stream in production; guard for lightweight test doubles.
    if (typeof res.on === 'function') {
      res.on('close', () => {
        if (!res.writableEnded) {
          clientGone = true
          upstreamAbort.abort()
        }
      })
    }

    if (isCrisisCheck) {
      const outcome = await runCrisisCheck(sanitizedMessages, openAiKey.value(), upstreamAbort.signal)
      const summary = `votes=${outcome.votes} failures=${outcome.failures} totalMs=${Date.now() - reqStart}`
      if (clientGone) {
        console.warn(`[chat] client-gone ${tag} ${summary}`)
        return
      }
      if (!outcome.vote) {
        console.error(`[chat] error ${tag} ${summary} upstream=${outcome.upstreamStatus ?? 'none'}`)
        res.status(outcome.upstreamStatus ?? 502).json({ error: 'AI service temporarily unavailable' })
        return
      }
      console.log(`[chat] done ${tag} ${summary}`)
      res.json({
        object: 'chat.completion',
        model: OPENAI_CRISIS_MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(outcome.vote) }, finish_reason: 'stop' }],
      })
      return
    }

    const openAiResponse = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        signal: upstreamAbort.signal,
        headers: {
          'Authorization': `Bearer ${openAiKey.value()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelForRequest,
          messages: sanitizedMessages,
          max_completion_tokens: resolvedMaxTokens,
          stream: streamForRequest,
          // Without this a streamed response carries no usage, so every
          // streamed turn was charged its whole reservation (#16). The extra
          // final chunk has `choices: []`, which the client already ignores.
          ...(streamForRequest ? { stream_options: { include_usage: true } } : {}),
          // Small-model tasks hardcode reasoning_effort='minimal' (the
          // budget is for visible output, not hidden reasoning). Other tasks
          // pass the client-supplied value through unchanged.
          ...(isSmallModelTask
            ? { reasoning_effort: CRISIS_REASONING }
            : (resolvedReasoning ? { reasoning_effort: resolvedReasoning } : {})),
          ...(isSignalCheck ? { response_format: SIGNAL_RESPONSE_FORMAT } : {}),
        }),
      },
    )

    const headersMs = Date.now() - reqStart

    if (!openAiResponse.ok) {
      const errorBody = await openAiResponse.text().catch(() => '')
      console.error(`[chat] error ${tag} status=${openAiResponse.status} headersMs=${headersMs}`, errorBody)
      settleQuota(0, null) // upstream refused — refund the whole reservation
      res.status(openAiResponse.status).json({
        error: 'AI service temporarily unavailable',
      })
      return
    }

    if (streamForRequest && openAiResponse.body) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('X-Accel-Buffering', 'no')

      const MAX_STREAM_BYTES = 1_048_576 // 1 MiB safety cap
      let totalBytes = 0
      let buffer = ''
      const counters: StreamCounters = {
        contentTokens: 0,
        finishReason: null,
        completionTokens: null,
        promptTokens: null,
        reasoningTokens: null,
      }
      const decoder = new TextDecoder()
      const reader = openAiResponse.body.getReader()
      // Emit a machine-readable truncation frame so the client can tell a
      // cut-off stream apart from a clean finish (a mid-stream break otherwise
      // looks identical to normal completion). The client treats any SSE data
      // object carrying an `error` field as a failed generation.
      let truncated: string | null = null
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (clientGone) { truncated = null; break }
          totalBytes += value.byteLength
          if (totalBytes > MAX_STREAM_BYTES) {
            console.warn(`[chat] stream-cap ${tag} bytes=${totalBytes}, aborting`)
            truncated = 'length_cap'
            break
          }

          // Inspect SSE chunks for diagnostic counters before forwarding. The
          // bytes are still piped verbatim — this only adds CPU. Catches the
          // "zero content tokens" failure mode that looks like a happy 608-byte
          // stream in raw-byte logs.
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) ingestStreamLine(line, counters)

          res.write(value)
        }
      } catch (streamErr) {
        // Upstream read failed mid-stream (network drop, upstream 5xx after
        // headers). If the client is still connected, tell it explicitly.
        if (!clientGone) {
          truncated = 'upstream_error'
          console.error(`[chat] stream-error ${tag}`, streamErr)
        }
      } finally {
        if (truncated && !clientGone && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: { type: truncated } })}\n\n`)
        }
        if (!res.writableEnded) res.end()
      }
      // A final frame without a trailing newline still carries usage.
      if (buffer) ingestStreamLine(buffer, counters)
      settleQuota(counters.completionTokens, counters.promptTokens)
      const empty = counters.contentTokens === 0
      const logFn = empty ? console.warn : console.log
      logFn(
        `[chat] done ${tag} bytes=${totalBytes} totalMs=${Date.now() - reqStart}` +
        ` contentTokens=${counters.contentTokens} finish=${counters.finishReason}` +
        ` promptTok=${counters.promptTokens} compTok=${counters.completionTokens} reasonTok=${counters.reasoningTokens}` +
        (empty ? ' EMPTY_COMPLETION' : ''),
      )
    } else {
      const data = await openAiResponse.json()
      const finishReason = data?.choices?.[0]?.finish_reason
      const contentLen = (data?.choices?.[0]?.message?.content || '').length
      const usage = data?.usage
      settleQuota(
        typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
        typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
      )
      console.log(`[chat] done ${tag} headersMs=${headersMs} totalMs=${Date.now() - reqStart} finish=${finishReason} contentLen=${contentLen} promptTok=${usage?.prompt_tokens} compTok=${usage?.completion_tokens} reasonTok=${usage?.completion_tokens_details?.reasoning_tokens}`)
      res.json(data)
    }
  },
)
