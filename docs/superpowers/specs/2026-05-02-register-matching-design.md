# Register Matching — Design

**Status:** Draft
**Date:** 2026-05-02
**Scope:** Therapist + Future Self conversational modes. No changes to journal-mode parts.

## Problem

The therapist prompt at `src/ai/therapistPrompts.ts:39` hardcodes `"Write at a 6th-grade reading level"` for every user. This is opinionated in two directions at once:

1. **For sophisticated writers**, grade-6 prose feels thin and condescending — the therapist talks down to a writer who is reaching for nuance.
2. **For struggling writers**, grade-6 may still include therapy-jargon (`somatic`, `dysregulation`, `attunement`) that the writer has no relationship with — fluent in vocabulary but foreign in register.

A second problem rides alongside: the input modality (desktop typing, mobile thumb-typing, voice transcription) systematically distorts any text-based heuristic about who the writer "is." Mobile entries are short and punctuation-light. Voice entries are run-on and use spoken vocabulary. Desktop entries are the only honest signal of register.

## Goals

- Adapt the therapist's vocabulary, sentence complexity, and example phrasing to the writer's natural register, learned over time from their own writing.
- Preserve a floor — the therapist must remain readable to a writer in distress, regardless of register.
- Be model-portable: the same register tag should produce broadly the same therapist behavior across LLM swaps.
- Eliminate therapy-jargon from therapist responses for *all* users, not just lower-register ones.
- Account for input modality so the register signal isn't polluted by phone typing or voice transcription.

## Non-goals

- Voice mimicry of the writer's exact phrases. That is Future Self mode's job (`loadVoiceExcerpts`).
- Per-message register adaptation. Register is a long-term trait. The current emotional state is handled separately by phase + grounding.
- Adapting register for journal-mode parts (Open, Weaver, Still, etc.). Those have their own seeded voices.
- Reading-level numbers (Flesch-Kincaid, etc.) anywhere in the production prompt. Numbers drift across models.

## Decisions (locked during brainstorming)

| # | Decision |
|---|---|
| 1 | Use **register tiers** (`plain` / `conversational` / `literate` / `scholarly`) with banned-word lists, sentence caps, and few-shot examples per tier. The therapy-jargon ban applies to all tiers. |
| 2 | **Tag entries with `inputMode` at write-time.** Separate the register *trait* (long-term, from desktop entries) from session *pacing* (per-session, from current modality). |
| 3 | **One-shot LLM classifier** caches result on `userProfile.linguisticRegister`. The classifier model is locked separately from the generation model — register tags stay stable across generation-model swaps. |
| 4 | Re-classify when **10 new desktop entries** have been written since the last classification (`desktopCount - lastClassifiedAtEntryCount ≥ 10`). |
| 5 | **Cold-start threshold = 10 total desktop entries**, fallback tier = `conversational`. (Threshold 4 and 5 share the number 10 deliberately — first classification fires when total ≥ 10, subsequent fire on delta ≥ 10.) The hardcoded `"Write at a 6th-grade reading level"` line is removed entirely; the new tier system is the only source of voice rules. |
| 6 | **Voice sessions cap the tier at `conversational`** — `literate` and `scholarly` writers get `conversational`-level vocabulary in voice mode. Lower tiers (`plain`) still apply normally. |
| 7 | **Grounding (crisis) sessions also cap at `conversational`** — distress is not the moment for richer vocabulary. The cap is invisible during normal use, decisive when needed. |

## Architecture

### File map

**New files:**
- `src/ai/registerTiers.ts` — typed `RegisterTier` interface, frozen `REGISTER_TIERS` config, `THERAPY_JARGON_BAN` list, pure `renderRegisterBlock(tier, currentInputMode)` rendering function.
- `src/ai/registerClassifier.ts` — `classifyRegister(desktopEntries)` LLM call returning `{ tier, confidence, reasoning }`. Uses `getClassifierModel()` (separate from `getModel()`).
- `src/engine/inputMode.ts` — `detectInputMode(opts?)` returning `'desktop' | 'mobile' | 'voice'` from `Capacitor.isNative` + `navigator.userAgent` + explicit voice flag.
- `src/engine/registerReclassifyTrigger.ts` — `reclassifyIfReady()` invoked after entry save; counts desktop entries since `lastClassifiedAtEntryCount`, fires `classifyRegister` when ready.
- `src/ai/registerTiers.test.ts` — unit tests for tier config and rendering.
- `src/ai/registerClassifier.test.ts` — tests with mocked LLM call.

