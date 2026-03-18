# CLAUDE.md — UnderSurface

## What is this project?

A diary app where AI inner voices encourage and guide the user's writing. The user types in a rich text editor; when they pause, slow down, or trail off, an AI "part" speaks on the page — nudging them to go deeper, keep going, or find what they haven't said yet. Live at [undersurface.me](https://undersurface.me).

## Quick Reference

```bash
npm run dev              # Dev server → localhost:5173
npm run build            # Production build → dist/
npm run lint             # ESLint (flat config)
npm run test             # Vitest
npm run preview          # Preview production build locally
npm run test:indexes     # Run Firestore index tests (requires emulator)
npm run smoke-test       # Post-deploy smoke test against live site
```

## CI/CD

`.github/workflows/ci.yml` runs on push/PR to main: type-check (frontend + functions), lint, test, build. Uses Node 22 and dummy `VITE_FIREBASE_*` env vars (Firebase config is public, only needed at runtime).

## Deploying Changes

The app runs on Firebase. Three deployable units:

### 1. Frontend (Firebase Hosting + PWA)

```bash
npm run build && firebase deploy --only hosting
```

### 2. Cloud Functions (Firebase Functions, Node.js 22)

Four functions in `functions/src/index.ts`:
- **`chat`** — proxies AI requests to OpenRouter (512MiB, minInstances: 1)
- **`accountApi`** — account deletion + contact form (256MiB, 60s)
- **`adminApi`** — admin dashboard backend (512MiB, 120s)
- **`mcpApi`** — MCP server with 4 read-only tools (512MiB, 120s)

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
AI responses:
  User types → PauseDetector → PartOrchestrator → openrouter.ts
    → fetch('/api/chat', { auth token }) → Cloud Function (chat)
    → verifies token → Secret Manager API key → OpenRouter → streams SSE back

Admin:  /admin → ADMIN_EMAILS check → adminApi Cloud Function → Admin SDK
Account: Settings → accountApi Cloud Function → delete/contact
```

### Key files

Detailed file-by-file reference: `.claude/docs/key-files.md`

Core entry points: `src/ai/openrouter.ts` (API calls), `src/ai/partPrompts.ts` (system prompts + `SHARED_INSTRUCTIONS`), `src/ai/sessionPrompts.ts` (session mode part prompts), `src/ai/therapistPrompts.ts` (therapist companion prompts), `src/engine/partOrchestrator.ts` (part selection + scoring), `src/engine/sessionOrchestrator.ts` (session phase detection + crisis keywords + emotion check), `src/engine/pauseDetector.ts` (pause detection), `src/engine/hrvEngine.ts` (webcam HRV biofeedback), `src/engine/hrvSignalWorker.ts` (CHROM rPPG signal processing Web Worker), `src/engine/hrvTimeline.ts` (HRV timeline + shift detection + prompt context), `src/components/Editor/LivingEditor.tsx` (TipTap editor), `src/components/Session/SessionView.tsx` (session/conversation mode UI), `src/store/db.ts` (Firestore wrapper), `functions/src/index.ts` (Cloud Functions).

### Data storage

- **Firestore** `users/{uid}/` — 14 subcollections: entries, parts, memories, thoughts, interactions, entrySummaries, userProfile, fossils, letters, sessionLog, innerWeather, consent, apiKeys, hrvSessions
- **Firestore** `appConfig/global` — readable by all authenticated, writable only via adminApi
- **Firestore** `contactMessages` — top-level, deny-all in client rules, written/read via Cloud Functions
- **localStorage** — device settings (theme, model, visual effects, speed, language)
- **Google Secret Manager** — `OPENROUTER_API_KEY`

### Auth

Firebase Authentication: Google Sign-In + Email/Password. `App.tsx` gates app behind auth. Cloud Functions verify ID tokens. `adminApi` checks `ADMIN_EMAILS` allowlist (in `functions/src/index.ts` and `src/App.tsx`).

### URL routing

SPA in `App.tsx` using `pushState`-based client-side routing (no router library): `/` → diary, `/session/:id` → session view, `/admin` → admin dashboard (lazy-loaded), anything else → `/`. `navigateTo()` callback uses `history.pushState` + React state; `popstate` listener handles back/forward.

### Feature flags

7 core flags (default enabled, `!== false`): `partsEnabled`, `visualEffectsEnabled`, `autocorrectEnabled`, `paragraphFade`, `inkWeight`, `colorBleed`, `breathingBackground`.
25 experimental flags (default disabled, `=== true`) across 6 categories: Atmosphere, Part Intelligence, Memory/Engagement, Text Interaction, Safety & Guidance, Biometric (`webcamHrv`).

Full list + settings cascade + tuning params: `.claude/docs/feature-flags.md`

### Admin dashboard

At `/admin` for admins only. Lazy-loaded. 6 tabs, 9 API actions. Overview shows live user count + cached rich metrics (writing habits, emotional landscape, feature adoption). Users table is sortable (9 columns). UserDetail has 8 tabs covering all 12 Firestore subcollections. Details: `.claude/docs/admin.md`

### Subsystems

Dark mode, adaptive parts, i18n (17 languages), emergency grounding, bundle splitting, intentions, explorations, session closing, autocorrect, body map, data export, webcam HRV biofeedback — all documented in `.claude/docs/subsystems.md`

### HRV Biofeedback (Session Mode)

Webcam-based heart rate variability monitoring using remote photoplethysmography (rPPG). Session mode only, gated behind `webcamHrv` feature flag + explicit camera consent.

**Pipeline:** Camera (max resolution) → main thread extracts RGB from face ROI → Web Worker runs CHROM algorithm (chrominance-based pulse extraction) → FFT for heart rate → temporal smoothing → `HrvMeasurement` emitted every 5s.

**Key components:** `hrvEngine.ts` (camera + face detection + frame capture), `hrvSignalWorker.ts` (CHROM + FFT + peak detection in Web Worker), `hrvTimeline.ts` (shift detection + message correlation + prompt context builder), `HrvAmbientBar.tsx` (fixed-position data bar with face thumbnail + HRV trace), `HrvConsentDialog.tsx` (one-time consent).

**Data flow:** HRV context injected into therapist system prompt via `hrvContext` field on `TherapistPromptOptions`. Full measurement log persisted to `hrvSessions/{sessionId}` in Firestore.

**Face detection:** Uses Chrome's `FaceDetector` API (Shape Detection) with EMA-smoothed ROI tracking. Falls back to center-of-frame if unavailable.

### Analytics & tracking

21 Firebase Analytics events, Google Ads conversion tracking, Sentry error monitoring — all documented in `.claude/docs/analytics.md`

### Environment variables

`.env.local` (git-ignored): `VITE_FIREBASE_*` (6 vars) + `VITE_SENTRY_DSN`. Build-time: `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`. All client-side vars are safe to expose.

## Testing

Vitest (~404 tests, 17 test files). Tests cover: `llmCorrect` (sentence extraction, CJK/Hindi/Thai, trigger logic, correction validation), `annotationParser` (parsing, ghost capitalization, delimiter), `bodyMapEngine` (emotion-to-color mapping, homunculus state computation), `ritualEngine`, `pauseDetector`, `partOrchestrator`, `weatherEngine`, `settings`, `sessionOrchestrator` (phase detection, crisis keywords, emotion check, grounding activation), `sessionReflectionEngine`, `sessionPrompts`, `therapistPrompts`, `SessionView`, `hrvSignalWorker` (CHROM extraction, FFT, bandpass filter, peak detection), `hrvTimeline` (shift detection, prompt context builder), `promptSafety`.

```bash
npm run test             # Run all tests
npm run test -- --watch  # Watch mode
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

### Changing the default AI model

**Via admin** (no redeploy): `undersurface.me/admin` → Settings → "Default Model".
**Via code**: update `DEFAULTS.openRouterModel` in `settings.ts`, `getModel()` in `openrouter.ts`, `model ||` in `functions/src/index.ts`. Deploy both.

### Updating the OpenRouter API key

```bash
echo "sk-or-v1-new-key" | firebase functions:secrets:set OPENROUTER_API_KEY
cd functions && npx tsc && cd .. && firebase deploy --only functions
```

### Adding a new seeded part

Add to `SEEDED_PARTS` in `partPrompts.ts`. Scoring is role-based (`ifsRole`) — no orchestrator changes needed.

### Adding a new Firestore collection

1. Add proxy in `db.ts` (add to the `db` object literal)
2. Add interface in `src/types/index.ts`
3. Add `'collectionName'` to `collectionNames` array in `exportAllData()` in `db.ts`
4. Add to `deleteAccount` collections array in `functions/src/index.ts`

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
- **Analytics `refreshAnalytics`** iterates all users + their subcollections (sessions, weather, parts, profiles, letters, fossils) — needs optimization at scale
- **CSP headers in `firebase.json`** — when adding new external scripts/connections/images, must update the Content-Security-Policy header. Google Ads and Firebase Auth both require specific CSP entries (`apis.google.com` for auth, `googleads.g.doubleclick.net` / `googleadservices.com` for ads). CSP violations show in browser console as "violates Content Security Policy directive"
- **`authDomain` must be `undersurfaceme.firebaseapp.com`** — do NOT change to custom domain without also adding `https://undersurface.me/__/auth/handler` as an authorized redirect URI in Google Cloud Console OAuth settings. Third-party cookie blocking can break `signInWithPopup` on some browsers
- **Permissions-Policy** — `camera=(self)` is enabled for HRV biofeedback. `microphone=()` and `geolocation=()` remain blocked

### React & Editor
- **Refs in setState callbacks** — capture ref values before calling setState (React batches updates)
- **Color bleed + dark mode** — must return `DecorationSet.empty` when disabled, not map existing decorations
- **Part colorLight alpha** — `'25'` in light, `'30'` in dark (via `boostAlpha`). Without boost, invisible on dark

### Engines & Logic
- **Orchestrator pre-warms caches** — `loadParts()` fetches profile + summaries + memories upfront
- **Exploration engine single-shot** — `hasSuggested` guard; must call `reset()` on entry switch
- **Session closing** — hardcoded The Weaver prompt, not part ID lookup
- **Crisis keyword check must run before LLM generation** — `checkCrisisKeywords()` is synchronous and activates grounding before `generateTherapistMessage()` so `isGrounding: true` flows into the prompt. Async emotion check alone is too late
- **Session sidebar is unified** — entries and sessions in one chronological list via `SidebarItem` discriminated union in `EntriesList.tsx`. No separate sections

### i18n
- **`t()` shadows loop variables** — in `db.ts`, use different names (e.g., `th` not `t`)
- **Emotion analysis returns English** — `isValidEmotion()` is English-based; UI translates
- **`languageDirective()` not in reflection/growth** — internal prompts stay English

### Settings & Config
- **`typewriterScroll` is admin-controlled** — in `ADMIN_CONTROLLED_KEYS`, localStorage stripped
- **Feature flags** — core use `=== false`, experimental use `=== true`. `getGlobalConfig()` returns `null` before first admin save
- **Grounding suppresses intention** in prompts — intentional during distress

### HRV / Biometric
- **Face detection requires Chrome 94+** — uses `FaceDetector` API (Shape Detection). Falls back to center-of-frame ROI if unavailable. Can be enabled via `chrome://flags/#enable-experimental-web-platform-features` on older Chrome
- **Camera resolution** — requests `ideal: 1920x1080` but main thread only reads the face ROI pixels (not full frame) to minimize data transfer to worker
- **CHROM signal quality** — rPPG accuracy depends heavily on lighting, stillness, and face visibility. RMSSD values of 200+ ms indicate noise (real RMSSD is 20-80 ms). HR accuracy is ±15-20 BPM compared to medical devices
- **Face ROI smoothing** — EMA with alpha=0.35 prevents green channel step-changes from ROI jitter. Too low = sluggish tracking. Too high = signal noise from position jumps
- **FFT range restricted to 0.7-2.5 Hz** (42-150 BPM) to avoid 2nd harmonic detection (e.g., 170 BPM when actual is 85 BPM)
- **HR temporal smoothing** — confidence-weighted EMA + outlier rejection (>30% from median replaced). Raw FFT HR can jump wildly; smoothed output is shown to user

### PWA & Build
- **PWA API calls not cached** — go through Firebase rewrites
- **Sentry source maps** read `process.env` (not `import.meta.env`), disabled without `SENTRY_AUTH_TOKEN`
- **Autocorrect** uses LLM-based sentence correction (`src/ai/llmCorrect.ts`) — works in all languages with sentence-ending punctuation (CJK fullwidth, Hindi danda); Thai silently skipped (no standard sentence punctuation)
