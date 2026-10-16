import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required for the release eval gate')
  process.exit(2)
}

const suites = [
  ['crisis', 'test:crisis'],
  ['signals', 'test:signals'],
  ['parts', 'test:parts'],
  ['intentions', 'test:intentions'],
  ['stance', 'test:stance'],
  ['depth', 'test:depth'],
  ['folio-safety', 'test:folio-safety'],
  ['folio-ask', 'test:folio'],
  ['folio-companion', 'test:folio-companion'],
]

const promptFiles = [
  'src/ai/crisisClassifierPrompt.ts',
  'src/ai/signalClassifierPrompt.ts',
  'src/ai/therapistPrompts.ts',
  'src/ai/partPrompts.ts',
  'src/engine/crisisClassifier.eval.ts',
  'src/folio/ask/askPrompt.ts',
  'src/folio/companion/calls.ts',
  'functions/src/shared/companionKernel.ts',
]

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const artifactRoot = join('.artifacts', 'model-evals')
const runDir = join(artifactRoot, timestamp)
mkdirSync(runDir, { recursive: true })

const promptHash = createHash('sha256')
for (const file of promptFiles) {
  promptHash.update(file)
  promptHash.update(readFileSync(file))
}

const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
const manifest = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  gitCommit: git.status === 0 ? git.stdout.trim() : null,
  promptHash: promptHash.digest('hex'),
  models: {
    crisis: process.env.CRISIS_EVAL_MODEL ?? 'gpt-5-nano',
    applicationChat: process.env.OPENAI_CHAT_MODEL ?? 'gpt-5.5',
  },
  suites: [],
}

for (const [name, script] of suites) {
  const started = Date.now()
  const result = spawnSync('npm', ['run', script], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  })
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}`
  writeFileSync(join(runDir, `${name}.log`), log)
  manifest.suites.push({
    name,
    script,
    passed: result.status === 0,
    exitCode: result.status,
    durationMs: Date.now() - started,
    log: `${name}.log`,
  })
  process.stdout.write(`[${result.status === 0 ? 'pass' : 'FAIL'}] ${name}\n`)
}

const passed = manifest.suites.every(suite => suite.passed)
const finished = {
  ...manifest,
  finishedAt: new Date().toISOString(),
  passed,
}
writeFileSync(join(runDir, 'manifest.json'), `${JSON.stringify(finished, null, 2)}\n`)
writeFileSync(join(artifactRoot, 'latest.json'), `${JSON.stringify(finished, null, 2)}\n`)

console.log(`Release eval artifact: ${join(runDir, 'manifest.json')}`)
if (!passed) process.exit(1)
