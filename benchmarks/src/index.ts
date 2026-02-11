#!/usr/bin/env node

import { Command } from 'commander'
import type { BenchmarkConfig, BenchmarkResult, SpeedResult, QualityResult, CostResult } from './types.js'
import { DEFAULT_WEIGHTS, BASELINE_MODEL, OPENROUTER_BASE } from './config.js'
import { fetchAndFilterModels, estimateBenchmarkCost } from './prefilter.js'
import { measureSpeed } from './speedTest.js'
import { measureQuality } from './qualityTest.js'
import { calculateCost } from './costCalc.js'
import { computeCompositeScores } from './composite.js'
import { getTestCases } from './testCases.js'
import { printProgress, printResults, printDryRun, saveResults } from './reporter.js'

function parseWeights(input: string): { speed: number; quality: number; cost: number } {
  const parts = input.split(',')
  const result = { ...DEFAULT_WEIGHTS }
  for (const part of parts) {
    const [key, val] = part.split('=')
    const num = parseFloat(val)
    if (key === 'speed' && !isNaN(num)) result.speed = num
    if (key === 'quality' && !isNaN(num)) result.quality = num
    if (key === 'cost' && !isNaN(num)) result.cost = num
  }
  // Normalize to sum to 1
  const sum = result.speed + result.quality + result.cost
  if (sum > 0) {
    result.speed /= sum
    result.quality /= sum
    result.cost /= sum
  }
  return result
}

