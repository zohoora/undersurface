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

Core entry points: `src/ai/openrouter.ts` (API calls), `src/ai/partPrompts.ts` (system prompts + `SHARED_INSTRUCTIONS`), `src/ai/sessionPrompts.ts` (session mode part prompts), `src/ai/therapistPrompts.ts` (therapist companion prompts + shared `SAFETY_RULES`), `src/ai/futureSelfPrompts.ts` (Future Self persona prompts), `src/engine/partOrchestrator.ts` (part selection + scoring), `src/engine/sessionOrchestrator.ts` (session phase detection + crisis keywords + emotion check), `src/engine/pauseDetector.ts` (pause detection), `src/engine/sessionContextLoader.ts` (`loadTherapistContext` + `loadFutureSelfContext` with voice excerpts), `src/engine/hrvEngine.ts` (webcam HRV biofeedback), `src/engine/hrvSignalWorker.ts` (CHROM rPPG signal processing Web Worker), `src/engine/hrvTimeline.ts` (HRV timeline + shift detection + prompt context), `src/hooks/useFutureSelfUnlock.ts` (Future Self unlock gating), `src/components/Editor/LivingEditor.tsx` (TipTap editor), `src/components/Session/SessionView.tsx` (session UI — shared across Therapist and Future Self modes via `mode` prop), `src/components/EntryChoice.tsx` (3-way choice screen with Future Self lock state), `src/store/db.ts` (Firestore wrapper), `functions/src/index.ts` (Cloud Functions).

### Data storage

- **Firestore** `users/{uid}/` — 14 subcollections: entries, parts, memories, thoughts, interactions, entrySummaries, userProfile, fossils, letters, sessionLog, innerWeather, consent, apiKeys, hrvSessions
- **Firestore** `appConfig/global` — readable by all authenticated, writable only via adminApi
- **Firestore** `contactMessages` — top-level, deny-all in client rules, written/read via Cloud Functions
- **localStorage** — device settings (theme, model, visual effects, speed, language)
- **Google Secret Manager** — `OPENROUTER_API_KEY`

### Auth

Firebase Authentication: Google Sign-In + Email/Password. `App.tsx` gates app behind auth. Cloud Functions verify ID tokens. `adminApi` checks `ADMIN_EMAILS` allowlist (in `functions/src/index.ts` and `src/App.tsx`).

### URL routing

SPA in `App.tsx` using `pushState`-based client-side routing (no router library): `/` → diary, `/new` → 3-way choice screen, `/session/:id` → therapist session, `/future-self/:id` → Future Self session, `/admin` → admin dashboard (lazy-loaded), anything else → `/`. `navigateTo()` callback uses `history.pushState` + React state; `popstate` listener handles back/forward.

### Feature flags

7 core flags (default enabled, `!== false`): `partsEnabled`, `visualEffectsEnabled`, `autocorrectEnabled`, `paragraphFade`, `inkWeight`, `colorBleed`, `breathingBackground`.
25 experimental flags (default disabled, `=== true`) across 6 categories: Atmosphere, Part Intelligence, Memory/Engagement, Text Interaction, Safety & Guidance, Biometric (`webcamHrv`).

Full list + settings cascade + tuning params: `.claude/docs/feature-flags.md`

### Admin dashboard

At `/admin` for admins only. Lazy-loaded. 6 tabs, 9 API actions. Overview shows live user count + cached rich metrics (writing habits, emotional landscape, feature adoption). Users table is sortable (9 columns). UserDetail has 8 tabs covering all 12 Firestore subcollections. Details: `.claude/docs/admin.md`

### Subsystems

Dark mode, adaptive parts, i18n (17 languages), emergency grounding, bundle splitting, intentions, explorations, session closing, autocorrect, body map, data export, webcam HRV biofeedback — all documented in `.claude/docs/subsystems.md`

### Future Self Mode (third session mode)

A third conversational mode where the AI plays the user's own future self — warmer, slower to judge, more curious — speaking in the user's own voice. Gated behind `futureSelfEnabled` feature flag + two admin-tunable thresholds. Reuses the existing session infrastructure via a `mode?: 'therapist' | 'futureSelf'` field on the `Session` type.

