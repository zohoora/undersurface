# Field Windows and Intervention Half-Life

**Date:** 2026-07-10
**Status:** Implemented and verified locally

## Product claim

UnderSurface should learn not only which form of support helps, but when a
brief interruption is welcome, when quiet is better, and whether any effect
survives beyond the first few minutes.

## Field windows

A linked-SMS user may explicitly nominate up to three recurring windows. Each
window has days, local start/end time, and one purpose:

- `notice` — name what is present;
- `settle` — take one small settling pause;
- `act` — identify one concrete next move.

The user also chooses a timezone and a maximum of one to three proactive
messages per week. Field windows default off. Disabling or unlinking SMS stops
future sends.

## Timing experiment

Protocol `field-window-timing-v1` compares two deterministic arms:

- `field_check_in` — one fixed, purpose-matched SMS with explicit permission
  not to reply;
- `field_no_contact` — deliberate quiet during the nominated window.

Assignment is deterministic per writer, window, and local date. Both arms are
recorded; neither reply rate nor silence is treated as wellbeing evidence. On
the next eligible app opening, the writer may rate how the timing fit. Missing
ratings stay missing.

## Dispatch architecture

1. A 15-minute scheduled function scans explicitly enabled preference docs.
2. A pure evaluator checks timezone, day, window, weekly cap, linkage, and a
   deterministic assignment id.
3. The scheduler writes a versioned research event. No-contact assignments are
   delivered immediately as quiet; contact assignments create a server-owned
   dispatch queue document.
4. A retrying queue trigger claims one dispatch, rechecks current opt-in and
   linkage, sends through Twilio, stores the outbound transcript, and marks
   provenance delivered.
5. Queue ids and research-event ids are deterministic, so scheduler retries
   cannot send duplicates. Account deletion removes pending dispatches.

The recoverable E.164 destination exists only in the server-owned phone-link
record. Client-readable SMS settings retain only the hash and last four digits.

## Outcome horizons

User-reported outcomes have three possible horizons:

1. immediate timing or intervention fit;
2. later today, after at least two hours;
3. next day, after at least twenty hours.

The model never grades its own response. Follow-ups are sparse, skippable, and
asked at most once per horizon. A skipped prompt is recorded only as asked, not
as a neutral outcome.

## Half-life evidence

The Field Manual summarizes rated horizon evidence for each writer-approved
protocol:

- `early` — fewer than three later reports;
- `carried` — usefulness remained in at least two next-day reports with no
  regret;
- `faded` — usefulness appeared later that day but not in available next-day
  reports;
- `mixed` — the small sample does not support either description.

Counts remain visible. No percentages or population claims are shown.

## Safety and autonomy

- Grounding and crisis content are never timing experiments.
- Proactive SMS copy is fixed; it never introduces interpretation or trauma
  exposure.
- Quiet hours are structurally enforced by the nominated windows.
- The user can disable windows or unlink SMS at any time.
- A proactive message always says no reply is required.
- Engagement, reply rate, and time in app are not benefit metrics.
- No field window can send more than once per local date, and the weekly cap is
  enforced before queue creation.

## Verification target

- Pure timezone/window/assignment/cap tests, including DST-compatible local
  formatting and retry-stable ids.
- Scheduler and dispatcher tests for opt-in rechecks, no-contact provenance,
  queue idempotency, and cancellation after unlink.
- UI tests for linked-only controls, persistence, timing-fit ratings, and both
  delayed horizons.
- Half-life analyzer, Field Manual, export, localization, and deletion tests.
- Full frontend, Functions, emulator, lint, build, and disposable-account E2E.

## Verification record

- Deterministic timezone, day, cap, one-per-date, assignment, deliberate-quiet,
  and pre-delivery consent/link recheck tests.
- Functions compilation and full Functions suite, with Twilio mocked or pure;
  no test sent a real proactive SMS.
- Full frontend suite, localization parity, lint, production build, and all
  Firestore/index/storage emulator tests.
- Disposable signed-in browser account: onboarding without an age gate,
  settings persistence, personal-science handshake, live Talk turn, closing
  outcome, next-step capture, account deletion, and rejected post-deletion
  credentials. Zero browser console errors.
