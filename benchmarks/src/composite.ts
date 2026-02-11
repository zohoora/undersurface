import type {
  SpeedResult,
  QualityResult,
  CostResult,
  ModelCandidate,
  CompositeScore,
  BenchmarkConfig,
} from './types.js'

function letterGrade(score: number): string {
  if (score >= 97) return 'A+'
  if (score >= 93) return 'A'
  if (score >= 90) return 'A-'
  if (score >= 87) return 'B+'
  if (score >= 83) return 'B'
  if (score >= 80) return 'B-'
  if (score >= 77) return 'C+'
  if (score >= 73) return 'C'
  if (score >= 70) return 'C-'
  if (score >= 67) return 'D+'
  if (score >= 63) return 'D'
  if (score >= 60) return 'D-'
  return 'F'
}

export function computeCompositeScores(
  candidates: ModelCandidate[],
  speedResults: SpeedResult[],
  qualityResults: QualityResult[],
  costResults: CostResult[],
  weights: BenchmarkConfig['weights'],
): CompositeScore[] {
  const scores: CompositeScore[] = []

  for (const candidate of candidates) {
    const speed = speedResults.find((r) => r.modelId === candidate.id)
    const quality = qualityResults.find((r) => r.modelId === candidate.id)
    const cost = costResults.find((r) => r.modelId === candidate.id)

    const speedScore = speed?.score ?? 0
    const qualityScore = quality?.overall ?? 0
    const costScore = cost?.score ?? 0
    const monthlyCost = cost?.monthlyCostPerUser ?? 0

    const errors: string[] = []
    if (speed?.error) errors.push(`Speed: ${speed.error}`)
    if (quality?.error) errors.push(`Quality: ${quality.error}`)

    const overall =
      speedScore * weights.speed +
      qualityScore * weights.quality +
      costScore * weights.cost

    scores.push({
      modelId: candidate.id,
      modelName: candidate.name,
      speed: speedScore,
      quality: qualityScore,
      cost: costScore,
      overall,
      monthlyCost,
      grade: letterGrade(overall),
      speedGrade: letterGrade(speedScore),
      qualityGrade: letterGrade(qualityScore),
      costGrade: letterGrade(costScore),
      isBaseline: candidate.isBaseline,
      errors,
    })
  }

  scores.sort((a, b) => b.overall - a.overall)
  return scores
}
