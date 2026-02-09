# UnderSurface

A diary app where inner voices respond as you write. Built with IFS (Internal Family Systems) principles — as you pause, slow down, or trail off, different parts of your inner world emerge on the page.

**Live at [undersurface.me](https://undersurface.me)**

## How It Works

You write in a rich text editor. As you pause, the app detects writing patterns (pauses, trailing off, questions, paragraph breaks) and selects an inner "part" to respond. Each part has a distinct voice, concern, and personality:

- **The Watcher** — notices what you avoid
- **The Tender** — holds your softness
- **The Still** — sits with what's present
- **The Spark** — wants to move, to act
- **The Weaver** — sees patterns across time

New parts can also emerge organically from your writing.

Parts learn over time through observation memories, reflection, and periodic growth cycles. They adapt their language, keywords, and emotional vocabulary based on what the user writes.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 7 |
| Editor | TipTap 3 (ProseMirror) |
| Styling | Tailwind CSS v4 |
| Animation | Framer Motion |
| Auth | Firebase Authentication (Google Sign-In) |
| Database | Cloud Firestore (with offline persistence) |
| AI | OpenRouter API (default: Gemini 3 Flash) via Cloud Function proxy |
| Hosting | Firebase Hosting |
| PWA | vite-plugin-pwa + Workbox |
| Spellcheck | Typo.js + dictionary-en |
| CI | GitHub Actions |

## Project Structure

```
undersurface/
├── src/
│   ├── ai/                        # AI integration
│   │   ├── openrouter.ts          # API client — calls /api/chat with Firebase auth token
│   │   └── partPrompts.ts         # System prompts for all 5 seeded parts + emergence/reflection/growth
│   ├── admin/                     # Admin dashboard (only loaded for admin users)
│   │   ├── adminTypes.ts          # TypeScript types for admin API responses + GlobalConfig
│   │   ├── adminApi.ts            # Client-side admin API caller (adminFetch)
│   │   ├── AdminDashboard.tsx     # Shell with tab navigation (Overview, Users, Insights, Settings)
│   │   ├── AdminOverview.tsx      # Metric cards + recent activity feed
│   │   ├── AdminUsers.tsx         # User table with drill-down
│   │   ├── AdminUserDetail.tsx    # Full user data view (entries, parts, thoughts, profile)
│   │   ├── AdminInsights.tsx      # LLM-generated narrative analysis of app usage
│   │   └── AdminSettings.tsx      # Form for GlobalConfig (model, speed, flags, announcements)
│   ├── auth/                      # Firebase authentication
│   │   ├── AuthContext.tsx         # Auth provider component
│   │   ├── authContext.ts          # Context definition
│   │   └── useAuth.ts             # Auth hook
│   ├── components/
│   │   ├── Atmosphere/            # Visual effects (breathing bg, cursor glow, pause ripple)
│   │   ├── Editor/                # TipTap editor + part thought bubbles
│   │   ├── Sidebar/               # Entry list, settings panel, model selector
│   │   ├── ThinkingOutLoud/       # Multi-turn dialogue with parts
│   │   ├── AnnouncementBanner.tsx # Global announcement banner (from admin config)
│   │   ├── ErrorBoundary.tsx
│   │   ├── LoginScreen.tsx
│   │   └── Onboarding.tsx
│   ├── engine/                    # Core logic
│   │   ├── pauseDetector.ts       # Detects writing pauses from keystroke timing
│   │   ├── partOrchestrator.ts    # Selects which part responds (role-based scoring)
│   │   ├── emergenceEngine.ts     # Detects and creates new emergent parts
│   │   ├── reflectionEngine.ts    # Entry reflection — memories, summaries, profile updates
│   │   ├── partGrowthEngine.ts    # Part evolution every 5 entries — prompt/keyword/emotion updates
│   │   └── spellEngine.ts         # Autocorrect engine (Damerau-Levenshtein + Typo.js)
│   ├── extensions/                # TipTap extensions (ink weight, color bleed, etc.)
│   ├── store/
│   │   ├── db.ts                  # Firestore wrapper (mimics Dexie API surface)
│   │   ├── settings.ts            # localStorage settings with 3-tier cascade
│   │   └── globalConfig.ts        # Real-time listener on appConfig/global Firestore doc
│   ├── styles/                    # Atmosphere CSS animations
│   ├── types/                     # TypeScript interfaces
│   ├── App.tsx                    # Root component (auth gate, admin routing, entry management)
│   ├── firebase.ts                # Firebase/Firestore initialization with offline persistence
│   └── main.tsx                   # React entry point
├── functions/                     # Firebase Cloud Functions
│   ├── src/index.ts               # Two functions: chat (AI proxy) + adminApi (admin backend)
│   ├── package.json
│   └── tsconfig.json
├── public/                        # Static assets (PWA manifest, icons, dictionaries)
├── firebase.json                  # Hosting rewrites + functions + firestore config
├── firestore.rules                # Firestore security rules
├── vite.config.ts                 # Vite + Tailwind + PWA config
└── .github/workflows/ci.yml      # CI pipeline
```

## Architecture

### AI Response Flow

```
User types → PauseDetector → PartOrchestrator → openrouter.ts
  → fetch('/api/chat', { auth: Firebase ID token })
  → Firebase Hosting rewrite → Cloud Function (chat)
  → Cloud Function verifies auth token
  → Cloud Function reads API key from Google Secret Manager
  → Proxies to OpenRouter API
  → Streams SSE response back to browser
```

The **pause detector** watches keystroke timing and text patterns to identify 8 pause types: `short_pause`, `sentence_complete`, `cadence_slowdown`, `paragraph_break`, `long_pause`, `ellipsis`, `question`, `trailing_off`.

The **part orchestrator** scores all parts for each pause event using:
- **Pause type affinity** — each IFS role has different affinities for each pause type (lookup tables in `ROLE_PAUSE_AFFINITIES`)
- **Content keywords** — role keywords (`ROLE_KEYWORDS`) + the part's `concern` field words + `learnedKeywords`
- **Emotional match** — role emotions (`ROLE_EMOTIONS`) + `learnedEmotions` vs. detected emotional tone
- **Recency penalty** — avoids repeating the same voice back-to-back
- **Randomness** — small random factor for organic feel

Scoring is **role-based** (uses `ifsRole` lookup tables), so emerged parts score correctly without any per-part configuration.

### Adaptive Parts System

Parts learn and evolve through five layers:

1. **Dynamic scoring** — Role-based lookup tables, not hardcoded per part ID
2. **Observation memories** — Every inline thought creates a `type: 'observation'` memory
3. **Reflection engine** — On entry switch, one API call produces entry summaries, reflection/pattern memories, and user profile updates (`reflectionEngine.ts`)
4. **Enhanced prompts** — `buildPartMessages()` injects categorized memories, user profile, and entry summaries into the system prompt
5. **Part growth** — Every 5 entries, one API call evolves parts: updates `systemPromptAddition`, `learnedKeywords`, `learnedEmotions` (`partGrowthEngine.ts`)

### Admin Dashboard Flow

```
Admin visits /admin → App.tsx checks ADMIN_EMAILS → renders AdminDashboard
  → adminApi.ts: fetch('/api/admin', { action, auth token })
  → Firebase Hosting rewrite → Cloud Function (adminApi)
  → Cloud Function verifies token + checks email against ADMIN_EMAILS
  → Uses Firebase Admin SDK to query across all users (bypasses Firestore rules)
  → Returns aggregated data / LLM insights / config updates
```

Admin access is gated in two layers:
1. **Frontend** — `App.tsx` checks email against `ADMIN_EMAILS` before rendering the dashboard
2. **Backend** — `adminApi` Cloud Function verifies the email from the Firebase ID token; returns 403 for non-admins

The admin route is checked **before** DB initialization, so the admin page doesn't load TipTap, spell engine, or other diary components.

## Development

### Prerequisites

- Node.js 20+
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
```

These are public Firebase client config values — security comes from Firestore rules + auth, not config secrecy.

### Run locally

```bash
npm run dev          # Dev server at localhost:5173
npm run build        # Production build to dist/
npm run preview      # Preview production build
npm run lint         # ESLint
npm run test         # Vitest
```

## Cloud Functions

Two Cloud Functions live in `functions/src/index.ts`:

### `chat` — AI proxy (256MiB, 30s timeout)

Proxies requests from the browser to OpenRouter. Verifies Firebase auth token on every request. The OpenRouter API key is stored in Google Secret Manager (`OPENROUTER_API_KEY`). Supports both streaming (SSE) and non-streaming responses.

SSE streaming requires these headers to prevent CDN buffering:
- `X-Accel-Buffering: no`
- `Cache-Control: no-cache, no-transform`

### `adminApi` — Admin backend (512MiB, 120s timeout)

Single function that routes by `req.body.action`:

| Action | Input | Returns |
|--------|-------|---------|
| `getOverview` | — | `userCount`, `totalEntries`, `totalThoughts`, `totalInteractions`, `recentActivity[]` |
| `getUserList` | — | `users[]` with entry/thought/interaction counts, total words, last active |
| `getUserDetail` | `{ uid }` | Full user data: entries, parts, thoughts, interactions, memories, profile, summaries |
| `getConfig` | — | Current `GlobalConfig` from `appConfig/global` |
| `updateConfig` | `{ config }` | Merged config (sets `updatedAt` + `updatedBy`) |
| `generateInsights` | — | LLM narrative + highlights from entry summaries and user profiles |

Uses Firebase Admin SDK to query across all users (bypasses Firestore security rules). Admin email is verified from the decoded Firebase ID token against the `ADMIN_EMAILS` allowlist.

### Firebase Hosting Rewrites

Defined in `firebase.json`:

| Path | Function |
|------|----------|
| `/api/chat` | `chat` |
| `/api/admin` | `adminApi` |
| `**` | `/index.html` (SPA fallback) |

## Data Model

### User data — Firestore under `users/{uid}/`

| Collection | Description |
|-----------|-------------|
| `entries` | Diary entries (content as HTML, plainText, timestamps) |
| `parts` | Inner voice definitions (name, color, IFS role, system prompt, learnedKeywords, learnedEmotions, systemPromptAddition) |
| `memories` | Persistent memories — types: `observation`, `interaction`, `reflection`, `pattern` |
| `thoughts` | Individual part responses anchored to entry text |
| `interactions` | Multi-turn "Thinking Out Loud" conversations |
| `entrySummaries` | AI-generated summaries of entries (produced by reflection engine) |
| `userProfile` | AI-maintained profile — `innerLandscape`, `recurringThemes`, `notablePatterns` |

Security rule: users can only read/write their own data (`request.auth.uid == userId`).

### Global config — `appConfig/global`

A single Firestore document providing app-wide defaults and feature flags:

```typescript
interface GlobalConfig {
  defaultModel: string                     // e.g. 'google/gemini-3-flash-preview'
  defaultResponseSpeed: number             // 0.5–2.0
  defaultTypewriterScroll: 'off' | 'comfortable' | 'typewriter'
  features: {
    partsEnabled: boolean       // Toggles AI thought generation
    visualEffectsEnabled: boolean  // Toggles breathing background
    autocorrectEnabled: boolean    // Toggles spell correction
  }
  announcement: {               // null = no announcement
    message: string
    type: 'info' | 'warning'
    dismissible: boolean
  } | null
  updatedAt: number
  updatedBy: string
}
```

- Readable by all authenticated users (via Firestore rules)
- Writable only through the `adminApi` Cloud Function (Admin SDK bypasses rules)
- Listened to in real-time via `onSnapshot` in `src/store/globalConfig.ts`

### Feature flags

| Flag | Where checked | Effect when `false` |
|------|---------------|---------------------|
| `partsEnabled` | `partOrchestrator.ts` | No AI thoughts generated |
| `visualEffectsEnabled` | `App.tsx` | Static background |
| `autocorrectEnabled` | `LivingEditor.tsx` | Spell correction skipped |

All flags default to **enabled** when config is `null` (not yet loaded or document doesn't exist). The checks use `=== false` so `undefined`/`null` are treated as enabled.

## Settings System

User preferences follow a 3-tier priority cascade:

```
user localStorage  >  appConfig/global defaults  >  hardcoded DEFAULTS
```

- **Hardcoded defaults** — in `src/store/settings.ts` `DEFAULTS` object
- **Global config defaults** — from `appConfig/global` (set by admin), applied as a middle tier
- **User localStorage** — per-device overrides set by the user

When `appConfig/global` updates (via admin), `invalidateSettingsCache()` is called so new defaults propagate. Users who have explicitly set a value in localStorage keep their override.

Settings are reactive via `useSettings()` hook (uses `useSyncExternalStore`). For non-React code, use `getSettings()`.

Global config is reactive via `useGlobalConfig()` hook. For non-React code, use `getGlobalConfig()` (synchronous, reads in-memory cache).

## Deployment

### Deploy everything (most common)

```bash
npm run build && cd functions && npx tsc && cd .. && firebase deploy
```

### Deploy only the frontend

```bash
npm run build
firebase deploy --only hosting
```

### Deploy only Cloud Functions

```bash
cd functions && npx tsc && cd ..
firebase deploy --only functions
```

### Deploy only Firestore rules

```bash
firebase deploy --only firestore:rules
```

### What to deploy

| What changed | Build step | Deploy command |
|---|---|---|
| Anything in `src/` | `npm run build` | `firebase deploy --only hosting` |
| Anything in `functions/src/` | `cd functions && npx tsc` | `firebase deploy --only functions` |
| `firestore.rules` | — | `firebase deploy --only firestore:rules` |
| Both `src/` and `functions/` | Both build steps | `firebase deploy` |

### Before deploying

1. `npm run build` — must succeed with zero errors
2. If you changed the Cloud Function: `cd functions && npx tsc` — must succeed
3. `firebase login` — must be logged in
4. Must have access to the `undersurfaceme` Firebase project

### Managing the OpenRouter API key

The API key is stored as a Firebase secret, not in any config file:

```bash
# View current secret
firebase functions:secrets:access OPENROUTER_API_KEY

# Update the secret
echo "sk-or-v1-..." | firebase functions:secrets:set OPENROUTER_API_KEY

# After updating, redeploy the function
cd functions && npx tsc && cd ..
firebase deploy --only functions
```

### Changing the default AI model

**Option A — via admin dashboard (no redeploy):**
1. Visit `undersurface.me/admin` → Settings tab
2. Change "Default Model" and save
3. Takes effect for new users / users who haven't overridden the model in localStorage

**Option B — via code (changes hardcoded fallback):**
1. `src/store/settings.ts` → `DEFAULTS.openRouterModel`
2. `src/ai/openrouter.ts` → `getModel()` fallback
3. `functions/src/index.ts` → the `model ||` fallback in `chat` function
4. Build and deploy both frontend and function

### Adding a new admin user

Update `ADMIN_EMAILS` in two places:
1. `src/App.tsx` — frontend routing gate
2. `functions/src/index.ts` — backend auth check

Then build and deploy both frontend and function.

### Toggling features without deploying

Visit `undersurface.me/admin` → Settings tab:
- Toggle `partsEnabled` to disable/enable AI thoughts
- Toggle `visualEffectsEnabled` to disable/enable breathing background
- Toggle `autocorrectEnabled` to disable/enable spell correction
- Set an announcement message to show a banner to all users

Changes propagate in real-time via Firestore `onSnapshot`.

## Domains

| URL | Purpose |
|-----|---------|
| [undersurface.me](https://undersurface.me) | Custom domain (primary) |
| [undersurfaceme.web.app](https://undersurfaceme.web.app) | Firebase default |
| [undersurfaceme.firebaseapp.com](https://undersurfaceme.firebaseapp.com) | Firebase legacy |

DNS is managed in Cloudflare (DNS-only mode, proxy OFF for A records). Firebase Auth has all three domains authorized for Google Sign-In.

## Code Conventions

- **TypeScript strict mode** — no `any`, use `import type {}` for type-only imports
- **No semicolons** — project uses no-semicolon style
- **Single quotes** — for strings
- **Tailwind CSS v4** — uses `@tailwindcss/vite` plugin, import with `@import "tailwindcss"` in CSS
- **TipTap v3** — editor storage types extended via `interface Storage {}` in `@tiptap/core` (see `src/types/tiptap.d.ts`)
- **Functional components** — class components only for `ErrorBoundary`
- **`useMemo` over `useEffect+setState`** — for derived state, to avoid cascading renders
- **Settings are reactive** — `useSettings()` via `useSyncExternalStore`, `getSettings()` for non-React code
- **Global config is reactive** — `useGlobalConfig()` via `useSyncExternalStore`, `getGlobalConfig()` for non-React code
- **Admin components use inline styles** — consistent warm muted palette (Inter font, #FAF8F5 bg, #A09A94 subtle, #2D2B29 text)
- **Feature flags use `=== false`** — so `null`/`undefined` defaults to enabled

## Known Gotchas

- **Refs in React setState callbacks** — Always capture ref values in a local variable before calling setState. React batches updates and the ref can change mid-callback.
- **TipTap editor.storage types** — Extended via `@tiptap/core` module augmentation in `src/types/tiptap.d.ts`, not via `EditorStorageMap`.
- **Damerau-Levenshtein distance** — "recieve" → "receive" is distance 1 (transposition), not 2.
- **Firebase offline persistence** — Uses `persistentLocalCache` + `persistentMultipleTabManager`. Initialized in `firebase.ts` before any Firestore calls.
- **Cloud Function streaming** — Requires `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform` headers to prevent CDN buffering of SSE.
- **Cloudflare DNS proxy** — Must be OFF (DNS only / gray cloud) for A records pointing to Firebase Hosting. Proxied mode breaks SSL provisioning.
- **CI build** — Uses dummy `VITE_FIREBASE_*` env vars since Firebase config is public and only needed at runtime.
- **Feature flags default to enabled** — `getGlobalConfig()` returns `null` before `appConfig/global` exists. All flag checks use `=== false` so `null`/`undefined` = enabled. The doc is created on first admin Settings save.
- **Admin API timeout** — `generateInsights` calls OpenRouter and can take 10-30s. The `adminApi` function has a 120s timeout to accommodate this.
- **`firebase.json` firestore section** — Required for `firebase deploy --only firestore:rules` to work. Contains `"rules": "firestore.rules"`.
- **PWA service worker caches aggressively** — After deploys, unregister the SW + hard refresh to test new changes.
- **`chatCompletion()` default `max_tokens: 150`** — Only for short inline thoughts. Structured JSON responses (reflection engine, part growth) need 600–800 tokens — pass `maxTokens` explicitly.
- **Settings cache invalidation** — `invalidateSettingsCache()` must be called when global config changes. This is wired up in the `onSnapshot` callback in `globalConfig.ts`.

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
