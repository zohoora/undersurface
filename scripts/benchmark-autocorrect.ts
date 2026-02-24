/**
 * Benchmark small/cheap LLMs for autocorrect quality.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... npx tsx scripts/benchmark-autocorrect.ts
 */

const API_KEY = process.env.OPENROUTER_API_KEY
if (!API_KEY) {
  console.error('Set OPENROUTER_API_KEY env var')
  process.exit(1)
}

const SYSTEM_PROMPT = `Fix ONLY spelling errors, capitalization, and missing apostrophes in contractions.
Return ONLY the corrected text. If no corrections needed, return the input exactly.
Do NOT rephrase, add words, remove words, or add commentary.`

const MODELS = [
  'google/gemini-2.0-flash-lite-001',
  'google/gemini-2.0-flash-001',
  'anthropic/claude-3.5-haiku',
  'mistralai/mistral-small',
  'meta-llama/llama-3.1-8b-instruct',
  'deepseek/deepseek-chat',
  'qwen/qwen-2.5-7b-instruct',
]

interface TestCase {
  input: string
  expected: string
  label: string
}

const TEST_CASES: TestCase[] = [
  // English misspellings
  { input: 'I went to teh store yestreday.', expected: 'I went to the store yesterday.', label: 'English transposition + misspelling' },
  { input: 'She recieved the pacakge on wendsday.', expected: 'She received the package on Wednesday.', label: 'English multiple misspellings' },

  // Capitalization
  { input: 'the quick brown fox jumped.', expected: 'The quick brown fox jumped.', label: 'Sentence capitalization' },
  { input: 'i think i should go now.', expected: 'I think I should go now.', label: 'Lowercase i correction' },

  // Contractions
  { input: 'I dont think thats right.', expected: "I don't think that's right.", label: 'Missing apostrophes' },
  { input: 'They wouldnt have known.', expected: "They wouldn't have known.", label: 'Contraction apostrophe' },

  // Clean text (must return unchanged)
  { input: 'The morning light was beautiful.', expected: 'The morning light was beautiful.', label: 'Clean text (no change needed)' },
  { input: 'She walked to the park.', expected: 'She walked to the park.', label: 'Clean text 2 (no change needed)' },

  // Non-English
  { input: 'Ella fue al mercado ayer.', expected: 'Ella fue al mercado ayer.', label: 'Spanish clean text' },
  { input: 'Je suis allé au magsin hier.', expected: 'Je suis allé au magasin hier.', label: 'French misspelling' },

  // Persian
  { input: 'من امروز به مدرسه رفتم.', expected: 'من امروز به مدرسه رفتم.', label: 'Persian clean text' },

  // Mixed / proper nouns
  { input: 'I visited new york and saw the staute of liberty.', expected: 'I visited New York and saw the Statue of Liberty.', label: 'Proper nouns + misspelling' },

  // CJK
  { input: '我今天去了超市买了很多东西。', expected: '我今天去了超市买了很多东西。', label: 'Chinese clean text' },
  { input: '今日は公園に行きました。', expected: '今日は公園に行きました。', label: 'Japanese clean text' },
  { input: '오늘 공원에 갔어요.', expected: '오늘 공원에 갔어요.', label: 'Korean clean text' },

  // Hindi
  { input: 'मैंने आज बहुत काम किया।', expected: 'मैंने आज बहुत काम किया।', label: 'Hindi clean text' },

  // Russian
  { input: 'Я ходил в магазен вчера.', expected: 'Я ходил в магазин вчера.', label: 'Russian misspelling' },

  // Turkish
  { input: 'Bugün markete gittim.', expected: 'Bugün markete gittim.', label: 'Turkish clean text' },
]

interface ModelResult {
  model: string
  latencies: number[]
  results: { input: string; expected: string; actual: string; match: boolean; wordCountDiff: boolean }[]
}

async function callModel(model: string, input: string): Promise<{ text: string; latencyMs: number }> {
  const start = Date.now()
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
      temperature: 0,
      max_tokens: 200,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${model}: HTTP ${res.status} — ${body}`)
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim() ?? ''
  return { text, latencyMs: Date.now() - start }
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

async function benchmarkModel(model: string): Promise<ModelResult> {
  const result: ModelResult = { model, latencies: [], results: [] }

  for (const tc of TEST_CASES) {
    try {
      const { text, latencyMs } = await callModel(model, tc.input)
      result.latencies.push(latencyMs)
      result.results.push({
        input: tc.input,
        expected: tc.expected,
        actual: text,
        match: text === tc.expected,
        wordCountDiff: wordCount(text) !== wordCount(tc.input),
      })
    } catch (err) {
      console.error(`  Error on "${tc.label}":`, (err as Error).message)
      result.results.push({
        input: tc.input,
        expected: tc.expected,
        actual: `ERROR: ${(err as Error).message}`,
        match: false,
        wordCountDiff: false,
      })
    }
  }

  return result
}

async function main() {
  console.log(`Benchmarking ${MODELS.length} models against ${TEST_CASES.length} test cases...\n`)

  const allResults: ModelResult[] = []

  for (const model of MODELS) {
    process.stdout.write(`Testing ${model}...`)
    const result = await benchmarkModel(model)
    allResults.push(result)
    const accuracy = result.results.filter(r => r.match).length
    console.log(` ${accuracy}/${TEST_CASES.length} accurate`)
  }

  // Summary table
  console.log('\n' + '='.repeat(110))
  console.log(
    'Model'.padEnd(42) +
    'Accuracy'.padEnd(12) +
    'Identity'.padEnd(12) +
    'Halluc.'.padEnd(10) +
    'p50 ms'.padEnd(10) +
    'p90 ms'.padEnd(10),
  )
  console.log('-'.repeat(110))

  const cleanIndices = TEST_CASES.map((tc, i) => tc.input === tc.expected ? i : -1).filter(i => i >= 0)

  for (const r of allResults) {
    const accuracy = r.results.filter(x => x.match).length
    const identityCorrect = cleanIndices.filter(i => r.results[i].actual === r.results[i].expected).length
    const hallucinations = r.results.filter(x => x.wordCountDiff).length
    const p50 = r.latencies.length ? percentile(r.latencies, 50) : 0
    const p90 = r.latencies.length ? percentile(r.latencies, 90) : 0

    console.log(
      r.model.padEnd(42) +
      `${accuracy}/${TEST_CASES.length}`.padEnd(12) +
      `${identityCorrect}/${cleanIndices.length}`.padEnd(12) +
      `${hallucinations}`.padEnd(10) +
      `${p50}`.padEnd(10) +
      `${p90}`.padEnd(10),
    )
  }

  console.log('='.repeat(110))

  // Detailed mismatches
  console.log('\nDetailed mismatches:\n')
  for (const r of allResults) {
    const mismatches = r.results.filter(x => !x.match)
    if (mismatches.length === 0) continue
    console.log(`--- ${r.model} ---`)
    for (const m of mismatches) {
      console.log(`  Input:    ${m.input}`)
      console.log(`  Expected: ${m.expected}`)
      console.log(`  Actual:   ${m.actual}`)
      console.log()
    }
  }

  // Raw JSON output
  const jsonPath = 'scripts/benchmark-results.json'
  const fs = await import('fs')
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2))
  console.log(`\nRaw results written to ${jsonPath}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
