import type { QualityResult, QualityDetail, TestCase, JudgeEvaluation, ProgressCallback } from './types.js'
import { QUALITY_WEIGHTS, VALID_EMOTIONS, OPENROUTER_BASE, OPENROUTER_HEADERS } from './config.js'
import { tryParseJson, stripThinking } from './jsonExtractor.js'

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

/**
 * Sends a chat completion request (non-streaming) to a model via OpenRouter.
 * Returns the text content of the first choice, or null on failure.
 * Handles 429 rate limits with exponential backoff.
 */
async function callModel(
  modelId: string,
  apiKey: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number,
  maxRetries = 3,
): Promise<string | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: false,
        }),
      })

      if (response.status === 429 && attempt < maxRetries) {
        await sleep(backoffMs(attempt))
        continue
      }

      if (!response.ok) {
        return null
      }

      const data = await response.json() as {
        choices?: { message?: { content?: string } }[]
      }
      return data.choices?.[0]?.message?.content ?? null
    } catch {
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt))
        continue
      }
      return null
    }
  }
  return null
}

// ─── Scoring functions per pattern ───────────────────────────────────────────

/**
 * Scores emotion detection: exact match = 100, contains valid emotion = 60, miss = 0.
 */
function scoreEmotionDetection(response: string): number {
  const cleaned = response.trim().toLowerCase().replace(/[^a-z]/g, '')
  // Exact match against valid emotions
  if (VALID_EMOTIONS.includes(cleaned)) return 100
  // Partial match — response contains a valid emotion word
  for (const emotion of VALID_EMOTIONS) {
    if (response.toLowerCase().includes(emotion)) return 60
  }
  return 0
}

/**
 * Scores emergence JSON output.
 * Checks: JSON parses (+30), detected field (+10), name field (+10),
 * all required fields (+50 proportional).
 */
function scoreEmergence(response: string): number {
  const parsed = tryParseJson<Record<string, unknown>>(response)
  if (!parsed) return 0

  let score = 30 // JSON parsed successfully

  if ('detected' in parsed) score += 10
  if (parsed.name && typeof parsed.name === 'string') score += 10

  // Check remaining required fields proportionally (50 points total)
  const requiredFields = ['color', 'concern', 'voice', 'ifsRole', 'firstWords']
  const presentCount = requiredFields.filter(f => f in parsed && parsed[f]).length
  score += Math.round((presentCount / requiredFields.length) * 50)

  return Math.min(100, score)
}

/**
 * Scores reflection JSON output.
 * Checks: JSON parses (+20), entrySummary complete (+30), partMemories (+15),
 * profileUpdates (+20), other fields (+15).
 */
function scoreReflection(response: string): number {
  const parsed = tryParseJson<Record<string, unknown>>(response)
  if (!parsed) return 0

  let score = 20 // JSON parsed successfully

  // entrySummary completeness (30 points)
  const summary = parsed.entrySummary as Record<string, unknown> | undefined
  if (summary && typeof summary === 'object') {
    let summaryScore = 0
    if (Array.isArray(summary.themes) && summary.themes.length > 0) summaryScore += 10
    if (summary.emotionalArc) summaryScore += 10
    if (Array.isArray(summary.keyMoments) && summary.keyMoments.length > 0) summaryScore += 10
    score += summaryScore
  }

  // partMemories (15 points)
  if (parsed.partMemories && (Array.isArray(parsed.partMemories) || typeof parsed.partMemories === 'object')) {
    score += 15
  }

  // profileUpdates (20 points)
  if (parsed.profileUpdates && typeof parsed.profileUpdates === 'object') {
    score += 20
  }

  // Other fields: crossEntryPatterns, partKeywordSuggestions (15 points)
  let otherPoints = 0
  if (parsed.crossEntryPatterns) otherPoints += 7
  if (parsed.partKeywordSuggestions) otherPoints += 8
  score += otherPoints

  return Math.min(100, score)
}

/**
 * Scores growth JSON output.
 * Checks: JSON parses (+30), has partGrowth (+20), promptAddition for at least
 * one part (+25), keywords (+15), emotions (+10).
 */
function scoreGrowth(response: string): number {
  const parsed = tryParseJson<Record<string, unknown>>(response)
  if (!parsed) return 0

  let score = 30 // JSON parsed successfully

  const partGrowth = parsed.partGrowth as Record<string, Record<string, unknown>> | undefined
  if (!partGrowth || typeof partGrowth !== 'object') return score

  score += 20 // has partGrowth

  const parts = Object.values(partGrowth)
  if (parts.length === 0) return score

  // promptAddition for at least one part
  if (parts.some(p => p && typeof p === 'object' && p.promptAddition)) {
    score += 25
  }

  // keywords present in any part
  if (parts.some(p => p && typeof p === 'object' && Array.isArray(p.keywords) && p.keywords.length > 0)) {
    score += 15
  }

  // emotions present in any part
  if (parts.some(p => p && typeof p === 'object' && Array.isArray(p.emotions) && p.emotions.length > 0)) {
    score += 10
  }

  return Math.min(100, score)
}

