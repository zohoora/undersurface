# CLAUDE.md — UnderSurface

## What is this project?

A session-first reflective companion app. Opening the app drops the user into a session with an AI companion across four surfaces: **Talk** (streamed text conversation), **Journal** (quiet TipTap page where inner-voice "parts" can respond on pause), **Speak** (live voice via OpenAI Realtime), and **Room** (an ambient voice/sound/silence space: Listen first, Lead me, or Quiet company). Room replaced the separate Relax and Drift surfaces on 2026-07-11. An optional SMS/MMS **field channel** (Twilio) carries the same companion between sessions. **Folio** (`/folio`) is a writing-first mode alongside Sessions: pages where a line can be lifted and written beneath, kept, and come back to (see the Folio section). The app pivoted from a diary-first product; the diary-entry flow no longer exists, but the journal/parts machinery lives on inside sessions. Live at [undersurface.me](https://undersurface.me).

## Current work

**Folio** was built autonomously from `docs/vision/folio-build-plan.md` (steps 0–11, all deployed by 2026-10-16) and is **open to every writer since 2026-10-16** (`folioEnabled: true` in production, set on the owner's decision after the §8.G fixes shipped; turning it off in admin Settings › Folio leaves only admins and accounts with the `folio` custom claim, such as the test account `folio-test@undersurface.me`). The plan holds the owner's decisions, the gates, the deploy and rollback protocol, the progress log (§9) and the owner's checklist (§8, real devices, screen readers, native translation review, taste). Its design is `docs/vision/2026-10-15-folio-v4.md`; the plan overrides it where they differ. Read both before touching `src/folio/` or any seam the plan lists. **Companion involvement** (a 1–5 slider in Folio settings, shipped 2026-10-16) is specified in `docs/vision/2026-10-16-folio-involvement.md`; read it before touching `src/folio/companion/`.

The current fix list is `TECH_ISSUES_2026-10-14.md` (40 items, worked on branch `fix/audit-2026-10-14`); its creative companion is `docs/vision/2026-10-14-the-deep.md`. The earlier remediation master plan is `docs/superpowers/plans/2026-07-03-full-remediation-master.md` (stage plans alongside it). Specs for the July 10–11 programs live in `docs/superpowers/specs/2026-07-1*.md`. Check these before starting significant work — your task may already be scoped there.

## Review docs

Canonical findings list, in order of authority:

- `APP_REVIEW_TREE_AND_FOREST_2026-05-21.md`
- `APP_REVIEW_2026-07-03.md`
- `APP_REVIEW_FABLE5_2026-07-03.md`
- `APP_REVIEW_TREE_AND_FOREST_2026-07-09.md`
- `TECH_ISSUES_2026-10-14.md` (technical audit of everything added since 2026-07-09)

## Quick Reference

```bash
npm run dev              # Dev server → localhost:5173
npm run build            # Production build → dist/ (tsc -b + vite build)
npm run build:release    # Release-only build + explicit Sentry source-map upload
npm run build:native     # CAPACITOR_BUILD=1 build (injects the native meta CSP); every cap:* script uses it
npm run lint             # ESLint (flat config)
npm run test             # Vitest (npm run test:watch for watch mode)
npm run preview          # Preview production build locally
npm run test:indexes     # Emulator tests: Firestore indexes + Firestore rules + Storage rules
npm run test:crisis      # Live crisis-classifier eval (RUN_CRISIS_EVAL=1, hits real API)
npm run test:folio-safety # Live eval: Folio's safety sampler against the real classifier
npm run test:folio       # Live eval: Folio's Ask notes (30 cases, gpt-5.5 judge)
npm run test:folio-companion # Live eval: Folio's companion involvement outputs (21 cases, real parsers + gpt-5.5 judge)
npx playwright test      # Browser suite (Folio editor, saving vs the Firestore emulator, a11y, Step inside); Java 21
npm run prodcheck:folio  # Production checks as the Folio test account (password from the macOS Keychain); DEVICE=pixel|iphone runs them as a phone (touch paths); owner-credentialed extras (incl. folio-involvement-check.cjs) are listed in scripts/folio-prodcheck/run-all.mjs
npm run test:release-evals # All live prompt evals + auditable artifact
npm run smoke-test       # Post-deploy smoke test against live site
npm run cap:ios          # Build + sync + open iOS (Capacitor; cap:android likewise)
```

Live evals (each needs `OPENAI_API_KEY`): `test:crisis`, `test:signals`, `test:parts`, `test:intentions`, `test:stance`, `test:depth`, `test:folio-safety`, `test:folio`, `test:folio-companion`. `scripts/run-release-evals.mjs` runs exactly these nine. `test:drift` was retired with Drift; Room has no live eval yet. **The crisis classifier votes three times:** `gpt-5-nano` at `reasoning_effort: 'minimal'` flips boundary cases 5–15% of the time with any prompt (measured 2026-10-16), so every channel (the `crisis_check` route, SMS, and both crisis evals) asks three times at once and takes the majority (`classifyByConsensus` in `functions/src/shared/crisisClassifier.ts`; owner decision, plan §8.G). A single eval run can still go red on noise; a failure is real only if it repeats. To read the production OpenAI key for an eval without printing it: `OPENAI_API_KEY="$(npx firebase functions:secrets:access OPENAI_API_KEY --project undersurfaceme 2>/dev/null)" npm run test:<eval>`.

## CI/CD

`.github/workflows/ci.yml` runs on push/PR to main: functions type-check + tests, lint, frontend type-check, test, emulator tests (Firestore indexes + Firestore rules + Storage rules, Java 21), build; and a `browsers` job running the Playwright suite (Chromium, WebKit, Firefox, Pixel 7 and iPhone 14 emulation, on Linux). Uses Node 22 and dummy `VITE_FIREBASE_*` env vars (Firebase config is public, only needed at runtime — never use the dummy values for production deploys). `.github/workflows/release-evals.yml` is the scheduled/manual/reusable behavioral gate and archives its prompt hash, model snapshot, results, latency, and logs for 90 days.

## Deploying Changes

The app runs on Firebase. Deployable units: hosting, functions, Firestore rules + indexes, Storage rules. `firebase.json`'s functions `predeploy` builds the functions package, so `firebase deploy` never ships stale JS; the explicit `npx tsc` below is just an early type check.

**Deploy order matters:** indexes → rules (Firestore + Storage) → functions → hosting. New queries need their indexes first; new client writes need the rules; and the admin UI's flag saves are validated by the functions' `configSchema.ts` (see Gotchas).

### 1. Frontend (Firebase Hosting + PWA)

```bash
OPENAI_API_KEY=... npm run test:release-evals
npm run build:release && firebase deploy --only hosting
```

### 2. Cloud Functions (Firebase Functions, Node.js 22)

Nine deployable functions, exported from `functions/src/index.ts`:
- **`chat`** (`functions/src/chat.ts`) — proxies AI requests to OpenAI; `gpt-5.5` for therapist/journal turns, `gpt-5-nano` for the `task: 'crisis_check'` and `task: 'signal_check'` classifier routes and for `task: 'autocorrect'` (512MiB, minInstances: 1, 300s). `crisis_check` asks three times at once and answers with the majority as one ordinary completion (`runCrisisCheck`: two agreeing votes decide at once and cancel the third; three different → the middle; a failed call with a split → the higher; a 4 s deadline under the browser's 5 s abort). Aborts upstream on client disconnect; mid-stream truncation is a real error. `validateChatMessages`: exactly one system message, first; last message from the user; roles system/user/assistant only (only role+content forwarded); caps user 8k chars, system 64k, assistant 32k, 50 messages, 512 KiB UTF-8 total (413 `request_too_large`). Classifier routes must be exactly `[system, user]` (24k/4k chars, `CLASSIFIER_SHAPE`) and stay quota-exempt. `autocorrect` is pinned the same way (`AUTOCORRECT_SHAPE`: 1.2k/1.2k chars, `reasoning_effort: 'minimal'`, 600 max tokens, never streamed) but stays quota-counted. Optional **durable monthly token quota** (`functions/src/shared/quota.ts`, reserve-then-reconcile; config on `appConfig/global.quota`; usage in top-level `quotas/{uid}`): streamed requests set `stream_options.include_usage`, so reservations settle to real completion tokens; prompt tokens are metered separately in `promptTokensUsed` and do NOT count toward the cap
- **`realtimeTokenApi`** (`functions/src/realtime.ts`) — mints OpenAI Realtime client secrets for `gpt-realtime-2` (256MiB, minInstances: 1, 30s). Server-side gate `isRealtimeVoiceAllowed` (`voiceEnabled === true` only — Room offers voice only then, otherwise just Quiet company; `shared/featureFlags.ts`, 60s cache). Error codes (`REALTIME_ERROR_CODES`, mapped client-side in `src/hooks/voiceErrors.ts`): 403 `voice_disabled`; 503 `voice_config_unavailable` (config/budget read failed — fails closed); 429 `voice_daily_budget_exceeded` (`VOICE_MINTS_PER_DAY = 30` per UTC day in `quotas/{uid}.daily.voiceMints`); 429 `voice_rate_limited` (10/min in-memory); 502 `voice_upstream_error` (refunds the mint); 400 `invalid_instructions` (empty or > 48k chars)
- **`accountApi`** (`functions/src/account.ts`) — `deleteAccount`, `submitContact`, `getSmsStatus`, `createSmsLinkCode` (403 `sms_disabled` while `features.smsEnabled === false`), `unlinkSms` (in-app unlink also revokes field-window consent; allowed while paused) (256MiB, 300s, binds the Twilio secrets). Deletion order: tombstone `users/{uid}` `{ status: 'deleting' }` → `revokeRefreshTokens` → snapshot Twilio message SIDs → unlink + delete top-level `smsPhoneLinks`/`smsLinkCodes`/`smsInbound`/`fieldWindowDispatches` docs → delete Twilio messages + MMS media (best effort, 90s budget) → `recursiveDelete` every subcollection → Storage `field-moments/{uid}/`, contact messages, quota doc → Auth user → final `recursiveDelete(users/{uid})`. Async writers treat a user as gone when the tombstone exists or the Auth user is missing (`ACCOUNT_DELETION_STATUS`)
- **`adminApi`** (`functions/src/admin/`) — admin dashboard backend, table-driven action dispatch; handler map in `admin/index.ts`, handlers in `admin/handlers.ts`, analytics in `admin/analytics.ts`, config validation in `admin/configSchema.ts` (512MiB, 120s)
- **`mcpApi`** (`functions/src/mcp.ts`) — MCP server with 4 read-only tools: `list-entries`, `get-entry`, `list-conversations`, `get-conversation` (256MiB, 30s)
- **`smsApi`** (`functions/src/sms/index.ts`) — public Twilio SMS/MMS webhook (256MiB, 30s): signature verification; opt-out words (`STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPTOUT`, `REVOKE`) and `UNLINK` are handled before the 30/min per-sender rate limiter and revoke field-window consent; then the kill switch (`features.smsEnabled === false` → "paused" reply); queue admission with `create()` (webhook redelivery cannot overwrite a processed doc) and a 30-day `expireAt`
- **`smsInboundProcessor`** (`functions/src/sms/index.ts`) — Firestore trigger on `smsInbound/{messageSid}` (retry: true, 3 attempts, 2-min lease; 256MiB, 120s). Drops the job if the user is tombstoned/gone or unlinked. Fetches protected Twilio images, runs L1 then `classifySmsCrisis` (fail-open logged distinctly), and passes bounded base64 images to GPT-5.5 for an adaptive-length reply + optional field note. Details under "SMS field channel" below
- **`fieldWindowScheduler`** (`functions/src/sms/fieldWindows.ts`) — `onSchedule('every 15 minutes')`, UTC (256MiB, 120s). Runs the stale-dispatch sweeper, then schedules proactive field-window texts
- **`fieldWindowDispatcher`** (`functions/src/sms/fieldWindows.ts`) — Firestore trigger on `fieldWindowDispatches/{eventId}`, `retry: false` (256MiB, 60s). Sends one proactive text

Shared cross-handler code in `functions/src/shared/`: `init.ts` (initializeApp), `auth.ts` (verifyAuth/`verifyAuthWithRole`/verifyAdmin + `ADMIN_EMAILS`), `cors.ts` (`ALLOWED_ORIGINS`), `rateLimit.ts` (`makeRateLimiter`), `secrets.ts` (`OPENAI_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`), `models.ts` (`OPENAI_CHAT_MODEL`, pinned), `crisisClassifier.ts` + `crisisFloor.ts` (shared cross-channel safety contract), `companionKernel.ts` (cross-channel companion contract, see below), `featureFlags.ts` (server reads of `appConfig/global.features`: `isRoomEnabled`, `isRealtimeVoiceAllowed`), `collections.ts` (`USER_SUBCOLLECTIONS`), `quota.ts` (monthly token quota + per-day budgets: `checkAndReserve`/`reconcile`/`consumeDailyBudget`/`refundDailyBudget`). `functions/src/index.ts` is a slim re-export so deploy targets are unchanged. `soundscapeApi` and its ElevenLabs binding were removed on 2026-10-14 (the secret, the `soundscapes/` Storage objects and their cache docs were left in place for the owner).

```bash
cd functions && npx tsc && cd .. && firebase deploy --only functions
```

### 3. Firestore + Storage rules and indexes

```bash
firebase deploy --only firestore:indexes
firebase deploy --only firestore:rules,storage
```

### Deploy everything

```bash
OPENAI_API_KEY=... npm run test:release-evals
npm run build:release && cd functions && npx tsc && cd .. && firebase deploy
```

### Post-deploy verification

After deploying, run the smoke test to verify the live site:

```bash
npm run smoke-test
```

### Decision table

| What changed | Build | Deploy |
|---|---|---|
| `src/` | `npm run build:release` | `firebase deploy --only hosting` |
| `functions/src/` | `cd functions && npx tsc` | `firebase deploy --only functions` |
| `firestore.rules` / `storage.rules` | — | `firebase deploy --only firestore:rules,storage` |
| `firestore.indexes.json` | — | `firebase deploy --only firestore:indexes` (before anything that queries it) |
| Several | All build steps | `firebase deploy` |

## Architecture

### Request flows

```
Therapist turns (Talk surface):
  user sends → SessionView.handleSend → useSessionStream.appendUserMessage
    (L1 sync floor runs here; the L2 classifier is raced from here)
    → respondToUserTurn (src/engine/turnResponder.ts) — reads isGroundingActive()
      at call time and after every await: adaptive conductor → personal-science
      research turn → plain model turn. Grounding at any point cancels the
      research arm and forces a grounded model turn (never a canned offer).
    → buildTherapistMessages (therapistPrompts.ts + shared companionKernel.ts)
    → streamChatCompletion (src/ai/openrouter.ts — legacy filename, calls /api/chat)
    → Cloud Function (chat) → verifies token → Secret Manager key → OpenAI gpt-5.5
    → streams SSE back; hidden <<RISK:N;…>> preamble stripped client-side
  Crisis: L1 regex (sessionOrchestrator.checkCrisisKeywords, sync, before generation)
          L2a = in-band <<RISK:N>> preamble at the start of the SAME stream (fail-open);
                risk=2 before first token aborts + retries with grounding on.
          L2b = standalone classifyCrisisRisk (gpt-5-nano) races the stream, once per
                user turn — the independent backstop for when the preamble fails open;
                risk=2 activates grounding (crisis UI + grounds subsequent turns).
                Also runs in journal/parts mode and on voice transcripts.

Journal surface parts:
  pause in TipTap → useJournalParts → PauseDetector + PartOrchestrator
    → openrouter.ts → /api/chat → OpenAI → part thought streams onto the page

Voice (Speak + Room):
  buildVoiceCompanionInstructions (src/ai/voiceInstructions.ts) — the ONE builder:
    therapist prompt (channel 'voice', live grounding, lexicon, HRV, flag gating)
    + a bounded, untrusted-wrapped seed of this session's recent turns
  Speak: useSessionVoice → POST /api/realtime-token → useVoiceSession WebRTC → OpenAI
  Room:  useRoomSession → buildRoomInstructions (roomPrompts.ts) wraps the same prompt
         → its own useVoiceSession; roomEngine owns time; cues go in as system
         conversation items (promptAssistant), never response.create overrides
  Transcripts → appendUserMessage / appendRealtimeCompanionMessage in the parent session

Admin:  /admin → isAdmin check → adminApi Cloud Function → Admin SDK
Account: Settings → accountApi Cloud Function → delete/contact/SMS link

SMS field channel:
  Settings → accountApi creates 10-minute code → user texts LINK <code>
    → smsApi validates Twilio signature + maps phone hash to uid
    → natural SMS/MMS → users/{uid}/smsMessages + smsInbound queue
    → smsInboundProcessor fetches/validates protected Twilio image media
    → shared crisis stack → GPT-5.5 multimodal structured turn (writer-local time)
    → idempotent Twilio reply + optional source-grounded field note / field moment
    → only selected notes enter later Talk/Speak prompts as weak context

Field windows (proactive SMS):
  Settings (FieldWindowSettings, phone linked) → companionPreferences/current.fieldWindows
    → fieldWindowScheduler (every 15 min): one randomized decision per writer-local day
    → fieldWindowDispatches/{eventId} → fieldWindowDispatcher rechecks + sends once
```

### Key files

Detailed file-by-file reference: `.claude/docs/key-files.md`

Core entry points: `src/ai/openrouter.ts` (all /api/chat calls — legacy filename kept, there is no OpenRouter; includes `classifyCrisisRisk` + `<<RISK:N>>` preamble handling), `src/ai/therapistPrompts.ts` (companion prompts — `THERAPIST_CORE` warm + `REAL_TALK_CORE` calling-out + `SAFETY_RULES` + `buildTherapistSystemPrompt`), `src/ai/voiceInstructions.ts` (single voice prompt builder for Speak + Room), `src/ai/roomPrompts.ts`, `src/ai/partPrompts.ts` (7 seeded parts + `SHARED_INSTRUCTIONS` + emergence/reflection/growth prompts), `functions/src/shared/crisisClassifier.ts` + `crisisFloor.ts` (single L1/L2 safety contract re-exported to the browser), `functions/src/shared/companionKernel.ts` (cross-channel companion contract), `src/ai/therapistRecommendationParser.ts` (tappable `#switch:`/`#end:session` segments), `src/engine/sessionRuntime.ts` (session epoch, abort set, append queue, send lock), `src/engine/sessionOrchestrator.ts` (phase detection + shared narrow L1 hard floor + emotion check), `src/engine/turnResponder.ts` (per-turn conductor/research/model routing with call-time grounding), `src/engine/adaptiveConductor.ts`, `src/engine/personalScience.ts`, `src/engine/freshEyes.ts`, `src/engine/surfaceAvailability.ts` (`isRoomEnabled`, `canOpenSurface`), `src/engine/roomEngine.ts` (Room clock + spoken controls), `src/engine/partOrchestrator.ts` (part selection + scoring), `src/engine/pauseDetector.ts`, `src/engine/sessionContextLoader.ts` (`loadTherapistContext`, including bounded SMS field notes), `src/engine/sessionFinalizer.ts`, `src/engine/hrvArchive.ts` (bounded persistence), `src/engine/hrvEngine.ts` (webcam HRV), `src/engine/hrvSignalWorker.ts` (CHROM rPPG Web Worker), `src/engine/hrvTimeline.ts`, `src/engine/polarH10Engine.ts` (Polar H10 BLE), `src/hooks/useSessionStream.ts` (message lifecycle + crisis race + `BiometricSource`), `src/hooks/useSessionBiometrics.ts` (camera/Polar selection + mutex), `src/hooks/useSessionVoice.ts` + `src/hooks/useVoiceSession.ts` (Realtime voice), `src/hooks/useRoomSession.ts`, `src/store/groundingState.ts` + `groundingPersistence.ts`, `src/components/Sidebar/SmsSettingsSection.tsx` (phone linking), `src/components/Editor/useJournalParts.ts` (in-session parts pipeline), `src/components/Session/SessionView.tsx` (session shell: surfaces, mode, biometrics), `src/components/Session/SessionBottomBar.tsx` (surface switcher + options menu), `src/components/Session/SessionJournalSurface.tsx` (in-session TipTap journal), `src/components/Session/Room/RoomField.tsx` (Room UI), `src/store/db.ts` (Firestore wrapper + `sessionMessages`). Cloud Functions: `functions/src/{chat,realtime,account,mcp}.ts` + `functions/src/admin/` + `functions/src/sms/` + `functions/src/shared/`. Folio: `src/folio/FolioApp.tsx` (shell, routes, shore, slips), `src/folio/page/FolioPageView.tsx` (one page: editor, saving, safety, Keep, Ask, Step inside), `src/folio/page/folioCore.ts` (the editor core), `src/folio/save/PageSaveController.ts` (C2), `src/folio/safety/FolioSafetyWatch.ts` (C4), `src/folio/kept/useKept.ts` (traces, come-backs, Return), `src/folio/ask/askContract.ts` (Ask), `src/folio/inside/StepInside.tsx`.

### Data storage

- **Firestore** `users/{uid}` root doc — server-owned account state (the deletion tombstone); client **read-only** (`firestore.rules`)
- **Firestore** `users/{uid}/` — 37 registered subcollections (`USER_SUBCOLLECTIONS` in `functions/src/shared/collections.ts`): the session, memory, reflection, biometric (`hrvSessions`), Room (`roomSessions`, plus legacy `relaxSessions`/`driftSessions` kept for export/delete), intention, value, companion-depth, experience/science (`companionPreferences`, `fieldMoments`, `interventionOutcomes`, `researchEvents`, `personalProtocols`, `livingHypotheses`), SMS (`smsMessages`, `smsSettings`) and Folio (`folioPages`, `folioTraces`, `folioPreferences`) collections. `sessions/{id}/messages` remains a nested transcript subcollection. The owner may write everything except `smsSettings/**` and `smsMessages/**`, which are server-owned and client read-only. `smsSettings` holds `current` (phone hash + last four), `riskState` (`lastRiskAt`), `optOut` (`optedOutAt`), and `usage` (daily SMS turn count: reserved before generation, refunded once when no reply is generated, counted once per message across retries; crisis turns exempt). `companionPreferences/current` stays client-writable: Settings writes field-window consent there and every grounding activation merges `lastGroundingAt` into it
- **Firestore** Folio: `folioPages/{pageId}` (the whole ProseMirror doc as one JSON string, kept companion notes as `doc.attrs.folioNotes`, a revision chain, the safety checked set; rules allow a write only on top of the server's `revId` — compare-and-swap, C2), `folioTraces/{traceId}` (a kept composition as JSON in `composition`; kept fields can never be updated, only `title`, the come-back fields, `safety` and H3's `returnEligible`/`lastReturnShownAt`; `entries/{id}` can be created and deleted, never edited — C3) and `folioPreferences/current` (`firstVisitSeenAt`, `reduceMotion`, `returnEnabled`, `involvement` 1–5, `involvementIntroSeenAt`). Traces may carry `keptBy: 'companion'` (create only) and `titleBy: 'companion' | null`. `folioPages` and `folioTraces` are carved out of the generic owner rule. Index exemptions: `folioPages.doc`, `folioPages.safety.checked`
- **Firestore** `appConfig/global` — readable by all authenticated, writable only via adminApi. Config allowlist (`functions/src/admin/configSchema.ts`): `defaultResponseSpeed`, `features`, `atmosphere`, `partIntelligence`, `engagement`, `grounding`, `voice`, `announcement`, `buildVersion`, `quota` (`{ enabled, monthlyTokenCap, perRoleCaps }`)
- **Firestore** `contactMessages` — top-level, deny-all in client rules, written/read via Cloud Functions
- **Firestore** `quotas/{uid}` — top-level (NOT under `users/`, deliberately — the `users/{uid}/{collectionId}` rule would let the owner write it, and Firestore unions `allow` rules). Client read-only / server-write-only. Holds `{ period, tokensUsed, requestCount, promptTokensUsed, daily: { voiceMints } }`
- **Firestore** `smsPhoneLinks`, `smsLinkCodes`, `smsInbound`, `fieldWindowDispatches` — top-level, deny-all client collections for phone-to-uid mappings, expiring link codes, async Twilio processing state, and proactive-send jobs. `smsInbound` docs carry a Timestamp `expireAt` (30 days) for a TTL policy that must be enabled outside the repo (see Gotchas)
- **Cloud Storage** — `field-moments/{uid}/…` (MMS images kept as field moments; owner read, server write); Room's ambient tracks are read from `seed-audio/v1/` (`useRoomSession.ts`)
- **localStorage** — device settings (`src/store/settings.ts` DEFAULTS: responseSpeed, autoCapitalize, autocorrect, bilateralStimulation, theme, language, timezone, lastSessionMode, lastRoom*, lastHome). Folio's per-account keys (pending saves `us.folioPending.<uid>.…`, view state, the activation mirror, Step inside's sound choice) and its one-navigation sessionStorage slots (Talk handoff, Lift into today, Go to the page) are cleared on sign-out and deletion (`clearFolioLocalForUser`)
- **Google Secret Manager** — `OPENAI_API_KEY` (chat + realtimeTokenApi + adminApi insights + SMS), `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` (SMS webhook/delivery, field windows, account deletion)

### Auth

Firebase Authentication: Google Sign-In + Email/Password. `App.tsx` gates app behind auth. Cloud Functions verify ID tokens. Admin allowlist lives in `functions/src/shared/auth.ts` (backend) and `src/admin/isAdmin.ts` (frontend gate used by `App.tsx`).

### URL routing

SPA in `App.tsx` using `pushState`-based client-side routing (no router library). There is no diary route and no choice screen:

- `/` and `/new` — treated as a root visit: after init, redirect to today's **active** session if one exists (searched in the 20 most recent sessions, "today" per the user's configured timezone) else `/session/new`
- `/session/new` — new session; `SessionView` creates the doc with `mode: initialMode ?? settings.lastSessionMode`, then `replaceState`s the real id into the URL. Creating it finalizes other active sessions among the latest 20, skipping any with activity in the last 30 minutes (`sessionFinalizer.ts`, `LIVE_SESSION_GRACE_MS`); an open session re-checks whether it was closed elsewhere when the page becomes visible
- `/session/:id` — existing session (mode loaded from Firestore)
- `/admin` — admin dashboard (lazy-loaded, `isAdmin` gated)
- `/folio` (most recent page if edited in the last 12 h, else a new one), `/folio/new`, `/folio/pages`, `/folio/p/:id`, `/folio/kept`, `/folio/kept/:traceId` — Folio (`src/folio/routes.ts`), rendered without the Sessions chrome and only for `canOpenFolio`; unknown `/folio/*` paths go to `/folio`. A root visit honors `settings.lastHome` (`folio` or sessions, bounded by a 4 s wait for the global config)
- anything else → `/`

`navigateTo()` uses `history.pushState` + React state; `popstate` listener handles back/forward. First-run consent (Onboarding) is checked before routing; completing it navigates to `/session/new`.

### Session surfaces

`SessionSurface = 'talk' | 'journal' | 'speak' | 'room' | 'relax' | 'drift'` (`SessionBottomBar.tsx`; `relax`/`drift` survive only as legacy values on old messages and arc targets). The bottom bar shows Talk and Journal always, Speak when `voiceEnabled === true`, and Room when Room is effectively enabled AND grounding is not active. The options menu (`•••` / More) holds the Fresh eyes switch (locked after the first user turn), the Journal "Inner voices" parts toggle (journal only, when `partsEnabled !== false` and not Fresh eyes; persists as `session.journalPartsEnabled`), and `◇ Real Talk`. `canOpenSurface` (`src/engine/surfaceAvailability.ts`) gates both bottom-bar switches and `#switch:` recommendation taps, so a link can never open an unavailable surface; the recommendation block only teaches surfaces that are available.

- **Talk** — streamed therapist conversation (`useSessionStream`, TipTap input composer in `SessionView`). Replies can carry tappable recommendation segments (`RecommendationSegments`) and an optimal-ending link (`#end:session`).
- **Journal** — `SessionJournalSurface`: quiet TipTap page; when the parts toggle is on, the same `PauseDetector`/`PartOrchestrator` pipeline from the old diary responds on pause (`useJournalParts`, `PartThoughtBubble`, `ThinkingSpace` for multi-turn). Parts are hard-silenced during grounding. Drafts are device-local and session-owned (`src/store/journalDrafts.ts`, `src/hooks/useJournalDraft.ts`): keyed `us.journalDraft.<uid>.<sessionId>`, debounced saves, restored on entry, appended exactly once to the OWNING session (`appendUserMessage` refuses a mismatched or closed owner) and cleared only after success; failures show `JournalDraftNotice` (retry/copy); sign-out and account deletion clear them.
- **Speak** — live voice. `useSessionVoice` builds instructions via `buildVoiceCompanionInstructions`; `realtimeTokenApi` pins `gpt-realtime-2`, default voice `marin`, speed 0.88, semantic VAD eagerness `low`, transcription `gpt-realtime-whisper`. WebRTC goes browser → OpenAI directly (hence `api.openai.com` in CSP `connect-src`). Speak reports `connecting` while instructions are prepared; a failed/closed peer or ICE connection, a remote data-channel close/error, or a fatal server error tears down the mic and shows an error (`useVoiceSession.ts`). `VoiceField` renders for ANY non-idle voice state, so a live mic always has a stop control. Wrapped in `SurfaceErrorBoundary` and loaded with `lazyWithRetry`.
- **Room** — see the Room section below. Writes `roomSessions`.

### Feature flags

7 core flags (on unless `=== false`): `partsEnabled`, `visualEffectsEnabled`, `autocorrectEnabled`, `paragraphFade`, `inkWeight`, `breathingBackground`, and the SMS kill switch `smsEnabled`.
31 experimental flags (`=== true`): Atmosphere (4), Part Intelligence (8, incl. `bodyMap`, `bilateralStimulation`), Memory/Engagement (5, incl. `lettersFromParts`), Safety & companion (10: `ruptureRepair`, `ruminationPivot`, `userParts`, `sessionIntentions`, `stanceAdaptation`, `userValues`, `companionInteriority`, `companionPresence`, `earnedHumor`, `storyArcs`), Biometric (`webcamHrv`, `polarH10`), Voice (`voiceEnabled`), Room (`roomEnabled`). Two legacy keys, `relaxEnabled`/`driftEnabled`, now only feed Room's derivation. **Folio:** `folioEnabled` (`=== true`, on in production since 2026-10-16; opens Folio for everyone — admins and the `folio` claim can always open it) and eight sub-switches, on unless `=== false`: `folioBetween`, `folioDistance`, `folioLiftToday`, `folioAsk`, `folioStepInside`, `folioStepInsideSound`, `folioReturn`, `folioInvolvement` (the companion-involvement slider; off puts every writer at level 1) (`folioSwitches` in `src/folio/access.ts`). A switch turned off hides its controls; it never hides or changes writing that used it. `emergencyGrounding` and `grounding.intensityThreshold` controlled nothing and were removed from the admin UI, types and defaults (grounding is always on via the crisis stack); the server still accepts both so stored configs validate, and the admin strips them before saving.

**Room's effective state** = `roomEnabled === true || (roomEnabled unset && (relaxEnabled || driftEnabled))` — `isRoomEnabled` in `src/engine/surfaceAvailability.ts` (shared by the session shell and admin via `src/admin/featureFlags.ts`) and its server twin in `functions/src/shared/featureFlags.ts`. `roomEnabled` is deliberately absent from `adminDefaults.ts` so an unset flag keeps deriving; Reset Defaults writes it off explicitly. `customSoundscapesEnabled` is retired: stripped before an admin save and dropped server-side (`RETIRED_FEATURE_KEYS`). The server allowlist is `FEATURE_KEYS` in `functions/src/admin/configSchema.ts` (49 keys; an unknown key rejects the whole save). The July 10–11 programs (conductor, personal science, prism, Fresh eyes, Field Mosaic) have no global flag — see below.

Full list + settings cascade + tuning params: `.claude/docs/feature-flags.md`

### Admin dashboard

At `/admin` for admins only. Lazy-loaded. Folio appears only as counts (Overview: Folio pages, Kept in Folio; a user's detail: pages and kept), never content. 6 tabs (Overview, Users, Analytics, Messages, Insights, Settings), 11 API actions (`getOverview`, `getUserList`, `getUserDetail`, `getConfig`, `updateConfig`, `getAnalytics`, `refreshAnalytics`, `generateInsights`, `getSessionMessages`, `getContactMessages`, `getDiagnostics`). UserDetail has 11 tabs (entries, parts, conversations, thoughts, memories, profile, sessions, weather, letters, fossils, diagnostics). Settings has a single Room toggle (shows "on through the legacy flags" while `roomEnabled` is unset) and an SMS field-channel toggle. Details: `.claude/docs/admin.md`

**Data loading pattern.** All one-shot admin views fetch through `useAdminQuery<T>(action, params?)` in `src/admin/useAdminQuery.ts` — a generic race-protected hook that wraps `adminFetch`. Stable `paramsKey` (JSON-stringified) prevents fresh-object-literal churn from triggering refetches. Returns `{ data, error, loading, setData, setError }`. Specialized wrappers: `useAdminUser` (typed `getUserDetail`), `useAdminConfig` (the `appConfig/global` round-trip with save + signalUpdate + resetDefaults), `useAdminMutation` (event-driven writes). Lazy/event-driven fetches call `adminFetch` directly.

### Crisis safety

Two layers, both feeding `activateGrounding` → `isGrounding` in the next prompt build:

- **L1 — deterministic hard floor.** `detectCrisisKeywords` (`functions/src/shared/crisisFloor.ts`, wrapped by `sessionOrchestrator.checkCrisisKeywords`): synchronous NFKC-normalized regexes for sincere, present, first-person methods/plans only. Contextual language such as “want to die,” slang, grief, and historical mentions defers to L2. Three precision guards (2026-10-14) send more to L2: pill patterns need an intent/overdose form (not "I forgot to take the pills this morning"); negation that directly governs the method defers ("I would never kill myself") unless doubted or conditional ("not sure I won't", "if I don't"); clearly historical attempts defer (past framing + temporal-distance marker; a time word like "today"/"tonight" keeps L1 only in the attempt's own sentence, and "again"/"this time" anywhere keeps it — plan §8.G, 2026-10-16). On SMS an L1 hit replaces the whole reply with the fixed emergency text, which is why precision matters. **Run `npm run test:crisis` before deploying any L1 change** — the 2026-10-14 guards were unit-tested (`crisisFloor.test.ts`) but the live eval still has to be run by the owner.
- **L2 — contextual LLM classifier.** Every user-authored path runs `classifyCrisisRisk` (`task: 'crisis_check'`, `gpt-5-nano`, strict JSON schema, three votes decided by majority server-side). Talk additionally folds the signal into the therapist stream as a `<<RISK:N>>` preamble; risk=2 before the first token aborts and retries grounded. Both fail open to risk 0 — L1 remains the narrow hard floor.

**Call-time grounding.** `respondToUserTurn` (`src/engine/turnResponder.ts`) reads `isGroundingActive()` at call time and after every await, because React state captured at render is stale when L1 fires inside the awaited append. `appendDeterministicCompanionMessage` re-checks grounding (also inside the append queue) and falls back to a grounded model turn. **Cross-channel crisis memory:** every grounding activation (any layer, any surface, Fresh eyes included) merges `lastGroundingAt` into `users/{uid}/companionPreferences/current` (`groundingPersistence.ts`, installed in `main.tsx`); SMS reads it plus `smsSettings/riskState` to ground replies and suppress proactive texts for 72h. Grounding state never goes to Google Analytics (`groundingState.ts` logs first-party diagnostics only).

Calibration history matters: a previous classifier over-called (grief, metaphor, hyperbole, gallows humor all flagged). Current prompts/thresholds are tuned for precision, not recall — do not "improve" recall without reading the eval set (`crisisClassifier.eval.ts`, `npm run test:crisis`).

### Companion signals (rupture repair + rumination pivot)

Two flag-gated behaviors (default OFF: `ruptureRepair`, `ruminationPivot`), spec in `docs/superpowers/specs/2026-07-03-rupture-rumination-design.md`. Three detection layers: deterministic rupture facts (`ruptureDetector.ts` — abandoned session with closed-habit guard, atypical gap vs own cadence, terse ending vs own median), a per-turn `task: 'signal_check'` gpt-5-nano classifier (`signalClassifierPrompt.ts` + `classifySessionSignals` — fully separate from the crisis classifier, quota-exempt, fail-open to zeros, fires from user turn 3), and a reflection-pass `loopSignal` (client counts consecutive no-new-information loop sessions; armed at streak 3). State: `companionSignals` singleton (consume-once `pendingRepair`, `ruminationWatch`). Effects: three prompt blocks in `therapistPrompts.ts` — `repairContext` (opener-only, name the disconnect once), `pivotDirective` (silent 4-move register shift; live tracker pivots are one-shot with a 6-turn cooldown, the cross-session watch pivots at most once per session), `softenStance` (held while withdrawal persists). **All three are suppressed under grounding — crisis owns the session.** Live per-turn signals are text-surface-only; voice gets `repairContext` at instruction build. Calibrated precision-first like the crisis classifier: brevity is not withdrawal, grief is not rumination.

### User parts (SP1 of the unique-companion program)

Flag-gated (`userParts`, default OFF), spec in `docs/superpowers/specs/2026-07-04-user-parts-model-design.md`. Ontology decision (2026-07-04): the 7 SEEDED_PARTS are the **companion's** parts; the writer's parts are a separate `userParts` collection, mapped collaboratively — the reflection pass emits precision-railed `partObservations` (matched by id against the existing map, no metaphor/distress/one-offs, max 2), `userPartTracker.ts` merges (evidence cap 8, sessionsSeen dedup, caps 9 active/5 candidates, retired never resurrected), and a candidate seen in ≥2 sessions arms an in-session proposal: the companion wraps its offer in `[phrase](#propose-part:id)` (see `partProposalParser.ts`), the `PartProposalCard` beneath the message takes an editable name + Keep / Not quite (2nd dismissal retires forever), and consent is a deterministic UI event. Confirmed parts + the coined-phrase `lexicon` (personalFacts, cap 12) enter the therapist prompt (untrusted-wrapped; suppressed under grounding; proposals never on the opener and never stacked with pivot/soften; `proposedAt` stamped only when the finalized message actually carried the marker). Voice gets parts+lexicon read-only. Management: "Parts of you" in Settings (rename/retire). Live eval: `npm run test:parts`.

### Session intentions + N-of-1 stance (2026-07-04)

Two flag-gated behaviors (default OFF: `sessionIntentions`, `stanceAdaptation`), spec `docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md`. **The thread:** reflection detects a volunteered concrete commitment (`statedIntention` — committed, never aspirational) or the companion offers one in closing phase via `[phrase](#offer-intention)` + IntentionCard (Keep/skip, active-session-only); openers weave in AT MOST one open intention warmly (`intentionTracker.ts` orders by notYetCount then age); reflection matches `intentionOutcomes` by id (absence ≠ not_yet); the 3rd not_yet arms a once-ever pattern nudge that also feeds `avoidancePatterns`. **Stance:** per-session `stanceObservation` (helped/hindered/unclear, "unclear over guessing"), every-5 consolidation into ≤6 tendencies (2+ aligned observations each, no safety entries) injected as tendencies-never-rules. The one-tap closing check-in UI was retired on 2026-10-14 (`ClosingCheckIn` deleted); reflection still reads a legacy `session.leavingFeeling` when present. All blocks suppressed under grounding; offers/nudges never stack with pivot/soften/proposals. Evals: `npm run test:intentions`, `npm run test:stance`.

### Folio (writing-first mode, 2026-10-16)

Design: `docs/vision/2026-10-15-folio-v4.md` (contracts C1–C6 in §5). Runbook, decisions and log: `docs/vision/folio-build-plan.md`. Evidence for the editor and save spikes: `docs/vision/folio-spikes.md`. All code is in `src/folio/` except the listed seams (App.tsx routing, `CrisisResources`' `onDismiss`/`showToken`, the Talk composer's one-time handoff, the classifier's own rate limit, the kernel's `'page'` channel, sign-out cleanup, export, registry, rules).

- **The page** (`page/`): a TipTap editor whose document is `(paragraph | underside)+`. **Lift** marks a line (`fold` mark) and opens an `underside` (`between?`, `beneath`) under it; **Closer/Farther** set its distance (`gap` 0–4). **C1, hidden writing:** a closed underside's text is not in the DOM, and four layers (input guard incl. key repeat and fences, history guard, integrity invariants, a restore-and-reveal safety net) keep any edit from changing it unseen. Keys: `Mod+Shift+Enter` lift/open/close, `Esc` close or unlift empty, `Mod+Alt+[ ]` closer/farther, `Mod+Alt+. ,` next/previous fold (announced), `Mod+Alt+Enter` Step inside. Italic only. Ink weight and paragraph settle (descending into undersides) follow their admin switches.
- **Saving** (`save/`, C2): every save writes the whole page with a new `revId` on top of the last one (rules enforce it); a rejection is classified once per chain (landed / conflict / remote delete); a conflict becomes a new page, never a merge; pending saves are kept per editor in localStorage and adopted on reopen; a Web Lock makes one tab the editor (queued, plus **Edit here** over `BroadcastChannel`). Statuses: Saved, Saved on this device, Not saved yet (with Copy page), Couldn't save. Size guard: warn at 400 KB, full at 900 KB.
- **Safety** (`safety/`, C4): `FolioSafetyWatch` runs L1 on each unit and its neighbours, and L2 (`checkCrisisRisk`, the additive client with an `unavailable` result) on windows of at most 1,000 characters; a unit enters the page's checked set only when every window is classified. Unchecked units are swept on open; a risk on a page not edited for 72 h shows the crisis card only (no grounding, no `lastGroundingAt`). **Shore** (`shorePresentation.ts`): grounding flattens the page and shows a line (Talk now, Talk now bringing this, Find help, I'm okay); I'm okay moves to **Quiet** without ending grounding; **Recent** (`recent.ts`) holds come-backs and Return for 72 h after any activation. The classifier routes have their own 20/min limiter (`rate_limited`).
- **Kept** (`kept/`, C3): **Keep** snapshots a fold (line, distance, between, beneath) as a trace; Undo for 10 s; the **floor** (`/folio/kept`) stacks traces newest first with versions and corrected copies together and no counts; a trace offers Add (dated entries), Name it, **Come back to this** (07:00 writer-local on the chosen day; one slip at a time; Not now; held under Recent as "Waiting"), **Lift into today's page**, a corrected copy, Go to the page, Delete. Traces carry their own checked set.
- **Step inside** (`inside/`, H1): the composition alone, full screen (Room's modal structure), three standing distances, optional forest/drone sound (Web Audio gain + low-pass where the bucket's CORS allows — it allows `https://undersurface.me` only), closed at once by shore.
- **Ask** (`ask/`, H2): on a selection, a note from the companion through the kernel's `'page'` channel; only the selection (≤ 1,000 chars), its passage and the language are sent. Contract: L1 first (a hit sends nothing), L2 and the reply race, display waits for L2, risk 2 regenerates grounded, grounding read again before display. Kept notes live on the page's document (`doc.attrs.folioNotes`, ≤ 50) so C2 saves them like the words.
- **Companion involvement** (`companion/`, `docs/vision/2026-10-16-folio-involvement.md`): a slider in Folio settings, 1 Quiet · 2 Points · 3 Asks · 4 Arranges · 5 Dances (default 1 for writers who saw Folio before it, 3 for new writers; the `folioInvolvement` switch off = 1). `conductor.ts` decides *when* (deterministic: an 8 s rest, the caret outside the target, the target's units checked and, for anything shown or written, risk 0 with its neighbours, a per-visit budget, one beat at a time; never under Shore, Quiet, Recent, the card, grounding, an unfocused window or a troubled save chain); the model decides only the words (`calls.ts`, strict JSON, the kernel's `'page'` channel with `unasked: true`). Ghosts and marks are decorations (`presence.ts`); level 4 lifts (caret untouched), keeps, names, sets a come-back; level 5 arrives from the last page (≤ 7 days), chooses distances, writes the between and a starter, opens Step inside (stillness, no sound, motion allowed) and closes folds (after a writer turn, out of view). Companion acts stay out of the undo history; each has a notice (Undo / Open / Start blank). Live eval `test:folio-companion`; production check `folio-involvement-check.cjs`.
- **Return** (`kept/returnTide.ts`, H3): with "Let kept things come back on their own" and a trace's own switch, a trace kept 14+ days ago may come back once per visit (anniversaries first), never under Recent/Shore/Quiet or after a grounding near keep, always after asked come-backs; 60 days' rest after each showing.
- **Art direction** (art pass, 2026-10-16, with Fable; design doc §3.11 made real): one sheet of warm paper held up to the light, and whatever is beneath a line is seen through it. Nothing is a box, card or panel; everything is paper or light on paper.
  - **Paper:** its colour and a light from one side follow the writer-local hour (`light.ts`, `data-light` morning/afternoon/evening/night; a lamp in dark mode). Grain is two tiles: fibre specks, plus paper formation in light mode only.
  - **The underside:** passages are blurred washes of a cooler sheet, clipped hard only at the fold's amber edge; the distance is bare paper, and so is an empty passage (`.folio-passage-empty`, from `foldView`): a wash with nothing on it reads as hidden text. A lift swings the passages down like a flap, with a faint thin-film tint, gated by `data-arrived`. The crease is an outline dog-ear (a CSS mask).
  - **Slips and pages:** slips replace panels; the Kept floor is sheets laid on each other (`--folio-i`, `--folio-thickness`); Step inside is the underside's own room.
  - **Shore and Quiet** switch all of it off: flat warm paper, no light, grain, shadow or motion. On phones in Shore and Quiet the menu stays at the top, clear of the help card.
  - Every effect is at most 7% opacity or 750 ms, and contrast is measured on every band.
- **Accessibility**: every action has a control and a key; axe-clean on both papers and in shore (CI and production checks); the six keyboard tasks of §3.10 are a Playwright test. Folio allows pinch zoom while open; its crisis card uses Folio's tokens.
- **Tests**: unit/component tests beside the code; `tests/folio-save.test.ts` and `tests/folio-traces.test.ts` on the emulator; `e2e/` with harness pages in `e2e/harness/`; live evals `test:folio-safety` and `test:folio`; production checks in `scripts/folio-prodcheck/` (`npm run prodcheck:folio`).

### Room (unified restorative surface, 2026-07-11)

Replaced the Relax and Drift surfaces (commit 5c5ec48; their UI, hooks, engines and prompts were deleted 2026-10-14). Spec `docs/superpowers/specs/2026-07-11-room-unified-experience.md`. Files: `src/components/Session/Room/RoomField.tsx`, `src/hooks/useRoomSession.ts`, `src/engine/roomEngine.ts`, `src/ai/roomPrompts.ts`. Gated by the effective Room flag (above) and never open under grounding (`roomOpen = roomEnabled && surface === 'room' && !grounding`; grounding unmounts it).

- **Choices.** Approach: **Listen first** (a real conversation first), **Lead me** (gentle initiative), **Quiet company** (sound and light only — no Realtime session, no mic). When `voiceEnabled` is off only Quiet company is offered (the approach is derived, so a flag switched off mid-choice cannot start voice). Voice Rooms use the admin `voice.defaultVoice`, like Speak. Length 2/5/10 min; voice density quiet/sparse/present; sound ocean/forest/drone/binaural/none from Storage `seed-audio/v1/`. Last choices persist as `settings.lastRoom*`.
- **`roomEngine` owns time.** `buildRoomScore` places arrival/company/return cues at fixed fractions of the arc; the model never decides when. Cues are purposes, not scripts (`roomCueInstruction`): the model words them itself. Cues fire only inside the current 250ms tick window (`roomCuesInWindow`, no bursts after a density change or reconnect) and are dropped if not deliverable within `ROOM_CUE_GRACE_MS` (15s). Delivery is `useVoiceSession.promptAssistant` — a system-role `conversation.item.create` plus a bare `response.create`, refused while a response is active or the writer is speaking.
- **Spoken controls** (`detectRoomCommand`): English-only, a short whole utterance (≤ 6 words, anchored grammar), never bare "end"/"finish"; skipped when grounding is active or L1 fires on the text. Non-English Room prompts drop the "the application handles the control locally" claim and point to the on-screen controls.
- **Modal + lifetime.** Portaled `role="dialog"` with focus trap (`useModalA11y`), `#root` made `inert`, Escape = Leave, 44px controls, sits above the biometrics bar. A Room lifetime token (uid, session, room) owns persistence and late Realtime callbacks: writes are snapshots on a per-Room queue; if the parent session changes the Room ends as interrupted; unmount is a persist-only finish; transcripts reach the parent session only while it is still the owner (then go through `appendUserMessage`, so L1/L2 run). Wake lock is re-acquired on `visibilitychange`.
- **Legacy targets.** `#switch:relax`, `relax-arc`, `drift-arc` (and old `relax`/`drift` arms) all open Room. `relaxSessions`/`driftSessions` data proxies, types, export and deletion paths remain.

### Companion programs (2026-07-10/11)

None of these has a global feature flag; they run in every active, non-Fresh-eyes session and are suppressed under grounding. Specs: `docs/superpowers/specs/2026-07-10-*.md`, `2026-07-11-adaptive-companion-conductor.md`.

- **Cross-channel companion kernel** (`functions/src/shared/companionKernel.ts`, imported by `therapistPrompts.ts` and `functions/src/sms/`): shared principles, 9 response modes, the web/voice/SMS capability matrix (`COMPANION_CHANNEL_CAPABILITIES`: only web has rich actions, tracked promises and the risk preamble; only SMS has images and a 1,200-char cap), memory-aperture handling, alliance preferences, continuity blocks. `buildCompanionKernelPrompt(channel, { grounding })` swaps in a no-experiments policy under grounding.
- **Adaptive conductor** (`src/engine/adaptiveConductor.ts`, protocol `adaptive-conductor-v1`): after ≥2 user turns, scores ordinary response modes plus available surface arms (`journal_arc`, `speak_arc`, `room_arc`). Decisions stay shadow-only (recorded, not delivered) until 3 shadow events exist; after that a seeded half of non-low-confidence turns go live (≤ 2 conductor events per session, at most one of them live — any non-shadow event counts, since the in-memory cache keeps `assigned` after delivery — and never on consecutive companion turns). Surface arms are delivered as a fixed offer with a `#switch:*-arc` link (`ConductorOfferCard`, "Not now" for every surface arm incl. `room_arc` via `isConductorSurfaceArm`); other arms become a model directive.
- **Personal science / research events** (`src/engine/personalScience.ts`, `src/store/personalScience.ts`): every assignment is a provenance-only `researchEvents` doc (statuses shadow/assigned/delivered/overridden/cancelled/failed), persisted before delivery. Ambient science: the hidden preamble also carries FIT/MOVE/AGENCY/CONF/STATE/CAP/NEED, recorded as `interventionOutcomes` (`ambient-*`). The **transfer ladder** (`companion_led → user_first → minimal_cue → independent`, protocol `transfer-ladder-v1`) runs only for a legacy `personalProtocols` doc in `learning`: the review/transfer UI was retired 2026-10-14 (`WhatHelpsMeSection` deleted), so no new protocols are created.
- **Ambiguity prism + living hypotheses** (`ambiguityPrismParser.ts`, `AmbiguityPrism.tsx`, `src/store/ambiguityPrism.ts`): for the `ambiguity_prism` arm the model must emit exactly three `[text](#prism:h1..h3)` lines; the card collects fits/maybe/not this, "none of these" and a rewrite. Feedback writes `interventionOutcomes` and `livingHypotheses`; confirmed/contested hypotheses (16 newest) re-enter Talk, voice and SMS context (dropped under grounding). The hypotheses panel was deleted; the data path remains.
- **Fresh eyes** (`src/engine/freshEyes.ts`, `session.memoryAperture: 'fresh' | 'pattern'`): a per-session switch, locked after the first user turn, never a default. `applyMemoryAperture` strips durable context (notes, memories, profile, facts, parts, intentions, stance, outcomes, protocols, hypotheses, promises); conductor, research, reflection, session note, journal parts, Field Mosaic and arcs are skipped. Voice still gets this session's own recent turns (`buildCurrentSessionSeed`). Safety is unchanged (grounding still persists `lastGroundingAt`).
- **Field windows** (`functions/src/sms/fieldWindows.ts`, `fieldWindowLogic.ts`, protocol `field-window-timing-v1`): up to 3 writer-local windows (≥ 15 min each, purposes notice/settle/act, `maxPerWeek` 1–3). Each writer-local day gets at most one hashed 50/50 decision: `field_check_in` (a fixed text ending "Reply STOP to opt out.") or `field_no_contact`. True weekly cap (indexed query on protocolId + weekKey + assignedArm, ignoring cancelled/failed); a capped day is recorded as `cancelled`/`ineligible_cap` for both arms so the experiment isn't biased. A crisis within 72h cancels the day (`recent_crisis`) at schedule time and again at send time. Consent older than the last STOP/UNLINK is ignored. The timezone is chosen from a list in Settings; an opted-in writer whose stored zone `Intl` rejects is skipped with a logged `invalid_timezone` category (counted in the scheduler summary). The dispatcher rechecks the writer-local clock, writes `sendState` then the outbound SID, and marks the event `failed` on a failed send; the sweeper finishes sent-but-unwritten jobs, fails ambiguous ones and cancels stale ones, never sends. Half-life analysis (`deriveHalfLifeEvidence`) has no UI caller since 2026-10-14.
- **Field Mosaic / field moments** (`FieldMosaic.tsx`, `functions/src/sms/moments.ts`): a `fieldMoments` doc is a short, source-grounded fragment from an SMS field note (risk < 2; images stored at `field-moments/{uid}/…`) or from session reflection (≤ 2 per session, exact quote match). The mosaic shows unreviewed moments at the top of an active session (≤ 2 messages) with bring-into-Talk / keep / not now; `loadUnreviewedFieldMoments` queries `status == 'unreviewed'` newest-first directly (composite index `fieldMoments` status + createdAt desc; a wide recent scan covers the window before it is built). Gated per user by `companionPreferences/current.fieldMosaicEnabled` (default on).
- **Optimal endings + surface arcs**: the web prompt may wrap a closing phrase in `[phrase](#end:session)` (not under grounding) which ends the session. `#switch:*-arc` links start a surface arc (`startSurfaceArc` in `SessionView.tsx`): an `interventionOutcomes` row + a linked `researchEvents` row (`surface-choreography-v1`); returning to Talk shows a quiet return line (Room, conductor) or `SurfaceArcReturn`'s helped/nothing/worse/not wanted. Grounding during an arc snaps back to Talk.
- **Experience intelligence** (spec `2026-07-10-experience-intelligence-program.md`): what shipped is the `companionPreferences` (alliance preferences, Field Mosaic toggle, field windows), `fieldMoments` and `interventionOutcomes` collections, the kernel's response grammar, Fresh eyes, Field Mosaic and arcs. Its outcome UIs (`OutcomePulse`, `ClosingCheckIn`, `ReceptivityHandshake`) were deleted 2026-10-14; several outcome writers in `src/store/interventionOutcomes.ts` now have no non-test callers.

### Companion depth program (2026-07-04)

Five flag-gated behaviors (default OFF), spec `docs/superpowers/specs/2026-07-04-companion-depth-program.md`, eval `npm run test:depth`. **Values** (`userValues`): parts-grammar map of what matters to the writer; intentions carry `valueId` and the follow-up/pattern-nudge name the value tension; value proposals share the single per-session proposal slot (parts win). **Interiority** (`companionInteriority`): evidence-backed process disclosure (grounded only in stance data), companion promises (made via `#promise[:date]` markers in finalized text, delivered via `#kept-promise:<id>`, cap 2, misses acknowledged never dropped — `promiseParser.ts`), and carrying (reflection's `carriedNoticing` → next opener, consume-once on `companionSignals`). **Presence** (`companionPresence`): `[line](#presence)` → one line + breathing dot (live session only). **Humor** (`earnedHumor`): rare callback levity, stance-suppressed. **Story arcs** (`storyArcs`): `storyArc.ts` triggers at long-gap returns/anniversaries (30-day cooldown, ≥8 summaries, declines on flat history) via `buildStoryArcPrompt`; pendingArc delivered consume-once on a non-opener turn. All suppressed under grounding.

**Letters from parts** (`lettersFromParts`): `letterEngine` writes letters after sessions close while the flag is on; the writer reads them in the settings sheet (`src/components/Sidebar/LettersSection.tsx` — newest first, unread dot, opening one sets `isRead`; hidden under grounding and until a letter exists).

### Subsystems

Dark mode, adaptive parts, i18n (17 languages), emergency grounding, bundle splitting, session closing, autocorrect, body map, data export, HRV biofeedback (webcam + Polar H10), PWA updates — documented in `.claude/docs/subsystems.md`. i18n: English fallbacks are spread first so translations always win; `untranslated.test.ts` and `policy.test.ts` guard against untranslated English and a stale processor disclosure.

### Real Talk mode (Session)

A tone variant of the therapist persona that names coping moves the writer is making — avoidance, externalization, intellectualization, rationalization, minimization, self-blame as shield, all-or-nothing thinking. Mantra: **not nice, but kind and constructive**.

**Architecture.** Real Talk is a *tone variant of the existing therapist prompt*, not a parallel pipeline. `buildTherapistSystemPrompt` accepts `mode?: 'standard' | 'real_talk'` and swaps only the persona core (`THERAPIST_CORE` ↔ `REAL_TALK_CORE`) and phase hint. All other context blocks (personalFacts, profile, memories, register tier, HRV, datetime, language directive, untrusted-content preamble, `SAFETY_RULES`) are reused unchanged. `REAL_TALK_CORE` includes a 7-item pattern taxonomy and explicit "label the move, never the writer" rules. Recommendation segments are suppressed in Real Talk (the calling-out persona does not soften by recommending).

**Crisis override (load-bearing invariant).** When `isGrounding === true`, `buildTherapistSystemPrompt` reverts to `THERAPIST_CORE` regardless of saved mode. Naming coping patterns is the wrong response to distress. The check is `useRealTalk = mode === 'real_talk' && !isGrounding`. Both the L1 keyword path and the async L2 paths flip `isGrounding` before the next prompt is built. Verified by `realTalkFlow.test.ts` and `therapistPrompts.test.ts`.

**Flow.** The old EntryChoice screen is gone. Real Talk is toggled *in-session* via the `◇ Real Talk` switch in the bottom bar's options menu. Toggling writes `session.mode` to Firestore and remembers the choice in `settings.lastSessionMode`, so future new sessions open in the last-used tone. Mode is never URL-encoded.

**Patterns leverage.** `UserProfile.avoidancePatterns` is populated by `sessionReflectionEngine` post-session; Real Talk benefits passively because those patterns surface in the existing "Patterns you have noticed" block of every prompt.

### HRV Biofeedback (Session Mode)

Heart rate variability monitoring with two interchangeable signal sources, both producing the same `HrvMeasurement` shape so downstream consumers (`HrvTimeline`, `BiometricsBar` in `HrvAmbientBar.tsx`, the therapist and voice prompts) are source-agnostic. Session mode only.

#### Source A — Webcam rPPG (default)

Remote photoplethysmography via the laptop webcam. Gated behind `webcamHrv` + explicit camera consent.

**Cardiac pipeline:** Camera (ideal 1920×1080, rAF cadence) → main thread extracts RGB from skin-colored pixels (R>G>B heuristic) in 3 sub-regions (forehead + left/right cheeks); non-skin pixels feed an NLMS noise-reference channel → Web Worker runs windowed CHROM (1.6s windows, 50% overlap, Hann OLA) → 4th-order Butterworth bandpass (1.2–2.5 Hz) → FFT with parabolic interpolation → confidence-weighted EMA smoothing → `HrvMeasurement` emitted every 5s.

**Respiration pipeline:** MediaPipe FaceLandmarker (`@mediapipe/tasks-vision`, lazily loaded, GPU delegate; WASM from cdn.jsdelivr.net, model from storage.googleapis.com — both in CSP) tracks 5 lower-face landmarks; median Y is the breath-motion signal, plus an adaptive chest ROI band below the chin when the chin sits high enough in frame. Landmarker init failure degrades gracefully (motion channel disabled, cardiac path unaffected).

**Components:** `hrvEngine.ts` (camera + frame capture + skin filtering + landmarker), `hrvSignalWorker.ts` (CHROM + FFT + derived metrics in Web Worker), `HrvConsentDialog.tsx` (one-time camera consent).

#### Source B — Polar H10 over Web Bluetooth

Chest-strap heart-rate monitor. Gated behind `polarH10` + explicit Bluetooth consent. Visible only in Chrome / Edge / Opera / Samsung Internet — Safari and iOS hide the connect button (no Web Bluetooth).

**Pipeline:** `navigator.bluetooth.requestDevice` with `optionalServices: [PMD_SERVICE]` → standard Heart Rate service (0x180D) → HR Measurement characteristic (0x2A37) → parser yields HR + RR intervals at 1/1024-s resolution → rolling 30s IBI buffer → reuses `hrvSignalWorker`'s `computeHrvMetrics` / `classifyAutonomicState` / `computeDerivedMetrics` (already exported, no duplication) → `HrvMeasurement` emitted every 5s.

**Polar PMD chest-motion respiration.** After the HR stream opens, the engine fires GET_MEASUREMENT_SETTINGS to learn supported values, then START_MEASUREMENT for the accelerometer at 50 Hz / 16-bit / ±2G. Accel magnitude → `respiratoryBandpass` (0.1–0.5 Hz, reused from worker) on a 30s sliding window → envelope-normalized 0..1 chest-motion `breathingScale` (15s adaptive horizon) → rising zero-crossings give breath onsets → median of inter-crossing intervals = respiratory rate. `breathingScale` is polled via a stable `useCallback` getter at rAF cadence so animations sync without React churn.

**Components:** `polarH10Engine.ts` (BLE lifecycle + HRM parser + PMD ACC parser + streaming breathing extractor), `usePolarH10Session.ts` (consent + flush to Firestore + timeline + getBreathingScale), `PolarH10ConnectButton.tsx` (status-driven button), `PolarH10ConsentDialog.tsx` (Bluetooth-flavored consent).

**Mutex.** H10 takes priority — when paired and streaming, webcam HRV is stopped by an effect in `useSessionBiometrics.ts` on `[polar.enabled, camera.enabled, cameraStopAndFlush]`. The webcam toggle is hidden while H10 is connected. The reverse can't arise. Both paths feed prompt context through the `BiometricSource` bridge (defined in `useSessionStream.ts`, built in `useSessionBiometrics.ts`) so `useSessionStream`, `useSessionVoice` and Room's voice instructions see whichever source is active.

#### Common: timeline, derived metrics, persistence

**Derived metrics from IBI series:** SDNN (overall HRV), pNN50 (parasympathetic index), LF/HF ratio (autonomic balance via FFT on IBI series), Baevsky Stress Index (histogram-based), cardiac coherence (HRV regularity). Same math regardless of source.

**Behavioral correlations:** Post-response physiological reaction (HR change after therapist speaks), per-message activation level (HR when user writes), session trajectory (calming vs escalating over time). All injected into therapist system prompt via `hrvContext` on `TherapistPromptOptions`.

**Persistence:** `HrvSessionData` written to `hrvSessions/{sessionId}` every 10s, carrying an optional `source: 'camera' | 'polarH10'` field. Webcam path includes `signalDumps` (raw RGB/CHROM/FFT for offline algo analysis); H10 path leaves `signalDumps: []` for now.

**Live breathing display:** the only consumer of `getBreathingScale` is the H10 respiration panel in `BiometricsBar` (`HrvAmbientBar.tsx`, via `chestScaleGetter`). Room's visuals do not follow biometrics; Room's voice gets `hrvContext` like Speak.

### Analytics & tracking

Firebase Analytics events, Google Ads conversion tracking, Sentry error monitoring — documented in `.claude/docs/analytics.md`

### Environment variables

`.env.local` (git-ignored): `VITE_FIREBASE_*` (6 vars) + `VITE_SENTRY_DSN`. Build-time: `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`, `CAPACITOR_BUILD=1` (native meta CSP). All client-side vars are safe to expose.

## Testing

Vitest with jsdom. Tests cover prompts, pure engines, the session runtime and full crisis decision pipeline, turn routing under grounding, Room (engine, hook, dialog), voice instructions, CSP derivation, bounded HRV archives, components, hooks, stores, i18n key parity, and admin config round trips. Functions-side tests cover chat validation + quota metering, realtime flags/budget, routing, admin handlers/analytics/config schema, account deletion, quota logic, the SMS processor/state/delivery, and the field-window scheduler, dispatcher and sweeper (with an in-memory Firestore fake in `functions/src/sms/testing/`). Emulator tests (`tests/`) cover indexes and Firestore + Storage rules, including the server-owned SMS docs and `quotas`. Live prompt evals remain explicit release/scheduled gates rather than ordinary PR tests.

```bash
npm run test             # Run all tests
npm run test:watch       # Watch mode
cd functions && npm test # Functions tests
npm run test:indexes     # Emulator tests (indexes + rules)
npm run smoke-test       # Post-deploy smoke test against live site
```

## Code Conventions

- **TypeScript strict mode** — no `any`, use `import type {}` for type-only imports
- **Tailwind CSS v4** — `@tailwindcss/vite` plugin, `@import "tailwindcss"` in CSS
- **TipTap v3** — editor.storage types via `@tiptap/core` module augmentation in `src/types/tiptap.d.ts`
- **No semicolons**, **single quotes**
- **Functional components** — class components only for error boundaries (`ErrorBoundary`, `SurfaceErrorBoundary`)
- **`useMemo` over `useEffect+setState`** for derived state
- **Reactive stores** — `useSettings()` / `useGlobalConfig()` via `useSyncExternalStore`; `getSettings()` / `getGlobalConfig()` for non-React
- **Colors via CSS variables** — never hardcode hex for themed colors; inline styles use `var(--bg-primary)` etc.
- **Admin components** — inline styles, warm muted palette, light-only
- **Session cards** — 44px targets and ≥ 12px text via the shared `src/components/Session/cardControls.ts`

## Common Tasks

### Changing the chat model

The model is pinned server-side. Update `OPENAI_CHAT_MODEL` in `functions/src/shared/models.ts` (crisis model: `OPENAI_CRISIS_MODEL` in `functions/src/chat.ts`; realtime model: `REALTIME_MODEL` in `functions/src/realtime.ts`), then `cd functions && npx tsc && cd .. && firebase deploy --only functions`. The client never sends a model field.

### Updating API keys

```bash
echo "sk-..." | firebase functions:secrets:set OPENAI_API_KEY
echo "AC..."  | firebase functions:secrets:set TWILIO_ACCOUNT_SID
echo "..."    | firebase functions:secrets:set TWILIO_AUTH_TOKEN
cd functions && npx tsc && cd .. && firebase deploy --only functions
```

### Adding a new seeded part

Add to `SEEDED_PARTS` in `partPrompts.ts` (currently 7: Watcher, Tender, Still, Spark, Weaver, Open, Quiet One). Scoring is role-based (`ifsRole`) — no orchestrator changes needed.

### Adding a new Firestore collection

1. Add proxy in `db.ts` (add to the `db` object literal)
2. Add interface in `src/types/index.ts`
3. Add `'collectionName'` to `collectionNames` in `exportAllData()` in `src/store/dataExport.ts` (and render it in `buildMarkdownExport`)
4. Add it to `USER_SUBCOLLECTIONS` in `functions/src/shared/collections.ts`. Account deletion is registry-free (`recursiveDelete`), but the account tests seed every registry entry to prove it
5. If only the server may write it, add it to the owner-write exclusion list in `firestore.rules` and cover it in `tests/firestore-rules.test.ts`

### Adding a new feature flag

Add it to `GlobalConfig.features` (`src/admin/adminTypes.ts`), `FEATURE_KEYS` in `functions/src/admin/configSchema.ts`, the admin Settings UI, and (if it should be reset) `src/admin/adminDefaults.ts`. Deploy functions before hosting, or admin saves will be rejected.

### Toggling features without deploying

`undersurface.me/admin` → Settings. Changes propagate in real-time via `onSnapshot` (server-side flag reads in `functions/src/shared/featureFlags.ts` cache for 60s).

## Infrastructure

| Service | URL |
|---------|-----|
| Firebase | [console.firebase.google.com/project/undersurfaceme](https://console.firebase.google.com/project/undersurfaceme/overview) |
| Firestore | [console.firebase.google.com/.../firestore](https://console.firebase.google.com/project/undersurfaceme/firestore) |
| Functions | [console.firebase.google.com/.../functions](https://console.firebase.google.com/project/undersurfaceme/functions) |
| Hosting | [console.firebase.google.com/.../hosting](https://console.firebase.google.com/project/undersurfaceme/hosting/sites/undersurfaceme) |
| Auth | [console.firebase.google.com/.../authentication](https://console.firebase.google.com/project/undersurfaceme/authentication/users) |
| DNS | [dash.cloudflare.com](https://dash.cloudflare.com) → undersurface.me |
| GitHub | [github.com/zohoora/undersurface](https://github.com/zohoora/undersurface) (public) |

## Known Gotchas

### Firebase & Infrastructure
- **Cloudflare DNS proxy must be OFF** (gray cloud) for Firebase Hosting A record — breaks SSL
- **Cloud Function streaming** requires `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`
- **Firebase offline persistence** — `persistentLocalCache` + `persistentMultipleTabManager` must init before any Firestore calls
- **`chat` function `minInstances: 1`** requires `firebase deploy --force`
- **Deploy order: indexes → rules → functions → hosting.** The admin bundle saves the whole `features` object, and `configSchema.ts` rejects any key it doesn't know: saving `roomEnabled`/`smsEnabled` (or any new flag) fails until the functions that know the key are live. New queries (the field-window weekly cap, the dispatch sweeper, Field Mosaic's unreviewed query) fail until their indexes are built
- **`smsInbound` TTL policy is not in the repo.** Docs carry a Timestamp `expireAt` (30 days), but nothing expires until the policy exists: `gcloud firestore fields ttls update expireAt --collection-group=smsInbound --enable-ttl --project=undersurfaceme` (an infrastructure change — confirm with the owner first)
- **Firestore unions every matching `allow`** — server-owned collections must be carved out of the `users/{uid}/{collectionId}/{document=**}` owner rule itself (see `smsSettings`/`smsMessages`), not denied in a separate, more specific block
- **Analytics `refreshAnalytics`** iterates all users + their subcollections — needs optimization at scale
- **Exactly one CSP on web: the `firebase.json` header.** `index.html` must not carry a meta CSP (browsers intersect two policies; that silently blocked the site's own Google Ads calls). Native builds have no headers, so `npm run build:native` (`CAPACITOR_BUILD=1`) injects a meta CSP derived from the header (`src/security/contentSecurityPolicy.ts`, pinned by its test). When adding external scripts/connections/images, update the header: Firebase Auth needs `apis.google.com`; Google Ads/GA4 need `googleads.g.doubleclick.net`, `ad.doubleclick.net`, `googleadservices.com`, `pagead2.googlesyndication.com`, `*.google-analytics.com`, `*.analytics.google.com` and the explicit regional `www.google.<tld>` list in `img-src` + `connect-src`; Realtime voice needs `api.openai.com` in `connect-src`; MediaPipe needs `cdn.jsdelivr.net` (script/connect) + `storage.googleapis.com`; Room audio needs `storage.googleapis.com` in `media-src`. CSP violations show in browser console as "violates Content Security Policy directive"
- **`authDomain` must be `undersurfaceme.firebaseapp.com`** — do NOT change to custom domain without also adding `https://undersurface.me/__/auth/handler` as an authorized redirect URI in Google Cloud Console OAuth settings. Third-party cookie blocking can break `signInWithPopup` on some browsers
- **Permissions-Policy** — `camera=(self)` (webcam HRV) and `microphone=(self)` (Speak + Room) are enabled; `geolocation=()` remains blocked

### React & Editor
- **Refs in setState callbacks** — capture ref values before calling setState (React batches updates)
- **Part colorLight alpha** — `'25'` in light, `'30'` in dark (via `boostAlpha` in `src/utils/color.ts`). Without boost, invisible on dark
- **Never gate a safety decision on render-captured React state** — read `isGroundingActive()` at the moment of deciding (see `turnResponder.ts`); `grounding` from a closure is stale while an append is awaited

### Engines & Logic
- **Orchestrator pre-warms caches** — `loadParts()` fetches profile + summaries + memories upfront
- **L1 crisis check must run before LLM generation** — `checkCrisisKeywords()` is synchronous and activates grounding before therapist generation so `isGrounding: true` flows into the prompt (`useSessionStream`). Async L2 alone is too late
- **`<<RISK:N>>` preamble must be stripped at every egress** — the session-mode L2 signal rides the therapist stream. `openrouter.ts` anchors the pattern to the stream start and scrubs mangled markers at fail-open flush; a leak shipped 2026-06-12 when the pattern required a trailing newline the model didn't emit. Fail-open is deliberate: L1 is the deterministic floor
- **Crisis classifier is tuned for precision, not recall** — a prior classifier over-called on grief/metaphor/hyperbole/gallows humor. Don't widen thresholds without running `npm run test:crisis` against the eval set; the same applies to any L1 regex change
- **Real Talk grounding override is non-negotiable** — `buildTherapistSystemPrompt` checks `useRealTalk = mode === 'real_talk' && !isGrounding`. Distress disables Real Talk, no exceptions. Anyone editing the prompt builder must preserve this single guard line. Both branches still embed `SAFETY_RULES` verbatim. Verified by tests in `therapistPrompts.test.ts` and `realTalkFlow.test.ts` — do not delete those tests when refactoring
- **Journal parts are triple-gated** — `SessionJournalSurface` requires the per-session toggle AND `!isGrounding` AND global `partsEnabled`. Parts silence during distress, mirroring the Real Talk override
- **Sidebar lists sessions only** — `EntriesList.tsx` maps `db.sessions` into `SidebarItem`s (preview from `sessionNote`/`firstLine`, favorites, search). Diary entries no longer appear anywhere in the UI
- **`entries` is a legacy collection** — nothing writes it. `echoEngine`/`quoteEngine`/`sessionReflectionEngine` and the MCP `list-entries`/`get-entry` tools still read old data. Keep it in export/delete paths
- **Room's spoken controls are English-only and anchored** — `detectRoomCommand` matches only a short whole utterance; ordinary speech containing "end", "stop talking" or "keep going" must stay conversation (a false positive can close Room or mute the mic mid-disclosure). Don't widen the patterns or claim local handling in non-English prompts
- **SMS sends are at-most-once** — never resend a reply whose Twilio call may have gone out (`sendState: 'sending'` without an `outboundSid`). The only exception is one resend of the fixed crisis reply

### i18n
- **`t()` shadows loop variables** — in `dataExport.ts` (which imports `t`), use different names (e.g., `th` not `t`)
- **Emotion analysis returns English** — validation is against an English emotion list; UI translates
- **`languageDirective()` not in reflection/growth** — internal prompts stay English

### Settings & Config
- **Feature flags** — core use `=== false`, experimental use `=== true`; Room uses `isRoomEnabled`, never a raw flag read. `getGlobalConfig()` returns `null` before first admin save
- **Settings cache invalidation** — `invalidateSettingsCache()` is wired into the `globalConfig.ts` `onSnapshot` callback; new admin defaults propagate without reload, localStorage overrides win

### HRV / Biometric — Webcam path
- **Skin color filtering for the cardiac ROI** — R>G>B heuristic outperformed FaceDetector-style tight bounding boxes for rPPG (jitter degraded signal). MediaPipe FaceLandmarker was later reinstated, but only for the **respiration motion channel** (5 lower-face landmarks + adaptive chest band); the cardiac signal still comes from skin-filtered sub-regions, with non-skin pixels as an NLMS noise reference. Landmarker init failure only disables the motion channel
- **Camera resolution** — requests `ideal: 1920x1080` but main thread only reads skin pixels from 3 sub-regions (forehead, left cheek, right cheek), sending just RGB averages to worker
- **Camera auto-exposure must be locked** — auto-exposure creates 0.5-1.1 Hz color drift that is 50-100x stronger than the cardiac signal. Engine locks `exposureMode` and `whiteBalanceMode` to manual via `applyConstraints`
- **CHROM windowed processing** — 1.6s windows with 50% overlap and Hann overlap-add (per rPPG-Toolbox reference). Per-window alpha adapts to lighting changes. Single-window CHROM over the full buffer produces worse results
- **4th-order highpass at 1.2 Hz** — 2 cascaded Butterworth stages. Environmental noise dominates 0.5-1.1 Hz; the cardiac signal at 1.5+ Hz is 50-100x weaker without aggressive filtering. Restricts detection to 72-150 BPM (safe for seated users)
- **RMSSD > 200ms is noise** — real RMSSD is 20-80 ms. Values above 200ms indicate noisy IBI detection; reported as 0
- **HR temporal smoothing** — confidence-weighted EMA (alpha scales with FFT confidence) + outlier rejection. Takes ~30s to converge from initial reading
- **HR accuracy** — within ±5-15 BPM of Apple Watch in ambient lighting. Accuracy depends on lighting stability, stillness, and skin visibility. Direct/diffuse light best; fluorescent worst
- **Signal dumps saved every 10s** — trimmed to the last 10 dumps at flush time to stay under the 1MB Firestore doc limit (engine keeps ~60 in memory)
- **Derived metrics** — SDNN, pNN50, LF/HF ratio, Baevsky Stress Index, cardiac coherence computed from IBI series. LF/HF uses 4 Hz interpolated IBI series + FFT
- **Behavioral correlations** — post-response HR change, per-message activation, session trajectory (calming vs escalating) computed from HRV timeline events and injected into therapist prompt
- **HR display rounding** — `BiometricsBar` renders `Math.round(latest.hr)`. The underlying `HrvMeasurement.hr` keeps float precision for downstream consumers (timeline correlations, Firestore archival); only the display is rounded

### HRV / Biometric — Polar H10 path
- **Web Bluetooth permission is per-service** — pairing without `optionalServices: [PMD_SERVICE]` declared on `requestDevice` scopes consent to HR-only. Accessing PMD afterward throws "Origin is not allowed to access this service." Existing pairings from earlier flag-off builds need to be re-paired once
- **PMD GET_MEASUREMENT_SETTINGS first, START second** — never hardcode TLV settings. The H10 ACC supports only `SAMPLE_RATE / RESOLUTION / RANGE` (no `CHANNELS`), and the set differs by sensor model + firmware. Sending an unsupported setting returns PMD error 5 (INVALID_PARAMETER). Always query → intersect → start
- **PMD response framing has a MORE_FRAME byte** — at offset 4 (after `f0 op type err`), before the TLV body. Missed it once during the trial; parser now starts at offset 5. Documented in Polar's SDK source but not in the protocol PDF
- **PMD ACC `frame_type=0x01` is 16-bit raw signed** — Polar's lower-nibble encodes resolution (`0x00`=8-bit, `0x01`=16-bit, `0x02`=24-bit) and the `0x80` bit flags delta-compression on top. Treating `0x01` as "delta" silently drops every frame
- **Re-pair required when toggling `polarH10`** — turning the flag on/off doesn't itself re-prompt; users who had a stale HR-only pair must click Disconnect → Connect to expand the permission scope
- **ACC magnitude (rotation-invariant) over single-axis** — `sqrt(x²+y²+z²)` of accel sample is used as the breathing signal source. Single-axis (e.g., Z for chest expansion) has ~6 dB better SNR but breaks if the strap shifts mid-session; magnitude is more robust
- **Streaming bandpass reuses `respiratoryBandpass`** — same 0.1–0.5 Hz Butterworth that the webcam worker uses. Applied to a sliding 30s window of accel magnitudes every 5 samples (~100 ms) so animation lag is capped at one stride
- **Adaptive envelope normalization** — 15s rolling min/max of the bandpassed signal maps to `breathingScale ∈ [0,1]`. Short enough to adapt to breathing-depth changes; long enough not to smear across posture changes
- **Mutex with webcam HRV** — H10 takes priority. `useSessionBiometrics.ts` stops the camera when polar starts streaming. Webcam toggle is hidden while H10 is active so the reverse can't arise
- **`getBreathingScale` is a stable `useCallback`** — animations poll it inside their own rAF loops without re-rendering React. Returns `null` when PMD isn't active so the consumer can hide or fall back (the `BiometricsBar` respiration panel does this)
- **Polar `respiratoryRate` may be null even when H10 is paired** — bandpass needs ~5s to settle, envelope needs ~15s to converge, and the rate requires ≥2 zero-crossings (~one full breath cycle). Expect a 30–60s warmup before the rate populates

### Realtime voice
- **`response.create` with `response.instructions` REPLACES the session prompt for that response** (per the Realtime API reference) — the reply runs without `SAFETY_RULES`, the language directive or Fresh-eyes boundaries. Steer a response with a system-role `conversation.item.create` followed by a bare `response.create` (`promptAssistant`). `useVoiceSession.speak()` still uses the override form and has no callers; don't revive it for companion speech
- **Dropped connections must surface** — `useVoiceSession` handles `pc.onconnectionstatechange`/`oniceconnectionstatechange` `failed`/`closed`, remote `dc.onclose`/`dc.onerror`, and fatal server errors (`isFatalRealtimeServerError`) by tearing down the mic and setting an error; recoverable server `error` events stay log-only
- **Reasoning models budget hidden reasoning + visible output together** — on gpt-5.x, `max_completion_tokens` covers BOTH. gpt-5.5 burns 1k–3k reasoning tokens before emitting output; too-tight caps return empty content with `finish_reason='length'`. The chat function caps at 4000; the crisis route uses `reasoning_effort='minimal'` + 500
- **Realtime tempo is deliberately slow** — `speed: 0.88`, semantic VAD eagerness `low` (8s max timeout). `medium`/`high` feel rushed for the therapy register
- **Room must reach `getUserMedia` inside the initiating tap on iOS** — `buildVoiceCompanionInstructions` is pure and synchronous for that reason; don't add awaits before the voice start

### Folio
- **Kept notes are a document attribute.** Any new way of loading a stored page into the editor must use `loadDoc` (`src/folio/ask/notes.ts`), which sets `doc.attrs.folioNotes`; `replaceWith(…content)` alone silently drops the notes
- **Anything saved with a page must live inside the `doc` JSON.** The save controller detects changes and conflicts by comparing the `doc` string; a separate field would be skipped and could be lost in a conflict copy
- **Closed undersides aren't in the DOM** (C1): browser find, grammar extensions and screen readers can't see them; Reading view shows everything. Never render hidden text "visually hidden" instead
- **The Playwright emulator webServer stops with SIGTERM.** If port 8087 is held after a run, an orphaned Java emulator from an older run is the cause; stop it before `test:indexes`
- **Browser tests race ProseMirror.** It reads the caret on `selectionchange`, defers Enter on iOS to the DOM change, and CI's emulated iPhone has a Linux `navigator.platform` (TipTap's Mac keymap vs ProseMirror's Ctrl-Mod disagree, so `Mod+A` isn't select-all). Poll the editor's selection after arrow keys and select with the browser's own keys
- **Step inside makes the page inert.** Focus and selection can only be restored after the dialog unmounts (`useStepInside`'s pending restore); a `focus()` while it's open silently fails
- **`seed-audio/` CORS allows `https://undersurface.me` only.** On localhost Step inside's sound falls back to volume-only by design
- **The companion's words are a mark that records what it wrote** (`companionText` with `original`): a run is the companion's only while its text is exactly that, however a change arrives (Android and IME input can put the writer's characters inside the span). The safety units read a paragraph whole as soon as the writer wrote anything in it (`safetyText`), and skip a paragraph only the companion wrote; build every new reading of page text on `safetyText`/`writerText`, never on the mark's presence
- **Open folds are remembered only after the page's own content is loaded** (`viewStateReady` in `FolioPageView`): writing the view state during the first paint used to forget them on every reload (fixed 2026-10-16)
- **The test account is usually in Recent**, because the production checks start shore: come-back slips are held ("Waiting") and Return can't show; the checks branch on it. Don't rewrite its `lastGroundingAt`
- **jsdom has no `localStorage`** (Node's global shadows it) **and no layout**: stub storage, and stub `getClientRects` before any ProseMirror `scrollIntoView`

### PWA & Build
- **PWA API calls not cached** — go through Firebase rewrites
- **Precache is trimmed** — locale chunks (`locale-<lang>-<hash>.js`), `AdminDashboard-*`, `vision_bundle-*` and marketing images are `globIgnores`d and runtime-cached `CacheFirst` (`on-demand-assets`, 40 entries, 60 days) in `vite.config.ts`. `skipWaiting` + `clientsClaim` stay on
- **Stale chunks after a deploy** — the new service worker claims open tabs and cleans the old precache, and Hosting rewrites unknown paths to `index.html`. `src/utils/lazyWithRetry.ts` retries an import once, then reloads once per chunk (sessionStorage guard, 60s); `main.tsx` reloads once on `vite:preloadError`; Room and Voice sit inside `SurfaceErrorBoundary`. Every other lazy chunk (SessionView, AdminDashboard, Onboarding, DeleteAccountModal, BodyMapTab) uses the same `lazyWithRetry` inside a `ChunkErrorBoundary` (calm message + deliberate "Try again"; the session one is inline so the sidebar and crisis card stay up). `CrisisResources` is a static import in the main bundle so it renders offline — keep it that way
- **Sentry source maps** read `process.env` (not `import.meta.env`), disabled without `SENTRY_AUTH_TOKEN`
- **Autocorrect** uses LLM-based sentence correction (`src/ai/llmCorrect.ts`, wired via `useAutocorrect` into the session composer/journal; `task: 'autocorrect'` on gpt-5-nano, sentences over 1,000 chars skipped) — works in all languages with sentence-ending punctuation (CJK fullwidth, Hindi danda); Thai silently skipped (no standard sentence punctuation)
- **The viewport is relaxed at boot on the web** — index.html carries the native app's locked viewport (`maximum-scale=1.0, user-scalable=no`); `applyWebViewport` (`src/utils/viewport.ts`, called from `main.tsx` off native) drops both limits for pinch zoom (WCAG 1.4.4), except that iPhone and iPad keep `maximum-scale=1`, which Safari ignores for pinch but which stops it zooming into a focused field under 16px. Don't drop that on iOS unless every text field is at least 16px on touch screens
- **Capacitor native builds call the prod origin** — `src/api/apiBase.ts` prefixes `/api/*` with `https://undersurface.me` on native platforms. Native builds must use `npm run build:native` (meta CSP). Mobile shipping is on the roadmap; do not remove `@capacitor/*` deps even when audits flag them
- **Type-check with `npx tsc -b --force`, NOT `tsc --noEmit -p tsconfig.json`.** `tsconfig.json` is a *solution* file (`"files": []` + references to `tsconfig.app.json` / `tsconfig.node.json`), so `tsc --noEmit -p tsconfig.json` type-checks **zero files** and always "passes" — a silent false green that let a real `TS2367` ship to prod once. The authoritative gate is `npx tsc -b --force` (the `--force` bypasses the `.tsbuildinfo` cache, which can otherwise mask errors in unchanged files). Vite/esbuild emits the JS bundle regardless of TS errors, so a "successful" `npm run build` is NOT proof of type-safety — run `tsc -b --force` explicitly before committing/deploying anything non-trivial.
- **Major dep upgrades** (TS 6, ESLint 10, Vite 8, @vitejs/plugin-react 6, @sentry/vite-plugin 5) are all blocked by `typescript-eslint@8`'s peer dep `typescript@<6.0.0`. Re-attempt once `typescript-eslint@9` ships.
