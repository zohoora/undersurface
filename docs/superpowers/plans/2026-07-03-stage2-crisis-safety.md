# Stage 2: Cross-Channel Crisis Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The grounding invariant ("distress disables Real Talk, no exceptions") holds on every channel, session mode gets an independent L2 backstop, the L1 regex stops over-calling, and a multilingual eval set locks the calibration in.

**Architecture:** Four independent tasks. (1) Voice: subscribe to grounding in useSessionVoice; on activation mid-session push rebuilt grounded instructions via the existing `sendSessionUpdate`. (2) Talk: race a standalone `classifyCrisisRisk` (gpt-5-nano) against the stream inside `generateTherapistMessage`, wired into the existing crisis-abort-retry mechanism, once per user turn. (3) Calibrate the L1 patterns for precision (over-calling history — see memory). (4) Extend `crisisClassifier.eval.ts` with multilingual cases + add red-team prompt-injection unit tests.

**Tech Stack:** Existing. No new deps.

## Global Constraints

- Inherit master plan constraints. NEVER weaken `useRealTalk = mode === 'real_talk' && !isGrounding`.
- Crisis calibration favors precision over recall for L2/L1 *upgrades*; the L1 floor keeps catching explicit ideation. Deleting an L1 pattern requires an eval negative showing it over-calls AND an eval positive proving explicit cases still catch.
- classifyCrisisRisk stays fail-open internally (returns 0 on error) — the backstop must never brick sends.
- One classifier call per user turn, not per retry attempt; skip openers (no user message) and skip when grounding is already active.

---

### Task 1: Voice-channel grounding push

**Files:** Modify: `src/hooks/useSessionVoice.ts`, maybe `src/hooks/useVoiceSession.ts` (sendSessionUpdate shape). Test: `src/hooks/useSessionVoice.test.ts`

**Interfaces:** Consumes `subscribeGrounding`/`isGroundingActive` (store/groundingState re-exported via useGroundingMode), `buildTherapistSystemPrompt` (already imported), `voice.sendSessionUpdate`.

- [ ] Failing test: render useSessionVoice, simulate connected voice state, `act(() => activateGrounding('auto'))` → expect `sendSessionUpdate` called with `instructions` containing the grounding directive and NOT containing Real Talk persona markers.
- [ ] Implementation: effect subscribing to grounding; on transition to active while voice session live, rebuild instructions with `isGrounding: true` (mode forced through the normal builder guard) and push `session.update`.
- [ ] Also cover: grounding activating while NOT connected → no call; deactivation → no spurious call (one-way push is fine for v1).
- [ ] Commit `fix(safety): grounding now reaches live voice sessions`

### Task 2: Standalone L2 backstop in session Talk mode

**Files:** Modify: `src/hooks/useSessionStream.ts`. Test: `src/hooks/useSessionStream.test.ts`

**Interfaces:** Consumes `classifyCrisisRisk(text, langCode)` from openrouter.ts (fail-open, returns 0|1|2), the existing `crisisAbortController`/`crisisAborted` mechanism in the generate loop.

- [ ] Failing test: mock classifyCrisisRisk → resolves 2; stream a normal response; expect grounding activated + stream aborted + grounded retry (same observable behavior as the preamble risk=2 path).
- [ ] Tests: classifier resolves 0 → no effect; classifier rejects → no effect; opener turn → classifier not called; grounding already active → not called; classifier called once across retry attempts.
- [ ] Implementation: fire the classifier promise once per generate (latest user message), wire `.then(risk => …)` into the same abort path as `onRisk(2)`; guard with `crisisAborted`/`isGroundingActive()`.
- [ ] Verify preamble-absence diagnostics: confirm `stream.preamble_malformed` fires on fail-open flush in openrouter.ts; add if missing.
- [ ] Commit `feat(safety): standalone L2 crisis classifier races the therapist stream`
- [ ] Update CLAUDE.md flow diagram (the Talk crisis block) to the new two-signal reality.

### Task 3: L1 regex precision calibration

**Files:** Modify: `src/engine/sessionOrchestrator.ts` (crisis patterns). Test: `src/engine/sessionOrchestrator.test.ts` + `src/engine/crisisClassifier.eval.ts` negatives.

- [ ] Collect the prior review's over-calling patterns (`/with jesus/`, `/can't do this anymore/`, `/rest forever/` and similar) — write failing tests from the eval set's own negatives (grief, metaphor, religious idiom, tiredness hyperbole) asserting checkCrisisKeywords does NOT fire.
- [ ] Keep/add explicit-ideation positives as regression tests before touching any pattern.
- [ ] Tighten patterns: require first-person + intent context where the bare phrase is ambiguous; delete only patterns whose true-positive coverage is redundant with a surviving pattern.
- [ ] Commit `fix(safety): calibrate L1 crisis patterns for precision (over-calling history)`

### Task 4: Multilingual eval set + red-team injection tests

**Files:** Modify: `src/engine/crisisClassifier.eval.ts`. Create: red-team cases in `src/ai/therapistPrompts.test.ts` / `src/ai/promptSafety.test.ts`.

- [ ] Extend the eval set: for each of ~12 major locales (es de fr pt ru ja zh ko hi tr pl nl), add ≥2 negatives (grief/metaphor/hyperbole/gallows humor, native idiom — e.g., Turkish "öldüm" = "I'm dead (tired)") and ≥1 explicit positive. Asymmetric gates: negatives must → 0, explicit → 2.
- [ ] Red-team unit tests: adversarial content in memories/summaries/profile/personalFacts fields through buildTherapistSystemPrompt → assert sanitization holds for every context block.
- [ ] Run the offline test suite; run the live eval (`npm run test:crisis`) if credentials allow; record results in the plan file.
- [ ] Commit `test(safety): multilingual crisis eval set + prompt-injection red team`

### Verification gate + Deploy #2 — status

- Task 1 (voice grounding), Task 2 (L2 backstop), Task 3 (L1 calibration), Task 4 (eval + red team) all committed.
- Eval set: 52 → 97 cases across 16 languages (was 5). Red-team injection test added covering every context block.
- Preamble pure-absence diagnostic deferred to Stage 3 (needs the C5 opt-in flag to know a preamble was expected, else false positives on diary callers).
- Live crisis eval (`RUN_CRISIS_EVAL=1 npm run test:crisis`) hits the real API + needs auth — run manually before relying on the new multilingual thresholds; not a headless CI gate.
- [x] Full gate: tsc ×2 clean, 1123 frontend + 65 functions tests green, lint clean.
- [ ] Deploy #2 (hosting) + smoke + Chrome check — batched with Stage 3 (both client-only) to reduce deploy churn, OR deploy now.
