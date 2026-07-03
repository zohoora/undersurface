# Full Remediation Master Plan (APP_REVIEW_FABLE5_2026-07-03)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every confirmed finding from the three app reviews and implement all Fable-5-window recommendations (Feats 0/A/B/C/D/E + HRV honesty layer + a11y/i18n + eval harness), in staged, independently-deployable tranches.

**Architecture:** Nine sequential stages, each producing working, tested, deployable software. Each stage gets its own detailed plan file written just-in-time (`2026-07-03-stage<N>-*.md` in this directory) because later stages' code depends on earlier stages' outcomes. Judgment-dense stages (2, 3, 4) are executed inline by the orchestrating session; mechanical tranches (i18n backfill, docs regeneration, translations) are delegated to subagents.

**Tech Stack:** React 18 + TypeScript strict + Vite + Tailwind v4 + TipTap v3 (frontend); Firebase Hosting/Functions (Node 22)/Firestore/Auth; OpenAI chat + realtime; Vitest.

## Global Constraints

- TypeScript strict mode, no `any`; `import type` for type-only imports; no semicolons; single quotes.
- All 1,105 frontend tests + 64 functions tests must stay green at every commit; run `npx tsc --noEmit -p tsconfig.json` (NOT `tsc -b`) plus `cd functions && npx tsc --noEmit` before every commit.
- i18n key parity is test-enforced: every new user-facing string goes through `t()` with keys added to ALL 17 locale files.
- Never weaken `useRealTalk = mode === 'real_talk' && !isGrounding` in `buildTherapistSystemPrompt`; both branches keep `SAFETY_RULES` verbatim; do not delete `therapistPrompts.test.ts` / `realTalkFlow.test.ts` guards.
- Crisis-classifier calibration must favor precision (history of over-calling grief/metaphor/hyperbole — see memory).
- Never prefix `npm run build` with dummy `VITE_FIREBASE_*` values (breaks Google Sign-In).
- User-facing "therapist" wording → **"companion"** (user decision). Internal identifiers stay.
- Webcam HRV: fix IBI math, but gate derived metrics (SDNN/pNN50/LF-HF/Baevsky/coherence) OUT of the AI prompt for `source === 'camera'`; keep HR + trend with hedged language; Polar keeps full metrics (user decision).
- Git: small coherent commits on `main`, push after each verified stage (user decision). Commit footer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + Claude-Session link.
- Deploys: staged (user decision) — after stage tests pass: `npm run build && firebase deploy --only hosting` and/or `cd functions && npx tsc && cd .. && firebase deploy --only functions` (`--force` when touching `chat` minInstances), then `npm run smoke-test`, then live-check via the logged-in Chrome browser. Prod is not in active use; deploys are safe (user confirmation).
- Colors via CSS variables only; admin components inline-styled light-only.

---

### Stage 0: Docs truth-up (Feat 0)

**Files:** Modify: `CLAUDE.md`, `README.md`. No deploy (docs only).

- [ ] Regenerate CLAUDE.md architecture/flow/key-files sections from actual code: session-first routing (no EntryChoice/LivingEditor), OpenAI (not OpenRouter), current function list, current collections. Verify every named file exists before naming it.
- [ ] Update README the same way.
- [ ] Keep all still-true gotchas; delete gotchas referencing removed systems; add pointers to the three APP_REVIEW files.
- [ ] Commit `docs: truth-up CLAUDE.md + README to session-first architecture`.

### Stage 1: Quick wins + production breakage (detailed plan: `2026-07-03-stage1-quick-wins.md`)

Fixes, each independently committable: meta-CSP media-src (Relax audio), mobile back-button/hamburger collision, therapist history windowing (50-msg brick), `email_verified` in verifyAdmin, `.limit()` on unbounded sessions scans, letter-trigger gate, GA crisis-event scrubbing, `sendInFlightRef` + immediate editor clear, `replaceState` initial redirect, functions tests in CI, memory slice/order fixes + summary sanitization in partPrompts, timezone default via `Intl`, invalid `/session/:id` redirect, "companion" rename (17 locales). **Deploy #1** (hosting + functions) + smoke test + Chrome live-check.

### Stage 2: Cross-channel crisis safety (Feat B core)

Voice-channel grounding push (`session.update` with rebuilt grounded instructions or session stop), standalone schema-enforced L2 classifier running in parallel in session mode (preamble absence → diagnostic event, not silent risk-0), L1 regex calibration against known over-callers, multilingual eval set expansion (17 languages, asymmetric gates), red-team tests for second-order injection via stored summaries/memories. **Deploy #2.**

