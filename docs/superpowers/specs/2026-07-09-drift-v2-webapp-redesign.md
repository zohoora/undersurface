# Drift v2 — webapp redesign (2026-07-09)

Supersedes the *experience layer* of `2026-07-04-drift-design.md`. The safety
architecture from that spec is **unchanged and still authoritative**: the engine's
monotonic no-return invariant, the two-layer crisis stack, scripted safety copy,
directional pills only (no numeric scale), no "EMDR" in product strings, grounding
suppression, `driftEnabled` default OFF.

## Why v1 was wrong for a webapp

v1 transplanted clinical pacing without the clinician holding it:

1. **Four gates before anything happens** — arrive screen → anchor (2 taps) →
   type a starting point → type a baseline. A therapist walks you through these;
   a webapp bleeds users at every gate.
2. **Typing required at every check-in** — `DriftExchange` refused to submit
   without text (`if (!trimmed) return`). Composing prose between every set is
   work, and work is the opposite of settling.
3. **25-second sets × 6 with no visible progression** — the user doesn't know
   where they are, how many sets remain, or when it ends. Clinically the
   clinician *is* the progress indicator. Online, silence reads as "is this
   doing anything?"
4. **LLM latency between every set** — 1–3s of dead air per exchange.
5. **Buried entry** — launched from a card inside the Relax settings panel.

## v2 principles

- **Time-boxed, chosen upfront.** Quick (~2 min, 3 waves) / Short (~4 min,
  5 waves) / Full (~6 min, 7 waves). Commitment clarity is an engagement
  primitive online.
- **Tap-first.** One begin screen: "What's stirring?" chips (+ optional
  free-text), anchor as an inline one-tap choice (default: feet), length, begin.
  Between waves the three pills submit **on tap** — typing is an optional
  "add a word" affordance, never a requirement.
- **Instant scripted micro-responses.** Tap-only check-ins get a rotating,
  deterministic pool of fixed i18n lines (zero latency, zero LLM, safest
  possible copy). The streamed LLM companion — unchanged prompt, unchanged
  crisis stack, still eval-verified — runs **only when the user actually
  writes**. Depth is opt-in; momentum is default.
- **Visible progression.** Wave dots (● ○ ○), a warmth layer that deepens as
  waves complete, and the BLS sweep **slows as the user reports softer**
  (pendulation embodied — `passMsForSoftening`, deterministic, clamped to the
  existing 1500–2500ms bound).
- **Sets are shorter (12s) and check-ins more frequent.** For a *resourcing*
  practice this is safety-neutral-or-better: less exposure per wave, more
  titration points. The engine's pendulation/stuck/cap semantics are untouched.
- **Felt contrast at closure.** The closing screen names the arc ("softened" vs
  "stayed with it") from engine counters — scripted templates, not LLM.
- **Own entry.** Drift is a first-class surface pill in the session bottom bar
  (gated on `driftEnabled`, hidden while grounding is active), mounted from
  `SessionView` as an immersive overlay. The Relax settings-panel card is gone.

## What the engine changes (and what it doesn't)

`driftEngine.ts` gains: `state.limits` ({setTarget, setMs, maxSessionMs}) set by
an optional `length` on BEGIN (defaults = v1 values, so every existing invariant
test passes byte-identical); `softerStreak` / `softerTotal` counters;
`passMsForSoftening()`. **Nothing else moves.** The phase order, no-return
invariant, crisis stickiness, stuck detection, hard cap, closure semantics, and
interweave cooldown are exactly the Fable-checkpoint-A-approved machine.

The hook auto-advances `anchor → choose → baseline` from the single begin screen
(dispatching the same events the UI used to gate on), so the verified state
machine is *driven faster*, not rewritten. Typed focus text still runs L1 + L2
before the practice proceeds; chips are app-authored copy and dispatch directly.

Voice keeps the same adapter: scripted cues for settle/closure/abort, the anchor
cue spoken once at the first wave, typed/voiced notices routed through the
unchanged LLM path.

## Explicitly out of scope

- No streaks, badges, or scores (ritualsNotStreaks philosophy; no numeric scale).
- No re-tuning of `driftPrompts.ts` — the live eval (`npm run test:drift`)
  remains valid because the LLM surface is byte-identical.
- Obsolete v1 i18n keys (arrive/choose/baseline gate copy) are left in place
  this pass — parity tests are one-directional; removal is a later cleanup.
