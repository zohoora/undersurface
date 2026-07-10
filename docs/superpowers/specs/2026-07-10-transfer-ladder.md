# Transfer Ladder and Field Manual

**Date:** 2026-07-10
**Status:** Implemented and verified locally

## Product claim

UnderSurface should not only learn which companion move helps. It should test
whether the writer can carry that move with progressively less help, then make
it easier to leave the app when the capacity has become their own.

## Ladder

Every writer-approved personal protocol may optionally enter four rungs:

1. `companion_led` — the companion performs the already-approved move.
2. `user_first` — the writer is invited to make the move before the companion.
3. `minimal_cue` — the app offers only a small, deterministic cue.
4. `independent` — the app explicitly leaves space for an offline attempt.

Enrollment is explicit in the Field Manual. A protocol never starts fading
because the model inferred readiness. The writer may pause, resume, retire, or
restart a ladder at any time.

## Experiment contract

- Protocol id: `transfer-ladder-v1`, version 1.
- Eligible turns retain every personal-science rail: opt-in, complete moment
  context, no opener, no grounding, no consecutive research turn, and the
  existing per-session cap.
- A learning protocol is compared only between its current rung and the next
  lighter rung. Assignment is deterministic and retry-stable.
- Companion-led delivery is prompt-assigned to the saved protocol's preferred
  move. The three lighter rungs are fixed, deterministic interventions.
- Every event links back to the writer-approved personal protocol. The event
  stores no message body.
- Immediate usefulness, delayed residue/use/regret, and writer-reported agency
  are evidence. Silence is never interpreted as an outcome.
- Observational SMS does not enter transfer comparisons. Graduated protocols
  may shape the shared Talk, Speak, and SMS companion context, but randomized
  ladder delivery is Talk-only in v1 because Talk can show assignment,
  override, and outcome controls faithfully.

## Advancement policy

The analyzer returns one of three states:

- `collecting` — fewer than six rated randomized deliveries or fewer than two
  samples on either rung.
- `ready` — the lighter rung preserves usefulness within a conservative
  non-inferiority margin, has no regret signal, has at most one negative report,
  and has at least one report of greater agency.
- `hold` — enough evidence exists but the lighter rung does not meet those
  conditions.

`ready` is a recommendation, never an automatic transition. At the independent
rung the same decision becomes a writer-controlled graduation: "This is mine
now." Graduation changes prompt behavior across channels toward the lightest
cue and away from automatically performing the move.

## Field Manual

The former What Helps Me atlas becomes a writer-owned Field Manual. Each active
protocol shows:

- its user-editable name and contextual conditions;
- evidence confidence and sample count;
- current ladder rung and progress;
- pause/resume/advance/graduation controls;
- an explicit reminder that the protocol is a contextual option, not a trait.

Rejected and retired findings remain suppressed as before. Graduation does not
delete evidence and can be restarted if the capacity becomes harder to access.

## Safety and failure behavior

- Grounding suppresses ladder assignments and graduated-protocol fading.
- Crisis, trauma exposure, help-seeking guidance, and biometric interpretation
  are never ladder arms.
- Every fixed lighter rung offers an immediate ordinary-response override.
- If provenance persistence fails, no ladder arm is delivered.
- If outcome persistence fails, the conversation remains usable and no
  advancement is inferred.
- Account export and deletion use the existing collections; no new collection
  is introduced.

## Verification target

- Pure assignment and evidence-policy tests, including retry stability,
  grounding suppression, context matching, negative/regret holds, and explicit
  graduation.
- Component tests for ladder transparency, agency outcomes, and Field Manual
  controls.
- Shared-kernel tests for graduated cross-channel behavior and grounding
  suppression.
- Full frontend, Functions, emulator, lint, build, and disposable-account E2E.

## Verification record

- Pure engine coverage for adjacent-rung assignment, retry stability,
  transferable-arm eligibility, grounding suppression, conservative
  non-inferiority, agency requirements, negative/regret holds, and exclusion
  from ordinary preferred-move findings.
- Store and rendered-component coverage for explicit start, pause, resume,
  advance, graduation, restart, fixed-rung transparency, overrides, and agency
  outcomes.
- Shared-kernel and SMS context coverage for writer-owned graduated protocols,
  cross-channel light-cue behavior, and grounding suppression.
- Export and 17-locale key-parity coverage.
- Full frontend and Functions suites, ESLint, TypeScript production build, and
  Firestore/Storage emulator suites.
- Automated disposable-account journey: two-checkbox onboarding, live GPT-5.5
  conversation, Field Manual inspection, personal-science opt-in, moment
  handshake, sampled outcome persistence, `390x844` no-overflow check, clean
  account deletion, and rejected deleted credentials.