### Stage 3: Session Runtime Kernel (Feat A)

`src/engine/sessionRuntime.ts`: epoch-fenced session lifetime (AbortController per session, checked after every await), serialized message-append queue, flush-on-exit typewriter completion, send lock. Decompose SessionView into shell + surface controllers around it. Fold in: preamble parsing opt-in flag (fixes diary streaming C5), inactivity-based stream timeout, error-vs-empty retry taxonomy, voice `start()` cancellation epochs, relax `end()` elapsed fix. Interleaving regression tests with fake timers (switch-mid-stream, back-mid-stream, double-Enter, voice-connect-then-leave, concurrent voice transcripts). **Deploy #3.**

### Stage 4: Memory system overhaul (Feat C)

`src/engine/memoryStore.ts`: recency+relevance scoring, content dedup (kills triplicates), token-budgeted context packer for prompt building; repair phantom-limb features (letters/echoes/quotes keyed to sessions, quiet-return `markQuiet` wiring with additive bonus); pruning/TTL policy for entrySummaries, innerWeather, sessionLog, learnedKeywords; bounded reads everywhere (`limit` + `where`); per-turn emotion-call throttle (30s parity with journal mode); feature-health counters surfaced in admin. **Deploy #4.**

### Stage 5: Webcam HRV gate + fix + hedge

Fix IBI double-count via absolute beat timestamps (dedup across overlapping windows) in `hrvSignalWorker.ts`; gate derived metrics out of `hrvTimeline.buildPromptContext` for `source === 'camera'` (HR + autonomic trend only, hedged phrasing); Polar unchanged; add missing tests for `computeDerivedMetrics` + compute handler; Polar reconnect interval-leak fix (clear before reopen). **Deploy #5.**

### Stage 6: Data lifecycle unification (Feat D)

`functions/src/shared/collections.ts` single registry (name, deletionPolicy, exportPolicy, writePolicy) consumed by: idempotent tombstone-first recursive deletion (subcollections before parents, `apiKeys` included, Auth user disabled first), complete export (`data.json` full portability + `journal.md` readable, including session messages; keys as metadata only), per-collection Firestore rules (function-owned collections `allow write: if false`), lifecycle test seeding every collection and asserting zero residue. **Deploy #6** (functions + rules + hosting).

### Stage 7: Cost hardening + durable quotas (Feat E)

SSE upstream abort on client disconnect + error frame on truncation; durable Firestore-backed per-user daily token/minute quotas (admin-configurable, transaction-based) enforced in chat/realtime/soundscape; per-role message length caps; MCP offset cap + composite index (or in-memory sort); soundscape claim-based generation dedup; admin `count()` aggregations for user list; sidebar `onSnapshot` (replaces 60s poll); offline-boot fix (drop `count()` from init path); sparse settings persistence (stop baking admin overrides into localStorage); cross-account reset on auth change (state, weather singleton, diagnostics uid capture). **Deploy #7.**

### Stage 8: UX / a11y / i18n backfill

Shared modal wrapper (focus trap/restore, Escape, `role="dialog"`) applied to consent dialogs; `prefers-reduced-motion` gating for all decorative animation + BilateralPulse freeze; keyboard/AT semantics for session list, biometrics bar, body map, ThinkingSpace; biometric error visibility (inline error row when `error && !enabled`); friendly mic-denial/voice-error states; Real Talk one-time explainer; ThinkingSpace reopen affordance; ~85 hardcoded strings → i18n keys + translations in all 17 locales (subagent-delegated translation passes). **Deploy #8.**

### Stage 9: Eval harness + design docs + handoff

Simulated-user eval harness (persona scripts × judge rubric over the real prompt stack with mocked transport, modeled on `crisisClassifier.eval.ts`); design docs for client-side encryption and the longitudinal insight engine (`docs/superpowers/specs/`); final CLAUDE.md refresh reflecting everything shipped; handoff doc with remaining recommendations. Final commit + push.

---

## Verification gate (every stage)

1. `npx tsc --noEmit -p tsconfig.json` and `cd functions && npx tsc --noEmit` — clean.
2. `npm run test` — all green; `cd functions && npm test` — all green.
3. `npm run lint` — clean.
4. `npm run build` — clean.
5. Commit; deploy per stage table; `npm run smoke-test`; Chrome live-check of the stage's user-visible behavior.
6. Push.
