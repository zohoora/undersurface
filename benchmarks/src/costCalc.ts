import type { ModelCandidate, CostResult } from './types.js'
import { MONTHLY_USAGE, MAX_MONTHLY_COST } from './config.js'

/**
 * Clamp a value between 0 and 1.
 */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/**
 * Calculates the estimated monthly cost per user for a model based on
 * catalog pricing and the app's usage patterns.
 *
 * For each usage pattern (Part Thoughts, Emotion Detection, Reflection, etc.):
 *   inputCost  = (calls * inputTokens / 1,000,000) * promptPrice
 *   outputCost = (calls * outputTokens / 1,000,000) * completionPrice
 *
 * Cost score: models costing $0 score 100, models at or above MAX_MONTHLY_COST ($5) score 0.
 * Linear interpolation between.
 */
export function calculateCost(candidate: ModelCandidate): CostResult {
  const breakdown: CostResult['breakdown'] = []
  let monthlyCost = 0

  for (const usage of MONTHLY_USAGE) {
    const inputCost = (usage.calls * usage.inputTokens / 1_000_000) * candidate.promptPrice
    const outputCost = (usage.calls * usage.outputTokens / 1_000_000) * candidate.completionPrice
    const patternCost = inputCost + outputCost

    breakdown.push({
      pattern: usage.pattern,
      callsPerMonth: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      monthlyCost: Math.round(patternCost * 10000) / 10000,
    })

    monthlyCost += patternCost
  }

  // Score: 0 at MAX_MONTHLY_COST or above, 100 at $0, linear between
  const score = Math.round(clamp01(1 - monthlyCost / MAX_MONTHLY_COST) * 100 * 10) / 10

  return {
    modelId: candidate.id,
    monthlyCostPerUser: Math.round(monthlyCost * 10000) / 10000,
    breakdown,
    score,
  }
}
