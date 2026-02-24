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

Three functions in `functions/src/index.ts`:
- **`chat`** — proxies AI requests to OpenRouter (512MiB, minInstances: 1)
- **`accountApi`** — account deletion + contact form (256MiB, 60s)
- **`adminApi`** — admin dashboard backend (512MiB, 120s)

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

Core entry points: `src/ai/openrouter.ts` (API calls), `src/ai/partPrompts.ts` (system prompts + `SHARED_INSTRUCTIONS`), `src/ai/sessionPrompts.ts` (session mode part prompts), `src/ai/therapistPrompts.ts` (therapist companion prompts), `src/engine/partOrchestrator.ts` (part selection + scoring), `src/engine/sessionOrchestrator.ts` (session phase detection + crisis keywords + emotion check), `src/engine/pauseDetector.ts` (pause detection), `src/components/Editor/LivingEditor.tsx` (TipTap editor), `src/components/Session/SessionView.tsx` (session/conversation mode UI), `src/store/db.ts` (Firestore wrapper), `functions/src/index.ts` (Cloud Functions).

### Data storage

- **Firestore** `users/{uid}/` — 12 subcollections: entries, parts, memories, thoughts, interactions, entrySummaries, userProfile, fossils, letters, sessionLog, innerWeather, consent
- **Firestore** `appConfig/global` — readable by all authenticated, writable only via adminApi
- **Firestore** `contactMessages` — top-level, deny-all in client rules, written/read via Cloud Functions
- **localStorage** — device settings (theme, model, visual effects, speed, language)
- **Google Secret Manager** — `OPENROUTER_API_KEY`

### Auth

Firebase Authentication: Google Sign-In + Email/Password. `App.tsx` gates app behind auth. Cloud Functions verify ID tokens. `adminApi` checks `ADMIN_EMAILS` allowlist (in `functions/src/index.ts` and `src/App.tsx`).

### URL routing

SPA in `App.tsx` using `pushState`-based client-side routing (no router library): `/` → diary, `/session/:id` → session view, `/admin` → admin dashboard (lazy-loaded), anything else → `/`. `navigateTo()` callback uses `history.pushState` + React state; `popstate` listener handles back/forward.

### Feature flags

3 core flags (default enabled, `=== false`): `partsEnabled`, `visualEffectsEnabled`, `autocorrectEnabled`.
28 experimental flags (default disabled, `=== true`) across 6 categories: Atmosphere, Part Intelligence, Memory/Engagement, Visual Effects, Text Interaction, Safety & Guidance.

Full list + settings cascade + tuning params: `.claude/docs/feature-flags.md`

### Admin dashboard

At `/admin` for admins only. Lazy-loaded. 6 tabs, 9 API actions. Overview shows live user count + cached rich metrics (writing habits, emotional landscape, feature adoption). Users table is sortable (9 columns). UserDetail has 8 tabs covering all 12 Firestore subcollections. Details: `.claude/docs/admin.md`

### Subsystems

Dark mode, adaptive parts, i18n (17 languages), emergency grounding, bundle splitting, intentions, explorations, session closing, autocorrect, body map, data export — all documented in `.claude/docs/subsystems.md`

### Analytics & tracking

21 Firebase Analytics events, Google Ads conversion tracking, Sentry error monitoring — all documented in `.claude/docs/analytics.md`

### Environment variables

`.env.local` (git-ignored): `VITE_FIREBASE_*` (6 vars) + `VITE_SENTRY_DSN`. Build-time: `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`. All client-side vars are safe to expose.

## Testing

Vitest (~229 tests). Tests cover: `llmCorrect`, `ritualEngine`, `pauseDetector`, `partOrchestrator`, `weatherEngine`, `settings`, `sessionOrchestrator` (phase detection, crisis keywords, emotion check, grounding activation), `sessionPrompts`, `therapistPrompts`, `SessionView`.

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

1. Add proxy in `db.ts`
2. Add interface in `src/types/index.ts`
3. Add to `exportAllData()` in `db.ts` and `deleteAccount` in `functions/src/index.ts`

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

### PWA & Build
- **PWA API calls not cached** — go through Firebase rewrites
- **Sentry source maps** read `process.env` (not `import.meta.env`), disabled without `SENTRY_AUTH_TOKEN`
- **Autocorrect** uses LLM-based sentence correction (`src/ai/llmCorrect.ts`) — works in all languages with sentence-ending punctuation (CJK fullwidth, Hindi danda); Thai silently skipped (no standard sentence punctuation)
