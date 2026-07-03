# Stage 1: Quick Wins + Production Breakage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 14 highest-value/lowest-risk fixes from APP_REVIEW_FABLE5_2026-07-03 §4 "Now" as small verified commits, then Deploy #1.

**Architecture:** Point fixes only — no refactors (those are Stages 3/4). Each task is independently committable and testable. TDD for logic changes; config/CSS changes verified by build + live check.

**Tech Stack:** Existing (React/TS strict/Vitest/Firebase).

## Global Constraints

- Inherit master plan constraints (docs/superpowers/plans/2026-07-03-full-remediation-master.md).
- Every commit: `npx tsc --noEmit -p tsconfig.json` clean + affected tests green.
- New user-facing strings → `t()` keys in all 17 locales (Task 14 is the only one adding strings).

---

### Task 1: Meta-CSP sync (restores Relax audio)

**Files:** Modify: `index.html:6`

- [ ] In the meta CSP: `media-src 'self' blob: capacitor:` → `media-src 'self' blob: capacitor: https://storage.googleapis.com`
- [ ] In the meta CSP `connect-src`: add `https://api.elevenlabs.io`, remove `https://openrouter.ai`
- [ ] Add comment-adjacent note in firebase.json? No — instead add a gotcha line to CLAUDE.md later (Stage 0 agent owns CLAUDE.md; skip here)
- [ ] `npm run build` passes; commit `fix(relax): allow storage.googleapis.com in meta CSP media-src — dual-CSP intersection was blocking all soundscape audio`

### Task 2: Mobile back-button / hamburger collision

**Files:** Modify: `src/components/Session/SessionView.tsx:424-441` and/or `src/styles/atmosphere.css` (back-button + hamburger rules ~1437)

- [ ] Read both components' positioning. Fix: on viewports where the hamburger renders (mobile breakpoint), offset the session back button right: `left: 60px` (CSS media query on the back button's class). Verify z-index so biometrics bar doesn't cover the hamburger: raise hamburger z-index above bar or add left padding to bar.
- [ ] Manual check via Chrome devtools mobile viewport after deploy. Commit `fix(mobile): session back button no longer covers sidebar hamburger`

### Task 3: Therapist history windowing (fixes 50-message brick)

**Files:** Modify: `src/ai/therapistPrompts.ts` (`buildTherapistMessages` ~:426). Test: `src/ai/therapistPrompts.test.ts`

- [ ] Failing test: build with 120-message history → result length ≤ 50, `result[0].role === 'system'`, last history message preserved verbatim, oldest dropped.

```ts
it('windows history to stay under the server message cap', () => {
  const history = Array.from({ length: 120 }, (_, i) => makeMsg(i))
  const msgs = buildTherapistMessages(sysOpts, history)
  expect(msgs.length).toBeLessThanOrEqual(50)
  expect(msgs[0].role).toBe('system')
  expect(msgs[msgs.length - 1].content).toBe(history[history.length - 1].content)
})
```

- [ ] Implementation: `const MAX_HISTORY = 48` (system + 48 ≤ 50 with headroom); `const windowed = history.slice(-MAX_HISTORY)`; when trimming occurred, prepend a one-line system-side note inside the system prompt? NO — keep minimal: just slice. Session summaries already carry long-term context.
- [ ] Tests green; commit `fix(session): window therapist history to 48 messages — sessions no longer brick at the server's 50-message cap`

### Task 4: email_verified in verifyAdmin

**Files:** Modify: `functions/src/shared/auth.ts:15-24`. Test: existing functions test file for auth (extend).

- [ ] Failing test: decoded token with admin email but `email_verified: false` → rejected.
- [ ] Implementation: require `decoded.email_verified === true` in the admin check.
- [ ] `cd functions && npm test` green; commit `fix(admin): require email_verified in verifyAdmin`

### Task 5: Bound the unbounded sessions scans

**Files:** Modify: `src/components/Sidebar/EntriesList.tsx:59`, `src/engine/sessionContextLoader.ts:19`. Tests: `src/engine/sessionContextLoader.test.ts`

- [ ] Sidebar query: `.limit(100)` (newest-first already). ContextLoader: `.limit(50)` before filtering to 5 notes. (onSnapshot conversion is Stage 7.)
- [ ] Update/extend contextLoader test asserting the limit is applied (db mock records limit).
- [ ] Commit `perf(firestore): bound sessions scans (sidebar 100, context loader 50)`

### Task 6: Letter trigger gate (stop letter-per-session spam)

**Files:** Modify: `src/engine/sessionReflectionEngine.ts:234-236`, `src/engine/letterEngine.ts`. Test: `src/engine/letterEngine.test.ts`

- [ ] Failing tests: (a) closed-session count 0 → no letter; (b) count 10, 0 letters → letter fires; (c) count 10, 1 letter already → no letter; (d) count 23, 2 letters → no letter (floor(23/10)=2); (e) count 30, 2 letters → fires.
- [ ] Implementation: replace the `entries.count() % N === 0` gate with self-healing quota: `lettersEarned = Math.floor(closedSessionCount / letterTriggerEntries)`; fire iff `existingLettersCount < lettersEarned`. Use `entrySummaries.count()` as the closed-session proxy (one summary per session close — verify in sessionReflectionEngine).
- [ ] Commit `fix(letters): gate letters on closed-session count with self-healing quota — was firing after every close (0 % 10 === 0)`

### Task 7: Scrub crisis/emotion signals from GA

**Files:** Modify: `src/store/groundingState.ts:36`, `src/engine/partOrchestrator.ts:461`. Check `src/services/analytics.ts` + diagnostics service.

