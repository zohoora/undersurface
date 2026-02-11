import type { ModelCandidate, OpenRouterModel, ProgressCallback } from './types.js'
import { BASELINE_MODEL, KNOWN_GOOD_PROVIDERS, COST_TIERS, HARD_FILTERS, OPENROUTER_BASE } from './config.js'

/**
 * Determines the cost tier for a model based on its completion price per million tokens.
 */
function getCostTier(completionPrice: number): 'cheap' | 'mid' | 'premium' {
  if (completionPrice < COST_TIERS.cheap.max) return 'cheap'
  if (completionPrice < COST_TIERS.mid.max) return 'mid'
  return 'premium'
}

/**
 * Converts an OpenRouter model to a ModelCandidate, extracting provider from model ID.
 */
function toCandidate(model: OpenRouterModel, isBaseline: boolean): ModelCandidate {
  const provider = model.id.split('/')[0] ?? 'unknown'
  // OpenRouter pricing is per-token (e.g., "0.00000025" = $0.25/M)
  // Convert to per-million for all downstream calculations
  const promptPrice = (parseFloat(model.pricing.prompt) || 0) * 1_000_000
  const completionPrice = (parseFloat(model.pricing.completion) || 0) * 1_000_000

  return {
    id: model.id,
    name: model.name,
    contextLength: model.context_length,
    promptPrice,
    completionPrice,
    maxCompletionTokens: model.top_provider?.max_completion_tokens ?? 0,
    provider,
    priorityScore: 0,
    isBaseline,
  }
}

/**
 * Checks whether a model passes all hard filters:
 * - Text in input and output modalities
 * - Sufficient context length
 * - Sufficient max completion tokens (if reported)
 * - Has real pricing data (not null/undefined/"0")
 * - Completion price within budget
 */
function passesHardFilters(model: OpenRouterModel): boolean {
  // Must have text modalities
  const inputMods = model.architecture?.input_modalities ?? []
  const outputMods = model.architecture?.output_modalities ?? []
  if (!inputMods.includes('text') || !outputMods.includes('text')) return false

  // Minimum context length
  if (model.context_length < HARD_FILTERS.minContextLength) return false

  // Minimum completion tokens (skip check if not reported)
  if (
    model.top_provider?.max_completion_tokens != null &&
    model.top_provider.max_completion_tokens < HARD_FILTERS.minCompletionTokens
  ) return false

  // Must have pricing data — strings like "0" or missing values are excluded
  if (!model.pricing?.prompt || !model.pricing?.completion) return false
  const promptPrice = parseFloat(model.pricing.prompt)
  const completionPrice = parseFloat(model.pricing.completion)
  if (isNaN(promptPrice) || isNaN(completionPrice)) return false
  if (promptPrice <= 0 && completionPrice <= 0) return false

  // Completion price cap (per million tokens)
  const completionPricePerMillion = completionPrice * 1_000_000
  if (completionPricePerMillion > HARD_FILTERS.maxCompletionPrice) return false

  return true
}

/**
 * Fetches all models from OpenRouter and filters them down to benchmark candidates.
 *
 * Pipeline:
 * 1. Fetch all models from OpenRouter (free endpoint, no auth)
 * 2. Apply hard filters (modalities, context, pricing, cost cap)
 * 3. Convert to ModelCandidate with provider extracted from model ID
 * 4. Apply soft scoring (known-good provider bonus, cost tier diversity)
 * 5. Always include baseline model and any --include-model models
 * 6. Sort by priority score, take top maxCandidates
 * 7. Ensure cost tier diversity (at least 3 from each tier if available)
 */
