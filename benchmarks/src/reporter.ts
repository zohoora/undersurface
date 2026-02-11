import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BenchmarkResult, CompositeScore } from './types.js'

// Box-drawing table renderer for terminal output
function pad(str: string, len: number, align: 'left' | 'right' = 'left'): string {
  const s = str.slice(0, len)
  const padding = len - s.length
  if (padding <= 0) return s
  return align === 'right'
    ? ' '.repeat(padding) + s
    : s + ' '.repeat(padding)
}

function renderTable(scores: CompositeScore[]): string {
  const cols = {
    rank: 4,
    model: 30,
    score: 6,
    speed: 8,
    quality: 8,
    cost: 8,
    monthly: 8,
  }

  const top = `┌${'─'.repeat(cols.rank + 2)}┬${'─'.repeat(cols.model + 2)}┬${'─'.repeat(cols.score + 2)}┬${'─'.repeat(cols.speed + 2)}┬${'─'.repeat(cols.quality + 2)}┬${'─'.repeat(cols.cost + 2)}┬${'─'.repeat(cols.monthly + 2)}┐`
  const mid = `├${'─'.repeat(cols.rank + 2)}┼${'─'.repeat(cols.model + 2)}┼${'─'.repeat(cols.score + 2)}┼${'─'.repeat(cols.speed + 2)}┼${'─'.repeat(cols.quality + 2)}┼${'─'.repeat(cols.cost + 2)}┼${'─'.repeat(cols.monthly + 2)}┤`
  const header = `│ ${pad('#', cols.rank)} │ ${pad('Model', cols.model)} │ ${pad('Score', cols.score, 'right')} │ ${pad('Speed', cols.speed, 'right')} │ ${pad('Quality', cols.quality, 'right')} │ ${pad('Cost', cols.cost, 'right')} │ ${pad('$/month', cols.monthly, 'right')} │`

  const rows = scores.map((s, i) => {
    const rank = `${i + 1}.`
    const modelLabel = s.isBaseline ? `${s.modelId} *` : s.modelId
    const scoreStr = s.overall.toFixed(1)
    const speedStr = `${Math.round(s.speed)} ${s.speedGrade}`
    const qualityStr = `${Math.round(s.quality)} ${s.qualityGrade}`
    const costStr = `${Math.round(s.cost)} ${s.costGrade}`
    const monthlyStr = `$${s.monthlyCost.toFixed(2)}`

    return `│ ${pad(rank, cols.rank)} │ ${pad(modelLabel, cols.model)} │ ${pad(scoreStr, cols.score, 'right')} │ ${pad(speedStr, cols.speed, 'right')} │ ${pad(qualityStr, cols.quality, 'right')} │ ${pad(costStr, cols.cost, 'right')} │ ${pad(monthlyStr, cols.monthly, 'right')} │`
  })

  // Fix bottom border
  const bottom = `└${'─'.repeat(cols.rank + 2)}┴${'─'.repeat(cols.model + 2)}┴${'─'.repeat(cols.score + 2)}┴${'─'.repeat(cols.speed + 2)}┴${'─'.repeat(cols.quality + 2)}┴${'─'.repeat(cols.cost + 2)}┴${'─'.repeat(cols.monthly + 2)}┘`

  return [top, header, mid, ...rows, bottom, '', '  * = current baseline'].join('\n')
}

