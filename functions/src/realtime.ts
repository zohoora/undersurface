import { onRequest } from 'firebase-functions/v2/https'
import { ALLOWED_ORIGINS } from './shared/cors.js'
import { makeRateLimiter } from './shared/rateLimit.js'
import { openAiKey } from './shared/secrets.js'
import { verifyAuth } from './shared/auth.js'
import { isRealtimeVoiceAllowed, loadFeatureFlags } from './shared/featureFlags.js'
import { consumeDailyBudget, refundDailyBudget } from './shared/quota.js'

const REALTIME_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'])
const REALTIME_DEFAULT_VOICE = 'marin'
// Latest reasoning realtime model. `gpt-realtime-2025-08-28` pins the
// snapshot under the rolling `gpt-realtime-2` alias for predictable behavior.
const REALTIME_MODEL = 'gpt-realtime-2'
// Newer transcription model: lower latency and tighter integration with the
// realtime audio path than legacy `whisper-1`.
const REALTIME_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper'
// The Realtime model has a 32k-token context window. This is a character cap,
// not a token cap: 48k characters is roughly 12k tokens and leaves substantial
// room for the live conversation. The previous 16k-character guard rejected
// ordinary continuity-rich Room/Speak prompts before they reached OpenAI.
export const REALTIME_INSTRUCTIONS_MAX = 48_000

export function realtimeInstructionsAllowed(instructions: string): boolean {
  return instructions.length > 0 && instructions.length <= REALTIME_INSTRUCTIONS_MAX
}

// Tempo settings — therapist should sound unhurried.
// 0.88 = ~12% slower than default; client-side pace-matching may lower further.
const REALTIME_BASE_SPEED = 0.88

// Semantic VAD eagerness. `low` (8s max timeout) fits the unhurried therapy
// register — the model waits longer before assuming the user is done.
// `medium` (4s) is the API default; `high` (2s) feels rushed for this UX.
const REALTIME_VAD_EAGERNESS = 'low'

const VOICE_PACING_ADDENDUM = `
VOICE DELIVERY (this is a live voice conversation, not text):
- Speak at a gentle, unhurried pace. Take a breath between thoughts.
- Leave small natural pauses. The user should feel heard, not rushed.
- Short phrases. One idea at a time. Let silence do some of the work.`

// Voice sessions are longer-lived and more expensive than chat requests.
const checkRealtimeRateLimit = makeRateLimiter({ windowMs: 60_000, max: 10 })

// Durable per-user ceiling on Realtime client-secret mints per UTC day, stored
// in the server-owned quotas/{uid} doc (`daily.voiceMints`). The in-memory
// limiter above only smooths bursts on one instance; this survives restarts
// and instance fan-out. 30 covers many Speak/Room sessions a day (one secret
// per session) while bounding a scripted abuser.
export const VOICE_MINTS_PER_DAY = 30

// Machine-readable error codes. The client matches on `code`, never on text.
export const REALTIME_ERROR_CODES = {
  disabled: 'voice_disabled',
  dailyBudget: 'voice_daily_budget_exceeded',
  rateLimited: 'voice_rate_limited',
  configUnavailable: 'voice_config_unavailable',
  upstream: 'voice_upstream_error',
  invalidInstructions: 'invalid_instructions',
} as const