async function checkCredits(apiKey: string): Promise<number | null> {
  try {
    const response = await fetch(`${OPENROUTER_BASE}/credits`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (!response.ok) return null
    const data = await response.json() as { data?: { total_credits?: number; total_usage?: number } }
    if (data.data) {
      const remaining = (data.data.total_credits ?? 0) - (data.data.total_usage ?? 0)
      return remaining
    }
    return null
  } catch {
    return null
  }
}

async function main() {
  const program = new Command()
    .name('undersurface-benchmark')
    .description('LLM benchmarking tool for UnderSurface')
    .requiredOption('--api-key <key>', 'OpenRouter API key')
    .option('--max-candidates <n>', 'Maximum models to evaluate', '20')
    .option('--timing-runs <n>', 'Timing runs per model', '3')
    .option('--judge-model <model>', 'Model for LLM-as-judge', 'anthropic/claude-sonnet-4')
    .option('--weights <w>', 'Scoring weights (speed=N,quality=N,cost=N)', 'speed=0.3,quality=0.5,cost=0.2')
    .option('--output-dir <dir>', 'Output directory for results', 'benchmarks/results')
    .option('--verbose', 'Verbose output', false)
    .option('--include-model <models...>', 'Additional models to always include')
    .option('--only-models <models...>', 'Skip filter, test only these models')
    .option('--skip-judge', 'Skip LLM-as-judge evaluation (faster/cheaper)', false)
    .option('--dry-run', 'Phase 1 only — show candidates and cost estimate', false)
    .parse()

  const opts = program.opts()
  const config: BenchmarkConfig = {
    apiKey: opts.apiKey,
    maxCandidates: parseInt(opts.maxCandidates),
    timingRuns: parseInt(opts.timingRuns),
    judgeModel: opts.judgeModel,
    weights: parseWeights(opts.weights),
    outputDir: opts.outputDir,
    verbose: opts.verbose,
    includeModels: opts.includeModel || [],
    onlyModels: opts.onlyModels || [],
    skipJudge: opts.skipJudge,
    dryRun: opts.dryRun,
    baselineModel: BASELINE_MODEL,
  }

  const progress = config.verbose
    ? printProgress
    : (msg: string) => { process.stdout.write(`\r${msg}${''.padEnd(20)}`) }

  // ─── Check credits ──────────────────────────────────────
  progress('Checking OpenRouter credits...')
  const credits = await checkCredits(config.apiKey)
  if (credits !== null) {
    if (credits < 0.50) {
      console.warn(`\n⚠ Low credits: $${credits.toFixed(2)} remaining. Benchmark may cost $0.70–$1.50.`)
    } else {
      progress(`Credits available: $${credits.toFixed(2)}`)
    }
  } else {
    progress('Could not check credits (non-fatal)')
  }
  console.log('')

  // ─── Phase 1: Pre-filter ────────────────────────────────
  progress('Phase 1: Fetching and filtering models...')

  let candidates
  if (config.onlyModels.length > 0) {
    // Skip filter — create minimal candidates from model IDs
    const response = await fetch(`${OPENROUTER_BASE}/models`)
    const data = await response.json() as { data: Array<{ id: string; name: string; context_length: number; pricing: { prompt: string; completion: string }; top_provider?: { max_completion_tokens?: number } }> }
    candidates = config.onlyModels.map((id) => {
      const model = data.data.find((m) => m.id === id)
      return {
        id,
        name: model?.name ?? id,
        contextLength: model?.context_length ?? 0,
        promptPrice: model ? parseFloat(model.pricing.prompt) * 1_000_000 : 0,
        completionPrice: model ? parseFloat(model.pricing.completion) * 1_000_000 : 0,
        maxCompletionTokens: model?.top_provider?.max_completion_tokens ?? 4096,
        provider: id.split('/')[0],
        priorityScore: 0,
        isBaseline: id === BASELINE_MODEL,
      }
    })
  } else {
    candidates = await fetchAndFilterModels(
      config.maxCandidates,
      config.includeModels,
      config.verbose ? progress : undefined,
    )
  }

  console.log(`\nFound ${candidates.length} candidates`)

  // ─── Dry run: show candidates and exit ──────────────────
  if (config.dryRun) {
    const estimate = estimateBenchmarkCost(candidates)
    printDryRun(candidates, estimate.estimatedCost, estimate.estimatedApiCalls)
    return
  }

  // ─── Phase 2: Deep evaluation ───────────────────────────
  const testCases = getTestCases()
  const streamingTest = testCases.find((t) => t.pattern === 'partThought' && t.stream)!
  const nonStreamingTest = testCases.find((t) => t.pattern === 'emotionDetection')!

  const speedResults: SpeedResult[] = []
  const qualityResults: QualityResult[] = []
  const costResults: CostResult[] = []
  const errors: string[] = []
  const startTime = Date.now()

  for (const [i, candidate] of candidates.entries()) {
    const label = `[${i + 1}/${candidates.length}] ${candidate.id}`

    // ─── 2a. Speed ────────────────────────────────────
    progress(`${label}: measuring speed...`)
    try {
      const speed = await measureSpeed(
        candidate.id,
        config.apiKey,
        streamingTest,
        nonStreamingTest,
        config.timingRuns,
        config.verbose ? (msg) => progress(`${label}: ${msg}`) : undefined,
      )
      speedResults.push(speed)
      if (config.verbose && speed.streaming) {
        console.log(`\n  Speed: TTFB=${speed.streaming.ttfbMs.toFixed(0)}ms, Total=${speed.streaming.totalMs.toFixed(0)}ms, ${speed.streaming.tokensPerSecond.toFixed(1)} tok/s → ${Math.round(speed.score)}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Speed error for ${candidate.id}: ${msg}`)
      speedResults.push({
        modelId: candidate.id,
        streaming: null,
        nonStreaming: null,
        score: 0,
        error: msg,
        supportsStreaming: false,
      })
    }

    // ─── 2b. Quality ──────────────────────────────────
    progress(`${label}: measuring quality...`)
    try {
      const quality = await measureQuality(
        candidate.id,
        config.apiKey,
        testCases,
        config.judgeModel,
        config.skipJudge,
        config.verbose ? (msg) => progress(`${label}: ${msg}`) : undefined,
      )
      qualityResults.push(quality)
      if (config.verbose) {
        console.log(`\n  Quality: thoughts=${quality.scores.partThoughts}, emotion=${quality.scores.emotionDetection}, reflection=${quality.scores.reflection} → ${Math.round(quality.overall)}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Quality error for ${candidate.id}: ${msg}`)
      qualityResults.push({
        modelId: candidate.id,
        scores: { partThoughts: 0, emotionDetection: 0, reflection: 0, emergence: 0, growth: 0, explorations: 0 },
        overall: 0,
        details: [],
        error: msg,
      })
    }

    // ─── 2c. Cost ─────────────────────────────────────
    const cost = calculateCost(candidate)
    costResults.push(cost)
  }

  // ─── Composite scoring ──────────────────────────────────
  console.log('')
  progress('Computing composite scores...')

  const compositeScores = computeCompositeScores(
    candidates,
    speedResults,
    qualityResults,
    costResults,
    config.weights,
  )

  // ─── Output ─────────────────────────────────────────────
  printResults(compositeScores)

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    config: {
      maxCandidates: config.maxCandidates,
      timingRuns: config.timingRuns,
      judgeModel: config.judgeModel,
      weights: config.weights,
      outputDir: config.outputDir,
      verbose: config.verbose,
      includeModels: config.includeModels,
      onlyModels: config.onlyModels,
      skipJudge: config.skipJudge,
      dryRun: config.dryRun,
      baselineModel: config.baselineModel,
    },
    candidates,
    results: compositeScores,
    speedResults,
    qualityResults,
    costResults,
    errors,
    duration: Date.now() - startTime,
  }

  const { jsonPath, mdPath } = saveResults(result, config.outputDir)
  console.log(`Results saved to:`)
  console.log(`  JSON: ${jsonPath}`)
  console.log(`  Markdown: ${mdPath}`)
  console.log(``)
  console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(0)}s`)

  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s) encountered:`)
    for (const err of errors) {
      console.log(`  - ${err}`)
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
