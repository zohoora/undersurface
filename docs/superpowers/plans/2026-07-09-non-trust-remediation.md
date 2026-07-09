# Non-Trust Remediation Completion Record

**Date:** 2026-07-09
**Source review:** `APP_REVIEW_TREE_AND_FOREST_2026-07-09.md`
**Scope:** Implement every actionable finding whose primary domain is safety correctness, reliability, architecture, operations, localization, or product coherence. Privacy, security, and cost work was explicitly excluded.

## Completed

### Crisis precision and channel parity

- Split the synchronous L1 layer into a narrow hard floor for explicit first-person methods/plans.
- Deferred contextual phrases such as “want to die,” “kms,” “overdose,” historical mentions, and “can’t do this anymore” to the context-aware L2 classifier.
- Moved the standalone L2 launch to the shared user-message append path, so Talk and Speak receive the same classifier backstop.
- Preserved Journal and Drift’s existing two-layer paths and Real Talk’s grounding override.
- Added an offline full-stack precision contract over every calibrated negative case.
- Changed the live crisis harness to evaluate the actual L1 → L2 decision pipeline rather than L2 in isolation.

### Admin configuration

- Added a server-owned configuration validator with explicit top-level and nested fields.
- Replaced silent key dropping with an HTTP 400 validation failure.
- Added the actual UI sections: `defaultResponseSpeed`, `atmosphere`, `partIntelligence`, `engagement`, `grounding`, `voice`, `features`, and `announcement`.
- Made `buildVersion` a supported explicit partial update.
- Changed the frontend to save only editable fields and signal a refresh with only `buildVersion`.
- Deep-merged server configuration with defaults on load.
- Added a backend round-trip test covering every rendered settings section.

### Bounded biometric persistence

- Added a shared `hrvArchive` builder for camera and Polar sessions.
- Bounded in-memory timeline events and shifts.
- Bounded persisted measurements, shifts, signal dumps, every raw signal array, peaks, IBIs, and spectrum bins.
- Preserved lifetime measurement and summary totals even when the rolling archive trims old samples.
- Suppressed overlapping 10-second flushes.
- Added first-party `hrv.persistence_failed` diagnostics.
- Added archive and long-session regression tests.

### Runtime ownership and dead code

- Added `SessionRuntime`, which owns the session epoch, active abort controllers, append serialization, and synchronous send lock.
- Session changes now invalidate stale async work and abort active streams.
- Moved camera/Polar selection, mutual exclusion, prompt bridging, cleanup, persistence flush, and page-layout effects into `useSessionBiometrics`.
- Removed the superseded `useAppendQueue` hook.
- Removed the unused `sessionPrompts.ts` pipeline and its test-only consumer.

### Product coherence, audience, and localization

- Rewrote login, landing, onboarding, app subtitle, HTML metadata, package metadata, and PWA metadata around the session-first product.
- Updated README and CLAUDE documentation from four surfaces to five, including Drift.
- Added an explicit 18+ onboarding acknowledgement and require it for existing as well as new accounts before app entry.
- Added an adult-gate regression test.
- Localized the complete session-first product surface and both biometric consent dialogs in all 17 supported languages.
- Added a locale completeness test for this copy surface.

### Release behavior and bundle boundaries

- Ordinary `npm run build` no longer uploads Sentry source maps or generates public map files.
- Added explicit `npm run build:release`; it fails early without a Sentry token and uses hidden source maps.
- Added `npm run test:release-evals`, which records git commit, prompt hash, model snapshot, suite results, duration, and logs.
- Added a scheduled, manual, and reusable GitHub Actions model-eval workflow with 90-day artifacts.
- Lazy-loaded Voice, Relax, and Drift surface implementations.
- Split Firebase, React/Framer, TipTap, and Sentry vendor boundaries.
- Removed all five static/dynamic import-conflict warnings.
- Reduced the largest application-generated chunk from the reviewed 681 kB engine chunk to 467 kB (Firebase vendor); the main application chunk is about 132 kB and SessionView about 240 kB.

### Remaining bounded read

- Story-arc generation now applies `.limit(24)` in Firestore instead of fetching every summary and slicing in memory.

## Explicit exclusions

These findings remain open because the requested scope excluded their primary domain:

- Privacy policy/provider/processor accuracy, analytics or advertising consent, and policy versioning.
- Reflection-content logging and Sentry PII/breadcrumb scrubbing.
- Complete machine-readable export, deletion parity, soundscape ownership, and retention/TTL policy.
- Dependency vulnerability remediation.
- Firestore writer-authority/schema rules.
- Admin identity/least-privilege/read-audit changes and stored-content prompt isolation.
- Prompt/input token accounting, durable Realtime/soundscape budgets, billing, and entitlements.
- Soundscape duplicate-generation claim timing.

The broad experimental portfolio remains behind disabled-by-default feature flags. No destructive feature removal was performed: deciding which experimental systems to delete is a product decision, not a correctness patch. The unused legacy prompt pipeline was removed.

## Verification

Completed against the resulting working tree:

| Check | Result |
|---|---|
| `git diff --check` | Passed |
| `npx tsc -b --force` | Passed |
| `cd functions && npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm run test` | **1,411 passed; 17 live tests skipped by design** |
| `cd functions && npm test` | **93 passed** |
| `npm run build` | Passed with no Sentry upload, no import-conflict warnings, and no >500 kB warning |
| Release eval runner syntax | Passed (`node --check`) |

Live model evals were not executed locally because they require an explicit API credential and are now the release/scheduled gate. Firestore index tests were not rerun because no indexes or Firestore queries requiring a new index changed. No deployment was performed.
