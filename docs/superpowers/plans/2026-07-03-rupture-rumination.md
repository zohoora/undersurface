# Rupture Repair + Rumination Pivot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Executed same-session by the plan author with user pre-approval ("autonomously implement"), so steps carry exact interfaces/thresholds rather than full duplicated code bodies; spec: `docs/superpowers/specs/2026-07-03-rupture-rumination-design.md`.

**Goal:** Companion detects alliance ruptures (repairs explicitly at next opener, softens silently mid-session) and rumination loops (pivots register silently), per the approved spec.

**Architecture:** Deterministic rupture facts + per-turn gpt-5-nano `signal_check` classifier + reflection-pass `loopSignal`; state in `companionSignals` singleton; three new prompt blocks with grounding suppression.

**Tech stack:** existing app conventions (TS strict, Vitest, no semicolons, single quotes).

## Global constraints

- Gate every commit on `npx tsc -b --force` + relevant tests + `npm run lint`; functions changes also `cd functions && npx tsc` + `npm test`.
- Crisis classifier (prompt, route, calibration) untouched.
- Both features behind experimental flags `ruptureRepair` / `ruminationPivot`, default off, `=== true` gating.
- `isGrounding` suppresses all three new prompt blocks.
- Precision-first thresholds exactly as specified in the spec.

---

### Task 1: `companionSignals` collection registration

**Files:** Modify `src/types/index.ts` (add `CompanionSignals` interface from spec), `src/store/db.ts` (add `companionSignals` to the `db` proxy object literal), `src/store/dataExport.ts` (add `'companionSignals'` to `collectionNames` in `exportAllData`), `functions/src/shared/collections.ts` (append `'companionSignals'` to `USER_SUBCOLLECTIONS`).

**Produces:** `db.companionSignals.get('current') / update / add` typed as `CompanionSignals`.

- [ ] Add interface + registrations (4 files)
- [ ] Run functions `account.test.ts` (registry-driven — picks the new collection up automatically) + frontend `dataExport` tests; typecheck both sides
- [ ] Commit `feat(signals): register companionSignals collection`

### Task 2: `src/engine/ruptureDetector.ts` (pure) + tests

**Produces:**
```ts
export type RuptureEvidence = 'abandoned' | 'terse_ending' | 'atypical_gap'
export function detectAbandonedSession(prior: Session[], now: number): boolean  // prior sorted newest-first, excludes current
export function detectAtypicalGap(prior: Session[], now: number): boolean
export function detectTerseEnding(userMessageLengths: number[]): boolean        // lengths in message order
export function detectOpenTimeEvidence(prior: Session[], now: number): RuptureEvidence | null  // abandoned wins over gap
```
Thresholds per spec: abandoned = newest prior `active` && `messageCount >= 4` && age > 6h && closed-ratio of last 10 ≥ 0.5. Gap = gap > 3× median inter-session gap && > 10 days && ≥ 5 prior sessions. Terse = ≥ 8 user messages && last 3 each < 40% of session median.

- [ ] Write `ruptureDetector.test.ts` first: each marker's fire/no-fire edges (habit guard, sparse history, exact boundary values)
- [ ] Implement; tests green; lint; commit `feat(signals): deterministic rupture evidence detectors`

### Task 3: `src/engine/signalTracker.ts` (pure class) + tests

**Produces:**
```ts
export class SignalTracker {
  record(s: { withdrawal: 0|1|2; rumination: 0|1|2 }): { pivotActive: boolean; softenActive: boolean }
  reset(): void
}
```
Rules: pivot arms on 2 consecutive rumination=2, then 6-turn cooldown (pivotActive true for the single arming turn; cooldown counts turns until re-armable). Soften arms on 2 consecutive withdrawal=2, releases after 2 consecutive withdrawal=0.

- [ ] Tests first: arm-at-2nd, no-arm-on-1-then-0, cooldown length, soften arm/release, reset
- [ ] Implement; green; commit `feat(signals): hysteresis/cooldown signal tracker`

### Task 4: classifier prompt + client wrapper

**Files:** Create `src/ai/signalClassifierPrompt.ts` (`SIGNAL_CLASSIFIER_PROMPT` — tier definitions for withdrawal 0/1/2 and rumination 0/1/2, distress-out-of-scope rule, JSON-only instruction). Modify `src/ai/openrouter.ts`:
```ts
export interface SessionSignalsResult { withdrawal: 0|1|2; rumination: 0|1|2; theme?: string }
export async function classifySessionSignals(recentUserMessages: string[]): Promise<SessionSignalsResult>
```
Mirrors `classifyCrisisRisk`: 5s abort, `task: 'signal_check'`, fail-open `{ withdrawal: 0, rumination: 0 }`, input = last 6 messages joined, ~2400 char cap, theme truncated to 60 chars.

- [ ] Tests in `openrouter.test.ts`: happy-path parse, malformed JSON → zeros, network error → zeros
- [ ] Implement; green; commit `feat(signals): session signal classifier client + prompt`

