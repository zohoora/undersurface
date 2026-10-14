# Technical issues: 2026-10-14

**For:** a coder agent working through fixes.
**Scope:** current `main` (2985b02). Focus is code added since the 2026-07-09 review: Room, the adaptive conductor, the SMS field channel and field windows, personal science, Fresh eyes, PWA updates.
**Method:** read-only source audit (frontend and functions, run in parallel) plus spot verification. Items marked **Verified** were re-read and confirmed independently by a second pass. Items marked **PLAUSIBLE** need a reproduction before fixing.
**Companion file:** `docs/vision/2026-10-14-the-deep.md` (the creative direction; not part of this fix list).

## Fix status (branch `fix/audit-2026-10-14`)

All items below were fixed on the branch on 2026-10-14. Nothing is deployed. The owner steps at the end of this section remain.

| # | Status | Commit(s) |
|---|---|---|
| 1 | Fixed: grounding is read at call time; deterministic offers re-check it and fall back to a model turn | 5d7da34 |
| 2 | Fixed: accurate processor disclosure in 17 locales (owner: verify the OpenAI retention sentence) | i18n commits (see below) |
| 3 | Fixed: client writes `lastGroundingAt`; server records SMS risk; 72h suppression of proactive texts; SMS turns grounded | 5d7da34, 1e3116e, b5d7e59 |
| 4 | Fixed: anchored ≤6-word English-only grammar; skipped on L1/grounding | 5d7da34 |
| 5 | Fixed: pills intent forms, negation, distant-past guards (owner: run `npm run test:crisis` before deploy) | 56c7110 |
| 6 | Confirmed by Realtime docs and fixed: cues sent as system conversation items | 1fc776d |
| 7 | Fixed | 1fc776d |
| 8 | Fixed; crisis reply additionally resends once on an ambiguous failure | 1e3116e, 52082ee |
| 9–10 | Fixed | b5d7e59 |
| 11 | Fixed | 399d433 |
| 12 | Fixed | 5d7da34, 399d433 |
| 13 | Fixed | 5d7da34 |
| 14 | Fixed for Room/Voice; the app-level lazy loader is completed in the sweep (S1) | 399d433 + sweep |
| 15 | Fixed | 5d7da34, 399d433 |
| 16–17 | Fixed (chat usage metering, prompt-token tracking, request caps, voice flag enforcement + daily budget, SMS kill switch + daily budget) | ceecff5, 1e3116e |
| 18 | Fixed in code (owner: enable the `smsInbound` TTL policy) | 1e3116e, 0398dff |
| 19 | Fixed: components localized; translations win over English fallbacks; untranslated-English test | 71d22eb + i18n commits |
| 20 | Fixed: single `roomEnabled` (falls back to legacy flags when unset) and `smsEnabled` toggles | db94253, 0398dff, 2f0e75d |
| 21–26 | Fixed | 1e3116e, b5d7e59, dc4a396, 52082ee |
| 27 | Fixed (recursiveDelete, token revocation, Twilio cleanup, processor tombstone check). Residual: an open tab can write for up to about an hour after deletion because the rules don't check the tombstone (owner decision) | 0398dff, 1e3116e |
| 28 | Fixed: soundscapeApi removed (owner: optionally delete the ElevenLabs secret and old cache objects) | 0398dff |
| 29 | Fixed | b5d7e59 |
| 30 | Fixed: unreachable UI deleted, 275 dead i18n keys removed, `test:drift` retired | db94253, 95b2509 |
| 31 | Fixed | 399d433 |
| 32 | Fixed | 71d22eb, 399d433 |
| 33 | Confirmed real and fixed | 1fc776d |
| 34–35 | Fixed (single voice-instruction builder) | 399d433, 1fc776d |
| 36 | Fixed per owner decision: one web CSP that allows Google Ads; native builds inject their own | ebe31ee |
| 37 | Fixed per owner decision: letters visible in the settings sheet | 3bec245 |
| 38 | Fixed | 12f7236 |
| 39 | Fixed: precache 2.69 MB → 1.93 MB | ebe31ee |
| 40 | Fixed (scheduler/dispatcher/sweeper/processor tests; emulator rules tests) | b5d7e59, dc4a396 |
| PLAUSIBLE webhook `set()` | Fixed (`create()`) | 1e3116e |

