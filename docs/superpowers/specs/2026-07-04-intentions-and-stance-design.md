# Session Intentions (The Thread) + N-of-1 Stance Adaptation — Design

**Date:** 2026-07-04
**Status:** Approved via brainstorming Q&A; "Build autonomously the whole thing"
**Build order:** Thread first (generates outcome-adjacent data), Stance second.

## Decisions (locked)

| Question | Decision |
|---|---|
| Intention capture | **Conversational + confirm card** — volunteered intentions detected by reflection (no card); companion-offered intentions require the card |
| Follow-up | **Warm ask; avoidance becomes material** — 3× "not yet" → pattern named ONCE, feeds `avoidancePatterns` |
| Resurfacing | In-app only v1 (no push) |
| Stance outcome signal | **Passive + one-tap closing check-in** ("How are you leaving?", 5 soft states, skippable) |
| Stance transparency | **Internal-only v1** (entries still plain-language so a future panel is pure rendering) |

Naming: legacy `threadEngine`/`unfinishedThreads` (narrative threads) and `intentionsEnabled` (diary-era per-entry intentions) already exist — this feature is **`sessionIntentions`** everywhere. Both features: default-off flags, grounding suppression, precision rails, i18n ×17, live evals before deploy.

---

## Feature 1 — Session Intentions (`sessionIntentions` flag)

**Collection `sessionIntentions`:** `{ id, text, sessionId, status: 'open'|'kept'|'adapted'|'released'|'expired', askedCount, notYetCount, patternNamed, lastAskedAt?, resolvedAt?, outcomeNote?, createdAt, updatedAt }`. **Cap 3 open** — creating a 4th releases the oldest (status 'released'). Standard registration checklist.

**Capture path A (volunteered):** reflection output gains `statedIntention: { present, text }` — the writer's own concrete commitment ("I'm going to call him Thursday"), NOT aspiration ("I should really..."), not the companion's suggestion, mostly from the closing stretch; omit when none. Creates an `open` intention directly (they said it — no card).

**Capture path B (companion-offered):** prompt block active only when `phase === 'closing'` AND open slots exist AND flag on AND not grounding; teaches `[intention phrase](#offer-intention)` marker (offer at most once, natural moment or omit). `IntentionCard` beneath the message: editable text pre-filled from the phrase, Keep / skip. Keep → create doc (cap enforced). Card renders only in the ACTIVE session (prop from SessionView) + skip remembered per-tab (sessionStorage) + duplicate text+sessionId check → no zombie cards on history re-render.

**Follow-up:** loader (flag-gated) returns open intentions, ordered highest `notYetCount` then oldest. Prompt block (all turns, incl. opener): list open intentions (untrusted-wrapped), "weave AT MOST ONE into your opening, warmly, no verdicts; afterwards follow the writer's lead." Reflection output gains `intentionOutcomes: [{ id, outcome: 'kept'|'adapted'|'not_yet'|'released', note? }]` (open list passed in by id). Client applies via pure `intentionTracker`: kept/adapted → resolved + note; released → closed silently; not_yet → count++. **notYetCount ≥ 3 && !patternNamed** → next build includes a name-the-pattern-once instruction, sets `patternNamed`, appends a line to `userProfile.avoidancePatterns` (existing cap/merge machinery).

**Eval (`npm run test:intentions`):** committed-vs-aspirational, companion-suggestion-must-not-extract, no-intention sessions, genuine commitment must extract, outcome matching by id.

---

## Feature 2 — N-of-1 Stance (`stanceAdaptation` flag)

**Check-in:** on end-session, a quiet "How are you leaving?" row (5 states: heavier / same / a shade lighter / lighter / much lighter), one tap or skip, never blocks closing. Stored as `Session.leavingFeeling?`. Flag-gated.

**Collection `stanceProfile`** (singleton 'current'): `{ id, rawObservations: { observation, direction: 'helped'|'hindered'|'unclear', sessionId, createdAt }[] (cap 20), entries: string[] (cap 6), consolidatedAt?, updatedAt }`. Standard registration.

**Learning loop:** (1) reflection output gains `stanceObservation: { observation, direction }` (≤1/session) — the transcript shows what the companion did (challenge density, question ratio, length); the arc + `leavingFeeling` (passed in as an option) show how it went. Rails: describe the COMPANION's move and its effect, never diagnose the writer; 'unclear' over guessing. (2) Every 5 reflections (existing `totalSummaryCount % 5` cadence): `buildStanceConsolidationPrompt(rawObservations)` → `{ entries: string[] }` — ≤6 plain-language tendencies, each needing ≥2 supporting observations (prompt-enforced), no safety-adjacent content.

**Injection:** `stanceContext?: string[]` prompt block — "Working with this writer, learned across your sessions … lean into these as tendencies, never rules." Suppressed under grounding. **Never touches safety:** SAFETY_RULES, grounding, crisis calibration, Real Talk override all out of reach — the block explicitly says it never overrides safety or grounding behavior. Voice gets it read-only.

**Eval (`npm run test:stance`):** challenge-that-deepened → helped; probing-then-shutdown → hindered; ambiguous → unclear (not guessed); no safety-adjacent entries from consolidation.

## Files (both)

Types+registration (`sessionIntentions`, `stanceProfile`, `Session.leavingFeeling`), `src/engine/intentionTracker.ts`, `src/ai/intentionOfferParser.ts`, `src/components/Session/IntentionCard.tsx`, `src/components/Session/ClosingCheckIn.tsx`, reflection prompt/schema + engine wiring, loader/stream/voice threading, `stanceConsolidator` pieces, flags/admin/docs, i18n ×17, unit tests throughout, two live-eval files + scripts.
