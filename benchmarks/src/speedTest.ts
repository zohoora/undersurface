import type { SpeedResult, TestCase, ProgressCallback } from './types.js'
import { SPEED_PARAMS, OPENROUTER_BASE, OPENROUTER_HEADERS } from './config.js'

/** Clamp a value between 0 and 1 */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/** Sleep for the given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Calculate exponential backoff with jitter */
function backoffMs(attempt: number, baseMs = 2000, maxMs = 30000): number {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt))
  const jitter = exponential * 0.5 * Math.random()
  return exponential + jitter
}

interface StreamingTimingResult {
  ttfbMs: number
  totalMs: number
  tokensPerSecond: number
  outputTokens: number
  error?: string
}

interface NonStreamingTimingResult {
  totalMs: number
  error?: string
}

/**
 * Performs a single streaming request and measures timing.
 *
 * Parses SSE events: lines starting with "data: ", JSON payloads with
 * choices[0].delta.content for token counting. "data: [DONE]" terminates.
 */
async function runStreamingRequest(
  modelId: string,
  apiKey: string,
  testCase: TestCase,
  timeoutMs = 30000,
): Promise<StreamingTimingResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const startTime = performance.now()
  let ttfbMs = 0
  let firstTokenReceived = false
  let tokenCount = 0
  let insideThinkBlock = false
  let contentBuffer = ''

  try {
    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...OPENROUTER_HEADERS,
      },
      body: JSON.stringify({
        model: modelId,
        messages: testCase.messages,
        max_tokens: testCase.maxTokens,
        temperature: testCase.temperature,
        stream: true,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const status = response.status
      const body = await response.text().catch(() => '')
      return { ttfbMs: 0, totalMs: 0, tokensPerSecond: 0, outputTokens: 0, error: `HTTP ${status}: ${body.slice(0, 200)}` }
    }

    if (!response.body) {
      return { ttfbMs: 0, totalMs: 0, tokensPerSecond: 0, outputTokens: 0, error: 'No response body for streaming' }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE lines
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // Keep incomplete last line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue

        const payload = trimmed.slice(6) // Remove "data: " prefix
        if (payload === '[DONE]') continue

        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[]
          }
          const delta = parsed.choices?.[0]?.delta
          // Content token (actual response) — what users see
          const content = delta?.content
          // Reasoning token (thinking models via API field) — not visible to users
          const reasoning = delta?.reasoning_content ?? delta?.reasoning

          if (reasoning) {
            // Model is actively responding (thinking phase) — count for TTFB
            if (!firstTokenReceived) {
              ttfbMs = performance.now() - startTime
              firstTokenReceived = true
            }
          }

          if (content) {
            // Track inline <think> tags in content stream
            contentBuffer += content
            if (/<think>/i.test(contentBuffer)) insideThinkBlock = true
            if (/<\/think>/i.test(contentBuffer)) {
              insideThinkBlock = false
              contentBuffer = '' // Reset after think block closes
            }

            if (!insideThinkBlock && !/<think>/i.test(content)) {
              if (!firstTokenReceived) {
                ttfbMs = performance.now() - startTime
                firstTokenReceived = true
              }
              tokenCount++
            }
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }

    const totalMs = performance.now() - startTime

    // Calculate tokens/second from first token to completion
    const generationTimeMs = totalMs - ttfbMs
    const tokensPerSecond = generationTimeMs > 0
      ? (tokenCount / (generationTimeMs / 1000))
      : 0

    return {
      ttfbMs: Math.round(ttfbMs),
      totalMs: Math.round(totalMs),
      tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
      outputTokens: tokenCount,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('abort')) {
      return { ttfbMs: 0, totalMs: timeoutMs, tokensPerSecond: 0, outputTokens: 0, error: `Streaming timeout (${timeoutMs}ms)` }
    }
    return { ttfbMs: 0, totalMs: 0, tokensPerSecond: 0, outputTokens: 0, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Performs a single non-streaming request and measures round-trip time.
 */
async function runNonStreamingRequest(
  modelId: string,
  apiKey: string,
  testCase: TestCase,
  timeoutMs = 15000,
): Promise<NonStreamingTimingResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const startTime = performance.now()

  try {
    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...OPENROUTER_HEADERS,
      },
      body: JSON.stringify({
        model: modelId,
        messages: testCase.messages,
        max_tokens: testCase.maxTokens,
        temperature: testCase.temperature,
        stream: false,
      }),
      signal: controller.signal,
    })

    const totalMs = performance.now() - startTime

    if (!response.ok) {
      const status = response.status
      const body = await response.text().catch(() => '')
      return { totalMs: 0, error: `HTTP ${status}: ${body.slice(0, 200)}` }
    }

    return { totalMs: Math.round(totalMs) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('abort')) {
      return { totalMs: timeoutMs, error: `Non-streaming timeout (${timeoutMs}ms)` }
    }
    return { totalMs: 0, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Calculates the speed score from streaming and non-streaming measurements.
 *
 * Streaming score combines three sub-scores (TTFB, total time, tokens/sec)
 * weighted by SPEED_PARAMS.streamSubWeights. Non-streaming score is based
 * on total round-trip time vs the target.
 *
 * If only one measurement type is available, it scales to the full 0-100 range.
 */
function computeSpeedScore(
  streaming: { ttfbMs: number; totalMs: number; tokensPerSecond: number } | null,
  nonStreaming: { totalMs: number } | null,
): number {
  const {
    ttfbTarget, totalTarget, tpsTarget,
    streamingWeight, nonStreamingWeight,
    streamSubWeights,
  } = SPEED_PARAMS

  let streamingScore = 0
  let hasStreaming = false
  if (streaming && streaming.totalMs > 0) {
    hasStreaming = true
    streamingScore =
      streamSubWeights.ttfb * clamp01(1 - streaming.ttfbMs / ttfbTarget) +
      streamSubWeights.total * clamp01(1 - streaming.totalMs / totalTarget) +
      streamSubWeights.tps * clamp01(streaming.tokensPerSecond / tpsTarget)
  }

  let nonStreamingScore = 0
  let hasNonStreaming = false
  if (nonStreaming && nonStreaming.totalMs > 0) {
    hasNonStreaming = true
    nonStreamingScore = clamp01(1 - nonStreaming.totalMs / totalTarget)
  }

  // If both available, use weighted combination
  if (hasStreaming && hasNonStreaming) {
    return (streamingWeight * streamingScore + nonStreamingWeight * nonStreamingScore) * 100
  }

  // If only one available, scale to full 100
  if (hasStreaming) return streamingScore * 100
  if (hasNonStreaming) return nonStreamingScore * 100

  return 0
}

/**
 * Measures streaming and non-streaming latency for a model.
 *
 * Runs multiple timing iterations with delays between them. Discards the worst
 * run and averages the rest. Handles rate limiting with exponential backoff.
 * If streaming consistently fails, falls back to non-streaming only.
 */
export async function measureSpeed(
  modelId: string,
  apiKey: string,
  streamingTestCase: TestCase,
  nonStreamingTestCase: TestCase,
  timingRuns: number,
  onProgress?: ProgressCallback,
): Promise<SpeedResult> {
  const MAX_RETRIES = 3

  // --- Streaming measurements ---
  onProgress?.(`${modelId}: measuring streaming speed...`)
  const streamingResults: StreamingTimingResult[] = []
  let streamingFailCount = 0

  for (let run = 0; run < timingRuns; run++) {
    if (run > 0) await sleep(1000)

    let result: StreamingTimingResult | null = null
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      result = await runStreamingRequest(modelId, apiKey, streamingTestCase)

      // Retry on 429 (rate limit) — error message contains "429"
      if (result.error?.includes('429') && retry < MAX_RETRIES) {
        const delay = backoffMs(retry)
        onProgress?.(`${modelId}: rate limited, retrying in ${Math.round(delay / 1000)}s...`)
        await sleep(delay)
        continue
      }
      break
    }

    if (result && !result.error) {
      streamingResults.push(result)
    } else {
      streamingFailCount++
      onProgress?.(`${modelId}: streaming run ${run + 1} failed: ${result?.error}`)
    }
  }

  // --- Non-streaming measurements ---
  onProgress?.(`${modelId}: measuring non-streaming speed...`)
  const nonStreamingResults: NonStreamingTimingResult[] = []

  for (let run = 0; run < timingRuns; run++) {
    if (run > 0) await sleep(1000)

    let result: NonStreamingTimingResult | null = null
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      result = await runNonStreamingRequest(modelId, apiKey, nonStreamingTestCase)

      if (result.error?.includes('429') && retry < MAX_RETRIES) {
        const delay = backoffMs(retry)
        onProgress?.(`${modelId}: rate limited, retrying in ${Math.round(delay / 1000)}s...`)
        await sleep(delay)
        continue
      }
      break
    }

    if (result && !result.error) {
      nonStreamingResults.push(result)
    } else {
      onProgress?.(`${modelId}: non-streaming run ${run + 1} failed: ${result?.error}`)
    }
  }

  // --- Aggregate results ---
  // Discard worst run (highest total time) and average the rest

  let streamingAvg: { ttfbMs: number; totalMs: number; tokensPerSecond: number } | null = null
  const supportsStreaming = streamingResults.length > 0

  if (streamingResults.length > 0) {
    // Sort by totalMs descending, remove worst
    const sorted = [...streamingResults].sort((a, b) => b.totalMs - a.totalMs)
    const kept = sorted.length > 1 ? sorted.slice(1) : sorted

    streamingAvg = {
      ttfbMs: Math.round(kept.reduce((sum, r) => sum + r.ttfbMs, 0) / kept.length),
      totalMs: Math.round(kept.reduce((sum, r) => sum + r.totalMs, 0) / kept.length),
      tokensPerSecond: Math.round(
        (kept.reduce((sum, r) => sum + r.tokensPerSecond, 0) / kept.length) * 10,
      ) / 10,
    }
  }

  let nonStreamingAvg: { totalMs: number } | null = null
  if (nonStreamingResults.length > 0) {
    const sorted = [...nonStreamingResults].sort((a, b) => b.totalMs - a.totalMs)
    const kept = sorted.length > 1 ? sorted.slice(1) : sorted

    nonStreamingAvg = {
      totalMs: Math.round(kept.reduce((sum, r) => sum + r.totalMs, 0) / kept.length),
    }
  }

  // Build error message if both failed completely
  let error: string | undefined
  if (!streamingAvg && !nonStreamingAvg) {
    error = `All speed tests failed for ${modelId}`
    if (streamingFailCount === timingRuns) {
      error += ' (streaming: all runs failed)'
    }
  } else if (!streamingAvg && streamingFailCount > 0) {
    // Streaming failed but non-streaming worked — note the fallback
    error = `Streaming failed (${streamingFailCount}/${timingRuns} runs), using non-streaming only`
  }

  const score = Math.round(computeSpeedScore(streamingAvg, nonStreamingAvg) * 10) / 10

  onProgress?.(`${modelId}: speed score ${score}`, error)

  return {
    modelId,
    streaming: streamingAvg,
    nonStreaming: nonStreamingAvg,
    score,
    error,
    supportsStreaming,
  }
}
