# User Parts Backfill (SP1.5) — Design + Plan

**Date:** 2026-07-04
**Status:** Approved ("Yes" to the design offered in-session)
**Parent:** `2026-07-04-user-parts-model-design.md` — this closes the veteran-user gap: forward-only detection treats a 60-session account like day one.

## Behavior

When a session opens with the `userParts` flag on and no backfill has ever run for this account, a **one-time, best-effort background walk** processes the user's session history and seeds part **candidates only** — the consent posture is untouched (nothing surfaces until the companion offers it in-session and the user names it on the card). Payoff: the first proposal can arrive in the *next* session, carrying evidence like "seen across many sessions," instead of after two fresh sightings.

## Mechanics

- **Claim-first, run-once.** `CompanionSignals` gains `partsBackfillAt?: number`, stamped BEFORE processing starts. An interrupted backfill never re-runs (partial seeding is fine; forward detection continues from there) — this also removes duplicate-processing and two-tab races.
- **Selection:** the newest 20 `closed` sessions with `messageCount >= 4`, processed **chronologically** (oldest first) so incremental matching accumulates parts the way live reflection would have.
- **Extraction:** a dedicated lean prompt `buildPartBackfillPrompt({ transcript, userParts })` that shares the exact PART OBSERVATIONS rules (extracted to a shared constant so the two prompts can never drift) and asks for `{"partObservations": [...]}` ONLY. Called via `chatCompletion` (60s timeout, 600-token cap, reasoning 'none'), one session at a time — sequential, to stay far under the chat rate limit.
- **Application:** per session, tolerant-parse → `applyPartObservations(currentParts, obs, sessionId, observedAt=session.endedAt ?? startedAt)` → persist updates/creates → fold into the in-memory list so the next session's call matches by id. `sessionsSeen` accumulates across distinct historical sessions naturally. Per-session failures are logged and skipped; the walk continues.
- **Caps:** the tracker's existing caps govern (5 candidates, 2 observations/session, evidence 8). With chronological processing, long-recurring parts consolidate into few strong candidates rather than flooding the cap.
- **Trigger:** `maybeBackfillUserParts()` (new `src/engine/userPartsBackfill.ts`), fired void from SessionView init after context load. No UI; invisible by design.
- **Lexicon:** not backfilled in v1 (coined phrases need conversational freshness; stale coinage used months later reads wrong).

## Files

`src/types/index.ts` (+`partsBackfillAt`), `src/ai/therapistPrompts.ts` (shared rules const + `buildPartBackfillPrompt`), `src/engine/userPartsBackfill.ts` (new), `src/components/Session/SessionView.tsx` (trigger), tests (`userPartsBackfill.test.ts`, prompt tests, one live-eval case through the backfill prompt).

## Tests

- Walk: only closed sessions with `messageCount >= 4`, newest-20 window, chronological order, sequential calls.
- Claim: marker stamped before processing; a set marker (or flag off) short-circuits with zero reads/calls.
- Incremental matching: a candidate created from session A is matched and bumped by session B within the same walk.
- Resilience: one session's call throwing doesn't stop the walk; malformed JSON tolerated.
- Prompt: shares the rules text verbatim; asks only for partObservations.
- Live eval: the genuine-recurring fixture, run through the backfill prompt, must observe.
