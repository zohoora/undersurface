# Personal Science Companion

**Date:** 2026-07-10
**Status:** Implemented and verified locally

## Product claim

UnderSurface does not claim to know the writer. It helps the writer discover,
with visible uncertainty, which forms of reflection are useful in which kinds
of moments. The system is successful when the writer gains agency, carries
something useful into life, or no longer needs another response.

## Closed loop

1. The writer optionally describes the moment with three low-burden signals:
   state, available capacity, and desired kind of help.
2. At a sparse, eligible, non-grounding turn, a versioned protocol assigns one
   low-risk response form.
3. The app records assignment separately from actual delivery and override.
4. The writer may report an immediate effect and a later residue/use/regret.
5. A deterministic, inspectable analyzer derives tentative findings only from
   rated, actually delivered randomized events.
6. The writer may keep, rename, reject, or retire a finding as a personal
   protocol. A finding never silently becomes a rule.

## Initial protocols

### Response grammar v1

Compares bounded response-grammar moves that fit the writer's declared need.
The model receives an exact one-turn structural assignment; persona and safety
rules do not change.

### Subtraction v1

Compares a generated response with a deterministic quiet turn. A quiet turn is
explicitly labeled in the interface and always offers an immediate override to
ask the companion to respond. This tests whether generation adds value rather
than presuming that it does.

### Surface choreography v1

Compares continuing in Talk with offering a reversible Journal arc. The offer
is deterministic and optional; entering Journal remains the writer's choice.
Later versions may add enabled Speak, Relax, or Drift surfaces after the basic
measurement contract has enough data.

## Eligibility and assignment

- Personal science is explicit opt-in in Companion Settings.
- The writer may skip the moment handshake and use UnderSurface normally.
- No experiment runs on an opener, during grounding, in a closed session, on
  consecutive eligible turns, or after the per-session cap.
- Assignment is deterministic from a stored seed so retries cannot switch arm.
- An assigned arm is not counted as delivered until its model response or fixed
  intervention is durably written.
- Delivery fidelity remains explicit: fixed interventions are deterministic,
  Talk response-grammar arms are prompt-assigned, and SMS response modes are
  model-reported structured output. Findings never hide this distinction.
- A writer override is preserved as an override, not relabeled as failure.
- Crisis behavior, grounding, trauma exposure, help-seeking guidance, and
  biometric interpretation are never experimental arms.

## Evidence model

`researchEvents` stores protocol/version, eligibility point, assignment kind,
assigned and delivered arms, context labels, model/prompt/app versions,
source ids, overrides, and outcome linkage. It contains no message body.

`interventionOutcomes` remains the writer-report source of truth and gains a
research-event link plus optional agency/next-step fields.

`personalProtocols` stores only writer-reviewed conclusions: active, rejected,
or retired. Evidence ids and confidence labels remain visible.

Observational SMS and surface events may inform a history view but never power
causal comparison language.

## What Helps Me

The user-facing atlas shows:

- how many experiments were actually rated;
- early findings with sample counts, negative outcomes, and visible uncertainty;
- active user-named protocols;
- rejected and retired findings without repeatedly proposing them;
- plain-language reminders that these are contextual hunches, not diagnoses.

Confidence labels are intentionally conservative: `early`, `emerging`, and
`repeated`. The interface never displays percentages from tiny samples as if
they were population statistics.

The next phase is implemented in
`2026-07-10-transfer-ladder.md`: writer-approved protocols may enter a
four-rung, writer-controlled practice ladder that tests whether usefulness can
survive progressively lighter companion support. Graduation is explicit and
shared across Talk, Speak, and SMS.

## Alliance constitution

The writer can set stable interaction preferences shared by Talk, Speak, and
SMS: comfort before challenge, ask before interpreting, directness, question
frequency, and phrases to avoid. These are instructions about the companion's
behavior, not claims about the writer.

Every eligible companion response has a low-friction `you missed me` path with
writer-authored reason labels. Repair feedback is stored as an outcome and may
shape later responses; the companion does not defend its intent or infer why a
session ended when the writer has supplied a reason.

## Anti-dependence outcome

Session closing may optionally ask what happens next: done for now, an offline
step, human contact, rest, or more support. Message count, session duration,
and return frequency are never treated as mental-health benefit.

## Data lifecycle

Both new collections join the client proxy, export, and account-deletion
registry. Account ownership rules remain unchanged. No experiment machinery
may bypass the existing data export or deletion path.

## Verification record

- Frontend TypeScript and production Vite/PWA build
- Cloud Functions TypeScript build
- Full frontend suite, including assignment, deterministic delivery,
  grounding suppression, handshake, repair, outcomes, atlas, export, and
  localization-key parity coverage
- Full Cloud Functions suite, including shared alliance context and SMS
  observational provenance
- Firestore rules/index and Storage rules suites under the emulators
- Desktop public-route initialization and `390x844` rendered overflow pass

Authenticated browser coverage now includes a disposable-account journey
through account creation, the two remaining onboarding acknowledgements, a
live companion exchange, persisted personal-science and alliance preferences,
the moment handshake, session closing, an offline next-step outcome, account
deletion, and rejection of the deleted credentials. The former age
attestation was removed by product direction so this journey can remain fully
automated.