/**
 * Scores explorations JSON output.
 * Checks: JSON parses as array (+30), has 2+ items (+20), each item has prompt (+25),
 * valid source (+15), sourceDetail (+10).
 */
function scoreExplorations(response: string): number {
  const parsed = tryParseJson<unknown[]>(response)
  if (!Array.isArray(parsed)) return 0

  let score = 30 // JSON parsed as array

  if (parsed.length >= 2) score += 20

  if (parsed.length === 0) return score

  // Check items — score proportionally across all items
  const items = parsed as Record<string, unknown>[]
  let promptPoints = 0
  let sourcePoints = 0
  let detailPoints = 0

  for (const item of items) {
    if (item && typeof item === 'object') {
      if (item.prompt && typeof item.prompt === 'string') promptPoints++
      if (item.source && typeof item.source === 'string') sourcePoints++
      if (item.sourceDetail && typeof item.sourceDetail === 'string') detailPoints++
    }
  }

  const count = items.length
  score += Math.round((promptPoints / count) * 25)
  score += Math.round((sourcePoints / count) * 15)
  score += Math.round((detailPoints / count) * 10)

  return Math.min(100, score)
}

/**
 * Routes scoring to the appropriate function based on test case pattern.
 */
function scoreResponse(pattern: string, response: string): number {
  switch (pattern) {
    case 'emotionDetection': return scoreEmotionDetection(response)
    case 'emergence': return scoreEmergence(response)
    case 'reflection': return scoreReflection(response)
    case 'growth': return scoreGrowth(response)
    case 'explorations': return scoreExplorations(response)
    default: return 0
  }
}

// ─── Judge evaluation ────────────────────────────────────────────────────────

/**
 * Builds the judge prompt for evaluating a Part Thought response.
 * The model name is intentionally hidden from the judge to prevent bias.
 */