**Modified files:**
- `src/types/index.ts` — add `InputMode`, `RegisterTierId`; extend `DiaryEntry`, `SessionMessage`, `UserProfile`.
- `src/ai/therapistPrompts.ts` — delete hardcoded grade-6 line + redundant register rules; extend `TherapistPromptOptions`; integrate `renderRegisterBlock`; apply grounding cap.
- `src/ai/futureSelfPrompts.ts` — same prompt integration.
- `src/engine/sessionContextLoader.ts` — read and pass through `linguisticRegister`.
- `src/components/Editor/LivingEditor.tsx` — capture `detectInputMode()` at entry save.
- `src/components/Session/SessionView.tsx` — capture `detectInputMode()` at message send; pass `currentInputMode` and `registerTier` into prompt build.
- `src/hooks/useVoiceSession.ts` — pass `{ fromVoice: true }` to `detectInputMode()`.
- `firestore.indexes.json` — add single-field ascending index on `entries.inputMode`.
- `src/ai/therapistPrompts.test.ts` — add register integration tests + regression guards.
- `src/ai/futureSelfPrompts.test.ts` — add register integration tests.

### Data flow

```
ENTRY WRITE PATH
  user saves entry
    ─► detectInputMode() ─► entry.inputMode stored
    ─► reclassifyIfReady() (async, fire-and-forget)
       ─► count desktop entries; compare to lastClassifiedAtEntryCount
       ─► if ≥10 new desktop entries:
          ─► classifyRegister(last 20 desktop entries)
          ─► write { linguisticRegister, lastClassifiedAtEntryCount } to userProfile

SESSION MESSAGE PATH
  user sends message
    ─► detectInputMode() ─► sessionMessage.userInputMode stored

SESSION GENERATION PATH
  generateTherapistMessage / generateFutureSelfMessage
    ─► loadTherapistContext() reads profile.linguisticRegister (default 'conversational')
    ─► detectInputMode() at call site provides currentInputMode
    ─► buildTherapistSystemPrompt({ ..., registerTier, currentInputMode })
       ─► applies grounding cap if isGrounding
       ─► renderRegisterBlock(tier, currentInputMode)
          ─► applies voice cap if currentInputMode === 'voice'
       ─► block injected into system prompt
```

### Type additions

```ts
export type InputMode = 'desktop' | 'mobile' | 'voice'

export type RegisterTierId = 'plain' | 'conversational' | 'literate' | 'scholarly'

export interface DiaryEntry {
  // ...existing
  inputMode?: InputMode  // optional for backfill compatibility
}

export interface SessionMessage {
  // ...existing
  userInputMode?: InputMode  // only set on user-speaker messages
}

export interface UserProfile {
  // ...existing
  linguisticRegister?: RegisterTierId
  lastClassifiedAtEntryCount?: number
}
```

`UserProfile.linguisticRegister` is optional in the type so existing user profiles remain valid; `loadTherapistContext` always coerces `undefined → 'conversational'` before passing to the prompt builder.

### Tier config

```ts
export interface RegisterTier {
  id: RegisterTierId
  description: string
  bannedWords: readonly string[]      // additive to global jargon ban
  sentenceCap: number | null          // max words/sentence; null = no cap
  exampleWrong: string
  exampleRight: string
}

export const THERAPY_JARGON_BAN: readonly string[] = [
  'dysregulation', 'co-regulation', 'somatic', 'attunement', 'rupture',
  'window of tolerance', 'parts work', 'inner child', 'shadow work',
  'nervous system', 'embodied', 'integration', 'felt sense',
] as const
```