### Task 5: `signal_check` route in `functions/src/chat.ts`

Mirror `crisis_check`: `SIGNAL_RESPONSE_FORMAT` json_schema (`withdrawal` int enum 0-2, `rumination` int enum 0-2, `theme` string, all required, `additionalProperties: false`), routes to `OPENAI_CRISIS_MODEL` (nano), `reasoning_effort: 'minimal'`, cap 500, forces non-streaming, **quota-exempt** (`!isCrisisCheck && !isSignalCheck` guard).

- [ ] Tests in `index.test.ts`: routes to nano + schema, non-streaming forced, quota not consulted for signal_check
- [ ] Implement; `cd functions && npx tsc && npm test`; commit `feat(chat): signal_check route (nano, strict schema, quota-exempt)`

### Task 6: prompt blocks in `src/ai/therapistPrompts.ts`

Add to `TherapistPromptOptions`: `repairContext?: { evidence: RuptureEvidence }`, `pivotDirective?: { theme?: string }`, `softenStance?: boolean`. Block copy per spec §Prompt integration. Suppression: all three skipped when `isGrounding`; `repairContext` only when `isFirstTurn`; `pivotDirective` only when `!isFirstTurn`. Theme wrapped in the existing untrusted-content convention. Extend `buildSessionReflectionPrompt` output-schema instructions with `loopSignal: { present, theme, newInformation }`.

- [ ] Tests first in `therapistPrompts.test.ts` (mirror realTalkFlow style): block present under flag conditions, absent under grounding, first-turn rules both directions, reflection prompt mentions loopSignal
- [ ] Implement; green; commit `feat(signals): repair/pivot/soften prompt blocks + loopSignal schema`

### Task 7: `sessionReflectionEngine.ts` — loopSignal + terse-ending

Parse `parsed.loopSignal` (tolerate absence/malformed → treated as `present: false`). Streak logic on `companionSignals.ruminationWatch` per spec (client counts consecutive `present && !newInformation`; 3 arms; break clears). Compute `detectTerseEnding` from the session's user messages; if fired, write `pendingRepair { evidence: 'terse_ending', sourceSessionId, createdAt }` (newest evidence wins the single slot). Both writes only under their respective flags.

- [ ] Tests: streak arm at 3, clear on break, malformed loopSignal ignored, terse-ending write, flag gating
- [ ] Implement; green; commit `feat(signals): reflection-pass loop tracking + terse-ending marker`

### Task 8: `sessionContextLoader.ts` — open-time evidence + state load

`loadTherapistContext` additionally loads `companionSignals` and the prior-session list it already fetches; compute `detectOpenTimeEvidence`; return `{ repairContext?, ruminationWatch? }` in `TherapistContext`. Open-time evidence arms/overwrites `pendingRepair` (persist) so the consume-once flow is uniform.

- [ ] Tests: evidence computed + persisted, existing pendingRepair passed through, flags gate
- [ ] Implement; green; commit `feat(signals): context loader arms open-time rupture evidence`

### Task 9: `useSessionStream.ts` wiring

- Opener: if `repairContext` present (+ flag), pass to prompt build for the first turn only, then clear `pendingRepair` in Firestore (consume-once, fire-and-forget).
- If `ruminationWatch` armed (+ flag), pass `pivotDirective` (with theme) on non-first turns.
- Per user turn ≥ 3 (+ either flag): fire `classifySessionSignals` with the last 6 user messages, feed `SignalTracker`; `pivotActive` → `pivotDirective` next build; `softenActive` → `softenStance` next build. Never await it in the stream path.
- Tracker reset on session change; grounding takes precedence at the prompt layer (already enforced in Task 6).

- [ ] Tests in `useSessionStream.test.ts`: classifier fired ≥ turn 3 only + flag gate, repair consumed once, options threaded, no firing when flags off
- [ ] Implement; green; commit `feat(signals): live signal wiring in the session stream`

### Task 10: flags + docs + voice passthrough

`src/admin/adminTypes.ts` features: `ruptureRepair?: boolean`, `ruminationPivot?: boolean`; `AdminSettings.tsx` defaults `false` + toggles (Part Intelligence section); `.claude/docs/feature-flags.md` rows; verify `useSessionVoice` receives `repairContext`/`pivotDirective` via the shared context/prompt path (session-start only). CLAUDE.md: short subsystem note + collection count 18→19.

- [ ] Implement; typecheck + lint + full suites both sides; commit `feat(signals): flags, docs, voice passthrough`

### Task 11: live eval + ship

Create `src/ai/signalClassifier.live.test.ts` gated on `RUN_SIGNAL_EVAL=1` (script `test:signals`): confusables — rumination vs grief retelling, withdrawal vs natural brevity, distress must return zeros.

- [ ] Full gates: `npx tsc -b --force`, `npm run test`, `npm run lint`, functions `npx tsc` + `npm test`
- [ ] `npm run build` + deploy hosting + functions (`--force` for chat minInstances) + `npm run smoke-test`
- [ ] Commit `feat(signals): live eval harness` + push
