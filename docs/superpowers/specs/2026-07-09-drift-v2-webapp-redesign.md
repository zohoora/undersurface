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

The original v2 voice adapter used scripted cues for settle/closure/abort and
routed spoken notices through the LLM path. The mobile addendum below supersedes
that behavior after field testing showed that it did not fit a tap-first practice.

## Seamless mobile addendum (2026-07-11)

The first iPhone field test exposed an important mismatch: enabling guidance
opened a two-way Realtime session, requested microphone permission, and then
did not reliably speak the selected anchor. Drift is tap-first, so it has no
reason to listen. The experience now follows these rules:

- **Spoken guidance is one-way.** Realtime starts with `passive: true`; Drift
  never calls `getUserMedia`, never requests microphone permission, and never
  runs a second voice-conversation pipeline beside its text companion.
- **The chosen anchor is real guidance.** Feet and calm-place anchors each have
  a distinct fixed cue, shown on screen and spoken word-for-word. Calm place
  includes a small, concrete imagery sequence rather than a generic label.
- **Audio is explicitly armed on the Begin gesture.** A single Web Audio
  context is created/resumed inside that gesture for iOS/WebKit and reused for
  every wave. Audio mode retains a quiet visual trace, so silence never looks
  like a frozen app. Visual rhythm is the first-use default.
- **Durations describe the actual practice.** The three 12-second-wave presets
  are presented as about 1/2/3 minutes (3/5/7 waves), not 2/4/6 minutes.
- **Entry and interruption are kind.** The first wave renders before storage or
  personalization reads finish; returning users get a remembered one-tap
  start; the screen stays awake; backgrounding pauses rather than silently
  consuming a wave; explicit pause/resume and close controls are always visible.
- **Typed depth has state.** A typed check-in disables duplicate input and shows
  a holding state. Its companion reply is one short sentence carried into the
  next wave, then cleared so it cannot repeat on later check-ins.
- **Return is ambient.** Directional check-ins, latency, interruptions, actual
  duration, and closure reason are persisted. Returning to Talk gets one quiet
  bridge line; it does not produce a research questionnaire.
- **Mobile entry is first-class.** Drift remains visible in the bottom bar on
  narrow screens instead of being hidden in More.

## Explicitly out of scope

- No streaks, badges, or scores (ritualsNotStreaks philosophy; no numeric scale).
- No re-tuning of `driftPrompts.ts` — the live eval (`npm run test:drift`)
  remains valid because the LLM surface is byte-identical.
- Obsolete v1 i18n keys (arrive/choose/baseline gate copy) are left in place
  this pass — parity tests are one-directional; removal is a later cleanup.
