# Ambiguity Prism and Living Hypotheses

**Date:** 2026-07-10
**Status:** Implemented and verified locally

## Product claim

UnderSurface should make uncertainty usable. When meaning is genuinely
ambiguous, it can offer several nonexclusive possibilities without turning any
one of them into a verdict, then remember only the writer's review of those
possibilities.

## Prism experience

An eligible Talk response may contain exactly three short hypotheses. They are
rendered as a separate prism beneath a brief introduction. The set should vary
the frame rather than paraphrase one idea three times, and should include at
least one ordinary state or situational explanation before reaching for a
deeper relational interpretation.

For every hypothesis the writer can choose:

- `fits` — this has some truth now;
- `maybe` — keep it visibly provisional;
- `not_this` — this frame misses;
- or `none of these` for the whole set.

The writer may add a better frame in their own words and report whether sorting
the set was easy, took some work, or created more work. Feedback is optional
and editable interpretations never become diagnoses.

## Research contract

Protocol `ambiguity-prism-v1` compares:

- `single_hypothesis` — one bounded, tentative interpretation;
- `ambiguity_prism` — three visibly tentative, nonexclusive hypotheses.

It uses the existing Personal Science rails and is eligible only when the
writer requested perspective. It never runs on an opener, during grounding,
on consecutive research turns, or beyond the per-session cap. Assignment is
retry-stable. A prism arm counts as delivered only if the finalized response
contains a valid three-hypothesis marker set; malformed delivery is cancelled,
not silently relabeled.

Immediate usefulness and delayed residue remain the primary outcomes. Prism
sorting, correction effort, and `none fit` are mechanism measures; the model
does not grade its own interpretation.

## Living hypotheses

Submitting prism feedback writes deterministic, writer-governed records:

- `confirmed` for a hypothesis marked `fits`;
- `candidate` for `maybe`;
- `contested` for `not_this` or `none of these`;
- a writer-authored replacement is `confirmed` and clearly source-labelled.

The Field Manual lets the writer rename, confirm, contest, or make any record
dormant. Confirmed and contested records may enter longitudinal context;
candidates remain visible in the manual but do not steer the companion.
Fresh-eyes sessions receive none of them. Grounding suppresses the entire
block. Contested records are instructions not to repeat a frame, not negative
facts about the writer.

## Cross-channel behavior

The Alliance Constitution gains an interpretation style:

- `adaptive` — one or several possibilities as the moment warrants;
- `single` — one tentative interpretation at a time;
- `prism` — prefer two or three possibilities when interpreting ambiguity.

This behavioral preference and reviewed living hypotheses flow through the
shared companion kernel to Talk, Speak, and SMS. Only Talk runs randomized
prism trials in v1 because it can render hypothesis-level controls faithfully.
Voice and SMS never emit prism markers.

## Data lifecycle

`livingHypotheses` joins the client collection proxy, shared context loaders,
export, and account-deletion registry. `interventionOutcomes` stores optional
prism feedback. Research events continue to contain no transcript text.

## Verification target

- Parser tests for exact valid sets, malformed fallback, and marker stripping.
- Assignment, eligibility, delivery-fidelity, and finding-policy tests.
- Component and store tests for multi-hypothesis review, none-fit, rewrite,
  correction effort, idempotent records, and Field Manual management.
- Shared-kernel Talk/Voice/SMS tests for interpretation style, confirmed and
  contested context, aperture filtering, and grounding suppression.
- Export, deletion, localization parity, full suites, emulator, build, and a
  disposable-account browser pass.

## Verification record

Completed on 2026-07-10:

- Frontend lint passed.
- Frontend suite passed: 101 files and 1,479 tests, with 7 live-eval files and
  17 live tests intentionally skipped by their environment gates.
- Functions build and suite passed: 18 files and 143 tests.
- Production frontend build passed.
- Firestore emulator suite passed: 40 tests.
- A disposable local account completed onboarding, enabled Personal Science,
  selected the prism interpretation preference, reloaded to confirm
  persistence, held a live multi-interpretation Talk exchange, rated a
  comparison, and opened the resulting Field Manual state.
- The disposable account was deleted through the product UI; attempting to
  sign in again with the same credentials returned `invalid credential`.
- Browser logs contained no errors. The marker parser, feedback card, living
  hypothesis store, and management UI were exercised deterministically in
  unit/component tests; the randomized browser turn landed in a different
  eligible comparison arm, as expected.
