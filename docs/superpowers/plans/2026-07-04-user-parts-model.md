# User Parts Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Executed same-session by the plan author with user pre-approval ("Implement autonomously"); spec: `docs/superpowers/specs/2026-07-04-user-parts-model-design.md`.

**Goal:** Collaborative user-parts mapping (propose → confirm-in-your-own-words → companion knows them) + shared-lexicon harvest, per the approved spec.

**Architecture:** Reflection-pass detection (mirrors loopSignal), `userParts` collection, `userPartTracker` pure merge engine, proposal via prompt block + `#propose-part` marker + inline confirm card, active-parts/lexicon prompt blocks, `userParts` flag default off.

## Global constraints

- Gate every commit: `npx tsc -b --force` + relevant tests + `npm run lint`; functions side when touched.
- All new blocks suppressed under grounding; proposals never stack with pivot/soften; precision-first everywhere.
- All new user-facing strings in all 17 locales; i18n parity tests must stay green.
- Client-side only (no functions/model changes) except the collections registry.

### Task 1: Types + registration
Create `UserPart` in `src/types/index.ts` (spec shape) + `lexicon?: string[]` on PersonalFacts; register `userParts` in `db.ts`, `dataExport.ts`, functions `collections.ts`.
- [ ] Implement; both typechecks; account/dataExport tests; commit

### Task 2: `src/engine/userPartTracker.ts` + tests
Pure functions: `applyPartObservations(existing: UserPart[], observations: unknown, sessionId: string, now: number): { updates: UserPart[]; creates: UserPart[] }` (evidence cap 8, sessionsSeen dedup per session, caps 9 active/5 candidates, retired never resurrected, malformed dropped) and `selectProposalCandidate(parts: UserPart[], now: number): UserPart | null` (sessionsSeen ≥ 2, dismissedCount === 0, proposedAt unset or > 7d).
- [ ] Tests first (merge, dedup, caps, retirement, eligibility edges); implement; commit

### Task 3: Reflection extension
`buildSessionReflectionPrompt` gains `userParts` option + `partObservations`/`coinedPhrases` schema with precision rails; `sessionReflectionEngine` parses (tolerant), calls tracker, persists creates/updates, merges lexicon into personalFacts (cap 12). Flag-gated.
- [ ] Tests (prompt mentions fields; engine writes; flag gate; malformed tolerated); implement; commit

### Task 4: Prompt blocks
`therapistPrompts.ts`: `activeUserParts?: { name, description }[]` block (untrusted-wrapped, hard rules), `lexicon?: string[]` block, `partProposal?: { id, tentativeName, description, quote }` block teaching `[<phrase>](#propose-part:<id>)` (never opener/grounding at prompt layer).
- [ ] Tests incl. grounding suppression; implement; commit

### Task 5: Marker parser + card
`src/ai/partProposalParser.ts` (`PATTERN = /\[([^\]]+)\]\(#propose-part:([\w-]+)\)/`): `extractPartProposal(text) → { cleanText, proposal? }`. `PartProposalCard.tsx`: editable name (pre-filled), Confirm → active/name/confirmedAt, "Not quite" → dismissedCount++ (2nd → retired). i18n keys ×17.
- [ ] Tests (parser + card writes); implement; commit

### Task 6: Wiring
`sessionContextLoader`: load userParts (flag-gated) → `activeUserParts` + `partProposalCandidate`. `useSessionStream`: thread blocks; proposal included ≤1×/session (ref), skipped when pivot/soften active this build; after finalize, stamp `proposedAt` only if marker present in fullText. `SessionView`: render card under messages containing the marker (strip marker from display). `useSessionVoice`: activeUserParts + lexicon read-only.
- [ ] Tests (arming, exclusivity, stamp-only-on-marker); implement; commit

### Task 7: Settings section + flag + docs
"Parts of you" list (rename/retire) in the Settings surface, flag-gated. `userParts` flag in adminTypes/AdminSettings/feature-flags.md; CLAUDE.md (collections 19→20, flags 25→26, subsystem note). i18n ×17.
- [ ] Implement; full suites; commit

### Task 8: Live eval + ship
`src/engine/partObservations.live.test.ts` (`RUN_PARTS_EVAL=1`, script `test:parts`): metaphor / one-off / distress must yield nothing; recurring pattern must observe; existing-part must match by id. Run it; calibrate prompt if it fails. Full gates both sides; build; deploy hosting; smoke; push; CI.
- [ ] Eval green; deployed; pushed; CI green
