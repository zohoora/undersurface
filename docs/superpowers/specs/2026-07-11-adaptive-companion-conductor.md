# Adaptive Companion Conductor

**Date:** 2026-07-11
**Status:** Implementation in progress

## Product claim

UnderSurface should not ask the writer to understand a growing toolbox. It
should recognize the kind of moment that is unfolding, choose the smallest
fitting form of help, explain any proposed transition in plain language, and
learn cautiously from what follows. Success includes needing less help.

The conductor coordinates existing capabilities. It does not introduce a new
surface, diagnose state, or optimize engagement.

## Decision model

Every eligible Talk turn produces a bounded candidate ranking across:

- ordinary response grammar (`witness`, `reflect`, `clarify`,
  `make_concrete`, `user_first`, `offer_action`, `offer_quiet`,
  `close_warmly`);
- reversible Journal, Speak, Relax, and Drift arcs that are actually enabled.

Inputs are limited to the current session phase, the existing hidden
state/capacity/need assessment, deterministic features of the current message,
enabled surfaces, recent conductor decisions, and writer-approved personal
protocols. No free-form model inference is written as a trait. Candidate
records contain reason codes and scores, never message text.

## Shadow-first rollout

The first three eligible high-confidence decisions for a writer are shadow
records. They change no output. After that calibration floor, sparse
deterministic assignments compare the top recommendation with a safe adjacent
alternative. Low-confidence decisions remain shadow-only forever.

Shadow and live records reuse `researchEvents` under
`adaptive-conductor-v1`. Shadow records have `status: shadow`; only randomized,
actually delivered live records can enter findings.

## Live experience contract

- At most one live conductor move per session and never on consecutive turns.
- Surface offers are deterministic, explicit, and reversible: the copy says
  why this form may fit, names the destination, says what will happen there,
  and offers `Not now` without penalty.
- Ordinary Talk moves stay natural and never mention internal routing.
- A declined offer is an override, not a negative outcome.
- Returning from a conductor arc is quiet. Ambient assessment may evaluate the
  next ordinary writer response; no questionnaire appears.
- Grounding, crisis, Fresh eyes, an opening turn, and unavailable surfaces
  suppress live and shadow orchestration.

## Context-conditioned learning

The existing evidence analyzer may derive a tentative finding only when:

- assignment was randomized;
- the arm was durably delivered;
- an ambient outcome has at least medium confidence or the writer supplied an
  explicit outcome;
- at least two arms were sampled in the same bounded context;
- the score separation and minimum sample rules are met.

Findings remain visible, editable, rejectable, and retireable in the Field
Manual. They describe a contextual option, not a personality fact.

## Transfer and anti-dependence

Writer-approved conductor findings use the existing Transfer Ladder. A
learning protocol retains adjacent-rung randomized comparisons. A graduated
protocol biases the conductor toward `user_first`, a minimal cue, quiet, or a
warm ending instead of silently performing the move. The same writer-owned
fading language already reaches Talk, Speak, and SMS through the shared
companion kernel.

## Stabilization instrumentation

Drift records operational, content-free experience signals: selected channel,
audio priming result, one-way guidance connection state, first cue request,
interruption count, actual duration, closure reason, and completion. Engine
diagnostics record guidance/audio failures and conductor planning/persistence
failures without user text or model output. PWA registration performs an
explicit update check and activates new precached releases without forcibly
reloading an open session.

## Verification target

- Pure conductor tests for ranking, confidence, deterministic assignment,
  shadow floor, sparsity, enabled-surface filtering, Fresh eyes/grounding, and
  transfer fading.
- Integration tests for provenance-before-delivery, explicit offer copy,
  decline overrides, quiet return, and ambient outcome linkage.
- Drift tests for no microphone request, audio priming, guidance state, pause,
  and final telemetry.
- Full frontend and Functions suites, Firestore/Storage emulator suites, lint,
  production build, mobile-width signed-in journey, disposable account
  deletion, deployment, and production smoke.
