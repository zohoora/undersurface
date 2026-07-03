import { onRequest } from 'firebase-functions/v2/https'
import { ALLOWED_ORIGINS } from './shared/cors.js'
import { makeRateLimiter } from './shared/rateLimit.js'
import { OPENAI_CHAT_MODEL } from './shared/models.js'
import { openAiKey } from './shared/secrets.js'
import { verifyAuth } from './shared/auth.js'

// Smaller/faster model for the crisis classifier (task: 'crisis_check'). Sized
// for a near-binary judgment with minimal latency — the safety path runs in
// parallel with therapist generation, so cold-start + reasoning slack on the
// main model is unacceptable here.
const OPENAI_CRISIS_MODEL = 'gpt-5-nano'

// Structured-output schema for the crisis classifier. Lives server-side so the
// shape is enforced by the API, not by client-side JSON.parse heuristics. Risk
// tiers are documented in src/ai/crisisClassifierPrompt.ts and the eval set.
const CRISIS_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'crisis_risk',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        risk: { type: 'integer', enum: [0, 1, 2] },
        reason: { type: 'string' },
      },
      required: ['risk', 'reason'],
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

const checkRateLimit = makeRateLimiter({ windowMs: 60_000, max: 30 })

interface StreamCounters {
  contentTokens: number
  finishReason: string | null
  completionTokens: number | null
  reasoningTokens: number | null
}

// Updates the diagnostic counters in-place from one parsed SSE data line.
// Silently ignores malformed JSON — the raw bytes are forwarded to the client
// regardless; counters are best-effort observability, not correctness.
function ingestStreamLine(line: string, counters: StreamCounters): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data: ')) return
  const data = trimmed.slice(6)
  if (data === '[DONE]') return

  let parsed: {
    choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
    usage?: {
      completion_tokens?: number
      completion_tokens_details?: { reasoning_tokens?: number }
    }
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
  const rt = usage.completion_tokens_details?.reasoning_tokens
  if (typeof rt === 'number') counters.reasoningTokens = rt
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

    const uid = await verifyAuth(req.headers.authorization)
    if (!uid) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    // Rate limit
    if (!checkRateLimit(uid)) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.' })
      return
    }

    // Validate request body. Client-supplied `model` is ignored — model is fixed
    // server-side. `temperature` is also ignored: GPT-5.x reasoning models only
    // accept the default (1.0), and OpenAI rejects custom values for this family.
    //
    // `task` is an optional routing parameter. 'crisis_check' switches to the
    // smaller classifier model with structured-output enforcement and forces
    // non-streaming. Anything else falls through to the standard chat path.
    const { messages, max_tokens, stream, reasoning_effort, task } = req.body || {}
    const ALLOWED_REASONING = new Set(['none', 'low', 'medium', 'high', 'xhigh'])
    const resolvedReasoning = typeof reasoning_effort === 'string' && ALLOWED_REASONING.has(reasoning_effort)
      ? reasoning_effort
      : undefined
    const isCrisisCheck = task === 'crisis_check'
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Invalid messages' })
      return
    }

    if (messages.length > MAX_MESSAGES) {
      res.status(400).json({ error: `Too many messages (max ${MAX_MESSAGES})` })
      return
    }

    for (const msg of messages) {
      if (typeof msg.role !== 'string' || typeof msg.content !== 'string') {
        res.status(400).json({ error: 'Invalid message format' })
        return
      }
      // Only enforce length limit on user-authored messages — system/assistant
      // prompts are built by the app and legitimately exceed 8k chars
      if (msg.role === 'user' && msg.content.length > MAX_MESSAGE_CHARS) {
        res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_CHARS} chars)` })
        return
      }
    }

    const modelForRequest = isCrisisCheck ? OPENAI_CRISIS_MODEL : OPENAI_CHAT_MODEL
    const streamForRequest = !isCrisisCheck && !!stream
    const resolvedMaxTokens = isCrisisCheck
      ? CRISIS_MAX_TOKENS
      : Math.min(
        typeof max_tokens === 'number' && max_tokens > 0 ? max_tokens : 150,
        MAX_TOKENS_CAP,
      )
    const reqStart = Date.now()
    const tag = `uid=${uid.slice(0, 8)} model=${modelForRequest} task=${task ?? 'chat'} stream=${streamForRequest} max_tokens=${resolvedMaxTokens} reasoning=${resolvedReasoning ?? 'default'}`
    console.log(`[chat] start ${tag}`)

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
          messages,
          max_completion_tokens: resolvedMaxTokens,
          stream: streamForRequest,
          // Crisis classifier hardcodes reasoning_effort='minimal' (smaller
          // model needs the budget for visible output, not hidden reasoning).
          // Other tasks pass the client-supplied value through unchanged.
          ...(isCrisisCheck
            ? { reasoning_effort: CRISIS_REASONING }
            : (resolvedReasoning ? { reasoning_effort: resolvedReasoning } : {})),
          ...(isCrisisCheck ? { response_format: CRISIS_RESPONSE_FORMAT } : {}),
        }),
      },
    )

    const headersMs = Date.now() - reqStart

    if (!openAiResponse.ok) {
      const errorBody = await openAiResponse.text().catch(() => '')
      console.error(`[chat] error ${tag} status=${openAiResponse.status} headersMs=${headersMs}`, errorBody)
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
      const empty = counters.contentTokens === 0
      const logFn = empty ? console.warn : console.log
      logFn(
        `[chat] done ${tag} bytes=${totalBytes} totalMs=${Date.now() - reqStart}` +
        ` contentTokens=${counters.contentTokens} finish=${counters.finishReason}` +
        ` compTok=${counters.completionTokens} reasonTok=${counters.reasoningTokens}` +
        (empty ? ' EMPTY_COMPLETION' : ''),
      )
    } else {
      const data = await openAiResponse.json()
      const finishReason = data?.choices?.[0]?.finish_reason
      const contentLen = (data?.choices?.[0]?.message?.content || '').length
      const usage = data?.usage
      console.log(`[chat] done ${tag} headersMs=${headersMs} totalMs=${Date.now() - reqStart} finish=${finishReason} contentLen=${contentLen} promptTok=${usage?.prompt_tokens} compTok=${usage?.completion_tokens} reasonTok=${usage?.completion_tokens_details?.reasoning_tokens}`)
      res.json(data)
    }
  },
)