The four tiers are defined in the brainstorm transcript and may be tuned during implementation. Banned-word lists and example pairs are starting points — the implementor may expand or trim based on initial output quality.

### Rendering

`renderRegisterBlock(tier, currentInputMode)` is a pure function that:

1. If `currentInputMode === 'voice'` and tier is `literate` or `scholarly`, downgrade to `conversational`.
2. Build a directive block:
   - One-line tier description.
   - Bullet listing the union of `THERAPY_JARGON_BAN` and `tier.bannedWords`.
   - Bullet stating the sentence cap, if non-null.
   - `Wrong:` / `Right:` example pair from the tier.
   - If `currentInputMode === 'voice'`: append a "spoken cadence" directive.
   - If `currentInputMode === 'mobile'`: append a "tight, small-screen" directive.

The voice cap lives inside this function — pushing it up to the prompt builder would scatter the rule.

### Grounding cap

In `buildTherapistSystemPrompt` (and the equivalent in `futureSelfPrompts.ts`):

```ts
const requestedTier = options.registerTier ?? 'conversational'
const effectiveTier = options.isGrounding && (requestedTier === 'literate' || requestedTier === 'scholarly')
  ? 'conversational'
  : requestedTier
const tier = REGISTER_TIERS[effectiveTier]
parts.push(renderRegisterBlock(tier, options.currentInputMode ?? 'desktop'))
```

This is the safety case: a `scholarly` user expressing crisis ideation should not receive responses with abstract/philosophical vocabulary. The cap is applied additively to the existing grounding directive in `THERAPIST_CORE`.

### Classifier

`classifyRegister(desktopEntries)`:
- Truncates each sample to 500 chars; caps to 20 samples; filters out samples <50 chars.
- If no usable samples, returns `{ tier: 'conversational', confidence: 'low' }` without an LLM call.
- Otherwise calls a small fast model (`getClassifierModel()`) with `temperature: 0` and `response_format: 'json_object'`.
- Validates the returned `tier` is in the four-tier allowlist; falls back to `conversational/low` on parse failure or rogue values.

The classifier is gated behind explicit input sanitization (`sanitizeForPrompt`, `wrapUserContent`) — same path as existing prompts. This is user-supplied text being sent to an LLM and the standard injection-defense applies.

### Reclassification trigger

