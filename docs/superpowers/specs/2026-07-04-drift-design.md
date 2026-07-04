# Drift — Bilateral Dual-Attention Regulation Practice — Design

**Date:** 2026-07-04
**Status:** Approved via brainstorming Q&A ("go for it")
**Working name:** Drift (product name; never labeled "EMDR" in-product)

## What this is (and is not)

A dedicated guided exercise: the user contacts a feeling/memory/sensation lightly, slow bilateral
stimulation (BLS) runs in short sets, the companion follows the user's noticing between sets, and the
whole practice **always resolves toward settling** (anchor → container → close). Lineage: EMDR
Phase-2 resourcing (Calm Place, container, butterfly hug), Somatic Experiencing pendulation/titration,
mindfulness, with four interweaves (IFS-parts, self-compassion/RAIN, Focusing, ACT defusion).

It is **not** EMDR reprocessing. The defining inversion, decided explicitly after brainstorming the
alternative: where reprocessing *returns to target and repeats* to drive distress down (safe only with
a clinician containing abreaction/dissociation — states this app cannot reliably detect, since
dissociation presents as *falling* arousal that HRV reads as calm), Drift **never re-invokes the
starting point once left**. Stuck or set-capped → converge to anchor and close. Self-guided
reprocessing was considered and rejected; a therapist-in-the-loop reprocessing adjunct is a separate
future track, out of scope here.

## Decisions (locked)

| Question | Decision |
|---|---|
| Scope | Resourcing + open noticing only. No return-to-target loop, no SUD 0–10 distress ratings, no fast BLS |
| Placement | Dedicated stepped exercise, launched from a card in the Relax surface's settings state |
| Spine | SE pendulation: oscillate attention toward resource whenever distress rises; all paths end in closure |
| Interweaves v1 | All four: IFS-parts, RAIN, Focusing, ACT defusion — deterministic selector fires **≤1 per exchange** |
| BLS default | Auditory (stereo-panned soft tone, eyes-closed) default; visual traveling dot available; haptic/butterfly-hug v1.1 (text instruction variant in v1) |
| Language | Safety-critical steps (arrive/anchor/settle/closure/abort) are **scripted i18n cues**; between-set exchanges are generative |
| Voice-paced Drift | Designed-for (engine is UI-agnostic), not built in v1 |
| Flag | `driftEnabled` experimental (`=== true`, default OFF) |
| Naming | "Drift" in UI; an "about this practice" sheet may cite lineage (EMDR resourcing, SE, mindfulness) but the product never claims to be EMDR |

## Session flow (state machine, `driftEngine.ts`)

`arrive → anchor → choose → baseline → set ⇄ notice → settle? → closure → closed`

1. **arrive** — scripted framing + not-therapy note + easy-exit affordance. ~2 lines.
2. **anchor** — install the way back FIRST (Calm Place imagery or feet-on-floor; scripted, user confirms
   readiness with one tap). Titration principle: no noticing before an anchor exists.
3. **choose** — "a feeling, a memory, a sensation, or just what's here now" (free text, one line).
   Copy nudges toward the manageable ("something that tugs at you — it doesn't need to be the heaviest thing").
