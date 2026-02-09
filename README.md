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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 7 |
| Editor | TipTap 3 (ProseMirror) |
| Styling | Tailwind CSS v4 |
| Animation | Framer Motion |
| Auth | Firebase Authentication (Google Sign-In) |
| Database | Cloud Firestore (with offline persistence) |
| AI | OpenRouter API (Gemini 3 Flash) via Cloud Function proxy |
| Hosting | Firebase Hosting |
| PWA | vite-plugin-pwa + Workbox |
| Spellcheck | Typo.js + dictionary-en |
| CI | GitHub Actions |

## Project Structure

```
undersurface/
├── src/
│   ├── ai/                  # AI integration
│   │   ├── openrouter.ts    # API client (calls /api/chat proxy)
│   │   └── partPrompts.ts   # System prompts for each part
│   ├── auth/                # Firebase authentication
│   │   ├── AuthContext.tsx   # Auth provider component
│   │   ├── authContext.ts    # Context definition
│   │   └── useAuth.ts       # Auth hook
│   ├── components/
│   │   ├── Atmosphere/      # Visual effects (breathing bg, cursor glow, pause ripple)
│   │   ├── Editor/          # TipTap editor + part thought bubbles
│   │   ├── Sidebar/         # Entry list, settings panel, model selector
│   │   ├── ThinkingOutLoud/ # Multi-turn dialogue with parts
│   │   ├── ErrorBoundary.tsx
│   │   ├── LoginScreen.tsx
│   │   └── Onboarding.tsx
│   ├── engine/              # Core logic
│   │   ├── pauseDetector.ts      # Detects writing pauses from keystrokes
│   │   ├── partOrchestrator.ts   # Selects which part responds and when
│   │   ├── emergenceEngine.ts    # Detects and creates new emergent parts
│   │   └── spellEngine.ts        # Autocorrect engine
│   ├── extensions/          # TipTap extensions (ink weight, color bleed, etc.)
│   ├── store/
│   │   ├── db.ts            # Firestore wrapper (mimics Dexie API)
│   │   └── settings.ts      # localStorage settings (model, visual prefs)
│   ├── styles/              # Atmosphere CSS animations
│   ├── types/               # TypeScript interfaces
│   ├── App.tsx              # Root component (auth gate, entry management)
│   ├── firebase.ts          # Firebase initialization
│   └── main.tsx             # React entry point
├── functions/               # Firebase Cloud Functions
│   ├── src/index.ts         # Chat proxy function
│   ├── package.json
│   └── tsconfig.json
├── public/                  # Static assets (PWA manifest, icons, dictionaries)
├── firebase.json            # Firebase hosting + functions config
├── firestore.rules          # Firestore security rules
├── vite.config.ts           # Vite + Tailwind + PWA config
└── .github/workflows/ci.yml # CI pipeline
```

## Development

### Prerequisites

- Node.js 22+
- Firebase CLI (`npm install -g firebase-tools`)
- Access to the `undersurfaceme` Firebase project

### Setup

```bash
git clone git@github.com:zohoora/undersurface.git
cd undersurface
npm install
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

### Run locally

```bash
npm run dev          # Dev server at localhost:5173
npm run build        # Production build to dist/
npm run preview      # Preview production build
npm run lint         # ESLint
npm run test         # Vitest
```

## Deployment

The app is deployed to Firebase (hosting + Cloud Function). There are two things to deploy: the **frontend** (static files in `dist/`) and the **Cloud Function** (the `/api/chat` proxy in `functions/`).

### Deploy everything (most common)

```bash
# 1. Build the frontend
npm run build

# 2. Compile the Cloud Function
cd functions && npx tsc && cd ..

# 3. Deploy both hosting and functions
firebase deploy
```

### Deploy only the frontend

If you only changed frontend code (anything in `src/`):

```bash
npm run build
firebase deploy --only hosting
```

### Deploy only the Cloud Function

If you only changed the function (anything in `functions/src/`):

```bash
cd functions && npx tsc && cd ..
firebase deploy --only functions
```

### What gets deployed where

| Change | Build step | Deploy command |
|--------|-----------|----------------|
| UI components, styles, settings | `npm run build` | `firebase deploy --only hosting` |
| AI model, prompts, settings defaults | `npm run build` | `firebase deploy --only hosting` |
| Cloud Function (proxy logic, auth) | `cd functions && npx tsc` | `firebase deploy --only functions` |
| Firestore security rules | None | `firebase deploy --only firestore:rules` |
| Both frontend + function | Both steps above | `firebase deploy` |

### Cloud Function architecture

The Cloud Function (`functions/src/index.ts`) is a proxy between the frontend and OpenRouter:

```
Browser → /api/chat → Firebase Hosting rewrite → Cloud Function → OpenRouter API
```

- The browser sends requests to `/api/chat` with a Firebase Auth token
- Firebase Hosting rewrites this to the `chat` Cloud Function
- The function verifies the auth token, then proxies to OpenRouter
- The OpenRouter API key is stored in **Google Secret Manager** (not in code)
- Supports both streaming (SSE) and non-streaming responses

### Managing the OpenRouter API key

The API key is stored as a Firebase secret, not in any file:

```bash
# View current secret
firebase functions:secrets:access OPENROUTER_API_KEY

# Update the secret
echo "sk-or-v1-..." | firebase functions:secrets:set OPENROUTER_API_KEY

# After updating, redeploy the function
cd functions && npx tsc && cd ..
firebase deploy --only functions
```

### Changing the AI model

The default model is set in three places:

1. **Client-side default**: `src/store/settings.ts` → `DEFAULTS.openRouterModel`
2. **Client-side fallback**: `src/ai/openrouter.ts` → `getModel()` fallback
3. **Server-side fallback**: `functions/src/index.ts` → the `model ||` fallback

The client sends its preferred model to the function, so the server fallback only applies if the client omits it. To change the default model, update all three files, then rebuild and deploy both.

### Domains

| URL | Purpose |
|-----|---------|
| [undersurface.me](https://undersurface.me) | Custom domain (primary) |
| [undersurfaceme.web.app](https://undersurfaceme.web.app) | Firebase default |
| [undersurfaceme.firebaseapp.com](https://undersurfaceme.firebaseapp.com) | Firebase legacy |

DNS is managed in Cloudflare. Firebase Auth has all three domains authorized for Google Sign-In.

## Data Model

All user data is stored in Firestore under `users/{uid}/`:

| Collection | Description |
|-----------|-------------|
| `entries` | Diary entries (content as HTML, plainText, timestamps) |
| `parts` | Inner voice definitions (name, color, IFS role, system prompt) |
| `memories` | Persistent memories parts carry across entries |
| `thoughts` | Individual part responses anchored to entry text |
| `interactions` | Multi-turn "Thinking Out Loud" conversations |

Security rule: users can only read/write their own data (`request.auth.uid == userId`).

## Settings

User preferences are stored in `localStorage` (not Firestore — they're device-specific):

- `openRouterModel` — AI model ID (default: `anthropic/claude-opus-4`)
- `responseSpeed` — How quickly parts respond (0.5–2.0)
- `paragraphFade`, `inkWeight`, `colorBleed`, `breathingBackground` — Visual effects
- `autoCapitalize`, `autocorrect` — Text correction features