`reclassifyIfReady()` is invoked from the entry-save flow (likely in `db.entries.add`'s caller path or a wrapper). It:

1. Reads `userProfile.linguisticRegister` and `lastClassifiedAtEntryCount` (treats missing/`undefined` as `0`).
2. Counts desktop entries via indexed query (`db.entries.where('inputMode').equals('desktop').count()`).
3. Returns early if total desktop entries < 10 (cold start).
4. Returns early if `(desktopCount - lastClassifiedAtEntryCount) < 10` and a tag already exists.
5. Loads last 20 desktop entries, calls `classifyRegister`.
6. If the new tag has `confidence === 'low'` and a confident tag already exists, skip the write (anti-regression on noisy data).
7. Otherwise, writes `{ linguisticRegister, lastClassifiedAtEntryCount: desktopCount }` to `userProfile`.

The trigger is fire-and-forget — entry save does not await it. Failure logs via Sentry; never blocks the user.

### Firestore index

`entries.inputMode` requires a single-field ascending index for the `where('inputMode').equals('desktop').count()` query. Added to `firestore.indexes.json`. Without the index, the query falls back to a full collection scan on every entry save.

### Removed from THERAPIST_CORE

The following lines are deleted from `THERAPIST_CORE` because their tier-aware versions live in `renderRegisterBlock`:

- `"Write at a 6th-grade reading level. Someone who is crying should be able to read your words."`
- `"One idea per sentence. No nested clauses."`
- `"No ornate restatements of what the writer said. Just respond to it."`
- The `Wrong:` / `Right:` example pair on lines 42–43.

Everything else in `THERAPIST_CORE` stays — `SAFETY_RULES` (verbatim), the AI-slop ban (`delve, tapestry, myriad...`), the `not X, but Y` ban, the persona rules (no mirroring, no "I" starts), and the structural rules (1–3 sentences, end with invitation, etc.).

## Testing strategy

### `src/ai/registerTiers.test.ts` (new, ~15 tests, no mocks)

Tier config sanity, `renderRegisterBlock` output structure, voice cap for `literate`/`scholarly`, voice preserves `plain` and `conversational`, modality directives for voice/mobile/desktop, sentence-cap line presence/absence based on `null`.

### `src/ai/registerClassifier.test.ts` (new, ~8 tests, mocked LLM)

Empty input fallback, short-sample fallback, sample truncation, sample count cap, valid JSON parsing, malformed JSON fallback, rogue tier fallback, request shape (`temperature: 0`, `response_format`).

### `src/ai/therapistPrompts.test.ts` (updated, +8 tests)

Default tier behavior, plain/scholarly tier injection, voice cap end-to-end, grounding cap end-to-end, grounding does NOT raise tier, regression guard ("6th-grade" no longer in prompt), `SAFETY_RULES` still present.

### `src/ai/futureSelfPrompts.test.ts` (updated, +2 tests)

Register block coexists with voice excerpts, voice cap applies in Future Self too.

### Out of scope for this test pass

- `reclassifyIfReady` — Firestore integration test, separate concern.
- `detectInputMode` — trivial environment wrapper.
- End-to-end test of full session generation. The unit tests cover the prompt-construction surface; live testing happens in the deploy verification.

## Migration / backfill

- Existing entries have no `inputMode`. They are simply not counted in the desktop-entry tally for classification — the trigger waits until 10 *new* tagged desktop entries accumulate. No backfill needed.
- Existing user profiles have no `linguisticRegister`. They get `conversational` (the default) until the next reclassification trigger fires. No migration needed.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Classifier writes a wrong tier on a small sample, sticks for 10 entries. | (a) Threshold is 10 entries (not 5). (b) Low-confidence results don't overwrite an existing confident tag. (c) Admin can manually correct from `/admin` (future work). |
| Generation model and classifier model diverge in interpretation of tier names. | Tier text in the generation prompt does NOT depend on tier name semantics — it lists concrete banned words, sentence caps, and examples. The model never sees the string `"scholarly"`; it sees the rules. |
| Voice transcripts contaminate classifier input. | Classifier reads `inputMode === 'desktop'` only. Voice and mobile are excluded by the indexed query. |
| Grounding cap miss: `scholarly` user in crisis gets scholarly response. | Explicit cap in `buildTherapistSystemPrompt`. Asserted by `therapistPrompts.test.ts`. |
| Hardcoded grade-6 line accidentally re-introduced during a future tweak. | Regression test in `therapistPrompts.test.ts` asserts `"6th-grade"` is NOT in the output. |
| Future Self mode forgets to apply the cap. | Same regression test pattern in `futureSelfPrompts.test.ts`. |
| Reclassification API call failure blocks entry save. | Trigger is fire-and-forget; errors caught and logged to Sentry; never awaited. |
| Firestore index missing → full scan on every entry save. | Index documented in `firestore.indexes.json` change. Deploy step includes `firebase deploy --only firestore:indexes`. |

## Open implementation choices (for the implementor)

These are deliberate handoffs to whoever implements — the design doesn't need to nail them, but they should be made consciously:

- The `bannedWords` lists per tier are starting points. Initial output samples will reveal what to add or remove.
- The four `exampleWrong`/`exampleRight` pairs encode the *voice* the implementor wants the therapist to have at each tier. Worth iterating on with sample sessions.
- The classifier model — pick a small fast one (Haiku class). Document the choice in `settings.ts` next to `getModel()`.
- Whether `reclassifyIfReady` runs from a wrapper around `db.entries.add` or from a hook in the editor save path. Either works; pick what's least invasive.

## Out of scope (future work)

- Admin UI for manually overriding `linguisticRegister`.
- Per-language tier tuning (current design is language-agnostic; tiers may behave differently in non-English).
- Adapting register for journal-mode parts.
- A user-facing "register" toggle in settings.
- Analytics on tier distribution across the user base.
