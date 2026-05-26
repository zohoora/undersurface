import { apiUrl } from '../api/apiBase'
import { getAuthToken } from '../api/authedFetch'
import { CRISIS_CLASSIFIER_PROMPT } from './crisisClassifierPrompt'
import { engineLog } from '../services/diagnostics'

export type CrisisRisk = 0 | 1 | 2

export interface CrisisRiskResult {
  risk: CrisisRisk
  reason?: string
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface StreamCallbacks {
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
  // Fires at most once per call. Missing preamble → risk=0 (fail-open).
  onRisk?: (risk: CrisisRisk) => void
}

// Anchored — a stray `<<RISK:2>>` quoted later in the response does not
// retroactively trigger grounding. Tolerant of contents and trailing
// whitespace: matches any 1–8 char payload between the colons and `>>`,
// then horizontal whitespace + at least one newline. If the captured
// payload isn't '0' / '1' / '2' (e.g., the model echoed the literal
// placeholder `N`, or emitted an out-of-range digit), we still strip the
// preamble and fail open to risk=0 — the L1 regex in sessionOrchestrator
// is the deterministic safety floor, so falling open here doesn't disable
// safety. The malformed bytes go to engineLog so model misbehavior is
// observable.
const RISK_PREAMBLE_PATTERN = /^<<RISK:([^>]{1,8})>>[ \t]*\n+/
const PREAMBLE_FAIL_OPEN_CHARS = 80

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
      throw new Error(`API error: ${response.status}${body ? ` — ${body}` : ''}`)
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
    const timeout = setTimeout(() => controller.abort(), 30000)
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
      throw new Error(`API error: ${response.status}${body ? ` — ${body}` : ''}`)
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

    // Parser for the `<<RISK:N>>\n\n` preamble emitted by the therapist (see
    // RISK_PREAMBLE_INSTRUCTIONS). Buffer until match or fail-open threshold.
    let preambleConsumed = false
    let preambleBuffer = ''

    const fireRisk = (risk: CrisisRisk): void => {
      if (preambleConsumed) return
      preambleConsumed = true
      callbacks.onRisk?.(risk)
    }

    const processContent = (chunk: string): void => {
      if (controller.signal.aborted) return

      if (preambleConsumed) {
        fullText += chunk
        callbacks.onToken(chunk)
        return
      }

      preambleBuffer += chunk
      const match = preambleBuffer.match(RISK_PREAMBLE_PATTERN)
      if (match) {
        const captured = match[1]
        let risk: CrisisRisk = 0
        if (captured === '0' || captured === '1' || captured === '2') {
          risk = parseInt(captured, 10) as CrisisRisk
        } else {
          // Categorize rather than log raw bytes — EngineLogContext.extra
          // contract forbids model output. Categories are enough to triage:
          // a spike in `literal_placeholder` means the prompt needs another
          // pass; `out_of_range_digit` means the model is hallucinating tiers.
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
        fireRisk(risk)
        if (controller.signal.aborted) return
        const remainder = preambleBuffer.slice(match[0].length)
        preambleBuffer = ''
        if (remainder) {
          fullText += remainder
          callbacks.onToken(remainder)
        }
        return
      }
      if (preambleBuffer.length > PREAMBLE_FAIL_OPEN_CHARS) {
        fireRisk(0)
        if (controller.signal.aborted) return
        fullText += preambleBuffer
        callbacks.onToken(preambleBuffer)
        preambleBuffer = ''
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

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

        if (loopDetected) break
      }
    } finally {
      clearTimeout(timeout)
    }

    // Fail-open if preamble never matched and we ended below the threshold.
    fireRisk(0)
    if (preambleBuffer.length > 0 && !controller.signal.aborted) {
      fullText += preambleBuffer
      callbacks.onToken(preambleBuffer)
      preambleBuffer = ''
    }

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