**Added from the second (Codex) review, `docs/reviews/2026-10-14-technical-handoff.md`:**

| ID | Issue | Status |
|---|---|---|
| T1 | Journal drafts can disappear or attach to the wrong session | Fixed: device-local drafts owned by (uid, session), exactly-once append to the owning session (95f1b98) |
| T2 | Room can outlive its parent session | Fixed: lifetime token, late transcripts fenced (399d433) |
| T3 | Room finish overwrote recorded choices | Fixed: immutable snapshots, per-Room write queue (399d433) |
| T4 | Ordinary speech parsed as Room commands | Same as #4 |
| T5 | Talk → Room/Speak dropped the current conversation | Fixed: bounded seed of current-session turns; Fresh eyes keeps them (1fc776d) |
| T6 | Room had no keyboard boundary | Same as #32: dialog, focus trap, inert background, Escape (399d433) |
| Export | Room visits missing from the Markdown export | Fixed (8b51d93) |

**Found during the fixes:**

| ID | Issue | Status |
|---|---|---|
| F1 | Ending a session from Journal hid the closing message | Fixed (3e68fba) |
| F2 | Dead Relax/Drift device settings | Removed (95b2509) |
| S1 | App-level `lazyWithRetry` reloads unconditionally (offline loop), and it wraps CrisisResources | Sweep commit |
| S2–S8 | Dead voice override, no-op admin settings, Room ignoring the admin voice, autocorrect on the main model, kill-switch gaps on phone linking, possible second conductor move, dangling `outcomeId`, field-window timezone/mosaic/budget-refund details | Sweep commit |

Known, not changed (product decision): the July 10 "make personal science ambient" change already left the transfer ladder and personal-protocol creation dormant. Nothing creates `personalProtocols` any more, and several outcome writers are test-only.

**Owner steps before or at deploy:**
1. `OPENAI_API_KEY=… npm run test:crisis`, and approve the new L1 cases in `functions/src/shared/crisisFloor.test.ts`.
2. Deploy order: `firebase deploy --only firestore:indexes` → `firestore:rules` → functions → hosting. Admin saves of `roomEnabled`/`smsEnabled` fail until the functions schema is live. The next functions deploy deletes `soundscapeApi`.
3. `gcloud firestore fields ttls update expireAt --collection-group=smsInbound --enable-ttl --project=undersurfaceme`
4. Native builds must use `npm run build:native` (all `cap:*` scripts do).
5. Have a native speaker review the translated privacy policy, and verify the OpenAI retention sentence.

## Current gate status (2026-10-14)

| Gate | Result |
|---|---|
| `npx tsc -b --force` | pass |
| `npm run lint` (exit code checked directly) | pass |
| `npm run test` | pass: 112 files, 1,551 tests, 17 live-eval tests skipped |
| `npm run build` | pass, no chunk warnings |
| `cd functions && npx tsc --noEmit` | pass |
| `cd functions && npm test` | pass: 19 files, 145 tests |
| `npm run test:indexes` (emulator) | **not run**: local Java is 1.8, emulator needs 11+ (CI uses 21) |

## Rules for whoever fixes these

- Type-check with `npx tsc -b --force` (never `tsc --noEmit -p tsconfig.json`, which checks zero files). Gate on `npm run lint`'s exit code; don't pipe it.
- **Do not weaken** `useRealTalk = mode === 'real_talk' && !isGrounding` in `therapistPrompts.ts`, or delete the tests that pin it.
- The crisis classifier is tuned for **precision**. Any change to L1 regexes or L2 prompts must be checked with `npm run test:crisis` (live, needs `OPENAI_API_KEY`), and the eval set is the arbiter.
- Deploys, Firestore TTL policies, secret removal, and feature-flag changes in `appConfig/global` are infrastructure changes. **State the current live state and the proposed change, then wait for the owner's confirmation** before doing any of them.
- Items in the "Owner decisions" section are not to be decided by the coder agent.