- [ ] Remove the `grounding_activated` GA event; replace with a first-party diagnostics log (existing diagnostics service) carrying the trigger.
- [ ] Remove the `emotion` parameter from the `part_thought` GA event (keep the event).
- [ ] Grep for other sensitive params sent to GA (`emotion`, `risk`, `grounding`, `crisis`) and scrub similarly.
- [ ] Tests green; commit `fix(privacy): stop sending grounding/emotion signals to Google Analytics; log first-party diagnostics instead`

### Task 8: Send lock + immediate editor clear

**Files:** Modify: `src/components/Session/SessionView.tsx` (`handleSend` ~:218-232, editor-clear effect ~:399)

- [ ] Add `const sendInFlightRef = useRef(false)`; at top of `handleSend`: `if (sendInFlightRef.current) return; sendInFlightRef.current = true` with `finally { sendInFlightRef.current = false }`.
- [ ] Read the draft synchronously, clear the editor immediately after reading (before the await); on append failure restore the draft into the editor.
- [ ] Existing SessionView tests still green; add a double-invoke test if the harness supports it cheaply.
- [ ] Commit `fix(session): synchronous send lock + immediate editor clear — double-Enter no longer duplicates messages/streams`

### Task 9: replaceState for initial route redirect

**Files:** Modify: `src/App.tsx:114-117, 144-154`

- [ ] Add `replace` option to `navigateTo` (uses `history.replaceState` when true); the root-visit session redirect (`:153`) passes `replace: true`. Back from a session now leaves the app cleanly instead of landing on a blank shell.
- [ ] Commit `fix(routing): replaceState for the root→session redirect — Back no longer lands on a blank shell`

### Task 10: Invalid /session/:id → recover

**Files:** Modify: `src/components/Session/SessionView.tsx:111-124`

- [ ] When `db.sessions.get(id)` returns undefined: call `onBack()` (navigates to `/session/new`) instead of silent return.
- [ ] Commit `fix(session): unknown session id recovers to a new session instead of a dead composer`

### Task 11: Functions tests in CI

**Files:** Modify: `.github/workflows/ci.yml`

- [ ] Add step after functions typecheck: `cd functions && npm test` (verify functions/package.json test script + whether `npm ci` in functions dir is already in the workflow; add if missing).
- [ ] Commit `ci: run the 64 functions tests (were type-checked only)`

### Task 12: Memory recency fixes + summary sanitization

**Files:** Modify: `src/ai/therapistPrompts.ts:337-341`, `src/engine/partOrchestrator.ts:155-160`, `src/ai/partPrompts.ts:329-334`. Tests: `therapistPrompts.test.ts`, `partOrchestrator.test.ts`, `partPrompts.test.ts`

- [ ] Failing tests: (a) therapist prompt with 12 newest-first memories includes the NEWEST 6 reflections/4 patterns, not the oldest; (b) part memories are sorted by timestamp before the recency slice; (c) `emotionalArc`/`themes` containing `ignore previous instructions` arrive sanitized in the part system prompt.
- [ ] Implementations: `slice(0, n)` against the newest-first array in therapistPrompts; sort ascending by `timestamp` in `loadParts` so downstream `slice(-n)` takes newest; wrap summary fields with `sanitizeForPrompt` in partPrompts (match sibling call sites).
- [ ] Commit `fix(memory): prompts now get newest memories (not oldest/random); sanitize summaries in part prompts`

### Task 13: Timezone default via Intl

**Files:** Modify: `src/store/settings.ts:50`. Test: `src/store/settings.test.ts`

- [ ] `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'` as DEFAULTS value.
- [ ] Test: default settings timezone equals the environment zone (mock `Intl` or assert non-empty + validity via `new Intl.DateTimeFormat('en', { timeZone: tz })` not throwing).
- [ ] Commit `fix(settings): default timezone from the device, not America/New_York`

### Task 14: "Companion" rename (17 locales)

**Files:** Modify: `src/i18n/translations/*.ts` (all 17). Reference keys: en.ts:98-100 (`Therapist is listening`, `The therapist is here…`, `The therapist couldn't be reached.`) + grep every locale for rendered "therapist" equivalents.

- [ ] Grep `src/i18n/translations` + `src/components` + `src/hooks` for user-facing therapist strings (rendered text only; internal identifiers/keys unchanged).
- [ ] Replace with "companion" phrasing in en.ts, then translate the same change in the other 16 locales (native-quality, matching each locale's existing register for the surrounding keys).
- [ ] i18n parity tests green; commit `feat(copy): user-facing "therapist" → "companion" across all locales`

### Verification gate + Deploy #1 — DONE

- [x] tsc ×2 clean; 1113 frontend + 65 functions tests green; lint clean; build clean
- [x] Pushed (c370fce); deployed hosting+functions --force; smoke-test 5/5
- [x] Chrome live-check on undersurface.me: CSP fix CONFIRMED — ocean.mp3 fetches 206 + audio/mpeg, `new Audio().play()` succeeds (was CSP-blocked). Meta CSP media-src now includes storage.googleapis.com.

**Residual finding (defer to Relax hardening in Stage 8, NOT a Stage 1 regression):** the app's own `useRelaxSession.begin()` still logged one `NotSupportedError` on play despite the source loading fine. Likely a play/load race (`el.play()` called synchronously right after `new Audio(src)`) or the stale saved `custom` prompt with no generated audio. Fix: `el.addEventListener('canplay', () => el.play().catch(...))` or await `el.load()`, and guard the custom path when no cached audio URL exists.