**Gating:** `useFutureSelfUnlock()` hook checks the feature flag and compares entry/session counts against `futureSelf.minEntries` (default 15) and `futureSelf.minSessions` (default 3) from `appConfig/global`. Both thresholds set to 0 = force-unlock (admin testing). Only "real" entries (non-empty `plainText`) and "real" sessions (≥2 messages) count toward progress.

**Voice mimicry:** `loadFutureSelfContext()` extends `loadTherapistContext()` with a `voiceExcerpts` pack — 5–8 short sentences sampled from the user's own recent entries, scored by first-person/emotional-marker density and deduplicated by 6-word prefix. These are injected into the prompt as "How you write (your own words)" so the AI mirrors the writer's rhythm and diction.

**Prompt composition:** `buildFutureSelfSystemPrompt()` mirrors `buildTherapistSystemPrompt()` but swaps the persona block (ambiguous "somewhere further on" time framing — no fixed years). The `SAFETY_RULES` block is exported from `therapistPrompts.ts` and used verbatim in both files — never paraphrased — so both personas share one authoritative safety directive.

**Crisis handling:** When `isGrounding` is true, the Future Self persona is *entirely dropped*. The prompt collapses to a plain grounding voice + SAFETY block. This preserves the existing `sessionOrchestrator.checkCrisisKeywords()` → `activateGrounding()` path unchanged and prevents the persona from inadvertently validating harmful ideation through "healed future" framing.

**UI:** Third card on `/new` choice screen (alongside Journal and Conversation). Rendered with purple drift glow (`future-glow` class). Locked state greys to 0.55 opacity with lock glyph + progress line ("12 / 15 entries · 2 / 3 sessions"). Click-while-locked opens a modal explanation. Sidebar distinguishes Future Self sessions with a concentric-circle icon instead of the chat-bubble.

**i18n:** All 17 languages have `choice.futureSelf.*` keys (title, tagline, desc, aria, locked.aria/progress/hint/dismiss) + `futureSelf.sessionHeader`.

**Admin:** `AdminSettings.tsx` "Future Self Mode" collapsible section exposes the feature flag, both thresholds (0–60 entries, 0–20 sessions), and voice excerpt count (3–15).

### HRV Biofeedback (Session Mode)

Webcam-based heart rate variability monitoring using remote photoplethysmography (rPPG). Session mode only, gated behind `webcamHrv` feature flag + explicit camera consent.

**Pipeline:** Camera (max resolution, 60fps) → main thread extracts RGB from skin-colored pixels in center 60% of frame (3 sub-regions: forehead + left/right cheeks) → Web Worker runs windowed CHROM algorithm (1.6s windows, 50% overlap, Hann OLA) → 4th-order Butterworth bandpass (1.2-2.5 Hz) → FFT with parabolic interpolation → confidence-weighted EMA smoothing → `HrvMeasurement` emitted every 5s.

**Derived metrics from IBI series:** SDNN (overall HRV), pNN50 (parasympathetic index), LF/HF ratio (autonomic balance via FFT on IBI series), Baevsky Stress Index (histogram-based), cardiac coherence (HRV regularity).

**Behavioral correlations:** Post-response physiological reaction (HR change after therapist speaks), per-message activation level (HR when user writes), session trajectory (calming vs escalating over time). All injected into therapist system prompt.

**Key components:** `hrvEngine.ts` (camera + frame capture + skin filtering), `hrvSignalWorker.ts` (CHROM + FFT + derived metrics in Web Worker), `hrvTimeline.ts` (shift detection + behavioral correlations + prompt context builder), `HrvAmbientBar.tsx` (fixed-position data bar with HRV trace + metrics), `HrvConsentDialog.tsx` (one-time consent).

**Data flow:** HRV context injected into therapist system prompt via `hrvContext` field on `TherapistPromptOptions`. Full measurement log + signal dumps persisted to `hrvSessions/{sessionId}` in Firestore every 10s.

**Signal processing:** Skin color filtering (R>G>B heuristic) replaces face detection for ROI — wider coverage, no jitter. Camera auto-exposure/white-balance locked to manual. Multi-ROI (forehead + cheeks) with confidence-weighted merge. Respiratory rate via 0.15-0.45 Hz bandpass on same CHROM signal.