export async function fetchAndFilterModels(
  maxCandidates: number,
  includeModels: string[],
  onProgress?: ProgressCallback,
): Promise<ModelCandidate[]> {
  onProgress?.('Fetching model catalog from OpenRouter...')

  const response = await fetch(`${OPENROUTER_BASE}/models`)
  if (!response.ok) {
    throw new Error(`OpenRouter models API returned ${response.status}: ${response.statusText}`)
  }

  const data = await response.json() as { data: OpenRouterModel[] }
  const allModels = data.data ?? []
  onProgress?.(`Fetched ${allModels.length} models`, 'Applying filters...')

  // Build a lookup for forced-include models (baseline + explicit includes)
  const forcedIds = new Set([BASELINE_MODEL, ...includeModels])

  // Separate forced models from the rest — forced models bypass hard filters
  const forcedModels: ModelCandidate[] = []
  const filteredModels: ModelCandidate[] = []

  for (const model of allModels) {
    if (forcedIds.has(model.id)) {
      forcedModels.push(toCandidate(model, model.id === BASELINE_MODEL))
      continue
    }
    if (passesHardFilters(model)) {
      filteredModels.push(toCandidate(model, false))
    }
  }

  onProgress?.(
    `${filteredModels.length} models passed hard filters`,
    `${forcedModels.length} forced-include models`,
  )

  // Track cost tier counts for diversity scoring
  const tierCounts: Record<string, number> = { cheap: 0, mid: 0, premium: 0 }
  for (const c of filteredModels) {
    tierCounts[getCostTier(c.completionPrice)]++
  }
  const avgTierCount = Math.max(1, (tierCounts.cheap + tierCounts.mid + tierCounts.premium) / 3)

  // Apply soft scoring
  for (const candidate of filteredModels) {
    let score = 0

    // Known-good provider bonus
    if (KNOWN_GOOD_PROVIDERS.includes(candidate.provider)) {
      score += 10
    }

    // Cost tier diversity — underrepresented tiers get a bonus
    const tier = getCostTier(candidate.completionPrice)
    if (tierCounts[tier] < avgTierCount) {
      score += 5
    }

    candidate.priorityScore = score
  }

  // Sort by priority descending, then by name for stability
  filteredModels.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore
    return a.id.localeCompare(b.id)
  })

  // Take top candidates, leaving room for forced models
  const slotsForFiltered = Math.max(0, maxCandidates - forcedModels.length)
  let selected = filteredModels.slice(0, slotsForFiltered)

  // Ensure cost tier diversity: at least 3 from each tier if available
  const MIN_PER_TIER = 3
  const selectedTierCounts: Record<string, number> = { cheap: 0, mid: 0, premium: 0 }
  const selectedIds = new Set(selected.map(c => c.id))

  for (const c of selected) {
    selectedTierCounts[getCostTier(c.completionPrice)]++
  }

  for (const tier of ['cheap', 'mid', 'premium'] as const) {
    if (selectedTierCounts[tier] >= MIN_PER_TIER) continue

    // Find unselected models in this tier, sorted by priority
    const needed = MIN_PER_TIER - selectedTierCounts[tier]
    const candidates = filteredModels.filter(c =>
      !selectedIds.has(c.id) && getCostTier(c.completionPrice) === tier,
    )

    const toAdd = candidates.slice(0, needed)
    for (const c of toAdd) {
      selected.push(c)
      selectedIds.add(c.id)
      selectedTierCounts[tier]++
    }
  }

  // Deduplicate forced models against selected
  const finalIds = new Set(selected.map(c => c.id))
  for (const forced of forcedModels) {
    if (!finalIds.has(forced.id)) {
      selected.push(forced)
      finalIds.add(forced.id)
    }
  }

  onProgress?.(
    `Selected ${selected.length} candidates`,
    `Tiers — cheap: ${selectedTierCounts.cheap}, mid: ${selectedTierCounts.mid}, premium: ${selectedTierCounts.premium}`,
  )

  return selected
}

/**
 * Estimates the total API cost of running the full benchmark suite.
 *
 * Assumes ~22 API calls per model:
 * - 3 streaming speed runs (Part Thought test case)
 * - 3 non-streaming speed runs (Emotion Detection test case)
 * - 4 emotion detection quality tests
 * - 2 part thought quality tests
 * - 1 emergence test
 * - 1 reflection test
 * - 1 growth test
 * - 1 explorations test
 * Plus ~2 judge calls per model (evaluating 2 part thought responses)
 */
export function estimateBenchmarkCost(candidates: ModelCandidate[]): {
  estimatedApiCalls: number
  estimatedCost: number
  breakdown: { phase: string; calls: number; cost: number }[]
} {
  // Approximate token counts per call type
  const callTypes = [
    { phase: 'Speed (streaming)', callsPerModel: 3, inputTokens: 1150, outputTokens: 150 },
    { phase: 'Speed (non-streaming)', callsPerModel: 3, inputTokens: 240, outputTokens: 20 },
    { phase: 'Emotion detection', callsPerModel: 4, inputTokens: 240, outputTokens: 20 },
    { phase: 'Part thoughts', callsPerModel: 2, inputTokens: 1150, outputTokens: 150 },
    { phase: 'Emergence', callsPerModel: 1, inputTokens: 850, outputTokens: 150 },
    { phase: 'Reflection', callsPerModel: 1, inputTokens: 2100, outputTokens: 800 },
    { phase: 'Growth', callsPerModel: 1, inputTokens: 1100, outputTokens: 600 },
    { phase: 'Explorations', callsPerModel: 1, inputTokens: 500, outputTokens: 300 },
  ]

  const breakdown: { phase: string; calls: number; cost: number }[] = []
  let totalCalls = 0
  let totalCost = 0

  for (const ct of callTypes) {
    let phaseCost = 0
    const calls = ct.callsPerModel * candidates.length

    for (const c of candidates) {
      const inputCost = (ct.inputTokens / 1_000_000) * c.promptPrice * ct.callsPerModel
      const outputCost = (ct.outputTokens / 1_000_000) * c.completionPrice * ct.callsPerModel
      phaseCost += inputCost + outputCost
    }

    breakdown.push({ phase: ct.phase, calls, cost: phaseCost })
    totalCalls += calls
    totalCost += phaseCost
  }

  // Judge calls: 2 per model, using the most expensive candidate as an upper bound estimate
  // (In practice the judge model is specified separately, but we estimate conservatively)
  const maxPromptPrice = Math.max(...candidates.map(c => c.promptPrice), 0)
  const maxCompletionPrice = Math.max(...candidates.map(c => c.completionPrice), 0)
  const judgeCalls = 2 * candidates.length
  const judgeCost = judgeCalls * (
    (1500 / 1_000_000) * maxPromptPrice + // ~1500 input tokens for judge prompt
    (200 / 1_000_000) * maxCompletionPrice  // ~200 output tokens for judge response
  )
  breakdown.push({ phase: 'Judge evaluations', calls: judgeCalls, cost: judgeCost })
  totalCalls += judgeCalls
  totalCost += judgeCost

  return {
    estimatedApiCalls: totalCalls,
    estimatedCost: Math.round(totalCost * 10000) / 10000,
    breakdown,
  }
}
