# Ambient Personal Science

**Date:** 2026-07-10
**Status:** Implemented

## Product decision

Personal Science becomes an invisible, universal property of ordinary
UnderSurface sessions. It is not an optional mode, a questionnaire, or a
visible comparison experience. The writer experiences a companion; the app
quietly gathers bounded evidence about which response forms appear to fit.

Fresh eyes is the sole exception. It neither reads nor produces longitudinal
memory, research assignments, turn assessments, or session assessments.

## Experience contract

- Remove `you missed me`, comparison labels, outcome pulses, delayed-outcome
  cards, the receptivity handshake, closing research check-ins, the Personal
  Science settings, and the Field Manual/evidence UI.
- Retain sparse, low-risk randomized response-grammar, surface-choreography,
  ambiguity, and transfer comparisons for every normal session.
- Remove designed silence and the subtraction protocol.
- Never mention assignments or assessments in companion output.

## Per-turn assessment

The next companion generation already sees the prior companion response and
the writer's reaction. It emits one hidden structured preamble that contains:

- crisis risk;
- conversational fit: `landed | partial | missed | unclear`;
- observable movement: `deepened | clarified | settled | mobilized | stayed |
  withdrew | unclear`;
- agency signal: `more | same | less | unclear`;
- confidence: `low | medium | high`.

The streaming parser strips this metadata before display. A deterministic
writer stores it as an `interventionOutcomes` record linked to the assessed
companion message, the following writer message, and any blinded research
event. Missing/malformed metadata fails open to `unclear` and never affects the
live response.

The evaluator judges observable conversational fit, not mental-health benefit.
Verbosity, agreement, continued use, and session duration are never treated as
benefit. Ending, silence, or brevity are ambiguous by default.

## Whole-session assessment

The existing reflection call also returns an `ambientAssessment` describing
the transcript's flow, overall fit, agency trajectory, ending state, and a
short evidence-grounded synthesis. This adds no new LLM call. It is stored on
the session document with evaluator model/prompt versions and confidence.

## Unfinished sessions

Starting a new session closes every prior active session before creating the
new record:

- empty shells are deleted;
- sessions with a real user-companion exchange are closed at their last
  message timestamp;
- normal sessions run the same reflection + whole-session assessment pipeline
  asynchronously;
- Fresh eyes sessions close without reflection or assessment.

Reflection is idempotent through `reflectionStatus` / `reflectedAt`, so a late
formal close and automatic finalization cannot double-write memory.

## Scientific interpretation

- Assignment remains deterministic and versioned.
- The turn evaluator is blind to the assessed response's research arm.
- Ambient assessments are noisy model-derived observations, not user-reported
  truth and not diagnoses.
- Findings require repeated, actually delivered randomized events with linked
  ambient outcomes; uncertainty remains explicit.
- The assessment output does not immediately rewrite the live user model.

## Verification

- Parser tests prove hidden metadata never reaches visible text.
- Planning tests prove universal eligibility, Fresh eyes exclusion, and no
  designed-silence assignments.
- Persistence tests prove deterministic idempotent turn outcomes.
- Reflection tests prove whole-session assessment is stored in the same call.
- Lifecycle tests prove New closes/refines prior active sessions and deletes
  empty shells.
- UI tests prove questionnaire/research controls are absent.
- Full frontend, Functions, emulator, build, lint, and production E2E coverage
  must pass before deployment.

Implementation verification: 1,501 frontend tests and 143 Functions tests
passed; lint, TypeScript, and the production build passed. Firestore emulator
and production verification are recorded with the deployment handoff.