### Analytics & tracking

21 Firebase Analytics events, Google Ads conversion tracking, Sentry error monitoring — all documented in `.claude/docs/analytics.md`

### Environment variables

`.env.local` (git-ignored): `VITE_FIREBASE_*` (6 vars) + `VITE_SENTRY_DSN`. Build-time: `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`. All client-side vars are safe to expose.

## Testing

Vitest (~432 tests, 20 test files). Tests cover: `llmCorrect` (sentence extraction, CJK/Hindi/Thai, trigger logic, correction validation), `annotationParser` (parsing, ghost capitalization, delimiter), `bodyMapEngine` (emotion-to-color mapping, homunculus state computation), `ritualEngine`, `pauseDetector`, `partOrchestrator`, `weatherEngine`, `settings`, `sessionOrchestrator` (phase detection, crisis keywords, emotion check, grounding activation), `sessionReflectionEngine`, `sessionPrompts`, `therapistPrompts`, `futureSelfPrompts` (persona, voice excerpts, grounding override, SAFETY block presence, sanitization), `useFutureSelfUnlock` (threshold logic, force-unlock, empty-entry filtering), `SessionView`, `hrvSignalWorker` (CHROM extraction, FFT, bandpass filter, peak detection), `hrvTimeline` (shift detection, prompt context builder), `promptSafety`.

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
- **Skin color filtering replaces face detection** — R>G>B heuristic on center 60% of frame outperforms FaceDetector API. Face detection's tight bounding box + ROI jitter degraded signal quality. Skin filter provides wider stable coverage
- **Camera resolution** — requests `ideal: 1920x1080` but main thread only reads skin pixels from 3 sub-regions (forehead, left cheek, right cheek), sending just RGB averages to worker
- **Camera auto-exposure must be locked** — auto-exposure creates 0.5-1.1 Hz color drift that is 50-100x stronger than the cardiac signal. Engine locks `exposureMode` and `whiteBalanceMode` to manual via `applyConstraints`
- **60fps required** — 30fps causes fluorescent light flicker (at harmonics of 60 Hz grid) to alias into the cardiac frequency range. 60fps prevents this aliasing
- **CHROM windowed processing** — 1.6s windows with 50% overlap and Hann overlap-add (per rPPG-Toolbox reference). Per-window alpha adapts to lighting changes. Single-window CHROM over the full buffer produces worse results
- **4th-order highpass at 1.2 Hz** — 2 cascaded Butterworth stages. Environmental noise dominates 0.5-1.1 Hz; the cardiac signal at 1.5+ Hz is 50-100x weaker without aggressive filtering. Restricts detection to 72-150 BPM (safe for seated users)
- **RMSSD > 200ms is noise** — real RMSSD is 20-80 ms. Values above 200ms indicate noisy IBI detection; reported as 0
- **HR temporal smoothing** — confidence-weighted EMA (alpha scales 0.05-0.50 with FFT confidence) + outlier rejection (>30% from median replaced). Takes ~30s to converge from initial reading
- **HR accuracy** — within ±5-15 BPM of Apple Watch in ambient lighting. Accuracy depends on lighting stability, stillness, and skin visibility. Direct/diffuse light best; fluorescent worst
- **Signal dumps saved every 10s** — full RGB buffers, CHROM pulse, FFT spectrum, IBIs saved to Firestore for offline algorithm analysis. Trimmed to last 10 dumps + 5s RGB to stay under 1MB doc limit
- **Derived metrics** — SDNN, pNN50, LF/HF ratio, Baevsky Stress Index, cardiac coherence computed from IBI series. LF/HF uses 4 Hz interpolated IBI series + FFT
- **Behavioral correlations** — post-response HR change, per-message activation, session trajectory (calming vs escalating) computed from HRV timeline events and injected into therapist prompt

### PWA & Build
- **PWA API calls not cached** — go through Firebase rewrites
- **Sentry source maps** read `process.env` (not `import.meta.env`), disabled without `SENTRY_AUTH_TOKEN`
- **Autocorrect** uses LLM-based sentence correction (`src/ai/llmCorrect.ts`) — works in all languages with sentence-ending punctuation (CJK fullwidth, Hindi danda); Thai silently skipped (no standard sentence punctuation)
