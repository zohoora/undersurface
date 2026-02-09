# CLAUDE.md — UnderSurface

## What is this project?

A diary app where IFS-inspired AI inner voices respond as the user writes. The user types in a rich text editor; when they pause, slow down, or trail off, an AI "part" speaks on the page. Live at [undersurface.me](https://undersurface.me).

## Quick Reference

```bash
npm run dev              # Dev server → localhost:5173
npm run build            # Production build → dist/
npm run lint             # ESLint
npm run test             # Vitest
npm run preview          # Preview production build locally
```

## Deploying Changes

The app runs on Firebase. There are two deployable units:

### 1. Frontend (Firebase Hosting)

Static files built by Vite, served from `dist/`.

```bash
npm run build
firebase deploy --only hosting
```

### 2. Cloud Function (Firebase Functions)

A single Cloud Function (`chat`) that proxies AI requests to OpenRouter. Located in `functions/`.

```bash
cd functions && npx tsc && cd ..
firebase deploy --only functions
```

### Deploy both at once

```bash
npm run build && cd functions && npx tsc && cd .. && firebase deploy
```

### Decision table: what to deploy

| What changed | Build | Deploy |
|---|---|---|
| Anything in `src/` | `npm run build` | `firebase deploy --only hosting` |
| Anything in `functions/src/` | `cd functions && npx tsc` | `firebase deploy --only functions` |
| `firestore.rules` | — | `firebase deploy --only firestore:rules` |
| Both `src/` and `functions/` | Both build steps | `firebase deploy` |

### Before deploying

1. Run `npm run build` — must succeed with zero errors
2. If you changed the Cloud Function, run `cd functions && npx tsc` — must succeed
3. You must be logged into Firebase CLI (`firebase login`)
4. You must have access to the `undersurfaceme` Firebase project

## Architecture

### Request flow for AI responses

```
User types → PauseDetector → PartOrchestrator → openrouter.ts
  → fetch('/api/chat', { auth: Firebase ID token })
  → Firebase Hosting rewrite → Cloud Function
  → Cloud Function verifies auth token
  → Cloud Function reads API key from Google Secret Manager
  → Proxies to OpenRouter API
  → Streams SSE response back to browser
```

### Key files

| File | Purpose |
|------|---------|
| `src/ai/openrouter.ts` | Client-side API calls (sends to `/api/chat` with Firebase auth token) |
| `src/ai/partPrompts.ts` | System prompts for all 5 seeded parts + emergence, reflection, growth prompts |
| `src/engine/partOrchestrator.ts` | Selects which part responds based on pause type, emotion, content (role-based scoring) |
| `src/engine/pauseDetector.ts` | Detects writing pauses from keystroke timing |
| `src/engine/emergenceEngine.ts` | Detects new parts emerging from writing |
| `src/engine/reflectionEngine.ts` | Entry reflection — creates memories, summaries, profile updates on entry switch |
| `src/engine/partGrowthEngine.ts` | Periodic part evolution — updates prompts, keywords, emotions every 5 entries |
| `src/engine/spellEngine.ts` | Autocorrect (Damerau-Levenshtein + Typo.js) |
| `src/store/db.ts` | Firestore wrapper — mimics Dexie.js API surface |
| `src/store/settings.ts` | User settings in localStorage |
| `src/firebase.ts` | Firebase/Firestore initialization with offline persistence |
| `functions/src/index.ts` | Cloud Function — the OpenRouter proxy |
| `firebase.json` | Hosting config + `/api/chat` rewrite to Cloud Function |
| `firestore.rules` | Security rules — users can only access their own data |

### Data storage

- **Firestore**: All user data under `users/{uid}/` — entries, parts, memories, thoughts, interactions, entrySummaries, userProfile
- **localStorage**: Device-specific settings (model choice, visual effect toggles, response speed)
- **Google Secret Manager**: The OpenRouter API key (`OPENROUTER_API_KEY`)

### Auth

Firebase Authentication with Google Sign-In only. The auth flow:
- `src/auth/AuthContext.tsx` provides user state
- `src/auth/useAuth.ts` is the hook components use
- `App.tsx` gates the entire app behind auth — unauthenticated users see `LoginScreen`
- The Cloud Function verifies Firebase ID tokens on every request

### Adaptive parts system

Parts learn and evolve through five layers:

1. **Dynamic scoring** — `partOrchestrator.ts` uses `ifsRole`-based lookup tables (not part IDs), so emerged parts score correctly out of the box. Parts also score on `concern` words and `learnedKeywords`.
2. **Observation memories** — Every inline thought creates a `type: 'observation'` memory. Thinking Out Loud interactions create `type: 'interaction'` memories.
3. **Reflection engine** — When the user switches entries, `reflectionEngine.ts` runs a single AI call analyzing the full entry + thoughts + interactions. Produces entry summaries, reflection/pattern memories, keyword suggestions, and user profile updates. Cost: ~1 API call per entry transition.
4. **Enhanced prompts** — `buildPartMessages()` injects categorized memories (reflections, patterns, interactions, observations), user profile (`innerLandscape`, `recurringThemes`), and entry summaries (for manager/self-role parts).
5. **Part growth** — Every 5 entry summaries, `partGrowthEngine.ts` runs a single AI call that evolves parts: updates `systemPromptAddition`, `learnedKeywords`, `learnedEmotions`. Cost: ~1 API call per 5 entries.

Key types: `PartMemory.type` (`'observation' | 'interaction' | 'reflection' | 'pattern'`), `EntrySummary`, `UserProfile`, `Part.learnedKeywords`, `Part.systemPromptAddition`.

### Environment variables

Defined in `.env.local` (git-ignored):

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

These are public Firebase client config values (security is via Firestore rules + auth, not config secrecy).

## Code Conventions

- **TypeScript strict mode** — no `any`, use `import type {}` for type-only imports
- **Tailwind CSS v4** — uses `@tailwindcss/vite` plugin, import with `@import "tailwindcss"` in CSS
- **TipTap v3** — editor storage types extended via `interface Storage {}` in `@tiptap/core` (see `src/types/tiptap.d.ts`)
- **No semicolons** — project uses no-semicolon style
- **Single quotes** — for strings
- **Functional components** — class components only for ErrorBoundary
- **useMemo over useEffect+setState** — for derived state, to avoid cascading renders
- **Settings are reactive** — `useSettings()` hook via `useSyncExternalStore`, `getSettings()` for non-React code

## Common Tasks

### Changing the AI model

Update in two places:
1. `src/store/settings.ts` → `DEFAULTS.openRouterModel`
2. `src/ai/openrouter.ts` → the `getModel()` fallback
3. `functions/src/index.ts` → the `model ||` fallback

Then build and deploy both frontend and function.

### Updating the OpenRouter API key

```bash
echo "sk-or-v1-new-key-here" | firebase functions:secrets:set OPENROUTER_API_KEY
cd functions && npx tsc && cd ..
firebase deploy --only functions
```

### Adding a new seeded part

1. Add to `SEEDED_PARTS` array in `src/ai/partPrompts.ts`
2. Scoring is now role-based (`ifsRole`) — no per-part changes needed in orchestrator
3. The part's `concern` field words are automatically used as content keywords
4. To customize role-level scoring, edit `ROLE_PAUSE_AFFINITIES`, `ROLE_KEYWORDS`, or `ROLE_EMOTIONS` in `partOrchestrator.ts`

### Adding a new Firestore collection

1. Add proxy in `src/store/db.ts`: `newCollection: createCollectionProxy('newCollection')`
2. Firestore rules already allow all subcollections under `users/{uid}/` — no rule changes needed
3. Add TypeScript interface in `src/types/index.ts`

### Modifying Firestore security rules

1. Edit `firestore.rules`
2. Deploy: `firebase deploy --only firestore:rules`

### Adding a new authorized domain

If the app needs to work on a new domain:
1. Firebase Console → Authentication → Settings → Authorized domains → Add domain
2. Update `HTTP-Referer` header in `functions/src/index.ts` if needed

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

## Known Gotchas

- **Refs in React setState callbacks**: Always capture ref values in a local variable before calling setState — React batches updates and the ref can change
- **TipTap editor.storage types**: Extended via `@tiptap/core` module augmentation in `src/types/tiptap.d.ts`, not via `EditorStorageMap`
- **Damerau-Levenshtein**: "recieve" → "receive" is distance 1 (transposition), not 2
- **Firebase offline persistence**: Uses `persistentLocalCache` + `persistentMultipleTabManager` — initialized in `firebase.ts` before any Firestore calls
- **Cloud Function streaming**: Requires `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform` headers to prevent CDN buffering of SSE
- **Cloudflare DNS proxy**: Must be OFF (DNS only / gray cloud) for the A record pointing to Firebase Hosting — proxied mode breaks SSL provisioning
- **CI build**: Uses dummy `VITE_FIREBASE_*` env vars since Firebase config is public and only needed at runtime