function renderMarkdown(result: BenchmarkResult): string {
  const lines: string[] = [
    `# UnderSurface LLM Benchmark Results`,
    '',
    `**Date:** ${result.timestamp}`,
    `**Duration:** ${(result.duration / 1000).toFixed(0)}s`,
    `**Candidates tested:** ${result.results.length}`,
    `**Weights:** Speed=${result.config.weights.speed}, Quality=${result.config.weights.quality}, Cost=${result.config.weights.cost}`,
    '',
    '## Rankings',
    '',
    '| # | Model | Score | Speed | Quality | Cost | $/month |',
    '|---|-------|-------|-------|---------|------|---------|',
  ]

  for (const [i, s] of result.results.entries()) {
    const baseline = s.isBaseline ? ' *' : ''
    lines.push(
      `| ${i + 1} | ${s.modelId}${baseline} | ${s.overall.toFixed(1)} | ${Math.round(s.speed)} ${s.speedGrade} | ${Math.round(s.quality)} ${s.qualityGrade} | ${Math.round(s.cost)} ${s.costGrade} | $${s.monthlyCost.toFixed(2)} |`
    )
  }

  lines.push('')
  lines.push('\\* = current baseline')

  if (result.errors.length > 0) {
    lines.push('')
    lines.push('## Errors')
    lines.push('')
    for (const err of result.errors) {
      lines.push(`- ${err}`)
    }
  }

  // Per-model detail sections
  lines.push('')
  lines.push('## Detailed Results')
  lines.push('')

  for (const score of result.results) {
    lines.push(`### ${score.modelId}`)
    lines.push('')
    lines.push(`- **Overall:** ${score.overall.toFixed(1)} (${score.grade})`)
    lines.push(`- **Speed:** ${Math.round(score.speed)} (${score.speedGrade})`)
    lines.push(`- **Quality:** ${Math.round(score.quality)} (${score.qualityGrade})`)
    lines.push(`- **Cost:** ${Math.round(score.cost)} (${score.costGrade}) — $${score.monthlyCost.toFixed(2)}/month`)

    const speedDetail = result.speedResults.find((r) => r.modelId === score.modelId)
    if (speedDetail?.streaming) {
      lines.push(`- **Streaming:** TTFB ${speedDetail.streaming.ttfbMs.toFixed(0)}ms, Total ${speedDetail.streaming.totalMs.toFixed(0)}ms, ${speedDetail.streaming.tokensPerSecond.toFixed(1)} tok/s`)
    }
    if (speedDetail?.nonStreaming) {
      lines.push(`- **Non-streaming:** ${speedDetail.nonStreaming.totalMs.toFixed(0)}ms`)
    }

    const qualityDetail = result.qualityResults.find((r) => r.modelId === score.modelId)
    if (qualityDetail) {
      lines.push(`- **Quality breakdown:** Thoughts=${qualityDetail.scores.partThoughts}, Emotion=${qualityDetail.scores.emotionDetection}, Reflection=${qualityDetail.scores.reflection}, Emergence=${qualityDetail.scores.emergence}, Growth=${qualityDetail.scores.growth}, Explorations=${qualityDetail.scores.explorations}`)
    }

    if (score.errors.length > 0) {
      lines.push(`- **Errors:** ${score.errors.join('; ')}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function printProgress(message: string, detail?: string): void {
  const timestamp = new Date().toLocaleTimeString()
  if (detail) {
    process.stdout.write(`\r[${timestamp}] ${message} — ${detail}`)
  } else {
    console.log(`[${timestamp}] ${message}`)
  }
}

export function printResults(scores: CompositeScore[]): void {
  console.log('')
  console.log(renderTable(scores))
  console.log('')
}

export function printDryRun(
  candidates: { id: string; promptPrice: number; completionPrice: number; isBaseline: boolean }[],
  estimatedCost: number,
  estimatedCalls: number,
): void {
  console.log('')
  console.log('=== DRY RUN — Candidates ===')
  console.log('')
  for (const [i, c] of candidates.entries()) {
    const baseline = c.isBaseline ? ' *' : ''
    console.log(
      `  ${i + 1}. ${c.id}${baseline}  (prompt: $${c.promptPrice.toFixed(4)}/M, completion: $${c.completionPrice.toFixed(4)}/M)`
    )
  }
  console.log('')
  console.log(`  Estimated API calls: ~${estimatedCalls}`)
  console.log(`  Estimated cost: ~$${estimatedCost.toFixed(2)}`)
  console.log('')
  console.log('  * = current baseline')
  console.log('')
}

export function saveResults(result: BenchmarkResult, outputDir: string): { jsonPath: string; mdPath: string } {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const ts = result.timestamp.replace(/[:.]/g, '-')
  const jsonPath = join(outputDir, `benchmark-${ts}.json`)
  const mdPath = join(outputDir, `benchmark-${ts}.md`)

  writeFileSync(jsonPath, JSON.stringify(result, null, 2))
  writeFileSync(mdPath, renderMarkdown(result))

  return { jsonPath, mdPath }
}
