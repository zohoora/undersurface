# UnderSurface

A session-first reflective companion app. Opening the app starts (or resumes) a daily session with an AI companion. Within a session the user can move between five surfaces — Talk, Journal, Speak, Relax, and Drift — while the companion carries context across them.

**Live at [undersurface.me](https://undersurface.me)**

## How It Works

Visiting the app routes straight into a session: today's active session if one exists, otherwise a new one. Each session offers five surfaces, switched from the bottom bar:

- **Talk** — streamed text conversation with the companion (OpenAI `gpt-5.5`). Replies can include tappable recommendations (e.g. a breathing break).
- **Journal** — a quiet TipTap writing page inside the session. An optional "Inner voices" toggle activates the parts pipeline: when the writer pauses, slows down, or trails off, an IFS-inspired inner "part" responds on the page.
- **Speak** — live voice conversation over WebRTC via OpenAI Realtime (`gpt-realtime-2`), tuned for an unhurried reflective register.
- **Relax** — breathwork, body scan, safe place, or open awareness, with an adaptive breath circle, ambient soundscapes (preset or custom-generated via ElevenLabs), and optional voice guidance.
- **Drift** — a short bilateral noticing-and-settling practice with deterministic, time-boxed progression and optional sparse companion turns.

A **◇ Real Talk** toggle switches the companion's tone to one that names coping moves (avoidance, intellectualization, minimization, …) — not nice, but kind and constructive. It is automatically disabled whenever grounding (crisis) mode is active.

Crisis safety is layered: a synchronous keyword floor plus an LLM risk classifier, both feeding a grounding mode that softens the companion, silences parts, and surfaces crisis resources.

Optional biometrics (webcam rPPG or a Polar H10 chest strap over Web Bluetooth) feed live heart-rate variability into the companion's context and drive the Relax breath pacing.

### Inner parts

Seven seeded parts — The Watcher, The Tender, The Still, The Spark, The Weaver, The Open, The Quiet One — plus parts that emerge organically from writing. Parts learn over time through observation memories, post-session reflection, and periodic growth cycles. All parts share `SHARED_INSTRUCTIONS` defining their writing-companion purpose. The former standalone diary flow is gone; parts now live exclusively inside the session's Journal surface.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript (strict) + Vite 7 |
| Editor | TipTap 3 (ProseMirror) |
| Styling | Tailwind CSS v4 |
| Animation | Framer Motion |
| Auth | Firebase Authentication (Google Sign-In + Email/Password) |
| Database | Cloud Firestore (with offline persistence) |
| AI — chat | OpenAI `gpt-5.5` via Cloud Function proxy (`/api/chat`) |
| AI — crisis | OpenAI `gpt-5-nano` (structured output, `task: 'crisis_check'`) |
| AI — voice | OpenAI Realtime `gpt-realtime-2` over WebRTC |
| Soundscapes | ElevenLabs via `soundscapeApi` (+ Firestore cache) |
| Biometrics | Webcam rPPG (CHROM, Web Worker, MediaPipe FaceLandmarker) + Polar H10 (Web Bluetooth) |
| Hosting | Firebase Hosting (rewrites → Cloud Functions, Node 22) |
| PWA | vite-plugin-pwa + Workbox |
| Mobile | Capacitor 8 shells (iOS/Android, in progress — `npm run cap:*`) |
| Monitoring | Sentry |
| CI | GitHub Actions |

## Project Structure

```
undersurface/
├── src/
│   ├── ai/                        # Prompts + API client
│   │   ├── openrouter.ts          # /api/chat client (legacy filename — calls OpenAI proxy, not OpenRouter)
│   │   ├── therapistPrompts.ts    # THERAPIST_CORE + REAL_TALK_CORE + SAFETY_RULES
│   │   ├── partPrompts.ts         # 7 seeded parts + SHARED_INSTRUCTIONS + emergence/reflection/growth
│   │   ├── crisisClassifierPrompt.ts
│   │   ├── relaxPrompts.ts        # Relax voice-guidance prompts
│   │   └── llmCorrect.ts          # LLM autocorrect
│   ├── engine/                    # Core logic (sessionOrchestrator, partOrchestrator,
│   │                              #   pauseDetector, hrvEngine, polarH10Engine, relaxEngine, …)
│   ├── hooks/                     # useSessionStream, useSessionVoice, useVoiceSession,
│   │                              #   useHrvSession, usePolarH10Session, useRelaxSession, …
│   ├── components/
│   │   ├── Session/               # SessionView (shell), SessionBottomBar, SessionJournalSurface,
│   │   │                          #   VoiceField, Relax/, HRV consent + biometrics bar
│   │   ├── Editor/                # useJournalParts + part thought bubbles (in-session journal)
│   │   ├── Sidebar/               # Session list + settings panel
│   │   ├── ThinkingOutLoud/       # Multi-turn dialogue with parts
│   │   └── Atmosphere/            # Breathing background, cursor glow, pause ripple
│   ├── admin/                     # Admin dashboard (lazy-loaded, admin users only)
│   ├── api/                       # apiBase (native origin handling), authedFetch, soundscape client
│   ├── auth/                      # Firebase authentication
│   ├── engine/                    # (see above)
│   ├── i18n/                      # 17 languages + key-parity tests
│   ├── native/                    # Capacitor glue (back button, keep-awake, share)
│   ├── store/                     # db.ts (Firestore wrapper), settings, globalConfig, dataExport
│   ├── extensions/                # TipTap extensions (inkWeight, paragraphSettle)
│   └── App.tsx                    # Auth gate + session-first routing
├── functions/                     # Firebase Cloud Functions (Node 22)
│   └── src/                       # chat, realtime, soundscapeApi (+soundscape/), account,
│                                  #   admin/, mcp, shared/ (auth, cors, rateLimit, secrets, models)
├── public/                        # Static assets (PWA manifest, icons, soundscape audio)
├── firebase.json                  # Hosting rewrites + CSP/Permissions-Policy headers
├── firestore.rules                # Firestore security rules
└── .github/workflows/ci.yml      # CI pipeline
```

## Architecture

### Therapist response flow (Talk)

```
User sends → useSessionStream → buildTherapistMessages
  → streamChatCompletion (src/ai/openrouter.ts)
  → fetch('/api/chat', { auth: Firebase ID token })
  → Firebase Hosting rewrite → Cloud Function (chat)
  → verifies token → OpenAI gpt-5.5 → streams SSE back
```

Crisis detection runs in two layers around this flow:

1. **L1 (deterministic floor)** — `sessionOrchestrator.checkCrisisKeywords`: synchronous regex over NFKC-normalized text, runs *before* generation so grounding flows into the prompt.
2. **L2 (LLM)** — every user-authored turn runs the standalone `classifyCrisisRisk` backstop (`task: 'crisis_check'`, gpt-5-nano, strict JSON schema). Talk also carries an in-band `<<RISK:N>>` preamble; risk 2 before the first token aborts and retries grounded. Both paths fail open — L1 remains the explicit-method floor.

When grounding activates: Real Talk reverts to the standard persona, journal parts are silenced, and crisis resources are shown.

### Journal parts flow

The pause detector watches keystroke timing and text patterns (8 pause types). The part orchestrator scores all parts per pause event — role-based affinities, content keywords, learned keywords/emotions, recency penalty, small randomness — so emerged parts score correctly with zero per-part configuration. Parts evolve via observation memories, the session reflection engine, and periodic growth cycles.

### Voice flow (Speak)

```
useSessionVoice → POST /api/realtime-token → realtimeTokenApi
  → mints OpenAI Realtime client secret (model gpt-realtime-2, voice marin,
     speed 0.88, semantic VAD 'low', transcription gpt-realtime-whisper)
  → useVoiceSession opens WebRTC directly to api.openai.com
```

Relax voice guidance reuses the same stack in `passive` mode (recvonly, no mic prompt).

### Admin flow

```
/admin → isAdmin check (src/admin/isAdmin.ts) → AdminDashboard
  → fetch('/api/admin', { action, auth token }) → adminApi Cloud Function
  → verifies token + ADMIN_EMAILS (functions/src/shared/auth.ts)
  → Firebase Admin SDK queries across all users (bypasses Firestore rules)
```

6 tabs (Overview, Users, Analytics, Messages, Insights, Settings), 11 actions. Gated in two layers: frontend allowlist for routing, backend allowlist returning 403 for non-admins.

### Hosting rewrites (`firebase.json`)

| Path | Function |
|------|----------|
| `/api/chat` | `chat` |
| `/api/admin` | `adminApi` |
| `/api/account` | `accountApi` |
| `/api/mcp` | `mcpApi` |
| `/api/realtime-token` | `realtimeTokenApi` |
| `/api/soundscape` | `soundscapeApi` |
| `**` | `/index.html` (SPA fallback) |

## Data Model

### User data — Firestore under `users/{uid}/`

| Collection | Description |
|-----------|-------------|
| `sessions` | Session docs (`mode: 'standard' \| 'real_talk'`, status, favorited, firstLine, sessionNote, journalPartsEnabled) |
| `sessions/{id}/messages` | Per-session message subcollection (therapist + user turns) |
| `parts` | Inner voice definitions (name, color, IFS role, system prompt, learned keywords/emotions) |
| `memories` | Persistent memories — `observation`, `interaction`, `reflection`, `pattern` |
| `thoughts` | Individual part responses anchored to journal text |
| `interactions` | Multi-turn "Thinking Out Loud" conversations |
| `entrySummaries` | AI-generated summaries (reflection engine) |
| `userProfile` | AI-maintained profile — inner landscape, recurring themes, avoidance patterns |
| `personalFacts` | Stable facts injected into therapist context |
| `fossils`, `letters`, `sessionLog`, `innerWeather` | Ritual/engagement subsystems |
| `consent` | Terms + camera + Bluetooth consent records |
| `hrvSessions` | HRV archives (`source: 'camera' \| 'polarH10'`, signal dumps) |
| `relaxSessions` | Relax surface session records |
| `diagnostics` | Client diagnostic events |
| `apiKeys` | Hashed keys for the MCP server |
| `entries` | **Legacy** diary entries — no writers anymore; read by echo/quote/reflection engines and MCP tools |

Security rule: users can only read/write their own data (`request.auth.uid == userId`).

### Global config — `appConfig/global`

A single Firestore document with app-wide defaults and feature flags (typed as `GlobalConfig` in `src/admin/adminTypes.ts`): 6 core flags (default enabled, checked `!== false`) and 23 experimental flags (default disabled, checked `=== true`) covering atmosphere, part intelligence, memory/engagement, safety, biometrics (`webcamHrv`, `polarH10`), voice (`voiceEnabled`), and Relax (`relaxEnabled`, `customSoundscapesEnabled`), plus tuning sections and an announcement banner. Readable by all authenticated users; writable only through `adminApi`; listened to in real-time via `onSnapshot` in `src/store/globalConfig.ts`.

## Settings System

User preferences follow a 3-tier priority cascade:

```
user localStorage  >  appConfig/global defaults  >  hardcoded DEFAULTS
```

Defaults live in `src/store/settings.ts` (response speed, autocorrect, theme, language, timezone, last session mode, Relax preferences). When `appConfig/global` updates, `invalidateSettingsCache()` propagates new defaults; explicit localStorage overrides win. Reactive via `useSettings()` / `useGlobalConfig()` (`useSyncExternalStore`); `getSettings()` / `getGlobalConfig()` for non-React code.

## Development

### Prerequisites

- Node.js 22
- Firebase CLI (`npm install -g firebase-tools`)
- Access to the `undersurfaceme` Firebase project

### Setup

```bash
git clone git@github.com:zohoora/undersurface.git
cd undersurface
npm install
cd functions && npm install && cd ..
```

Create `.env.local` with Firebase config:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=undersurfaceme.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=undersurfaceme
VITE_FIREBASE_STORAGE_BUCKET=undersurfaceme.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_SENTRY_DSN=...            # optional
```

These are public Firebase client config values — security comes from Firestore rules + auth, not config secrecy. Never build for production deploy with dummy values.

### Run locally

```bash
npm run dev          # Dev server at localhost:5173
npm run build        # Production build to dist/
npm run build:release # Release build + explicit Sentry source-map upload
npm run preview      # Preview production build
npm run lint         # ESLint
npm run test         # Vitest
npm run test:indexes # Firestore index tests (emulator)
npm run smoke-test   # Post-deploy smoke test against the live site
```

## Cloud Functions

Six functions in `functions/src/` (shared helpers in `shared/`):

| Function | File | Purpose | Config |
|----------|------|---------|--------|
| `chat` | `chat.ts` | OpenAI proxy — `gpt-5.5` therapist/journal turns, `gpt-5-nano` crisis route, SSE streaming | 512MiB, minInstances 1, 300s |
| `realtimeTokenApi` | `realtime.ts` | Mints OpenAI Realtime client secrets | 256MiB, minInstances 1, 30s |
| `soundscapeApi` | `soundscapeApi.ts` + `soundscape/` | ElevenLabs soundscape generation + Firestore cache | 256MiB, 60s |
| `accountApi` | `account.ts` | Account deletion + contact form | 256MiB, 60s |
| `adminApi` | `admin/` | Admin dashboard backend (11 actions) | 512MiB, 120s |
| `mcpApi` | `mcp.ts` | MCP server, 4 read-only tools, API-key auth | 256MiB, 30s |

The chat model is pinned server-side in `functions/src/shared/models.ts` (`OPENAI_CHAT_MODEL`); the client never sends a model field. SSE streaming requires `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`.

## Deployment

Before a production release, run the pinned behavioral gate. It writes a
machine-readable manifest with the git commit, prompt hash, model snapshot,
suite results, latency, and logs under `.artifacts/model-evals/`. The same gate
runs weekly and on demand in `.github/workflows/release-evals.yml`.

```bash
OPENAI_API_KEY=... npm run test:release-evals
```

Ordinary `npm run build` never contacts Sentry. Use `build:release` only for an
actual release; it requires `SENTRY_AUTH_TOKEN` and uploads hidden source maps.

### Deploy everything (most common)

```bash
npm run build:release && cd functions && npx tsc && cd .. && firebase deploy
```

### Partial deploys

| What changed | Build step | Deploy command |
|---|---|---|
| Anything in `src/` | `npm run build:release` | `firebase deploy --only hosting` |
| Anything in `functions/src/` | `cd functions && npx tsc` | `firebase deploy --only functions` |
| `firestore.rules` | — | `firebase deploy --only firestore:rules` |
| Both | Both build steps | `firebase deploy` |

After deploying, run `npm run smoke-test`. Note `chat`'s `minInstances: 1` requires `firebase deploy --force`.

### Managing API keys

Both keys are Firebase secrets (Google Secret Manager), not config files:

```bash
echo "sk-..." | firebase functions:secrets:set OPENAI_API_KEY
echo "..."    | firebase functions:secrets:set ELEVENLABS_API_KEY
cd functions && npx tsc && cd .. && firebase deploy --only functions
```

### Changing the AI models

- Chat: `OPENAI_CHAT_MODEL` in `functions/src/shared/models.ts`
- Crisis classifier: `OPENAI_CRISIS_MODEL` in `functions/src/chat.ts`
- Voice: `REALTIME_MODEL` in `functions/src/realtime.ts`

Then rebuild + deploy functions.

### Adding a new admin user

Update the allowlist in two places, then deploy both frontend and functions:
1. `src/admin/isAdmin.ts` — frontend routing gate
2. `functions/src/shared/auth.ts` — backend `ADMIN_EMAILS` check

### Toggling features without deploying

`undersurface.me/admin` → Settings. Feature flags, announcement banner, and tuning params propagate in real-time via Firestore `onSnapshot`.

## Domains

| URL | Purpose |
|-----|---------|
| [undersurface.me](https://undersurface.me) | Custom domain (primary) |
| [undersurfaceme.web.app](https://undersurfaceme.web.app) | Firebase default |
| [undersurfaceme.firebaseapp.com](https://undersurfaceme.firebaseapp.com) | Firebase legacy (must stay the `authDomain`) |

DNS is managed in Cloudflare (DNS-only mode, proxy OFF for A records). Firebase Auth has all three domains authorized for Google Sign-In.

## Code Conventions

- **TypeScript strict mode** — no `any`, `import type {}` for type-only imports
- **No semicolons**, **single quotes**
- **Tailwind CSS v4** — `@tailwindcss/vite` plugin, `@import "tailwindcss"` in CSS
- **TipTap v3** — editor storage types via `@tiptap/core` module augmentation (`src/types/tiptap.d.ts`)
- **Functional components** — class components only for `ErrorBoundary`
- **`useMemo` over `useEffect+setState`** for derived state
- **Reactive stores** — `useSettings()` / `useGlobalConfig()` via `useSyncExternalStore`
- **Colors via CSS variables** — never hardcode hex for themed colors
- **Admin components use inline styles** — warm muted palette, light-only

## Known Gotchas & Further Docs

The authoritative, regularly-updated gotcha list (Firebase/CSP, crisis-safety invariants, HRV signal processing, Polar PMD protocol, build caveats) lives in **`CLAUDE.md`**. Deeper references live in `.Codex/docs/`. Current review findings include `APP_REVIEW_TREE_AND_FOREST_2026-07-09.md`; the active remediation plan is `docs/superpowers/plans/2026-07-03-full-remediation-master.md`.

## Infrastructure

| Service | Console URL |
|---------|------------|
| Firebase project | [console.firebase.google.com/project/undersurfaceme](https://console.firebase.google.com/project/undersurfaceme/overview) |
| Firestore data | [console.firebase.google.com/.../firestore](https://console.firebase.google.com/project/undersurfaceme/firestore) |
| Cloud Functions | [console.firebase.google.com/.../functions](https://console.firebase.google.com/project/undersurfaceme/functions) |
| Hosting | [console.firebase.google.com/.../hosting](https://console.firebase.google.com/project/undersurfaceme/hosting/sites/undersurfaceme) |
| Auth users | [console.firebase.google.com/.../authentication](https://console.firebase.google.com/project/undersurfaceme/authentication/users) |
| DNS (Cloudflare) | [dash.cloudflare.com](https://dash.cloudflare.com) → undersurface.me |
| GitHub repo | [github.com/zohoora/undersurface](https://github.com/zohoora/undersurface) (private) |
