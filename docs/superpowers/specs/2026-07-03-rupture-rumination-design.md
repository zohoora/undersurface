# Rupture Repair + Rumination Pivot — Design

**Date:** 2026-07-03
**Status:** Approved (visibility, timing, pivot target, loop scope, and architecture chosen by Arash via brainstorming Q&A)

## Purpose

Two evidence-aligned companion behaviors that target known drivers of therapeutic outcomes:

1. **Rupture detection & repair.** Alliance ruptures (withdrawal, disengagement, abrupt endings) predict dropout; *repaired* ruptures predict breakthroughs. The companion detects rupture evidence and explicitly, non-defensively names it at the next session's opening.
2. **Rumination detection & pivot.** Unlimited empathic reflection can entrench rumination — the co-rumination failure mode of reflective apps. The companion detects circling (live within a session, and across sessions) and silently shifts register instead of reflecting the loop back.

## Decisions (locked)

| Question | Decision |
|---|---|
| Visibility | **Name ruptures explicitly; pivot rumination silently** (no meta-commentary) |
| Repair timing | **Explicit repair at next-session opener + silent mid-session stance softening** on live withdrawal |
| Pivot target | **Companion's choice from a taxonomy**: concrete next step, values/meaning reframe, body/present-moment shift, or offering a Relax break |
| Loop scope | **Both** in-session circling and cross-session recurrence |
| Architecture | **B: per-turn LLM signal classifier** (gpt-5-nano) for live signals + deterministic rupture facts + reflection-pass extension for cross-session loops |

## Detection — three layers

### Layer 1: Deterministic rupture evidence (no LLM)

Computed from existing data. Precision-first thresholds; all three markers arm `pendingRepair`.

- **Abandoned session** — computed at next session open from session docs only: the most recent prior session has `status: 'active'`, `messageCount >= 4`, `startedAt` > 6h ago, **and** the user normally closes sessions (≥ 50% of their last 10 sessions have `status: 'closed'`). The habit guard prevents constant firing for users who never formally end sessions.
- **Terse ending** — computed at session close inside `reflectOnSession` (messages already in memory): each of the last 3 user messages < 40% of the user's median user-message length in that session, with ≥ 8 user messages total in the session.
- **Atypical gap** — computed at next session open from session docs: time since last session > 3× the user's median inter-session gap AND > 10 days, with an established cadence (≥ 5 prior sessions).

### Layer 2: Per-turn signal classifier (live)

New `task: 'signal_check'` route in the `chat` Cloud Function, mirroring `crisis_check` exactly but fully separate — **the crisis classifier prompt, route, and calibration are untouched**.

- Model `gpt-5-nano`, `reasoning_effort: 'minimal'`, `max_completion_tokens: 500`, non-streaming, strict JSON schema.
- Output: `{ withdrawal: 0|1|2, rumination: 0|1|2, theme: string }` (theme ≤ 60 chars, empty when rumination is 0).
- Input: the last 6 user messages of the current session (truncated to ~2400 chars total), most recent last.
- Client wrapper `classifySessionSignals()` in `openrouter.ts` mirrors `classifyCrisisRisk` (5s abort, fail-open to zeros).
- Fired from `useSessionStream` per user turn, fire-and-forget alongside the crisis race; **never blocks or delays the therapist stream**. Only fires from user turn 3 onward, and only when at least one of the two feature flags is enabled.
- **Quota-exempt** like `crisis_check`: server-bounded (nano + 500 cap), still behind the 30/min rate limiter, and only ever fires alongside already-quota-gated chat turns.
- Classifier prompt explicitly scopes distress OUT: crisis content is the crisis machinery's job; the signal classifier returns zeros for it rather than flagging withdrawal/rumination on distress disclosures.

**Hysteresis (in `signalTracker`):** acting requires 2 consecutive turns at level 2 for the same signal. After a pivot activates, a 6-turn cooldown before another pivot. Withdrawal softening deactivates after 2 consecutive zeros. All transient — React state only, reset on session change.

### Layer 3: Reflection-pass extension (cross-session)

`reflectOnSession`'s existing LLM output schema gains `loopSignal: { present: boolean, theme: string, newInformation: boolean }` (the prompt already receives recent summaries + the session transcript, so recurrence is visible to it). Malformed/missing output tolerated — treated as absent.

- Recurrence judgment belongs to the LLM (it sees prior summaries); the client only counts. 3 consecutive sessions with `present: true` and `newInformation: false` → arm persistent `ruminationWatch`, storing the latest theme. No client-side theme-similarity matching.
- Any session with `present: false` or `newInformation: true` → clear the watch and reset the streak.

## State — new `companionSignals` collection

Singleton doc `current` in `users/{uid}/companionSignals` (follows the new-collection checklist: `db.ts` proxy, `src/types/index.ts` interface, `dataExport.ts` collectionNames, functions `USER_SUBCOLLECTIONS`):