export const realtimeTokenApi = onRequest(
  {
    secrets: [openAiKey],
    cors: ALLOWED_ORIGINS,
    memory: '256MiB',
    minInstances: 1, // voice UX requires warm start; 2-5s cold-start before recording = broken-feeling
    timeoutSeconds: 30,
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

    if (!checkRealtimeRateLimit(uid)) {
      res.status(429).json({
        error: 'Too many voice sessions. Please wait a moment.',
        code: REALTIME_ERROR_CODES.rateLimited,
      })
      return
    }

    const { instructions, voice } = (req.body || {}) as { instructions?: unknown; voice?: unknown }

    if (typeof instructions !== 'string' || instructions.length === 0) {
      res.status(400).json({ error: 'Missing instructions', code: REALTIME_ERROR_CODES.invalidInstructions })
      return
    }
    if (!realtimeInstructionsAllowed(instructions)) {
      console.warn('Realtime instructions rejected for length', { length: instructions.length, max: REALTIME_INSTRUCTIONS_MAX })
      res.status(400).json({
        error: `Instructions too long (max ${REALTIME_INSTRUCTIONS_MAX} chars)`,
        code: REALTIME_ERROR_CODES.invalidInstructions,
      })
      return
    }

    // Server-side flag enforcement. The client hides Speak and Room when their
    // flags are off, but any signed-in user can call this endpoint directly.
    // Fail closed when the config can't be read.
    const now = new Date()
    let voiceAllowed: boolean
    try {
      voiceAllowed = isRealtimeVoiceAllowed(await loadFeatureFlags(now.getTime()))
    } catch {
      console.error('[realtime] config-unavailable')
      res.status(503).json({ error: 'Voice is temporarily unavailable.', code: REALTIME_ERROR_CODES.configUnavailable })
      return
    }
    if (!voiceAllowed) {
      res.status(403).json({ error: 'Voice is not available right now.', code: REALTIME_ERROR_CODES.disabled })
      return
    }

    // Consume the daily mint only after validation and flag checks, so a
    // rejected request never costs the user a session.
    let budget: Awaited<ReturnType<typeof consumeDailyBudget>>
    try {
      budget = await consumeDailyBudget({ uid, bucket: 'voiceMints', limit: VOICE_MINTS_PER_DAY, now })
    } catch {
      console.error('[realtime] budget-unavailable')
      res.status(503).json({ error: 'Voice is temporarily unavailable.', code: REALTIME_ERROR_CODES.configUnavailable })
      return
    }
    if (!budget.allowed) {
      console.warn(`[realtime] daily-budget-block limit=${budget.limit}`)
      res.status(429).json({
        error: "You have reached today's voice limit. It resets at midnight UTC.",
        code: REALTIME_ERROR_CODES.dailyBudget,
      })
      return
    }

    // An upstream failure refunds the mint and is reported as 502, never as
    // OpenAI's own status: the client must not confuse an upstream 403/429
    // with this endpoint's flag and budget codes.
    const failUpstream = (status: number | 'network') => {
      console.error(`OpenAI realtime error: ${status}`)
      void refundDailyBudget({ uid, bucket: 'voiceMints', now })
      res.status(502).json({ error: 'Voice service temporarily unavailable', code: REALTIME_ERROR_CODES.upstream })
    }

    const resolvedVoice = typeof voice === 'string' && REALTIME_VOICES.has(voice) ? voice : REALTIME_DEFAULT_VOICE
    const voiceInstructions = `${instructions}\n\n${VOICE_PACING_ADDENDUM}`

    let openAiResponse: Awaited<ReturnType<typeof fetch>>
    try {
      openAiResponse = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAiKey.value()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: REALTIME_MODEL,
            instructions: voiceInstructions,
            audio: {
              input: {
                transcription: { model: REALTIME_TRANSCRIPTION_MODEL },
                turn_detection: {
                  type: 'semantic_vad',
                  eagerness: REALTIME_VAD_EAGERNESS,
                  create_response: true,
                  interrupt_response: true,
                },
              },
              output: {
                voice: resolvedVoice,
                speed: REALTIME_BASE_SPEED,
              },
            },
          },
          expires_after: { anchor: 'created_at', seconds: 600 },
        }),
      })
    } catch {
      failUpstream('network')
      return
    }

    if (!openAiResponse.ok) {
      failUpstream(openAiResponse.status)
      return
    }

    const data = await openAiResponse.json()
    res.json({
      clientSecret: data.value,
      expiresAt: data.expires_at,
      model: REALTIME_MODEL,
      voice: resolvedVoice,
    })
  },
)
