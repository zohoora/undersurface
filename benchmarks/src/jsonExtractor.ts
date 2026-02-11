/**
 * Strips thinking/reasoning blocks from model output.
 *
 * Thinking models (DeepSeek R1, Qwen3, QwQ, etc.) wrap chain-of-thought
 * in <think>...</think> or <reasoning>...</reasoning> tags before the
 * actual response. This must be stripped before scoring or JSON parsing.
 */
export function stripThinking(response: string): string {
  let stripped = response
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim()

  // Handle unclosed <think> tag — strip from <think> to end, then check
  // if the model wrote anything before the tag
  if (!stripped && /<think>/i.test(response)) {
    // Try content before the <think> tag
    const beforeThink = response.replace(/<think>[\s\S]*$/i, '').trim()
    if (beforeThink) return beforeThink
  }

  return stripped || response.trim()
}

export function extractJson(response: string): string {
  // Strip thinking blocks first
  const clean = stripThinking(response)
  const match = clean.match(/```(?:json)?\s*([\s\S]*?)```/)
  return match ? match[1].trim() : clean.trim()
}

export function tryParseJson<T>(response: string): T | null {
  try {
    const cleaned = extractJson(response)
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}
