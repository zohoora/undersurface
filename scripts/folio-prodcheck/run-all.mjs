// Folio's production checks (docs/vision/folio-build-plan.md §6), run in order
// as the test account `folio-test@undersurface.me`. The password is read from
// the macOS Keychain (service `undersurface-folio-test`) by each script and is
// never printed. Each script cleans up its own pages and kept things.
//
//   node scripts/folio-prodcheck/run-all.mjs            # production
//   BASE_URL=http://localhost:4174 node scripts/folio-prodcheck/run-all.mjs
//
// A local build reaches production's /api through Vite's proxy (vite preview
// inherits server.proxy), so every check runs against a local build too.
//
// Not run here, because they need the owner's signed-in gcloud (admin-rest.cjs)
// and change more than the test account's pages (plan §8.G, 2026-10-16):
//   folio-return-slip-check.cjs   the Return slip (clears the checks' own
//                                 lastGroundingAt, backdates one test trace)
//   folio-access-check.cjs        EXPECT=bounced|open, with the test account's
//                                 folio claim removed (admin-rest setTestClaims)
//   sessions-zoom-card-check.cjs  the web viewport and the Sessions crisis
//                                 card's contrast (one L1 Talk message)
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const checks = [
  ['Sessions (Talk reply, crisis_check)', 'sessions-check.cjs'],
  ['Folio: write, lift, save, shore, Quiet', 'folio-check.cjs'],
  ['Folio: accessibility (axe, keyboard path)', 'folio-a11y-check.cjs'],
  ['Folio: Kept (step 7)', 'folio-kept-check.cjs'],
  ['Folio: Step inside (step 8)', 'folio-inside-check.cjs'],
  ['Folio: Ask (step 9)', 'folio-ask-check.cjs'],
  ['Folio: Return settings (step 10)', 'folio-return-check.cjs'],
]
let failed = 0
const rows = []
for (const [name, file] of checks) {
  const started = Date.now()
  const r = spawnSync(process.execPath, [join(here, file)], { encoding: 'utf8', env: process.env, timeout: 15 * 60 * 1000 })
  const ok = r.status === 0
  if (!ok) failed++
  rows.push(`| ${name} | ${ok ? 'pass' : 'FAIL'} | ${Math.round((Date.now() - started) / 1000)} s |`)
  if (!ok) console.error(`--- ${file} ---\n${(r.stdout || '').slice(-3000)}${(r.stderr || '').slice(-1000)}`)
}
const left = spawnSync(process.execPath, [join(here, 'account-inspect.cjs')], { encoding: 'utf8', env: process.env })
console.log('| Check | Result | Time |\n|---|---|---|\n' + rows.join('\n'))
console.log(`\nTest account afterwards:\n${left.stdout}`)
process.exit(failed === 0 ? 0 : 1)