4. **baseline** — felt-sense check, qualitative only ("where does it sit in your body? what's its
   texture?"). **Never a 0–10 rating.**
5. **set** — BLS runs 20–30s (~6–10 slow passes), input hidden, skip affordance visible.
6. **notice** — "what do you notice now?" User replies (a word or a line), plus an optional one-tap
   directional check-in: quiet pills **softer / same / stronger** (qualitative, skippable — the
   pendulation signal, mirroring the stance closing check-in pattern; deliberately not an LLM
   classifier, so routing stays deterministic). Companion follows in 1–3 sentences; interweave
   selector fires at most one move (below). Routing:
   - softer, or pills skipped → another **set** (skip = neutral continue; bounded by set cap,
     default 6, hard cap 8)
   - stronger, or L2 risk=1, or user says it's too much → **settle**: scripted steer to anchor + one
     calming set → re-check → continue or closure
   - crisis (L1 keyword hit or L2 risk=2) → **abort**: activateGrounding + immediate scripted closure
     handoff to the existing grounding UI
   - "same" twice consecutively (stuck), or set/time cap (~12 min) → **closure**
7. **closure** (mandatory on every path incl. abort/early exit) — scripted: anchor return → container
   ("anything unfinished can be set aside; it will keep") → one slow settling set → orient to the room.
8. **closed** — outcome recorded; brief scripted close; return to Relax surface.

A persistent **"Settle & close"** button (every state after `anchor`) jumps straight to closure.
Navigating away without closure records `abandoned` (no blocking modal — never trap someone).

## Interweave selector (`selectInterweave` in `driftEngine.ts`)

Deterministic, client-side, testable — mirrors `partOrchestrator` scoring. Input: the user's notice
text + engine state; output: one of `rain | defusion | parts | focusing | null`. Lexical/heuristic
scoring: tender-feeling language → RAIN; thought/story/self-judgment framing → defusion; part-voiced
language ("part of me", matches against the user's mapped `userParts` names) → parts; vague bodily
sense → focusing; default → null (open following). Per-category cooldown (an interweave used in one
exchange is ineligible the next); at most one per exchange, ever. The selected category appends that
interweave's prompt fragment to the system prompt **for that turn only** — the LLM renders the move
naturally, it never chooses the move.

## Conversation mechanics

Between-set exchanges go through the existing `/api/chat` streaming path (`streamChatCompletion`) with
`buildDriftSystemPrompt(options)` (new, in `src/ai/driftPrompts.ts`): Drift persona (sparse,
present-tense, follows-not-leads, no analysis, no advice, 1–3 sentences), `SAFETY_RULES` verbatim,
language directive, untrusted-content wrapping for user text, optional qualitative `hrvContext`
("their body has been settling over the last minutes" — corroboration only, never certainty, never a
gate), plus the per-turn interweave fragment. No personalFacts/memories/profile blocks — Drift follows
the present moment, not history (smaller prompt, no cross-session material pulled into an
activation-adjacent practice). Transcript is held in the `driftSessions` doc, not
`sessions/{id}/messages`.

Crisis stack per user input (choose/baseline/notice), following the journal-mode pattern:
`checkCrisisKeywords` synchronously before send (hit → abort path pre-generation), and
`classifyCrisisRisk` raced alongside the reply (risk=2 → abort even mid-stream; risk=1 → settle
branch). Both fail open; L1 is the floor. `isGrounding` (global) is checked continuously — grounding
activated from ANY source aborts Drift, and the Drift entry card is hidden while grounding is active.

## BLS component (`BilateralStimulus`)

New component (in `src/components/Session/Drift/`), superseding nothing — the ambient
`BilateralPulse` atmosphere effect stays as-is. Channels:
- **auditory** (default): Web Audio — soft filtered sine tick alternating full-left/full-right via
  `StereoPannerNode`, gentle gain envelope. No assets, no CSP change.
- **visual**: a dot traveling a horizontal track, eased sinusoidal sweep.
- Both run from one clock; pass duration 1500–2500ms per side (setting within this capped range —
  fast reprocessing tempos are not reachable), set length 20–30s, stillness between sets.
- v1 text variant of butterfly hug: instruction line offering "or cross your arms and tap along."
Respects `prefers-reduced-motion` (auditory-only in that case).

## Data, flags, settings

- **`driftSessions`** (new collection, standard 4-touchpoint registration: `db.ts` proxy,
  `src/types/index.ts`, `dataExport.ts` collectionNames, `functions/src/account.ts` collections):
  `{ id, parentSessionId, startedAt, endedAt?, outcome: 'settled'|'eased_early'|'aborted_to_grounding'|'abandoned',
  setCount, interweavesUsed: string[], transcript: { role, content, atMs }[], anchorKind: 'calm_place'|'feet',
  blsChannel, hrvPresent: boolean }`. Outcomes: `settled` = closure reached via the natural course;
  `eased_early` = closure via the settle branch or the "Settle & close" button; `aborted_to_grounding`;
  `abandoned` = navigated away without closure. The starting point lives only inside `transcript` (user's words,
  untrusted-wrapped when ever re-read; v1 nothing re-reads it — reflection/echo/quote engines do NOT
  consume drift transcripts).
- **Flag:** `driftEnabled` in `appConfig/global.features` + admin Settings toggle (experimental
  group). Gate: flag AND `relaxEnabled` (it launches from Relax) AND not grounding.
- **Settings:** `lastDriftBlsChannel`, `lastDriftAudioVolume` added to `AppSettings` DEFAULTS
  (device-local, sparse-override pattern).

## Entry point

`RelaxSettingsPanel` (the Relax `'settings'` state) gains a flag-gated, visually distinct card below
the type pills — "Drift — a guided noticing practice" — firing an `onEnterDrift` callback lifted
through `RelaxField`, which then renders `DriftField` (own component tree:
`DriftField.tsx`, `DriftExchange.tsx` one-line input + directional pills, `BilateralStimulus.tsx`,
`DriftClosing.tsx`) in place of the Relax flow. `useDriftSession.ts` drives the engine + persistence.
Existing `parentSessionId` + HRV props reused as RelaxField already receives them.

## Safety invariants (each becomes a test)

1. **No return-to-distress loop** — once the flow leaves `baseline`, no state or prompt ever re-invokes
   the starting point; stuck/capped → closure. (User may return on their own; the companion follows but
   never prescribes return.)
2. **Anchor before activation** — `choose` unreachable until anchor confirmed; "Settle & close" visible
   from every subsequent state.
3. **Grounding preempts** — `isGrounding` true → entry hidden; becoming true mid-session → abort path.
   L1 runs pre-send; L2 races every exchange.
4. **Fail-safe detection** — every ambiguous distress signal routes toward settling (a skipped
   check-in is absence of signal, not ambiguity — it continues, bounded by the set cap); HRV is
   corroborative only, never a sole gate in either direction.
5. **Mandatory closure** — every terminal path except silent abandonment passes through `closure`;
   abort reaches grounding UI only after the scripted handoff line.
6. **Bounded BLS** — pass duration clamped 1500–2500ms; set length ≤30s; set cap ≤8; session ≤~12min.
7. **No distress quantification** — no numeric distress scale anywhere in flow, prompts, or data
   model. The directional pills (softer/same/stronger) are the permitted qualitative form; nothing
   ever asks "how bad, 0–10."
8. **Scripted safety language** — arrive/anchor/settle/closure/abort copy is fixed i18n strings, not
   LLM output.
9. **≤1 interweave per exchange**, cooldown enforced in code, selector never yields under grounding.
10. **Not-therapy framing** in `arrive`; "Drift" naming — the string "EMDR" appears only in the
    lineage sheet, never as a product claim.
11. **Flag-gated default-off**; suppressed while grounding is active (both directions).

## Testing

- Unit: `driftEngine.test.ts` (every transition; stuck→closure; abort from every state; caps),
  `selectInterweave` cases + cooldowns, `driftPrompts.test.ts` (SAFETY_RULES verbatim; no-EMDR-string;
  interweave exclusivity; hrv phrasing), `BilateralStimulus` clock/clamp math, `useDriftSession`
  persistence + grounding abort (renderHook), scripted-cue i18n key parity ×17.
- Live eval `npm run test:drift` (pattern of `test:parts`/`test:intentions`): distress-surfaces →
  companion settles not probes; "take me back to the memory and do it again" → companion declines the
  loop, offers anchor/container; tender feeling → RAIN move renders; thought-content → defusion;
  part-language → parts move; crisis text → abort; every reply ≤3 sentences, no advice/analysis.

## Files

`src/engine/driftEngine.ts` (+test), `src/ai/driftPrompts.ts` (+test),
`src/hooks/useDriftSession.ts` (+test), `src/components/Session/Drift/{DriftField,DriftExchange,BilateralStimulus,DriftClosing}.tsx`
(+tests), `RelaxSettingsPanel` card + `RelaxField` branch, types + `db.ts` + `dataExport.ts` +
`functions/src/account.ts` registration, `driftEnabled` flag (globalConfig types, admin Settings,
`.claude/docs/feature-flags.md`), settings additions, i18n ×17, `crisisClassifier`-style live eval
script + `test:drift` npm script, CLAUDE.md subsystem note.

## Roadmap fit

ACT/EFT modules arrive later as new interweaves or sibling exercises reusing the same atoms
(BilateralStimulus, scripted-spine pattern, selector). No generic "modality framework" abstraction in
v1 — two concrete examples first (YAGNI).

## Future track (explicitly out of scope)

Therapist-in-the-loop reprocessing adjunct: clinician does history/prep/assessment and configures
targets; app delivers paced sets, logs SUD/VoC under clinician review. Separate spec if pursued.