---

## P0

### 1. A crisis turn can be answered by a canned conductor or research message (Verified)
**Where:** `src/components/Session/SessionView.tsx:277-356` (`respondToUserTurn`), called from `handleSend` at about `:374-404`. L1 runs inside `appendUserMessage` (`src/hooks/useSessionStream.ts:844`), which calls `activateGrounding` synchronously.

**Problem:** `respondToUserTurn` reads `grounding` from the React state captured at render time. When L1 fires during `await appendUserMessage(...)`, grounding is now active but the closure still sees `false`. `planAdaptiveConductor` and `planResearchTurn` both run, and three delivery paths skip the model entirely: `fixed_surface_offer`, `fixed_journal_offer`, and `fixed_transfer` call `appendDeterministicCompanionMessage`. The model path is safe only because `generateTherapistMessage` re-reads `isGroundingActive()`.

**Scenario:** After the conductor's three shadow turns, a writer sends a message that trips L1. The conductor ranks `room_arc` highly (body words) and the only reply is "Your body may need a change of atmosphere… [Open Room…]". No grounded response is generated.

**Fix:**
- Use `const groundingNow = isGroundingActive()` inside `respondToUserTurn` and `handleMosaicOpen` instead of the captured `grounding`.
- Defense in depth: inside `appendDeterministicCompanionMessage`, re-check `isGroundingActive()` and fall back to `generateTherapistMessage`.

**Test:** L1 fires on a turn whose conductor seed would deliver a fixed offer. Expect no deterministic message, and a grounded model turn instead.

### 2. The privacy policy names the wrong provider and omits SMS, MMS and phone numbers
**Where:** `src/i18n/translations/en.ts:350` and all 17 locales.

**Problem:** The policy still says "OpenRouter". It does not mention OpenAI (chat and Realtime), Twilio (phone numbers, SMS bodies, MMS images), Cloud Storage for field-moment images, ElevenLabs, Sentry, or Google Analytics and Ads. It also says data is not shared.

