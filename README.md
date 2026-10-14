# UnderSurface

A session-first reflective companion app. Opening the app starts (or resumes) a daily session with an AI companion. Within a session the user can move between four surfaces — Talk, Journal, Speak, and Room — while the companion carries context across them. An optional SMS/MMS field channel carries the same companion between sessions.

**Live at [undersurface.me](https://undersurface.me)**

## How It Works

Visiting the app routes straight into a session: today's active session if one exists, otherwise a new one. Each session offers four surfaces, switched from the bottom bar:

- **Talk** — streamed text conversation with the companion (OpenAI `gpt-5.5`). Replies can include tappable recommendations (open Journal, Speak or Room for a while, then return).
- **Journal** — a quiet TipTap writing page inside the session. An optional "Inner voices" toggle activates the parts pipeline: when the writer pauses, slows down, or trails off, an IFS-inspired inner "part" responds on the page.
- **Speak** — live voice conversation over WebRTC via OpenAI Realtime (`gpt-realtime-2`), tuned for an unhurried reflective register.
- **Room** — an ambient space where an organic two-way voice conversation can dissolve into sound and silence. The writer chooses Listen first, Lead me, or Quiet company (sound and light only, no microphone) and 2, 5 or 10 minutes; one deterministic score keeps timing and atmosphere coherent while the companion remains interruptible. Room replaced the earlier Relax and Drift surfaces.

**Fresh eyes** (per session, before the first message) lets the companion meet the writer without past-session memory. A **◇ Real Talk** toggle switches the companion's tone to one that names coping moves (avoidance, intellectualization, minimization, …) — not nice, but kind and constructive. It is automatically disabled whenever grounding (crisis) mode is active.

Crisis safety is layered: a synchronous keyword floor plus an LLM risk classifier, both feeding a grounding mode that softens the companion, silences parts, closes Room, and surfaces crisis resources. A recent crisis also grounds SMS replies and pauses proactive texts for 72 hours.

Optional biometrics (webcam rPPG or a Polar H10 chest strap over Web Bluetooth) feed live heart-rate variability into the companion's context.

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
| SMS/MMS | Twilio (webhook + Firestore-triggered processor + scheduled field windows) |
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
│   │   ├── voiceInstructions.ts   # One Realtime prompt builder for Speak + Room
│   │   ├── roomPrompts.ts         # Organic, interruptible Room voice contract
│   │   └── llmCorrect.ts          # LLM autocorrect
│   ├── engine/                    # Core logic (sessionOrchestrator, partOrchestrator,
│   │                              #   pauseDetector, turnResponder, roomEngine, hrvEngine, …)
│   ├── hooks/                     # useSessionStream, useSessionVoice, useVoiceSession,
│   │                              #   useHrvSession, usePolarH10Session, useRoomSession, …
│   ├── components/
│   │   ├── Session/               # SessionView (shell), SessionBottomBar, SessionJournalSurface,
│   │   │                          #   VoiceField, Room/, HRV consent + biometrics bar
│   │   ├── Editor/                # useJournalParts + part thought bubbles (in-session journal)
│   │   ├── Sidebar/               # Session list + settings panel
│   │   ├── ThinkingOutLoud/       # Multi-turn dialogue with parts
│   │   └── Atmosphere/            # Breathing background, cursor glow, pause ripple
│   ├── admin/                     # Admin dashboard (lazy-loaded, admin users only)
│   ├── api/                       # apiBase (native origin handling), authedFetch, accountApi
│   ├── auth/                      # Firebase authentication
│   ├── engine/                    # (see above)
│   ├── i18n/                      # 17 languages + key-parity tests
│   ├── native/                    # Capacitor glue (back button, keep-awake)
│   ├── store/                     # db.ts (Firestore wrapper), settings, globalConfig, dataExport
│   ├── extensions/                # TipTap extensions (inkWeight, paragraphSettle)
│   └── App.tsx                    # Auth gate + session-first routing
├── functions/                     # Firebase Cloud Functions (Node 22)
│   └── src/                       # chat, realtime, account, admin/, mcp,
│                                  #   sms/ (webhook, processor, field windows), shared/
├── public/                        # Static assets (PWA manifest, icons, logos)
├── firebase.json                  # Hosting rewrites + the single web CSP/Permissions-Policy headers
├── firestore.rules                # Firestore security rules (+ storage.rules, firestore.indexes.json)
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

Speak and Room share one prompt builder (`src/ai/voiceInstructions.ts`), which also carries this session's recent turns so a change of medium keeps the thread. Room steers its timed cues with system conversation items rather than `response.create` instruction overrides (which would replace the session prompt and its safety rules). Quiet company does not create a Realtime session or request microphone access. The token endpoint enforces the voice/Room flags server-side and a daily per-user mint budget.

### SMS field flow

```
Settings creates link code → user texts LINK <code> to +1 289-778-0589
  → smsApi validates Twilio signature and maps the phone to a Firebase uid
  → natural SMS/MMS is persisted + queued → smsInboundProcessor
  → protected Twilio images are fetched, bounded, and encoded as multimodal input
  → shared crisis stack → GPT-5.5 chooses reply length + optional field note
  → Twilio SMS reply; only selected notes enter later Talk/Speak context
```

Replies are idempotent (a reply that may already have gone out is never resent), crisis-aware (a recent SMS risk or in-app grounding grounds the reply), budgeted (40 generated turns per day), and retention-bounded (message bodies cleared on completion, MMS media deleted at Twilio). Admins can pause the whole channel (`smsEnabled`). With consent, **field windows** send at most a few short, randomized check-ins per week inside writer-chosen windows (`fieldWindowScheduler` + `fieldWindowDispatcher`); STOP or unlinking revokes consent.

Writers text naturally or attach up to four JPEG, PNG, WEBP, or GIF images—there are no save, depth, or app-handoff content commands. GPT-5.5 is explicitly prompted for the carrier-SMS/MMS medium: concise by default, longer only when the moment warrants it, with a hard 1,200-character backstop. It separately returns a structured decision about whether a source-grounded text or image detail is useful enough to carry into a later session. Image bytes are passed ephemerally to the model; the transcript stores attachment metadata, not a second image copy.

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
| `/api/sms` | `smsApi` |
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
| `roomSessions` | Unified Room choices, controls, elapsed time, and transcript |
| `relaxSessions`, `driftSessions` | Legacy Relax/Drift records (kept for export and deletion) |
| `companionPreferences`, `fieldMoments`, `interventionOutcomes`, `researchEvents`, `personalProtocols`, `livingHypotheses` | Alliance preferences + field-window consent, field moments, outcome and research provenance, hypotheses |
| `diagnostics` | Client diagnostic events |
| `apiKeys` | Hashed keys for the MCP server |
| `entries` | **Legacy** diary entries — no writers anymore; read by echo/quote/reflection engines and MCP tools |
| `smsMessages` | Inbound/outbound SMS/MMS transcript, attachment metadata, and model-selected field notes; transcript exported, selected notes loaded as weak recent context |
| `smsSettings` | Server-owned SMS state: phone-link status (phone hash + last four only), risk state, opt-out time, daily usage |

Security rules: users can only read their own data. They can write their own collections except `smsSettings`, `smsMessages` and the `users/{uid}` root doc, which only Cloud Functions write. The full registry is `functions/src/shared/collections.ts`.

### Global config — `appConfig/global`

A single Firestore document with app-wide defaults and feature flags (typed as `GlobalConfig` in `src/admin/adminTypes.ts`): core and experimental flags covering atmosphere, part intelligence, memory/engagement, safety, biometrics (`webcamHrv`, `polarH10`), voice (`voiceEnabled`), Room (`roomEnabled`; while unset, the legacy `relaxEnabled`/`driftEnabled` flags still turn it on), the SMS kill switch (`smsEnabled`, on unless false), plus tuning sections and an announcement banner. Readable by all authenticated users; writable only through `adminApi`; listened to in real-time via `onSnapshot` in `src/store/globalConfig.ts`.

## Settings System

User preferences follow a 3-tier priority cascade:

```
user localStorage  >  appConfig/global defaults  >  hardcoded DEFAULTS
```

Defaults live in `src/store/settings.ts` (response speed, autocorrect, theme, language, timezone, last session mode, and the last Room choices). When `appConfig/global` updates, `invalidateSettingsCache()` propagates new defaults; explicit localStorage overrides win. Reactive via `useSettings()` / `useGlobalConfig()` (`useSyncExternalStore`); `getSettings()` / `getGlobalConfig()` for non-React code.

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

Nine deployable functions in `functions/src/` (shared helpers in `shared/`):

| Function | File | Purpose | Config |
|----------|------|---------|--------|
| `chat` | `chat.ts` | OpenAI proxy — `gpt-5.5` therapist/journal turns, `gpt-5-nano` crisis/signal routes, SSE streaming, request validation, metered token quota | 512MiB, minInstances 1, 300s |
| `realtimeTokenApi` | `realtime.ts` | Mints OpenAI Realtime client secrets (flag-gated, daily budget) | 256MiB, minInstances 1, 30s |
| `accountApi` | `account.ts` | Account deletion (incl. Twilio copies), contact form, and SMS phone-link actions | 256MiB, 300s |
| `adminApi` | `admin/` | Admin dashboard backend (11 actions) | 512MiB, 120s |
| `mcpApi` | `mcp.ts` | MCP server, 4 read-only tools, API-key auth | 256MiB, 30s |
| `smsApi` | `sms/index.ts` | Twilio SMS/MMS webhook, account controls, media descriptors, queue admission | 256MiB, 30s |
| `smsInboundProcessor` | `sms/index.ts` | Protected media fetch, multimodal crisis handling, adaptive response + note selection, idempotent Twilio delivery | 256MiB, 120s |
| `fieldWindowScheduler` | `sms/fieldWindows.ts` | Every 15 minutes: schedules proactive field-window texts, sweeps stale dispatches | 256MiB, 120s |
| `fieldWindowDispatcher` | `sms/fieldWindows.ts` | Sends one queued field-window text after a final recheck | 256MiB, 60s |

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

Deploy order when several pieces change: Firestore indexes → rules → functions → hosting.

### Deploy everything (most common)

```bash
npm run build:release && cd functions && npx tsc && cd .. && firebase deploy
```

### Partial deploys

| What changed | Build step | Deploy command |
|---|---|---|
| Anything in `src/` | `npm run build:release` | `firebase deploy --only hosting` |
| Anything in `functions/src/` | `cd functions && npx tsc` | `firebase deploy --only functions` |
| `firestore.rules` / `storage.rules` | — | `firebase deploy --only firestore:rules,storage` |
| `firestore.indexes.json` | — | `firebase deploy --only firestore:indexes` |
| Several | All build steps | `firebase deploy` |

After deploying, run `npm run smoke-test`. Note `chat`'s `minInstances: 1` requires `firebase deploy --force`.

### Managing API keys

Provider credentials are Firebase secrets (Google Secret Manager), not config files:

```bash
echo "sk-..." | firebase functions:secrets:set OPENAI_API_KEY
echo "AC..."  | firebase functions:secrets:set TWILIO_ACCOUNT_SID
echo "..."    | firebase functions:secrets:set TWILIO_AUTH_TOKEN
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

The authoritative, regularly-updated gotcha list (Firebase/CSP, crisis-safety invariants, HRV signal processing, Polar PMD protocol, build caveats) lives in **`CLAUDE.md`**. Deeper references live in `.claude/docs/`. The current technical fix list is `TECH_ISSUES_2026-10-14.md`; earlier review findings include `APP_REVIEW_TREE_AND_FOREST_2026-07-09.md`.

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
