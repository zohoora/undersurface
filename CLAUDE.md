# CLAUDE.md — UnderSurface

## What is this project?

A session-first reflective companion app. Opening the app drops the user into a therapist session — an AI companion that talks with them across four surfaces: **Talk** (streamed text conversation), **Journal** (quiet TipTap page where inner-voice "parts" can respond on pause), **Speak** (live voice via OpenAI Realtime), and **Relax** (guided breathwork + soundscapes). The app pivoted from a diary-first product; the diary-entry flow no longer exists, but the journal/parts machinery lives on inside sessions. Live at [undersurface.me](https://undersurface.me).

## Current work

A full remediation effort is underway. The master plan is `docs/superpowers/plans/2026-07-03-full-remediation-master.md` (stage plans live alongside it, e.g. `2026-07-03-stage1-quick-wins.md`). Check it before starting significant work — your task may already be scoped there.

## Review docs

Canonical findings list, in order of authority:

- `APP_REVIEW_TREE_AND_FOREST_2026-05-21.md`
- `APP_REVIEW_2026-07-03.md`
- `APP_REVIEW_FABLE5_2026-07-03.md`

## Quick Reference

```bash
npm run dev              # Dev server → localhost:5173
npm run build            # Production build → dist/ (tsc -b + vite build)
npm run lint             # ESLint (flat config)
npm run test             # Vitest (npm run test:watch for watch mode)
npm run preview          # Preview production build locally
npm run test:indexes     # Run Firestore index tests (requires emulator)
npm run test:crisis      # Live crisis-classifier eval (RUN_CRISIS_EVAL=1, hits real API)
npm run smoke-test       # Post-deploy smoke test against live site
npm run cap:ios          # Build + sync + open iOS (Capacitor; cap:android likewise)
```

## CI/CD

`.github/workflows/ci.yml` runs on push/PR to main: type-check (frontend + functions), lint, test, Firestore index tests (emulator + Java 21), build. Uses Node 22 and dummy `VITE_FIREBASE_*` env vars (Firebase config is public, only needed at runtime — never use the dummy values for production deploys).

## Deploying Changes

The app runs on Firebase. Three deployable units:

### 1. Frontend (Firebase Hosting + PWA)

```bash
npm run build && firebase deploy --only hosting
```

### 2. Cloud Functions (Firebase Functions, Node.js 22)

Six functions split across `functions/src/`:
- **`chat`** (`functions/src/chat.ts`) — proxies AI requests to OpenAI; `gpt-5.5` for therapist/journal turns, `gpt-5-nano` for the `task: 'crisis_check'` route (512MiB, minInstances: 1, 300s). Aborts the upstream request on client disconnect and signals mid-stream truncation as a real error (not a clean finish). Enforces an optional **durable monthly token quota** (`functions/src/shared/quota.ts`, reserve-then-reconcile; crisis-checks exempt; config on `appConfig/global.quota`; usage in top-level `quotas/{uid}`)
- **`realtimeTokenApi`** (`functions/src/realtime.ts`) — mints OpenAI Realtime client secrets for `gpt-realtime-2` voice sessions (256MiB, minInstances: 1, 30s)
- **`soundscapeApi`** (`functions/src/soundscapeApi.ts`) — ElevenLabs-backed custom soundscape generator + Firestore cache (`functions/src/soundscape/`) (256MiB, 60s)
- **`accountApi`** (`functions/src/account.ts`) — account deletion + contact form, table-driven action dispatch (256MiB, 60s)
- **`adminApi`** (`functions/src/admin/`) — admin dashboard backend, table-driven action dispatch; handler map in `admin/index.ts`, handlers in `admin/handlers.ts`, analytics in `admin/analytics.ts` (512MiB, 120s)
- **`mcpApi`** (`functions/src/mcp.ts`) — MCP server with 4 read-only tools: `list-entries`, `get-entry`, `list-conversations`, `get-conversation` (256MiB, 30s)

Shared cross-handler code in `functions/src/shared/`: `init.ts` (initializeApp), `auth.ts` (verifyAuth/`verifyAuthWithRole`/verifyAdmin + `ADMIN_EMAILS`), `cors.ts` (`ALLOWED_ORIGINS`), `rateLimit.ts` (`makeRateLimiter`), `secrets.ts` (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`), `models.ts` (`OPENAI_CHAT_MODEL`, pinned), `collections.ts` (`USER_SUBCOLLECTIONS`), `quota.ts` (durable token quota — `checkAndReserve`/`reconcile`/`resolveCap`/`periodKey`). `functions/src/index.ts` is a slim re-export so deploy targets are unchanged.

```bash
cd functions && npx tsc && cd .. && firebase deploy --only functions
```

### 3. Firestore Rules

```bash
firebase deploy --only firestore:rules
```

### Deploy everything

```bash
npm run build && cd functions && npx tsc && cd .. && firebase deploy
```

### Post-deploy verification

After deploying, run the smoke test to verify the live site:

```bash
npm run smoke-test
```

### Decision table

| What changed | Build | Deploy |
|---|---|---|
| `src/` | `npm run build` | `firebase deploy --only hosting` |
| `functions/src/` | `cd functions && npx tsc` | `firebase deploy --only functions` |
| `firestore.rules` | — | `firebase deploy --only firestore:rules` |
| Both | Both build steps | `firebase deploy` |

## Architecture

### Request flows

```
Therapist turns (Talk surface):
  user sends → useSessionStream → buildTherapistMessages (therapistPrompts.ts)
    → streamChatCompletion (src/ai/openrouter.ts — legacy filename, calls /api/chat)
    → Cloud Function (chat) → verifies token → Secret Manager key → OpenAI gpt-5.5
    → streams SSE back; <<RISK:N>> preamble stripped client-side
  Crisis: L1 regex (sessionOrchestrator.checkCrisisKeywords, sync, before generation)
          L2a = in-band <<RISK:N>> preamble at the start of the SAME stream (fail-open);
                risk=2 before first token aborts + retries with grounding on.
          L2b = standalone classifyCrisisRisk (gpt-5-nano) races the stream, once per
                user turn — the independent backstop for when the preamble fails open;
                risk=2 activates grounding (crisis UI + grounds subsequent turns).
                Also runs in journal/parts mode.

Journal surface parts:
  pause in TipTap → useJournalParts → PauseDetector + PartOrchestrator
    → openrouter.ts → /api/chat → OpenAI → part thought streams onto the page

Voice (Speak surface):
  useSessionVoice → POST /api/realtime-token (realtimeTokenApi mints client secret)
    → useVoiceSession WebRTC direct to OpenAI Realtime (gpt-realtime-2)

Relax surface:
  preset soundscapes from static assets; custom prompts → /api/soundscape
    → soundscapeApi → ElevenLabs (+ Firestore cache); optional voice guidance
    runs a passive (recvonly) realtime session

Admin:  /admin → isAdmin check → adminApi Cloud Function → Admin SDK
Account: Settings → accountApi Cloud Function → delete/contact
```

### Key files

Detailed file-by-file reference: `.claude/docs/key-files.md`

Core entry points: `src/ai/openrouter.ts` (all /api/chat calls — legacy filename kept, there is no OpenRouter; includes `classifyCrisisRisk` + `<<RISK:N>>` preamble handling), `src/ai/therapistPrompts.ts` (therapist companion prompts — `THERAPIST_CORE` warm + `REAL_TALK_CORE` calling-out + `SAFETY_RULES` + `buildTherapistSystemPrompt`), `src/ai/partPrompts.ts` (7 seeded parts + `SHARED_INSTRUCTIONS` + emergence/reflection/growth prompts), `src/ai/crisisClassifierPrompt.ts` (L2 risk-tier prompt), `src/ai/relaxPrompts.ts` (Relax voice guidance), `src/ai/therapistRecommendationParser.ts` (tappable recommendation segments in therapist messages), `src/engine/sessionOrchestrator.ts` (phase detection + L1 crisis regex + emotion check), `src/engine/partOrchestrator.ts` (part selection + scoring), `src/engine/pauseDetector.ts`, `src/engine/sessionContextLoader.ts` (`loadTherapistContext`), `src/engine/relaxEngine.ts` (breath pacing math), `src/engine/hrvEngine.ts` (webcam HRV), `src/engine/hrvSignalWorker.ts` (CHROM rPPG Web Worker), `src/engine/hrvTimeline.ts`, `src/engine/polarH10Engine.ts` (Polar H10 BLE), `src/hooks/useSessionStream.ts` (therapist message lifecycle + crisis race + `BiometricSource`), `src/hooks/useSessionVoice.ts` + `src/hooks/useVoiceSession.ts` (Realtime voice), `src/components/Editor/useJournalParts.ts` (in-session parts pipeline), `src/hooks/useHrvSession.ts`, `src/hooks/usePolarH10Session.ts`, `src/hooks/useRelaxSession.ts`, `src/components/Session/SessionView.tsx` (session shell: surfaces, mode, biometrics), `src/components/Session/SessionBottomBar.tsx` (surface switcher + Real Talk toggle), `src/components/Session/SessionJournalSurface.tsx` (in-session TipTap journal), `src/components/Session/Relax/` (Relax UI), `src/store/db.ts` (Firestore wrapper + `sessionMessages`). Cloud Functions: `functions/src/{chat,realtime,soundscapeApi,account,mcp}.ts` + `functions/src/admin/` + `functions/src/soundscape/` + `functions/src/shared/`.

Note: `src/ai/sessionPrompts.ts` exists but has no non-test consumers — candidate for removal, see review docs.

### Data storage

- **Firestore** `users/{uid}/` — 18 subcollections in `db.ts`: entries (legacy — **no writers anymore**, read only by echo/quote/reflection engines and MCP), parts, memories, thoughts, interactions, entrySummaries, userProfile, personalFacts, fossils, letters, sessionLog, innerWeather, consent, sessions (docs carry `mode: 'standard' | 'real_talk'`, `status`, `favorited`, `journalPartsEnabled`), apiKeys, hrvSessions, relaxSessions, diagnostics. Plus `sessions/{id}/messages` subcollection (via the `sessionMessages` helper in `db.ts`, not the `db` proxy).
- **Firestore** `appConfig/global` — readable by all authenticated, writable only via adminApi. Config allowlist: `features`, `tuning`, `grounding`, `announcement`, `quota` (`{ enabled, monthlyTokenCap, perRoleCaps }` — see the durable-quota note under `chat`)
- **Firestore** `contactMessages` — top-level, deny-all in client rules, written/read via Cloud Functions
- **Firestore** `quotas/{uid}` — top-level (NOT under `users/`, deliberately — the `users/{uid}/{document=**}` rule would let the owner write it, and Firestore unions `allow` rules). Client read-only / server-write-only. Holds `{ period, tokensUsed, requestCount }` for the durable token quota
- **localStorage** — device settings (`src/store/settings.ts` DEFAULTS: responseSpeed, autoCapitalize, autocorrect, bilateralStimulation, theme, language, timezone, lastSessionMode, lastRelax*)
- **Google Secret Manager** — `OPENAI_API_KEY` (chat + realtimeTokenApi + adminApi insights), `ELEVENLABS_API_KEY` (soundscapeApi)

### Auth

Firebase Authentication: Google Sign-In + Email/Password. `App.tsx` gates app behind auth. Cloud Functions verify ID tokens. Admin allowlist lives in `functions/src/shared/auth.ts` (backend) and `src/admin/isAdmin.ts` (frontend gate used by `App.tsx`).

### URL routing

SPA in `App.tsx` using `pushState`-based client-side routing (no router library). There is no diary route and no choice screen:

- `/` and `/new` — treated as a root visit: after init, redirect to today's **active** session if one exists (searched in the 20 most recent sessions, "today" per the user's configured timezone) else `/session/new`
- `/session/new` — new session; `SessionView` creates the doc with `mode: initialMode ?? settings.lastSessionMode`, then `replaceState`s the real id into the URL
- `/session/:id` — existing session (mode loaded from Firestore)
- `/admin` — admin dashboard (lazy-loaded, `isAdmin` gated)
- anything else → `/`

`navigateTo()` uses `history.pushState` + React state; `popstate` listener handles back/forward. First-run consent (Onboarding) is checked before routing; completing it navigates to `/session/new`.

### Session surfaces

`SessionSurface = 'talk' | 'journal' | 'speak' | 'relax'` (`SessionBottomBar.tsx`). Talk is always available; Speak shows only when `voiceEnabled === true`, Relax only when `relaxEnabled === true`. The Journal surface shows an "Inner voices" parts toggle when `partsEnabled !== false`; the per-session choice persists as `session.journalPartsEnabled`. The bottom bar also hosts the `◇ Real Talk` toggle.

- **Talk** — streamed therapist conversation (`useSessionStream`, TipTap input composer in `SessionView`). Therapist replies can carry tappable recommendation segments (`RecommendationSegments`).
- **Journal** — `SessionJournalSurface`: quiet TipTap page; when the parts toggle is on, the same `PauseDetector`/`PartOrchestrator` pipeline from the old diary responds on pause (`useJournalParts`, `PartThoughtBubble`, `ThinkingSpace` for multi-turn). Parts are hard-silenced during grounding.
- **Speak** — live voice. `useSessionVoice` builds the therapist system prompt as Realtime instructions; `realtimeTokenApi` pins `gpt-realtime-2`, default voice `marin`, speed 0.88, semantic VAD eagerness `low`, transcription `gpt-realtime-whisper`. WebRTC goes browser → OpenAI directly (hence `api.openai.com` in CSP `connect-src`).
- **Relax** — breathwork/body-scan/safe-place/open-awareness (`RelaxSessionType`), breath circle paced by `relaxEngine` (adaptive to measured respiratory rate, 5% lead, floored at the session target), preset soundscapes + custom ElevenLabs soundscapes (`customSoundscapesEnabled`), optional passive-mode voice guidance. Writes `relaxSessions`.

### Feature flags

6 core flags (default enabled, `!== false`): `partsEnabled`, `visualEffectsEnabled`, `autocorrectEnabled`, `paragraphFade`, `inkWeight`, `breathingBackground`.
23 experimental flags (default disabled, `=== true`) across: Atmosphere, Part Intelligence, Memory/Engagement, Safety, Biometric (`webcamHrv`, `polarH10`), Voice (`voiceEnabled`), Relax (`relaxEnabled`, `customSoundscapesEnabled`). `colorBleed` no longer exists.

Full list + settings cascade + tuning params: `.claude/docs/feature-flags.md`

### Admin dashboard

At `/admin` for admins only. Lazy-loaded. 6 tabs (Overview, Users, Analytics, Messages, Insights, Settings), 11 API actions (`getOverview`, `getUserList`, `getUserDetail`, `getConfig`, `updateConfig`, `getAnalytics`, `refreshAnalytics`, `generateInsights`, `getSessionMessages`, `getContactMessages`, `getDiagnostics`). UserDetail has 11 tabs (entries, parts, conversations, thoughts, memories, profile, sessions, weather, letters, fossils, diagnostics). Details: `.claude/docs/admin.md`

**Data loading pattern.** All one-shot admin views fetch through `useAdminQuery<T>(action, params?)` in `src/admin/useAdminQuery.ts` — a generic race-protected hook that wraps `adminFetch`. Stable `paramsKey` (JSON-stringified) prevents fresh-object-literal churn from triggering refetches. Returns `{ data, error, loading, setData, setError }`. Specialized wrappers: `useAdminUser` (typed `getUserDetail`), `useAdminConfig` (the `appConfig/global` round-trip with save + signalUpdate + resetDefaults), `useAdminMutation` (event-driven writes). Lazy/event-driven fetches call `adminFetch` directly.

### Crisis safety

Two layers, both feeding `activateGrounding` → `isGrounding` in the next prompt build:

- **L1 — deterministic floor.** `sessionOrchestrator.checkCrisisKeywords`: synchronous regex over NFKC-normalized text. No LLM, no cooldown, no feature flag. Runs in `useSessionStream` **before** therapist generation so `isGrounding: true` can flow into the prompt.
- **L2 — LLM classifier.** Two shapes: in session mode it is folded into the therapist stream as a `<<RISK:N>>` preamble (parsed by `streamChatCompletion`'s `onRisk`; risk=2 arriving before the first token aborts the stream and retries grounded). In journal/parts mode, `classifyCrisisRisk` calls `/api/chat` with `task: 'crisis_check'`, routed server-side to `gpt-5-nano` with a strict JSON schema. Both fail open to risk 0 — L1 is the safety floor.

Calibration history matters: a previous classifier over-called (grief, metaphor, hyperbole, gallows humor all flagged). Current prompts/thresholds are tuned for precision, not recall — do not "improve" recall without reading the eval set (`crisisClassifier.eval.ts`, `npm run test:crisis`).

### Subsystems

Dark mode, adaptive parts, i18n (17 languages), emergency grounding, bundle splitting, session closing, autocorrect, body map, data export, HRV biofeedback (webcam + Polar H10), Relax — documented in `.claude/docs/subsystems.md`

### Real Talk mode (Session)

A tone variant of the therapist persona that names coping moves the writer is making — avoidance, externalization, intellectualization, rationalization, minimization, self-blame as shield, all-or-nothing thinking. Mantra: **not nice, but kind and constructive**.

**Architecture.** Real Talk is a *tone variant of the existing therapist prompt*, not a parallel pipeline. `buildTherapistSystemPrompt` accepts `mode?: 'standard' | 'real_talk'` and swaps only the persona core (`THERAPIST_CORE` ↔ `REAL_TALK_CORE`) and phase hint. All other context blocks (personalFacts, profile, memories, register tier, HRV, datetime, language directive, untrusted-content preamble, `SAFETY_RULES`) are reused unchanged. `REAL_TALK_CORE` includes a 7-item pattern taxonomy and explicit "label the move, never the writer" rules. Recommendation segments are suppressed in Real Talk (the calling-out persona does not soften by recommending).

**Crisis override (load-bearing invariant).** When `isGrounding === true`, `buildTherapistSystemPrompt` reverts to `THERAPIST_CORE` regardless of saved mode. Naming coping patterns is the wrong response to distress. The check is `useRealTalk = mode === 'real_talk' && !isGrounding`. Both the L1 keyword path and the async L2 paths flip `isGrounding` before the next prompt is built. Verified by `realTalkFlow.test.ts` and `therapistPrompts.test.ts`.

**Flow.** The old EntryChoice screen is gone. Real Talk is toggled *in-session* via the `◇ Real Talk` switch in `SessionBottomBar`. Toggling writes `session.mode` to Firestore and remembers the choice in `settings.lastSessionMode`, so future new sessions open in the last-used tone. Mode is never URL-encoded.

**Patterns leverage.** `UserProfile.avoidancePatterns` is populated by `sessionReflectionEngine` post-session; Real Talk benefits passively because those patterns surface in the existing "Patterns you have noticed" block of every prompt.

### HRV Biofeedback (Session Mode)

Heart rate variability monitoring with two interchangeable signal sources, both producing the same `HrvMeasurement` shape so downstream consumers (`HrvTimeline`, `BiometricsBar` in `HrvAmbientBar.tsx`, therapist prompt, Relax mode) are source-agnostic. Session mode only.

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

**Mutex.** H10 takes priority — when paired and streaming, webcam HRV is suppressed via a SessionView `useEffect` on `[polar.enabled, hrv.enabled, hrvStopAndFlush]`. The webcam toggle is hidden while H10 is connected. The reverse can't arise. Both paths feed prompt context through the `BiometricSource` bridge (`useSessionStream.ts`) so `useSessionStream` and `useSessionVoice` see whichever source is active.

#### Common: timeline, derived metrics, persistence

**Derived metrics from IBI series:** SDNN (overall HRV), pNN50 (parasympathetic index), LF/HF ratio (autonomic balance via FFT on IBI series), Baevsky Stress Index (histogram-based), cardiac coherence (HRV regularity). Same math regardless of source.

**Behavioral correlations:** Post-response physiological reaction (HR change after therapist speaks), per-message activation level (HR when user writes), session trajectory (calming vs escalating over time). All injected into therapist system prompt via `hrvContext` on `TherapistPromptOptions`.

**Persistence:** `HrvSessionData` written to `hrvSessions/{sessionId}` every 10s, carrying an optional `source: 'camera' | 'polarH10'` field. Webcam path includes `signalDumps` (raw RGB/CHROM/FFT for offline algo analysis); H10 path leaves `signalDumps: []` for now.

**Relax mode integration:** When polar is connected, `RelaxBreathCircle` follows the live chest motion (via the `chestScaleGetter` prop, smoothed with a 50ms time constant) instead of running its internal breath pacer.

### Analytics & tracking

Firebase Analytics events, Google Ads conversion tracking, Sentry error monitoring — documented in `.claude/docs/analytics.md`

### Environment variables

`.env.local` (git-ignored): `VITE_FIREBASE_*` (6 vars) + `VITE_SENTRY_DSN`. Build-time: `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`. All client-side vars are safe to expose.

## Testing

Vitest with jsdom. Tests cover: prompts (`therapistPrompts` incl. Real Talk persona swap + grounding override, `partPrompts`, `relaxPrompts`, `registerTiers`, `promptSafety`, `llmCorrect`, `annotationParser`, `therapistRecommendationParser`, `openrouter` incl. `<<RISK:N>>` handling), engines (`sessionOrchestrator` — phase detection, crisis keywords, emotion check; `realTalkFlow` end-to-end crisis override; `partOrchestrator`, `pauseDetector`, `sessionReflectionEngine`, `sessionContextLoader`, `closingEngine`, `relaxEngine`, `ritualEngine`, `bodyMapEngine`, `weatherEngine`, `partGrowthEngine`, `threadEngine`, `letterEngine`, `echoEngine`, `quoteEngine`, `disagreementEngine`, `quietTracker`, `emergenceEngine`, `voiceFieldColors`), HRV (`hrvSignalWorker`, `hrvEngine`, `hrvTimeline`, `polarH10Engine` — golden bytes, RR conversion, pure math, `feedSampleForTest`/`tickForTest`), components (`SessionView`, `SessionBottomBar`, `SessionJournalSurface`, `useJournalParts`, `useLoginFlow`), hooks via `renderHook` (`useSessionVoice`, `useSessionStream`, `useChatResponse`, `useAutocorrect`, `useGroundingMode`, `useTheme`, `useTypewriter`, `useAppendQueue`, `useModalA11y` — Escape/focus-trap/restore), utils (`contextPacker` token budgeting, `memoryPruner`, `voiceErrors` classifier), stores (`settings` — sparse-override persistence, `globalConfig`, `groundingState`), i18n (`translations` + key parity — every locale has every English key), admin (`isAdmin`, `useAdminQuery`, `useAdminConfig` save round-trip + key allowlist, `useAdminMutation`, `useAdminUser`), services (`diagnostics`), types (`session`). Functions-side: `index.test.ts`, `admin/handlers.test.ts`, `admin/analytics.test.ts`, `account.test.ts` (zero-residue/idempotent/tombstone deletion), `shared/quota.test.ts` (cap resolution, UTC period rollover, reservation decision), `soundscape/normalize.test.ts`, `soundscape/provider.test.ts`, `soundscape/cache.claim.test.ts` (generation-claim dedup). The live crisis eval (`crisisClassifier.live.test.ts`) only runs under `npm run test:crisis`.

```bash
npm run test             # Run all tests
npm run test:watch       # Watch mode
npm run test:indexes     # Integration tests against Firestore emulator
npm run smoke-test       # Post-deploy smoke test against live site
```

## Code Conventions

- **TypeScript strict mode** — no `any`, use `import type {}` for type-only imports
- **Tailwind CSS v4** — `@tailwindcss/vite` plugin, `@import "tailwindcss"` in CSS
- **TipTap v3** — editor.storage types via `@tiptap/core` module augmentation in `src/types/tiptap.d.ts`
- **No semicolons**, **single quotes**
- **Functional components** — class components only for ErrorBoundary
- **`useMemo` over `useEffect+setState`** for derived state
- **Reactive stores** — `useSettings()` / `useGlobalConfig()` via `useSyncExternalStore`; `getSettings()` / `getGlobalConfig()` for non-React
- **Colors via CSS variables** — never hardcode hex for themed colors; inline styles use `var(--bg-primary)` etc.
- **Admin components** — inline styles, warm muted palette, light-only

## Common Tasks

### Changing the chat model

The model is pinned server-side. Update `OPENAI_CHAT_MODEL` in `functions/src/shared/models.ts` (crisis model: `OPENAI_CRISIS_MODEL` in `functions/src/chat.ts`; realtime model: `REALTIME_MODEL` in `functions/src/realtime.ts`), then `cd functions && npx tsc && cd .. && firebase deploy --only functions`. The client never sends a model field.

### Updating API keys

```bash
echo "sk-..." | firebase functions:secrets:set OPENAI_API_KEY
echo "..."    | firebase functions:secrets:set ELEVENLABS_API_KEY
cd functions && npx tsc && cd .. && firebase deploy --only functions
```

### Adding a new seeded part

Add to `SEEDED_PARTS` in `partPrompts.ts` (currently 7: Watcher, Tender, Still, Spark, Weaver, Open, Quiet One). Scoring is role-based (`ifsRole`) — no orchestrator changes needed.

### Adding a new Firestore collection

1. Add proxy in `db.ts` (add to the `db` object literal)
2. Add interface in `src/types/index.ts`
3. Add `'collectionName'` to `collectionNames` in `exportAllData()` in `src/store/dataExport.ts`
4. Add to the `collections` array in `handleDeleteAccount` in `functions/src/account.ts`

### Toggling features without deploying

`undersurface.me/admin` → Settings. Changes propagate in real-time via `onSnapshot`.

## Infrastructure

| Service | URL |
|---------|-----|
| Firebase | [console.firebase.google.com/project/undersurfaceme](https://console.firebase.google.com/project/undersurfaceme/overview) |
| Firestore | [console.firebase.google.com/.../firestore](https://console.firebase.google.com/project/undersurfaceme/firestore) |
| Functions | [console.firebase.google.com/.../functions](https://console.firebase.google.com/project/undersurfaceme/functions) |
| Hosting | [console.firebase.google.com/.../hosting](https://console.firebase.google.com/project/undersurfaceme/hosting/sites/undersurfaceme) |
| Auth | [console.firebase.google.com/.../authentication](https://console.firebase.google.com/project/undersurfaceme/authentication/users) |
| DNS | [dash.cloudflare.com](https://dash.cloudflare.com) → undersurface.me |
| GitHub | [github.com/zohoora/undersurface](https://github.com/zohoora/undersurface) (private) |

## Known Gotchas

### Firebase & Infrastructure
- **Cloudflare DNS proxy must be OFF** (gray cloud) for Firebase Hosting A record — breaks SSL
- **Cloud Function streaming** requires `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`
- **Firebase offline persistence** — `persistentLocalCache` + `persistentMultipleTabManager` must init before any Firestore calls
- **`chat` function `minInstances: 1`** requires `firebase deploy --force`
- **Analytics `refreshAnalytics`** iterates all users + their subcollections — needs optimization at scale
- **CSP headers in `firebase.json`** — when adding new external scripts/connections/images, must update the Content-Security-Policy header. Firebase Auth needs `apis.google.com`; Google Ads needs `googleads.g.doubleclick.net` / `googleadservices.com`; Realtime voice needs `api.openai.com` in `connect-src`; ElevenLabs needs `api.elevenlabs.io`; MediaPipe needs `cdn.jsdelivr.net` (script/connect) + `storage.googleapis.com` (media). CSP violations show in browser console as "violates Content Security Policy directive"
- **`authDomain` must be `undersurfaceme.firebaseapp.com`** — do NOT change to custom domain without also adding `https://undersurface.me/__/auth/handler` as an authorized redirect URI in Google Cloud Console OAuth settings. Third-party cookie blocking can break `signInWithPopup` on some browsers
- **Permissions-Policy** — `camera=(self)` (webcam HRV) and `microphone=(self)` (Speak surface) are enabled; `geolocation=()` remains blocked

### React & Editor
- **Refs in setState callbacks** — capture ref values before calling setState (React batches updates)
- **Part colorLight alpha** — `'25'` in light, `'30'` in dark (via `boostAlpha` in `src/utils/color.ts`). Without boost, invisible on dark

### Engines & Logic
- **Orchestrator pre-warms caches** — `loadParts()` fetches profile + summaries + memories upfront
- **Session closing** — hardcoded The Weaver prompt in `closingEngine.ts`, not part ID lookup
- **L1 crisis check must run before LLM generation** — `checkCrisisKeywords()` is synchronous and activates grounding before therapist generation so `isGrounding: true` flows into the prompt (`useSessionStream`). Async L2 alone is too late
- **`<<RISK:N>>` preamble must be stripped at every egress** — the session-mode L2 signal rides the therapist stream. `openrouter.ts` anchors the pattern to the stream start and scrubs mangled markers at fail-open flush; a leak shipped 2026-06-12 when the pattern required a trailing newline the model didn't emit. Fail-open is deliberate: L1 is the deterministic floor
- **Crisis classifier is tuned for precision, not recall** — a prior classifier over-called on grief/metaphor/hyperbole/gallows humor. Don't widen thresholds without running `npm run test:crisis` against the eval set
- **Real Talk grounding override is non-negotiable** — `buildTherapistSystemPrompt` checks `useRealTalk = mode === 'real_talk' && !isGrounding`. Distress disables Real Talk, no exceptions. Anyone editing the prompt builder must preserve this single guard line. Both branches still embed `SAFETY_RULES` verbatim. Verified by tests in `therapistPrompts.test.ts` and `realTalkFlow.test.ts` — do not delete those tests when refactoring
- **Journal parts are triple-gated** — `SessionJournalSurface` requires the per-session toggle AND `!isGrounding` AND global `partsEnabled`. Parts silence during distress, mirroring the Real Talk override
- **Sidebar lists sessions only** — `EntriesList.tsx` maps `db.sessions` into `SidebarItem`s (preview from `sessionNote`/`firstLine`, favorites, search). Diary entries no longer appear anywhere in the UI
- **`entries` is a legacy collection** — nothing writes it. `echoEngine`/`quoteEngine`/`sessionReflectionEngine` and the MCP `list-entries`/`get-entry` tools still read old data. Keep it in export/delete paths

### i18n
- **`t()` shadows loop variables** — in `dataExport.ts` (which imports `t`), use different names (e.g., `th` not `t`)
- **Emotion analysis returns English** — validation is against an English emotion list; UI translates
- **`languageDirective()` not in reflection/growth** — internal prompts stay English

### Settings & Config
- **Feature flags** — core use `=== false`, experimental use `=== true`. `getGlobalConfig()` returns `null` before first admin save
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
- **Mutex with webcam HRV** — H10 takes priority. SessionView's `useEffect([polar.enabled, hrv.enabled, hrvStopAndFlush])` stops the camera when polar starts streaming. Webcam toggle is hidden while H10 is active so the reverse can't arise
- **`getBreathingScale` is a stable `useCallback`** — animations poll it inside their own rAF loops without re-rendering React. Returns `null` when PMD isn't active so the consumer can fall back to its internal pacer (Relax does this)
- **Polar `respiratoryRate` may be null even when H10 is paired** — bandpass needs ~5s to settle, envelope needs ~15s to converge, and the rate requires ≥2 zero-crossings (~one full breath cycle). Expect a 30–60s warmup before the rate populates

### Realtime voice
- **Reasoning models budget hidden reasoning + visible output together** — on gpt-5.x, `max_completion_tokens` covers BOTH. gpt-5.5 burns 1k–3k reasoning tokens before emitting output; too-tight caps return empty content with `finish_reason='length'`. The chat function caps at 4000; the crisis route uses `reasoning_effort='minimal'` + 500
- **Realtime tempo is deliberately slow** — `speed: 0.88`, semantic VAD eagerness `low` (8s max timeout). `medium`/`high` feel rushed for the therapy register
- **Relax voice guidance is `passive: true`** — recvonly transceiver, no `getUserMedia`, no mic prompt

### PWA & Build
- **PWA API calls not cached** — go through Firebase rewrites
- **Sentry source maps** read `process.env` (not `import.meta.env`), disabled without `SENTRY_AUTH_TOKEN`
- **Autocorrect** uses LLM-based sentence correction (`src/ai/llmCorrect.ts`, wired via `useAutocorrect` into the session composer/journal) — works in all languages with sentence-ending punctuation (CJK fullwidth, Hindi danda); Thai silently skipped (no standard sentence punctuation)
- **Capacitor native builds call the prod origin** — `src/api/apiBase.ts` prefixes `/api/*` with `https://undersurface.me` on native platforms. Mobile shipping is on the roadmap; do not remove `@capacitor/*` deps even when audits flag them
- **Type-check with `npx tsc -b --force`, NOT `tsc --noEmit -p tsconfig.json`.** `tsconfig.json` is a *solution* file (`"files": []` + references to `tsconfig.app.json` / `tsconfig.node.json`), so `tsc --noEmit -p tsconfig.json` type-checks **zero files** and always "passes" — a silent false green that let a real `TS2367` ship to prod once. The authoritative gate is `npx tsc -b --force` (the `--force` bypasses the `.tsbuildinfo` cache, which can otherwise mask errors in unchanged files). Vite/esbuild emits the JS bundle regardless of TS errors, so a "successful" `npm run build` is NOT proof of type-safety — run `tsc -b --force` explicitly before committing/deploying anything non-trivial.
- **Major dep upgrades** (TS 6, ESLint 10, Vite 8, @vitejs/plugin-react 6, @sentry/vite-plugin 5) are all blocked by `typescript-eslint@8`'s peer dep `typescript@<6.0.0`. Re-attempt once `typescript-eslint@9` ships.