function buildJudgePrompt(testCase: TestCase, response: string): { role: string; content: string }[] {
  // Extract part info from the test case system message
  const systemMsg = testCase.messages.find(m => m.role === 'system')?.content ?? ''
  const userMsg = testCase.messages.find(m => m.role === 'user')?.content ?? ''

  // Try to extract part name and role from the system prompt
  const nameMatch = systemMsg.match(/(?:You are|name[:\s]+)([^."\n]+)/i)
  const partName = nameMatch?.[1]?.trim() ?? 'Unknown Part'

  return [
    {
      role: 'system',
      content: `You are evaluating an AI inner voice response for a diary app. The AI part is responding to a writer's diary entry to encourage deeper writing.

Part name: ${partName}
Part voice: (described in the system prompt below)

Score this response on each criterion (0-100):
1. brevity: Is it 1-2 sentences? (100=perfect length, 50=slightly long, 0=way too long)
2. noFirstPerson: Does it avoid starting with "I"? (100=no first person start, 0=starts with "I")
3. emotionalFit: Does it match the emotional tone of the writing? (0-100)
4. genuineness: Does it feel genuine, not performative or theatrical? (0-100)
5. writingGuidance: Does it encourage the writer to keep writing or go deeper? (0-100)
6. voiceMatch: Does it sound like the described voice/character? (0-100)

Respond with JSON only:
{"brevity": N, "noFirstPerson": N, "emotionalFit": N, "genuineness": N, "writingGuidance": N, "voiceMatch": N, "overall": N, "reasoning": "1-2 sentences"}`,
    },
    {
      role: 'user',
      content: `System prompt given to the part:
---
${systemMsg.slice(0, 2000)}
---

The writer wrote:
---
${userMsg.slice(0, 1000)}
---

The part responded:
---
${response}
---

Score this response as JSON.`,
    },
  ]
}

/**
 * Calls the judge model to evaluate a Part Thought response.
 * Returns a JudgeEvaluation with scores for each criterion.
 */
async function evaluateWithJudge(
  judgeModel: string,
  apiKey: string,
  testCase: TestCase,
  response: string,
): Promise<JudgeEvaluation | null> {
  const messages = buildJudgePrompt(testCase, response)
  const result = await callModel(judgeModel, apiKey, messages, 300, 0.0)
  if (!result) return null

  const parsed = tryParseJson<JudgeEvaluation>(result)
  if (!parsed || typeof parsed.overall !== 'number') return null

  return parsed
}

// ─── Main quality measurement ────────────────────────────────────────────────

/**
 * Measures response quality for a model across all test cases.
 *
 * Automated scoring for: emotion detection, emergence, reflection, growth, explorations.
 * LLM-as-judge scoring for: part thoughts (unless skipJudge is true).
 *
 * Returns weighted overall score and detailed per-test-case results.
 */
export async function measureQuality(
  modelId: string,
  apiKey: string,
  testCases: TestCase[],
  judgeModel: string,
  skipJudge: boolean,
  onProgress?: ProgressCallback,
): Promise<QualityResult> {
  const details: QualityDetail[] = []

  // Group test cases by pattern
  const byPattern: Record<string, TestCase[]> = {}
  for (const tc of testCases) {
    const group = byPattern[tc.pattern] ?? []
    group.push(tc)
    byPattern[tc.pattern] = group
  }

  // Per-pattern scores accumulate here
  const patternScores: Record<string, number[]> = {
    partThoughts: [],
    emotionDetection: [],
    emergence: [],
    reflection: [],
    growth: [],
    explorations: [],
  }

  // --- Automated patterns: emotion, emergence, reflection, growth, explorations ---
  const automatedPatterns = ['emotionDetection', 'emergence', 'reflection', 'growth', 'explorations']

  for (const pattern of automatedPatterns) {
    const cases = byPattern[pattern] ?? []
    for (const tc of cases) {
      onProgress?.(`${modelId}: running ${tc.name}...`)

      const response = await callModel(
        modelId, apiKey, tc.messages, tc.maxTokens, tc.temperature,
      )

      if (!response) {
        details.push({
          testCase: tc.id,
          pattern: tc.pattern,
          response: '',
          score: 0,
          notes: 'Model returned no response',
        })
        patternScores[pattern].push(0)
        continue
      }

      const cleanedResponse = stripThinking(response)
      const score = scoreResponse(pattern, cleanedResponse)
      details.push({
        testCase: tc.id,
        pattern: tc.pattern,
        response: cleanedResponse.slice(0, 500),
        score,
      })
      patternScores[pattern].push(score)

      // Brief delay to avoid rate limiting between calls
      await sleep(500)
    }
  }

  // --- Part Thoughts: LLM-as-judge or neutral score ---
  const partThoughtCases = byPattern['partThought'] ?? []

  if (skipJudge) {
    // Assign neutral 50 for each part thought test
    for (const tc of partThoughtCases) {
      details.push({
        testCase: tc.id,
        pattern: tc.pattern,
        response: '(judge skipped)',
        score: 50,
        notes: 'Judge evaluation skipped (--skip-judge)',
      })
      patternScores.partThoughts.push(50)
    }
  } else {
    for (const tc of partThoughtCases) {
      onProgress?.(`${modelId}: running ${tc.name}...`)

      const response = await callModel(
        modelId, apiKey, tc.messages, tc.maxTokens, tc.temperature,
      )

      if (!response) {
        details.push({
          testCase: tc.id,
          pattern: tc.pattern,
          response: '',
          score: 0,
          notes: 'Model returned no response',
        })
        patternScores.partThoughts.push(0)
        continue
      }

      // Strip thinking tokens before judge evaluation — judge should only see the actual response
      const cleanResponse = stripThinking(response)

      // Evaluate with judge
      onProgress?.(`${modelId}: judge evaluating ${tc.name}...`)
      const evaluation = await evaluateWithJudge(judgeModel, apiKey, tc, cleanResponse)

      const score = evaluation?.overall ?? 50 // Fall back to neutral if judge fails
      details.push({
        testCase: tc.id,
        pattern: tc.pattern,
        response: response.slice(0, 500),
        score,
        judgeResponse: evaluation
          ? JSON.stringify(evaluation).slice(0, 500)
          : 'Judge evaluation failed',
        notes: evaluation?.reasoning,
      })
      patternScores.partThoughts.push(score)

      await sleep(500)
    }
  }

  // --- Compute per-pattern averages ---
  const avg = (scores: number[]): number =>
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

  const scores = {
    partThoughts: Math.round(avg(patternScores.partThoughts) * 10) / 10,
    emotionDetection: Math.round(avg(patternScores.emotionDetection) * 10) / 10,
    reflection: Math.round(avg(patternScores.reflection) * 10) / 10,
    emergence: Math.round(avg(patternScores.emergence) * 10) / 10,
    growth: Math.round(avg(patternScores.growth) * 10) / 10,
    explorations: Math.round(avg(patternScores.explorations) * 10) / 10,
  }

  // --- Weighted overall ---
  const overall = Math.round((
    QUALITY_WEIGHTS.partThoughts * scores.partThoughts +
    QUALITY_WEIGHTS.emotionDetection * scores.emotionDetection +
    QUALITY_WEIGHTS.reflection * scores.reflection +
    QUALITY_WEIGHTS.emergence * scores.emergence +
    QUALITY_WEIGHTS.growth * scores.growth +
    QUALITY_WEIGHTS.explorations * scores.explorations
  ) * 10) / 10

  onProgress?.(`${modelId}: quality score ${overall}`)

  return {
    modelId,
    scores,
    overall,
    details,
  }
}