**Fix:** Draft an accurate processor inventory and SMS/MMS/phone sections with retention terms (see #18). **The owner must approve the wording** before it ships to 17 locales.

---

## P1: safety-adjacent

### 3. Proactive SMS and SMS replies ignore a recent crisis
**Where:** `functions/src/sms/fieldWindows.ts:225-241` (pre-send recheck), `functions/src/sms/prompts.ts:22-25` (no `grounding` passed), `functions/src/sms/index.ts:363-375`.

**Problem:** The field-windows spec says crisis content is never a timing experiment. The dispatcher rechecks consent and linkage only. App grounding lives in browser memory (`src/store/groundingState.ts`), so the server can't see it. SMS replies never set the kernel's `grounding` option, even right after a risk-2 crisis reply.

**Scenario:** The fixed crisis SMS goes out at 08:50. At 09:00 the "act" window sends "what is one next move…".

**Fix:**
- Persist a server-readable `lastRiskAt` (server-owned doc) on SMS risk ≥ 1 and on app grounding activation.
- The scheduler and dispatcher cancel within N hours (suggest 72) of `lastRiskAt`.
- SMS passes `grounding: risk >= 1 || recentCrisis`.

### 4. Room treats ordinary speech as voice commands (Verified)
**Where:** `src/engine/roomEngine.ts:45-54`, applied to every user transcript at `src/hooks/useRoomSession.ts:190-191`.

**Problem:** These all match:

| Utterance | Detected | Effect |
|---|---|---|
| "At the end of the day I just feel tired" | `end` | Room closes |
| "I need to finish my thesis" | `end` | Room closes |
| "I want it all to end" | `end` | Room closes while L2 is still classifying a possible passive-ideation statement |
| "My boss wouldn't stop talking" | `quiet` | Cancels the reply and **disables the mic** (`setVoiceDensity` → `voice.setMicEnabled(false)`) |
| "not yet", "keep going" | `stay` | Room extends |

The detector is English-only, yet `roomPrompts.ts` tells the model "the application also handles the control locally" in every language.

**Fix:**
- Match only short whole utterances (anchored patterns, ≤ 6 words).
- Never treat bare `end` or `finish` as a command.
- Skip detection when L1 fires or the text is crisis-adjacent.
- Localize the patterns, or drop the "handled locally" sentence for non-English sessions.

**Test:** a table of the sentences above, all returning `null`.

### 5. The L1 hard floor fires on benign text, and on SMS it replaces the whole reply
**Where:** `functions/src/shared/crisisFloor.ts:7-11`; applied at `functions/src/sms/index.ts:363,375`.

**Problem:** `detectCrisisKeywords` returns true for "I forgot to take the pills this morning", "I would never kill myself, I just hate this job", and "Five years ago I tried to end my life. I am doing much better now." L2's own contract scores past tense and hyperbole as 0. On SMS, an L1 hit skips L2 and sends the fixed emergency text.

**Fix:** Tighten the pills patterns to intent forms. Add negation and past-tense guards that defer to L2. Add full-stack L1+L2 eval cases. **Run `npm run test:crisis`.** This is a precision-calibrated area, so treat the eval as authoritative.

### 6. PLAUSIBLE: Room cue responses may run without the companion system prompt
**Where:** `src/hooks/useVoiceSession.ts:482-493` (`promptAssistant`), used by `useRoomSession.ts:314`.

**Problem:** `response.create` with `response.instructions` likely overrides the session instructions for that response. If so, the arrival, company and return cues are generated without SAFETY_RULES, the language directive, Fresh-eyes boundaries, or the Room rules.

**Verify:** run a non-English Lead-me Room and check the language of the first cue.

**Fix:** Send the cue as a `conversation.item.create` system item, then `response.create` with no `instructions`. Alternatively, concatenate the full session instructions and the cue.

### 7. A dropped voice connection is never shown to the user
**Where:** `src/hooks/useVoiceSession.ts:195-293`, `:404-418`.

**Problem:** There are no handlers for `pc.onconnectionstatechange`, `oniceconnectionstatechange`, `dc.onclose`, or `dc.onerror`. Commit 961cbc8 made the server `error` event log-only. After an ICE failure or server-side session end, the UI keeps saying "listening", the mic track stays live, the Room wake lock stays held, and Room's retry button never appears.

**Fix:** Handle `failed`/`closed` and non-local `dc.onclose` by tearing down and setting the error. Treat fatal server error codes as fatal.

---

## P1: correctness and data

### 8. An SMS retry can send a second, different reply (Verified)
**Where:** `functions/src/sms/index.ts:423-437` (Twilio send, then Storage upload), `:502` (commit), `:503-514` (catch resets to `pending` and rethrows), trigger `retry: true` at `:354`.

**Problem:** If the media upload or batch commit fails after the send, the retry re-generates and re-sends. Permanent Twilio 4xx errors (e.g. 21610, unsubscribed) are retried too.

**Fix:**
- Immediately after `messages.create`, write `outboundSid` and `sendState: 'sent'` to the queue doc.
- On retry, skip the send when `outboundSid` exists and only finish the remaining writes.
- Make the media upload non-fatal.
- Classify Twilio 4xx as terminal.

### 9. The weekly proactive-SMS cap can be exceeded (Verified)
**Where:** `functions/src/sms/fieldWindows.ts:54-70` (`proactiveCount`).

**Problem:** It reads the latest 100 `researchEvents` across **all** protocols and filters in memory. SMS replies and conductor turns also write research events, so active users push field-window events out of the window and the count drops to 0.

**Fix:** Query `where('protocolId','==','field-window-timing-v1').where('weekKey','==',key)` (add the index), or keep a server-owned weekly counter updated in the scheduler transaction.

### 10. One malformed preferences doc stops field windows for everyone after it
**Where:** `functions/src/sms/fieldWindows.ts:95-158` (no per-user try/catch; `limit(500)` with no pagination), `functions/src/sms/fieldWindowLogic.ts:150,169` (`window.label.trim()` on a missing label).

**Problem:** `companionPreferences/current` is client-writable. A window without `label` throws and aborts the whole run, so every user who sorts after it is skipped on every tick. Users past the first 500 are never scheduled.

**Fix:** Validate every field. Use per-user try/catch with category-only logging. Paginate with `startAfter`.

### 11. Saying "stay" during Room's Listen-first threshold breaks its clock
**Where:** `src/hooks/useRoomSession.ts:170-175`, `:300-305`.

**Problem:** `applyCommand('stay')` moves the phase to `immersing` without setting `immersionStartedAtRef`.
- **First Room after mount:** the clock never runs.
- **Later Rooms:** a stale timestamp fires every cue in one tick.

**Fix:** If the phase is `threshold`, call `enter()`. Reset `immersionStartedAtRef` in `finish()`.

### 12. A `#switch:speak` link can start a voice session the user can't see
**Where:** `SessionView.tsx:655-657` → `handleSurfaceChange` at `:550-552`; render guard at `:1222`. `RECOMMENDATION_BLOCK` teaches `#switch:speak` unconditionally (`therapistPrompts.ts:205`).

**Problem:** When voice is disabled, tapping the link opens the mic and starts a Realtime session. Transcripts are written, but no overlay or stop control is rendered.

**Fix:**
- Gate `speak` and `room` targets on their flags in both handlers.
- Render VoiceField whenever `voice.state !== 'idle'`.
- Only teach links for surfaces that are actually available.

### 13. Room offers from the conductor have no "Not now"
**Where:** `src/components/Session/SessionMessage.tsx:112`.

**Problem:** The decline control is only rendered for `journal_arc | speak_arc | relax_arc | drift_arc`. `room_arc`, the most common arm, can't be declined, so `markResearchOverridden` never records the decline and the conductor's data is skewed.

**Fix:** Use `isConductorSurfaceArm(message.researchArm)`, and add a `room_arc` test.

### 14. Stale chunks after a deploy can crash the whole app
**Where:** `SessionView.tsx:47-48` (plain `lazy()` for VoiceField and RoomField), `vite.config.ts` (`skipWaiting` + `clientsClaim` from 49ae186), single root ErrorBoundary at `main.tsx:157`, `i18n/index.ts:23` (no `.catch`).

**Problem:** A new service worker claims open tabs and cleans the old precache. Hosting rewrites `**` to `index.html`, so the old-hash chunk import fails and the root boundary replaces the session, losing any draft.

**Fix:**
- Use `lazyWithRetry`, or a `vite:preloadError` handler that reloads once.
- Add local error boundaries around Room and Voice.
- Add `.catch` to `preloadLanguage`.

### 15. Starting a session can close or delete one that's live in another tab or device
**Where:** `src/engine/sessionFinalizer.ts:7-41`, called from `SessionView.tsx:205`.

**Problem:** Every new session closes all other active sessions in the latest 20 and deletes empty shells, with no recency check. Two tabs landing on `/session/new` delete each other's shells, and a laptop "New session" closes the phone's ongoing session.

**Fix:** Skip sessions with activity in the last ~30 minutes. Optionally subscribe to the session's `status` and react when it is closed remotely.

### 16. Streamed chat turns are always charged the full token reservation
**Where:** `functions/src/chat.ts:277-290`, `:242-250`, `:363`.

**Problem:** There is no `stream_options: { include_usage: true }`, so `completionTokens` is `null` and `settleQuota(null)` charges the whole `max_tokens` (up to 4000) per streamed turn. With the quota enabled, users hit the cap about 6x early. Input tokens are still not metered.

**Fix:** Add `include_usage` when streaming, and meter `prompt_tokens`.

### 17. Several cost paths have no durable per-user limit
**Where:** `functions/src/realtime.ts:58-82`, `functions/src/sms/index.ts:203`, `functions/src/chat.ts:191-240`.

**Problem:**
- **Realtime:** any signed-in user can mint sessions with client-supplied instructions up to 48k chars. The server checks no feature flags and appends no server-side safety block.
- **SMS:** available to everyone, with no quota and no kill switch.
- **Chat:** system and assistant message length is unbounded, and the quota-exempt `crisis_check`/`signal_check` routes accept arbitrary messages.

**Fix:**
- Enforce feature flags server-side.
- Keep daily per-user budgets in `quotas/{uid}` for voice mints and SMS turns.
- Add `features.smsEnabled`.
- Cap request bytes and enforce role order.

### 18. MMS media and message bodies are retained indefinitely
**Where:** `functions/src/sms/index.ts:493-501`, `functions/src/account.ts:69-75`.

**Problem:**
- Twilio keeps every MMS image and message body forever; there are no media deletes or body redaction.
- Top-level `smsInbound` docs keep `body` and `from` after completion.
- Account deletion touches neither.

**Fix:**
- Delete Twilio media after fetch (`messages(sid).media(mediaSid).remove()`), and optionally redact bodies.
- Clear `body`/`from` on completion.
- Add a TTL on `smsInbound.completedAt` (**infra change: confirm with owner**).
- On account deletion, delete the user's message SIDs at Twilio.

### 19. i18n: about 36% of strings are English in every non-English locale, and Room regressed existing translations
**Where:** `src/i18n/translations/sessionCopy.ts` (English `personalScienceEnglish` spread into every locale), `src/i18n/roomFallback.ts`, `conductorFallback.ts`, `driftSeamlessFallback.ts`.

**Problem:**
- 236 of 647 keys equal English in all 16 other locales: all of Room, the conductor, shell aria-labels, the landing preview, and `ps.*`.
- `roomFallback` is spread last, so it **overwrites** existing translations of `onboarding.step1.body` and `landing.feature2`. First-run onboarding is English for German, Japanese and others.
- Hardcoded English in components: `SurfaceArc.tsx` (all), `FieldMosaic.tsx` (all), `RoomField.tsx:185`, `SessionView.tsx:1057`, the `main.tsx:91-93` banner, and `CompanionPreferencesSection.tsx:135-197`.
- The key-parity test can't see any of this.

**Fix:**
- Spread fallbacks **before** locale blocks.
- Translate the strings.
- Add a test that fails when a non-allowlisted value equals English.

### 20. Admins can't fully turn Room off, and the toggles are mislabelled
**Where:** `src/admin/AdminSettings.tsx:676-715`, `SessionView.tsx:105`.

**Problem:**
- Room is on when `relaxEnabled || driftEnabled`, but the Drift toggle is nested under Relax and hidden when Relax is off.
- Labels still say "Relax Mode / hypnotherapy".
- "Custom soundscapes" controls nothing now.

**Fix:** A single `roomEnabled` flag with a migration (**owner decision**, see below), or at minimum un-nest and relabel the toggles.

---

## P2

| # | Issue | Where | Fix |
|---|---|---|---|
| 21 | Server-owned docs (`smsSettings`, `smsMessages`) are client-writable; the phone-recovery fallback trusts `smsSettings.phoneHash` and can merge-create an orphan `smsPhoneLinks` doc holding a plaintext number | `firestore.rules:4-6`, `functions/src/sms/linking.ts:152-162` | Deny client writes to those collections; in the fallback, `update` only an existing link with a matching `uid`; add rules tests |
| 22 | Dispatcher doesn't recheck the window and `localDate` at send time; failed sends leave research events `assigned` (still counted toward the cap); stuck `sending`/`pending` docs have no sweeper | `functions/src/sms/fieldWindowLogic.ts:215-226`, `fieldWindows.ts:210-300` | Recheck the clock before send; mark failures; add a stale-doc sweeper; write `outboundSid` first |
| 23 | The weekly cap biases the timing experiment (late-week days only appear in the no-contact arm) | `fieldWindowLogic.ts:158` | When capped, record nothing for the date or record an `ineligible_cap` event excluded from analysis |
| 24 | STOP/UNLINK leave `fieldWindows.enabled`/`consentAt` intact, so re-linking resumes proactive texts; STOP is handled after the rate limiter; no OPTOUT/REVOKE keywords; proactive copy lacks "Reply STOP" | `functions/src/sms/index.ts:203-220`, `sms/field.ts:15` | Clear consent on opt-out; handle opt-out first; extend keywords |
| 25 | SMS prompts use UTC; no local time reaches the model, so "tonight"/"this morning" is guessed | `functions/src/sms/prompts.ts:82`, `shared/companionKernel.ts:300-310`, `sms/context.ts:190` | Pass the user's timezone and a local "now" line |
| 26 | When OpenAI is down the SMS fallback has no safety line, and the classifier failing open is logged as a genuine 0 | `functions/src/sms/openai.ts:81,93`, `sms/field.ts:87-88` | Add an emergency line to `SMS_UNAVAILABLE_RESPONSE`; log fail-open distinctly |
| 27 | Account deletion: the rules don't enforce the tombstone, so an open tab can write for about an hour; an in-flight SMS processor can upload after the prefix delete | `functions/src/account.ts:49-61` | `recursiveDelete` + `revokeRefreshTokens`; processor checks the tombstone |
| 28 | `soundscapeApi` is still deployed with the ElevenLabs key but has no frontend caller | `functions/src/soundscapeApi.ts` | Remove or gate it server-side (**owner decision**) |
| 29 | Scheduler does 100+ reads per opted-in user every 15 minutes before checking whether a window is open; windows under 15 minutes never fire | `fieldWindows.ts:104-131`, `FieldWindowSettings.tsx:173-182` | Reorder the checks; enforce a 15-minute minimum window |
| 30 | About 4,500 lines of dead code since Room (`Drift/*`, `Relax/*`, their hooks/engines/prompts, `OutcomePulse`, `ReceptivityHandshake`, `ResearchMoment`, `ClosingCheckIn`, `WhatHelpsMeSection`, `LivingHypothesesPanel`, etc.) plus about 270 dead i18n keys × 17; `scripts/run-release-evals.mjs:18` still gates releases on `test:drift` while Room has no eval | see the frontend audit list | Delete the UI and hooks, keep the `relaxSessions`/`driftSessions` data proxies for export and delete; add a Room eval (**owner decision on deleting vs archiving**) |
| 31 | Room lifecycle: unmount without `finish()` leaves `endedAt = null`; the voice "end" command leaves the user on Room's choose screen; no wake-lock re-acquire on `visibilitychange`; density changes burst past cues; the 250 ms interval effect is rebuilt every render | `src/hooks/useRoomSession.ts`, `RoomField.tsx` | Persist-only finish on unmount; route "end" through `onClose`; re-acquire the wake lock; only fire cues in the current tick window |
| 32 | Accessibility: the Room overlay has no `role="dialog"`/focus trap; the biometrics bar can cover its close button; 38px controls; `role="menu"` containing `role="switch"`; 8-10px text and about 16-20px targets in Prism, Mosaic, SurfaceArc and ConductorOfferCard | `RoomField.tsx:70`, `SessionBottomBar.tsx:87`, `atmosphere.css:2495` | Dialog semantics, 44px targets, a legible minimum font size |
| 33 | PLAUSIBLE: the Speak surface snaps back to Talk because the "speak + idle → talk" effect runs during an await before `voice.start`, so speak arcs never resolve | `SessionView.tsx:797-801`, `useSessionVoice.ts:198` | Treat `connecting` as active; set it before the await |
| 34 | The IndexedDB banner (2985b02) is never removed once auth recovers; English-only with hex colors | `src/main.tsx:72-120` | Remove it on `authStateReady()`; localize |
| 35 | Room and Speak build voice instructions separately; Room hardcodes `isGrounding: false` and omits lexicon, HRV and flag gating | `SessionView.tsx:688-724` vs `useSessionVoice.ts:88-170` | One shared voice-instruction builder; move arc/conductor logic into a `useSurfaceArcs` hook |
| 36 | Two CSPs are enforced on web (the `firebase.json` header and the `index.html` meta tag); their intersection blocks the site's own Google Ads calls (`ad.doubleclick.net`, `google.ca/pagead`), so ad conversion tracking is silently broken. Seen in the live console on 2026-10-14 | `firebase.json:34`, `index.html:6` | Make the two policies agree, or emit the meta CSP only in native builds. **Owner decision first: keep ads at all?** (see below) |
| 37 | `letterEngine` writes letters from parts after sessions close (when `lettersFromParts` is on), but no user-facing component renders them; they're visible only in the admin "Letters" tab. Model cost with no user benefit, and letters addressed to the user are read by no one but the admin | `src/engine/sessionReflectionEngine.ts:384`, `src/admin/AdminUserDetail.tsx:29` | **Owner decision:** surface them (see the vision doc) or stop generating them |
| 38 | Docs are stale. `CLAUDE.md` still describes five surfaces with Relax/Drift, never mentions Room, the conductor, Fresh eyes, personal science, field windows or FieldMosaic, and documents a removed closing check-in. `AGENTS.md` is untracked and says four surfaces. `.claude/docs/{key-files,subsystems,feature-flags}.md` are Relax/Drift-only | repo root, `.claude/docs/` | Refresh after the fixes above land |
| 39 | The PWA precaches all 16 locale chunks, the admin dashboard and the MediaPipe bundle for every user (2.69 MB) | `vite.config.ts` | `globIgnores` + runtime caching for those |
| 40 | Test gaps: no tests for `scheduleFieldWindows` or `fieldWindowDispatcher` (only their pure logic); the rules tests don't cover `sms*`, `fieldWindowDispatches`, `quotas` or server-owned user docs | `functions/`, `tests/firestore-rules.test.ts` | Add them alongside #8-#10 and #21 |

PLAUSIBLE, low likelihood: `storeInboundMessage` uses `set()` (`functions/src/sms/index.ts:113`), so a Twilio webhook redelivery would wipe a processed `fieldNote`/`risk`. Use `create()` or a field-limited merge.

---

## Owner decisions needed (don't decide these in code)

1. **Privacy-policy wording** (#2) before it is translated.
2. **Ads on the landing page** (#36): fix the CSP so they work, or remove the Google Ads tags entirely. A tracker on the threshold of a private reflection space is a product question as much as a technical one.
3. **Letters from parts** (#37): surface them or stop generating them.
4. **Room flag model** (#20): a single `roomEnabled` with a migration, or keep it derived from `relaxEnabled`/`driftEnabled`.
5. **Dead Relax/Drift code** (#30): delete or archive. `soundscapeApi` (#28): remove the endpoint and the ElevenLabs secret, or keep them for a future custom-sound feature.
6. **L1 tightening** (#5): approve the eval cases first.

## Suggested order

1. #1 (P0 safety), then #3, #4, #5 with `test:crisis`, then #7.
2. #8, #9, #10 (SMS correctness), then #16 and #17 (cost).
3. #12, #13, #14, #15, #11 (session and Room correctness).
4. #19 (i18n), #2 once the wording is approved, #18 (retention).
5. The P2 table, then the docs refresh (#38) last, so the docs describe the fixed code.