```ts
interface CompanionSignals {
  id: 'current'
  pendingRepair: {
    evidence: 'abandoned' | 'terse_ending' | 'atypical_gap'
    sourceSessionId: string
    createdAt: number
  } | null
  ruminationWatch: {
    theme: string          // sanitized, <= 60 chars — treated as untrusted content in prompts
    streak: number         // consecutive loop sessions observed
    lastConfirmedAt: number
  } | null
  updatedAt: number
}
```

- **Repair is consume-once:** the session opener that uses `pendingRepair` clears it immediately (repeated repair reads as accusation). If a new marker arms while one is pending, newest evidence wins (single slot).
- Mid-session states (softening, live pivot) never persist.

## Prompt integration — three new blocks

Three optional fields on `TherapistPromptOptions`, same pattern as `isGrounding`/`hrvContext`:

- `repairContext?: { evidence: 'abandoned' | 'terse_ending' | 'atypical_gap' }` — opener-only block: name the disconnect once, non-defensively; own the companion's possible part; invite correction without demanding an explanation; follow the user's lead; never re-raise it.
- `pivotDirective?: { theme?: string }` — silent-pivot block: validate first, then shift register **without meta-commentary**, choosing from the taxonomy (concrete next step / values-meaning reframe / body-present-moment shift / offer a Relax break), riding the user's own material. Theme string is wrapped as untrusted content.
- `softenStance?: boolean` — withdrawal block: shorter replies, warmer, no probing questions, no interpretation.

**Suppression rules:**
- `isGrounding === true` suppresses **all three** blocks (crisis owns the session; pivoting away from distress disclosure is harmful).
- `repairContext` only on `isFirstTurn`; `pivotDirective` never on `isFirstTurn`.
- Real Talk composes unchanged with all three.

**Voice:** `repairContext` (and `ruminationWatch`-armed `pivotDirective`) flow into Realtime instructions at session start via the shared prompt builder. Live per-turn signals are text-surface-only in v1 (voice builds instructions once).

## Feature flags

Two experimental flags, default **off**, standard `=== true` gating (`adminTypes.ts` features, `AdminSettings.tsx` toggle, `.claude/docs/feature-flags.md`):
- `ruptureRepair` — layers 1 + withdrawal softening + repair block
- `ruminationPivot` — rumination classification + reflection loopSignal + pivot block

The signal classifier fires if at least one flag is on (it serves both), but each behavior activates only under its own flag.

## Files

| File | Change |
|---|---|
| `src/engine/ruptureDetector.ts` (new) | Pure marker functions + threshold constants |
| `src/engine/signalTracker.ts` (new) | Hysteresis/cooldown state machine (pure class) |
| `src/ai/signalClassifierPrompt.ts` (new) | Classifier prompt + tier definitions |
| `src/ai/openrouter.ts` | `classifySessionSignals()` (mirrors `classifyCrisisRisk`) |
| `functions/src/chat.ts` | `signal_check` route: nano, minimal reasoning, 500 cap, strict schema, quota-exempt |
| `src/ai/therapistPrompts.ts` | 3 new options + blocks + suppression rules; `buildSessionReflectionPrompt` gains `loopSignal` |
| `src/engine/sessionReflectionEngine.ts` | Parse `loopSignal`, streak/clear logic, terse-ending marker write |
| `src/engine/sessionContextLoader.ts` | Load `companionSignals`; compute abandoned/gap markers at open |
| `src/hooks/useSessionStream.ts` | Fire classifier ≥ turn 3, feed tracker, thread options, consume-once repair |
| `src/store/db.ts`, `src/types/index.ts`, `src/store/dataExport.ts`, `functions/src/shared/collections.ts` | `companionSignals` collection registration |
| `src/admin/adminTypes.ts`, `src/admin/AdminSettings.tsx`, `.claude/docs/feature-flags.md` | Flags |
| `CLAUDE.md` | Feature documentation |

## Testing

- `ruptureDetector.test.ts` — every threshold edge (abandoned/habit-guard, terse-ending ratios, gap math with sparse history)
- `signalTracker.test.ts` — hysteresis (2-consecutive), cooldown, softening release, session reset
- `therapistPrompts.test.ts` — blocks present/absent; **grounding suppresses all three**; repair only on first turn; pivot never on first turn
- `sessionReflectionEngine.test.ts` — loopSignal parse (incl. malformed JSON), streak arm at 3, clear on break
- `openrouter.test.ts` — `classifySessionSignals` happy path + fail-open
- `functions/src/index.test.ts` — signal_check routes to nano with schema, quota-exempt, non-streaming
- `useSessionStream.test.ts` — classifier fired ≥ turn 3 only, flags gate, options threading, repair consumed once
- `signalClassifier.live.test.ts` (env-gated `RUN_SIGNAL_EVAL=1`) — precision-focused confusables: rumination vs grief retelling, withdrawal vs natural brevity, distress (must return zeros)

**Calibration philosophy: precision over recall** — a missed pivot costs nothing; a false repair is creepy. Mirrors the crisis classifier's documented calibration history.

## Non-goals (v1)

- No live per-turn signals in voice sessions
- No user-facing settings UI beyond the admin flags
- No repair for mid-session detection (softening only)
- No persistence of transient in-session states
