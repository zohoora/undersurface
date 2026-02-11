# CLAUDE.md — UnderSurface

## What is this project?

A diary app where AI inner voices encourage and guide the user's writing. The user types in a rich text editor; when they pause, slow down, or trail off, an AI "part" speaks on the page — nudging them to go deeper, keep going, or find what they haven't said yet. Live at [undersurface.me](https://undersurface.me).

## Quick Reference

```bash
npm run dev              # Dev server → localhost:5173
npm run build            # Production build → dist/
npm run lint             # ESLint
npm run test             # Vitest
npm run preview          # Preview production build locally
```

## Deploying Changes

The app runs on Firebase. There are three deployable units:

### 1. Frontend (Firebase Hosting + PWA)

Static files built by Vite, served from `dist/`. PWA enabled via `vite-plugin-pwa` — service worker auto-updates, precaches static assets and Google Fonts.

```bash
npm run build
firebase deploy --only hosting
```

### 2. Cloud Functions (Firebase Functions, Node.js 22)

Three Cloud Functions in `functions/src/index.ts`:
- **`chat`** — proxies AI requests to OpenRouter (256MiB, 30s timeout)
- **`accountApi`** — user self-service: account deletion + contact form (256MiB, 60s timeout)
- **`adminApi`** — admin dashboard backend with 8 actions (512MiB, 120s timeout)

```bash
cd functions && npx tsc && cd ..
firebase deploy --only functions
```

### 3. Firestore Rules

```bash
firebase deploy --only firestore:rules
```

### Deploy everything at once

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
  → Firebase Hosting rewrite → Cloud Function (chat)
  → Cloud Function verifies auth token
  → Cloud Function reads API key from Google Secret Manager
  → Proxies to OpenRouter API
  → Streams SSE response back to browser
```

### Request flow for admin dashboard

```
Admin visits /admin → App.tsx checks ADMIN_EMAILS → renders AdminDashboard (lazy-loaded)
  → adminApi.ts: fetch('/api/admin', { action, auth token })
  → Firebase Hosting rewrite → Cloud Function (adminApi)
  → Cloud Function verifies token + checks email against ADMIN_EMAILS
  → Uses Firebase Admin SDK to query across all users (bypasses Firestore rules)
  → Returns aggregated data / LLM insights / config updates / analytics / messages
```

### Request flow for account actions

```
User opens Settings → Delete Account / Contact form
  → accountApi.ts: fetch('/api/account', { action, auth token })
  → Firebase Hosting rewrite → Cloud Function (accountApi)
  → Cloud Function verifies auth token, extracts uid
  → deleteAccount: deletes all 12 user subcollections + user doc + Firebase Auth record
  → submitContact: validates message, writes to top-level contactMessages collection
```

### Key files

| File | Purpose |
|------|---------|
| `src/ai/openrouter.ts` | Client-side API calls (sends to `/api/chat` with Firebase auth token) |
| `src/ai/partPrompts.ts` | System prompts for all 6 seeded parts + exported SHARED_INSTRUCTIONS + emergence, reflection, growth, grounding, intention prompts |
| `src/engine/partOrchestrator.ts` | Selects which part responds based on pause type, emotion, content (role-based scoring); distress detection triggers grounding; passes intention to prompts |
| `src/engine/pauseDetector.ts` | Detects writing pauses from keystroke timing |
| `src/engine/emergenceEngine.ts` | Detects new parts emerging from writing (imports `SHARED_INSTRUCTIONS` from partPrompts) |
| `src/engine/reflectionEngine.ts` | Entry reflection — creates memories, summaries, profile updates on entry switch |
| `src/engine/partGrowthEngine.ts` | Periodic part evolution — updates prompts, keywords, emotions every 5 entries |
| `src/engine/spellEngine.ts` | Autocorrect (Damerau-Levenshtein + Typo.js) |
| `src/engine/weatherEngine.ts` | Inner weather tracking from emotional tone shifts |
| `src/engine/ritualEngine.ts` | Session logging for ritual detection (writing habits) |
| `src/engine/fossilEngine.ts` | Resurfaces old entry commentary when revisiting past entries |
| `src/engine/explorationEngine.ts` | AI-generated personalized writing prompts from user profile + recent summaries |
| `src/store/db.ts` | Firestore wrapper — mimics Dexie.js API surface; 12 collection proxies + Markdown data export |
| `src/store/settings.ts` | User settings in localStorage (3-tier cascade: hardcoded < globalConfig < localStorage) |
| `src/store/globalConfig.ts` | Real-time listener on `appConfig/global` Firestore doc, provides `useGlobalConfig()` hook |
| `src/firebase.ts` | Firebase/Firestore initialization with offline persistence |
| `src/auth/authContext.ts` | Auth context type: `signIn` (Google), `signInWithEmail`, `signUpWithEmail`, `resetPassword`, `signOut` |
| `src/auth/AuthContext.tsx` | Auth provider — Google + Email/Password + password reset via `sendPasswordResetEmail` |
| `src/auth/useAuth.ts` | Hook for consuming auth context |
| `src/api/accountApi.ts` | Client-side account API caller for `deleteAccount` and `submitContact` actions |
| `src/components/LoginScreen.tsx` | Landing page + auth: artistic design with Spectral serif poetry, breathing circle animation, email/password form (sign-in, sign-up, password reset modes), Google sign-in alternative |
| `src/components/Onboarding.tsx` | Post-signup consent flow (terms acceptance) |
| `src/components/CrisisResources.tsx` | Crisis resource links shown during grounding mode |
| `src/components/DeleteAccountModal.tsx` | Account deletion confirmation modal |
| `src/components/PolicyContent.tsx` | Privacy policy and disclaimer content |
| `src/components/PolicyModal.tsx` | Modal wrapper for policy content |
| `src/components/InnerWeather.tsx` | Inner weather display widget |
| `src/components/SessionClosing.tsx` | Session closing overlay — shows The Weaver's closing thought with fade-in/out animation |
| `src/components/AnnouncementBanner.tsx` | Fixed banner from global config, dismissible via sessionStorage |
| `src/components/Editor/LivingEditor.tsx` | TipTap-based rich text editor with part thoughts, autocorrect, color bleed |
| `src/components/Editor/IntentionInput.tsx` | Subtle per-entry intention input (ghost button → inline edit, 120 char max) |
| `src/components/Editor/ExplorationCard.tsx` | Clickable exploration prompt card with dismiss button |
| `src/components/Sidebar/EntriesList.tsx` | Entry list sidebar |
| `src/components/Sidebar/SettingsPanel.tsx` | User settings panel (appearance, model, speed, data export, contact form, delete account) |
| `src/admin/adminTypes.ts` | TypeScript types for admin API responses + `GlobalConfig` |
| `src/admin/adminApi.ts` | Client-side admin API caller (`adminFetch(action, params)`) |
| `src/admin/AdminDashboard.tsx` | Admin shell with tab navigation (Overview, Users, Analytics, Messages, Insights, Settings). Lazy-loaded via `React.lazy` — default export. |
| `src/admin/AdminOverview.tsx` | Metric cards + recent activity feed |
| `src/admin/AdminUsers.tsx` | User table with drill-down |
| `src/admin/AdminUserDetail.tsx` | Full user data view (entries, parts, thoughts, profile) |
| `src/admin/AdminAnalytics.tsx` | Active users, engagement metrics, entries/day chart, signups/week chart, part usage chart |
| `src/admin/AdminMessages.tsx` | Contact message inbox for admin |
| `src/admin/AdminInsights.tsx` | LLM-generated narrative analysis of app usage |
| `src/admin/AdminSettings.tsx` | Form for GlobalConfig (model, speed, feature flags, announcements, version signal) |
| `src/hooks/useTheme.ts` | Theme resolution hook (light/dark/system) + media query listener, applies `data-theme` on `<html>` |
| `src/hooks/useGroundingMode.ts` | Grounding state via `useSyncExternalStore`, sets `data-grounding` on `<html>`, auto-exit timer |
| `src/hooks/useFlowState.ts` | Flow state detection from keystroke timing, sets `data-flow` + `--flow-intensity` on `<html>` |
| `src/hooks/useTimeAwarePalette.ts` | Time-of-day hue shifts on the atmosphere |
| `src/hooks/useSeasonalPalette.ts` | Seasonal color shifts |
| `src/hooks/useHandwritingMode.ts` | Handwriting font mode |
| `src/extensions/colorBleed.ts` | TipTap extension — tints recent text with part color; disabled in dark mode, returns `DecorationSet.empty` |
| `functions/src/index.ts` | Cloud Functions — `chat` (OpenRouter proxy) + `accountApi` (user self-service) + `adminApi` (admin backend) |
| `firebase.json` | Hosting config + rewrites: `/api/chat` → `chat`, `/api/admin` → `adminApi`, `/api/account` → `accountApi` |
| `firestore.rules` | Security rules — users read/write own data; `appConfig` readable by all authenticated; `contactMessages` deny-all (written via Admin SDK only) |
| `vite.config.ts` | Vite + React + Tailwind CSS v4 + VitePWA (precaching + Google Fonts caching) |
| `public/robots.txt` | SEO: allows all except `/admin`, references sitemap |
| `public/sitemap.xml` | SEO: single URL entry for `https://undersurface.me/` |
| `public/og-image.png` | 1200x630 Open Graph image (warm background, Spectral title, Inter tagline) |

### Data storage

- **Firestore**: User data under `users/{uid}/` — 12 subcollections: entries, parts, memories, thoughts, interactions, entrySummaries, userProfile, fossils, letters, sessionLog, innerWeather, consent
- **Firestore**: Global config at `appConfig/global` — readable by all authenticated users, writable only via `adminApi` Cloud Function (Admin SDK bypasses rules)
- **Firestore**: Contact messages at top-level `contactMessages` — deny-all in client rules, written by `accountApi` Cloud Function via Admin SDK, read by `adminApi`
- **localStorage**: Device-specific settings (theme, model choice, visual effect toggles, response speed)
- **Google Secret Manager**: The OpenRouter API key (`OPENROUTER_API_KEY`)

### Auth

Firebase Authentication with Google Sign-In and Email/Password. The auth flow:
- `src/auth/AuthContext.tsx` provides user state and auth methods: `signIn` (Google popup), `signInWithEmail`, `signUpWithEmail`, `resetPassword` (sends Firebase password reset email), `signOut`
- `src/auth/authContext.ts` defines the `AuthContextValue` interface
- `src/auth/useAuth.ts` is the hook components use
- `App.tsx` gates the entire app behind auth — unauthenticated users see `LoginScreen`
- The `LoginScreen` serves as both landing page and auth form: email/password with sign-in, sign-up, and password reset modes; Google sign-in as alternative
- The Cloud Functions verify Firebase ID tokens on every request
- `adminApi` additionally checks email against `ADMIN_EMAILS` allowlist (hardcoded in both `functions/src/index.ts` and `src/App.tsx`)

### URL routing

The app is a single-page application. URL routing is handled in `App.tsx`:
- `/` — main diary editor
- `/admin` — admin dashboard (checks `ADMIN_EMAILS`, lazy-loads `AdminDashboard`)
- Any other path — redirects to `/` via `history.replaceState`

### Admin dashboard

Available at `/admin` for admin users only (currently `zohoora@gmail.com`). Two-layer access control:

1. **Frontend** — `App.tsx` checks `ADMIN_EMAILS` before rendering `AdminDashboard`; non-admins are redirected to `/`
2. **Backend** — `adminApi` Cloud Function verifies email from the Firebase ID token; returns 403 for non-admins

The admin route is checked before DB initialization, so the admin page doesn't load TipTap, spell engine, or other diary components. `AdminDashboard` is lazy-loaded via `React.lazy()` + `Suspense` to keep it out of the main bundle.

Admin has 6 tabs: **Overview**, **Users**, **Analytics**, **Messages**, **Insights**, **Settings**.

#### Admin API actions

| Action | Input | Returns |
|--------|-------|---------|
| `getOverview` | — | userCount, totalEntries, totalThoughts, totalInteractions, recentActivity[] |
| `getUserList` | — | users[] with counts, words, lastActive |
| `getUserDetail` | `{ uid }` | Full user data: entries, parts, thoughts, interactions, memories, profile, summaries |
| `getConfig` | — | Current GlobalConfig from `appConfig/global` |
| `updateConfig` | `{ config }` | Merged config (sets updatedAt + updatedBy) |
| `getAnalytics` | — | activeUsers (daily/weekly/monthly), signupsByWeek, entriesByDay, partUsage, engagement metrics |
| `generateInsights` | — | LLM narrative + highlights from entry summaries and user profiles |
| `getContactMessages` | — | Up to 100 most recent contact messages, ordered by createdAt desc |

#### Account API actions

| Action | Input | Returns |
|--------|-------|---------|
| `deleteAccount` | — | Deletes all 12 user subcollections + user doc + Firebase Auth user |
| `submitContact` | `{ message }` | Writes to top-level `contactMessages` collection (validated, max 5000 chars) |

### Global config and feature flags

`appConfig/global` is a Firestore document that provides app-wide defaults and feature flags. It is:
- Listened to in real-time via `onSnapshot` in `src/store/globalConfig.ts`
- Readable by all authenticated users (for announcements + defaults)
- Writable only through the admin Cloud Function (Admin SDK)

#### Settings cascade

User settings follow a 3-tier priority:
```
user localStorage > appConfig/global defaults > hardcoded DEFAULTS
```

When globalConfig updates, `invalidateSettingsCache()` is called so new defaults propagate. Existing users keep their localStorage values for any settings they've explicitly changed.

#### Feature flags

| Flag | Where checked | Default | Effect when off |
|------|---------------|---------|-----------------|
| `features.partsEnabled` | `partOrchestrator.ts` top of `handlePause` | enabled | No AI thoughts generated |
| `features.visualEffectsEnabled` | `App.tsx` — `BreathingBackground` enabled prop | enabled | Static background |
| `features.autocorrectEnabled` | `LivingEditor.tsx` autocorrect block | enabled | Skip correction |
| `features.emergencyGrounding` | `partOrchestrator.ts` `checkDistress()` | **disabled** | No distress detection, no grounding toggle in settings |
| `features.intentionsEnabled` | `App.tsx` — `IntentionInput` render guard | **disabled** | No intention input above editor |
| `features.guidedExplorations` | `explorationEngine.ts` `shouldSuggest()` | **disabled** | No AI writing prompts on new entries |

**Core flags** (partsEnabled, visualEffects, autocorrect) default to **enabled** — checks use `=== false` so `undefined`/`null` are treated as enabled.

**Experimental flags** (emergencyGrounding, intentions, explorations) default to **disabled** — checks use `=== true` so they must be explicitly enabled in admin Settings.

#### Announcements

When `config.announcement` is set (via admin Settings tab), `AnnouncementBanner` renders a fixed banner at the top of the viewport. Supports `info` and `warning` types. Dismissible announcements are tracked per-message in sessionStorage.

#### Version signal (update notification)

`globalConfig.ts` tracks `buildVersion` from `appConfig/global`. On first snapshot, it captures the initial version. If a subsequent snapshot has a different `buildVersion`, `hasNewVersion` flips to `true` and a refresh banner appears in `App.tsx`. Admins bump the version via "Signal Update" button in `AdminSettings.tsx` (sets `buildVersion` to ISO timestamp). No polling — purely reactive via Firestore `onSnapshot`.

### Dark mode / theme system

The app supports light, dark, and system-follow themes via `[data-theme="dark"]` CSS attribute on `<html>`.

#### How it works

1. **CSS variable architecture** — All colors are defined as CSS custom properties in `atmosphere.css` `:root`. The `[data-theme="dark"]` block overrides every variable with warm dark equivalents (deep charcoals, not blue-blacks).
2. **Semantic overlay variables** — `--overlay-subtle`, `--overlay-light`, `--overlay-medium`, `--surface-primary`, `--border-subtle`, `--border-light`, `--sidebar-bg`, `--banner-*` variables ensure overlays, surfaces, and borders adapt to the theme.
3. **Emotion dark variants** — Each of the 9 emotions has a `[data-theme="dark"] .atmosphere[data-emotion="..."]` override with subtle warm shifts around the dark base.
4. **Theme hook** — `useTheme()` in `src/hooks/useTheme.ts` resolves the setting (`light`/`dark`/`system`) to an actual theme, listens to `prefers-color-scheme` media query for `system` mode, and sets `data-theme` on `<html>`.
5. **Settings** — `theme: 'light' | 'dark' | 'system'` in `AppSettings`, default `'system'`. Toggle is in SettingsPanel under "Appearance".
6. **Inline styles** — Components with React inline styles (LoginScreen, Onboarding, ErrorBoundary, AnnouncementBanner, SettingsPanel, App loading states) use `var(--bg-primary)` etc. instead of hardcoded hex.
7. **Color bleed** — Disabled in dark mode. `LivingEditor.tsx` passes `disabled: true` to the colorBleed extension when `theme === 'dark'`. The extension returns `DecorationSet.empty` when disabled, clearing all existing tint decorations.
8. **Part colors** — `colorLight` alpha is boosted from `'25'` to `'30'` in dark mode via `boostAlpha()` helper in `PartThoughtBubble.tsx` and `ThinkingSpace.tsx`.

#### Adding new themed components

Use CSS `var()` references for all colors. For React inline styles: `style={{ background: 'var(--bg-primary)' }}`. For CSS: just use the variable. The `[data-theme="dark"]` block in `atmosphere.css` handles the rest.

### Adaptive parts system

Parts learn and evolve through five layers:

1. **Dynamic scoring** — `partOrchestrator.ts` uses `ifsRole`-based lookup tables (not part IDs), so emerged parts score correctly out of the box. Parts also score on `concern` words and `learnedKeywords`.
2. **Observation memories** — Every inline thought creates a `type: 'observation'` memory. Thinking Out Loud interactions create `type: 'interaction'` memories.
3. **Reflection engine** — When the user switches entries, `reflectionEngine.ts` runs a single AI call analyzing the full entry + thoughts + interactions. Produces entry summaries, reflection/pattern memories, keyword suggestions, and user profile updates. Cost: ~1 API call per entry transition.
4. **Enhanced prompts** — `buildPartMessages()` injects categorized memories (reflections, patterns, interactions, observations), user profile (`innerLandscape`, `recurringThemes`), and entry summaries (for manager/self-role parts).
5. **Part growth** — Every 5 entry summaries, `partGrowthEngine.ts` runs a single AI call that evolves parts: updates `systemPromptAddition`, `learnedKeywords`, `learnedEmotions`. Cost: ~1 API call per 5 entries.

Key types: `PartMemory.type` (`'observation' | 'interaction' | 'reflection' | 'pattern'`), `EntrySummary`, `UserProfile`, `Part.learnedKeywords`, `Part.systemPromptAddition`.

**Shared instructions**: `SHARED_INSTRUCTIONS` is exported from `partPrompts.ts` and used by both seeded part prompts and `emergenceEngine.ts` for emerged parts. It defines the writing-companion purpose ("encourage and guide the writing"), critical rules, and safety guardrails. All parts (seeded and emerged) inherit the same base instructions from this single source of truth.

### Emergency grounding

When the writer is in distress, the app shifts to a calming mode. Controlled by `features.emergencyGrounding`.

#### How it works

1. **Distress detection** — `partOrchestrator.ts` scans the last 500 characters for distress keywords (scared, terrified, panic, spiraling, etc.) on every pause. Adds +1 if current emotion is `anxious` or `fearful`. If hits >= `intensityThreshold` (default 3), activates grounding.
2. **Grounding state** — `useGroundingMode.ts` uses module-level state + `useSyncExternalStore` (same pattern as `useFlowState`). Sets `data-grounding="true"` on `<html>`. Exposes `activateGrounding()`, `deactivateGrounding()`, `isGroundingActive()` for non-React code.
3. **Auto-exit** — Timer deactivates grounding after `autoExitMinutes` (default 5). Re-triggering resets the timer.
4. **Atmosphere** — `atmosphere.css` `[data-grounding="true"]` rules: desaturated greens, nearly 2x slower breathing, overrides emotional atmosphere. Thoughts get `filter: saturate(0.6)`. Flow glow suppressed. Dark mode variant included.
5. **Part scoring** — Self-role parts (The Still, The Open) get `+selfRoleScoreBonus` (default 40), all other roles get `-otherRolePenalty` (default 30). Strongly favors calming voices.
6. **Prompt override** — When grounding is active, `buildPartMessages` appends a grounding instruction that overrides the intention: "Be gentle, slow, grounding. Do not probe or push deeper."
7. **Manual toggle** — SettingsPanel shows a "Grounding mode" toggle when the feature is enabled.
8. **Crisis resources** — `CrisisResources.tsx` renders crisis helpline links when grounding is active.

#### Tuning (admin Settings → Safety & Wellbeing)

`GlobalConfig.grounding`: `autoExitMinutes`, `selfRoleScoreBonus`, `otherRolePenalty`, `intensityThreshold`.

### Intentions

Per-entry writing intentions that persist and influence AI responses. Controlled by `features.intentionsEnabled`.

#### How it works

1. **UI** — `IntentionInput.tsx` renders above the editor: ghost "+ set an intention" button → expands to text input (120 char max) → collapses on blur.
2. **Persistence** — Intention is stored as an `intention` field on the entry document via `db.entries.update`. Loaded in `handleSelectEntry`, cleared on `handleNewEntry`.
3. **Prompt injection** — `buildPartMessages` appends: `The writer set an intention: "{intention}". If natural, help them stay connected to it. Don't force it.` This is skipped when grounding is active.
4. **Orchestrator** — `LivingEditor` syncs the intention to `orchestratorRef.current.setIntention()` via a `useEffect`. The orchestrator passes it to `buildPartMessages` options.
5. **Reflection** — `reflectionEngine.ts` prepends `[Writer's intention: "..."]` to the entry text when running reflection, so summaries and memories capture the intended direction.

### Guided explorations

AI-generated personalized writing prompts on new blank entries. Controlled by `features.guidedExplorations`. Connects to Intentions: selecting an exploration sets it as the entry's intention.

#### How it works

1. **Engine** — `explorationEngine.ts` loads user profile + recent entry summaries, calls `chatCompletion` with a prompt asking for N personalized writing prompts, parses JSON response into `GuidedExploration[]`.
2. **Trigger** — `App.tsx` `handleNewEntry` calls `engine.reset()` then `generateExplorations()` if the feature is enabled and grounding is not active. Single-shot guard prevents duplicate suggestions.
3. **UI** — `ExplorationCard.tsx` renders 2-3 prompts as clickable items in a subtle card with Spectral font and "where to begin" header. Dismiss button (x) clears the card.
4. **Selection** — Clicking a prompt calls `handleSelectExploration` which sets the prompt as the intention and dismisses the card.
5. **Suppression** — Explorations don't generate during grounding mode. Cleared on entry switch.

#### Feature interconnections

| Scenario | Behavior |
|----------|----------|
| User selects exploration | Prompt becomes entry intention |
| Grounding activates | Explorations suppressed, intention not pursued in prompts |
| Grounding deactivates | Normal behavior resumes |
| Entry switch | Intention loads from entry, explorations reset |
| New entry (blank) | Explorations generate, intention starts empty |

#### Tuning (admin Settings → Writing Guidance)

`GlobalConfig.explorations`: `maxPrompts` (default 3), `triggerOnNewEntry` (default true).

### Autocorrect

`spellEngine.ts` provides Damerau-Levenshtein + Typo.js autocorrection. Corrections trigger on word-boundary characters (space, comma, period, etc.) but **not** on apostrophe — apostrophes are part of words (e.g., "didn't").

**Undo on Backspace**: `LivingEditor.tsx` tracks the last autocorrection in `lastAutocorrectRef`. If the user presses Backspace immediately after a correction (cursor is right after the corrected word + delimiter), the correction reverts to the original text. The ref is cleared on any other keypress (single-shot undo).

### Session closing

A warm closing ritual when the user taps "done for now" at the bottom of the editor.

#### How it works

1. **Trigger** — A subtle "done for now" text button sits at bottom-center of the screen (CSS class `session-close-trigger`). On mobile (≤768px), it shifts up to `bottom: 56px` with a larger tap target.
2. **Save + AI call** — `handleSessionClose` in `App.tsx` saves the current entry, then sends the last ~600 characters to The Weaver via `chatCompletion` with a special closing prompt (max 80 tokens, 15s timeout).
3. **Overlay** — `SessionClosing.tsx` renders a full-screen overlay: backdrop fades in (0.5s), breathing dots pulse while loading, then the phrase floats in with a subtle upward animation. "— The Weaver" attribution appears below in purple (`--color-weaver`).
4. **Dismiss** — User taps anywhere to fade out (0.5s) and return to the editor.
5. **Fallback** — If the AI call fails, the fallback phrase is: "You showed up today. That matters."

### Data export

`exportAllData()` in `db.ts` exports all user data as a human-readable Markdown document (`undersurface-export-YYYY-MM-DD.md`). Structure:

1. **About You** — user profile (inner landscape, themes, patterns, growth signals)
2. **Your Inner Voices** — each part with role, description, concern, growth notes, last 5 reflections
3. **Journal** — entries grouped by date, each with: timestamp, intention, entry text, part thoughts (with anchor context), Thinking Out Loud conversations, reflection summaries, fossil commentary
4. **Letters from Your Voices** — chronological letters with trigger type
5. **Writing Sessions** — table of date, time, duration, word count

Part IDs are resolved to human-readable names throughout.

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
- **Global config is reactive** — `useGlobalConfig()` hook via `useSyncExternalStore`, `getGlobalConfig()` for non-React code (synchronous, reads in-memory cache)
- **Colors via CSS variables** — all colors in `atmosphere.css` use `var()` references; inline styles use `var(--bg-primary)` etc. Never hardcode hex values for themed colors
- **Admin components use inline styles** — consistent with the warm muted palette (Inter font, #FAF8F5 bg, #A09A94 subtle, #2D2B29 text); admin stays light-only

## Common Tasks

### Changing the default AI model

Option A — via admin dashboard (no redeploy):
1. Visit `undersurface.me/admin` → Settings tab
2. Change "Default Model" and save
3. Takes effect for new users / users who haven't overridden the model in localStorage

Option B — via code (affects hardcoded fallback):
1. `src/store/settings.ts` → `DEFAULTS.openRouterModel`
2. `src/ai/openrouter.ts` → the `getModel()` fallback
3. `functions/src/index.ts` → the `model ||` fallback in `chat` function
4. Build and deploy both frontend and function

### Updating the OpenRouter API key

```bash
echo "sk-or-v1-new-key-here" | firebase functions:secrets:set OPENROUTER_API_KEY
cd functions && npx tsc && cd ..
firebase deploy --only functions
```

### Adding a new admin user

Update `ADMIN_EMAILS` in two places:
1. `src/App.tsx` — frontend routing gate
2. `functions/src/index.ts` — backend auth check

Then build and deploy both frontend and function.

### Adding a new seeded part

1. Add to `SEEDED_PARTS` array in `src/ai/partPrompts.ts`
2. Scoring is now role-based (`ifsRole`) — no per-part changes needed in orchestrator
3. The part's `concern` field words are automatically used as content keywords
4. To customize role-level scoring, edit `ROLE_PAUSE_AFFINITIES`, `ROLE_KEYWORDS`, or `ROLE_EMOTIONS` in `partOrchestrator.ts`

### Adding a new Firestore collection

1. Add proxy in `src/store/db.ts`: `newCollection: createCollectionProxy('newCollection')`
2. Firestore rules already allow all subcollections under `users/{uid}/` — no rule changes needed
3. Add TypeScript interface in `src/types/index.ts`
4. Add the collection name to `exportAllData()` in `db.ts` and `deleteAccount` in `functions/src/index.ts`

### Modifying Firestore security rules

1. Edit `firestore.rules`
2. Deploy: `firebase deploy --only firestore:rules`

### Signaling a new version to users

After deploying, users with the old version see a "New version available — tap to refresh" banner:

1. Visit `undersurface.me/admin` → Settings tab
2. Click "Signal Update" — this sets `buildVersion` to the current timestamp in `appConfig/global`
3. All connected clients detect the version change via `onSnapshot` and show the refresh banner

No code changes needed — this is a Firestore-based mechanism.

### Toggling features without deploying

Visit `undersurface.me/admin` → Settings tab:
- Toggle `partsEnabled` to disable/enable AI thoughts
- Toggle `visualEffectsEnabled` to disable/enable breathing background
- Toggle `autocorrectEnabled` to disable/enable spell correction
- Toggle `emergencyGrounding` to enable distress detection + grounding mode (Safety & Wellbeing section)
- Toggle `intentionsEnabled` to enable per-entry writing intentions (Writing Guidance section)
- Toggle `guidedExplorations` to enable AI writing prompts on new entries (Writing Guidance section)
- Set an announcement message to show a banner to all users

Changes propagate in real-time via Firestore `onSnapshot`.

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
- **Feature flags default to enabled**: `getGlobalConfig()` returns `null` before the `appConfig/global` doc exists. All flag checks use `=== false` so `null`/`undefined` are treated as enabled. The doc is created on first save in admin Settings.
- **Admin API timeout**: `generateInsights` calls OpenRouter and can take 10-30s. The `adminApi` function has a 120s timeout to accommodate this.
- **firebase.json `firestore` section**: Required for `firebase deploy --only firestore:rules` to work. Contains `"rules": "firestore.rules"`.
- **Autocorrect apostrophe**: Apostrophe (`'`) is NOT a word boundary for autocorrect. It was removed from the trigger regex in `LivingEditor.tsx` because contractions like "didn't" were being mangled ("didn'" → autocorrect on "didn" → "din'").
- **Autocorrect undo is single-shot**: `lastAutocorrectRef` is cleared on any keypress other than Backspace. Only the most recent correction can be undone, and only immediately after it happens.
- **Color bleed + dark mode**: The colorBleed extension must return `DecorationSet.empty` when disabled (not preserve existing decorations via mapping). Otherwise, switching to dark mode leaves stale colored text in the editor.
- **Part colorLight alpha differs by theme**: Light mode uses `'25'` alpha, dark mode uses `'30'` (via `boostAlpha` helper). Without the boost, part thought backgrounds are nearly invisible on dark backgrounds.
- **PWA enabled**: `VitePWA` plugin in `vite.config.ts` caches static assets and Google Fonts. API calls (`/api/chat`, `/api/admin`, `/api/account`) are NOT cached — they go through Firebase Hosting rewrites to Cloud Functions.
- **Sidebar backdrop-filter**: The sidebar uses `backdrop-filter: blur(16px)` for readability over editor text. The gradient is solid for 80% of its width to prevent text showing through.
- **Experimental features default to disabled**: Features like `emergencyGrounding`, `intentionsEnabled`, `guidedExplorations` use `=== true` checks. This is the opposite of core flags. If you add a new experimental feature, use `=== true` (disabled by default).
- **Grounding CSS overrides emotion atmosphere**: `[data-grounding="true"] .atmosphere[data-emotion]` forces calm greens regardless of the current emotion. Both light and dark variants are needed.
- **Intention field on entry documents**: The `intention` field is stored directly on entry documents via `db.entries.update`. It's not in the `DiaryEntry` TypeScript interface — accessed via cast (e.g., `as { intention?: string }`). This follows the existing pattern for `createdAt` access.
- **Grounding suppresses intention in prompts**: When `isGrounding` is true in `buildPartMessages`, the grounding instruction is appended instead of the intention instruction. This is intentional — during distress, parts should not push the writer toward their intention.
- **Exploration engine single-shot guard**: `ExplorationEngine.hasSuggested` prevents duplicate API calls per entry. Must call `reset()` before `shouldSuggest()` on entry switch.
- **Admin dashboard is lazy-loaded**: `AdminDashboard` uses `React.lazy()` + `Suspense` in `App.tsx`. It must use a default export. All admin components (AdminOverview, AdminUsers, AdminAnalytics, AdminMessages, AdminInsights, AdminSettings, adminApi, adminTypes) are bundled into a separate chunk.
- **contactMessages Firestore rules**: `contactMessages` has `allow read, write: if false` in client rules. It's a top-level collection (not under `users/{uid}/`) written by `accountApi` Cloud Function via Admin SDK and read by `adminApi` Cloud Function.
- **Account deletion deletes 12 collections**: The `deleteAccount` action in `accountApi` must delete all subcollections under `users/{uid}/`. If a new collection is added to `db.ts`, it must also be added to the deletion list in `functions/src/index.ts`.
- **Analytics iterates all users**: `handleGetAnalytics` in `functions/src/index.ts` reads entries/parts/thoughts for every user. Fine at small scale but may need optimization (aggregation docs, Cloud Scheduler) as user count grows.
- **Session closing uses The Weaver specifically**: The closing prompt is hardcoded to The Weaver's voice (pattern-seeing, warm, connecting). The part ID isn't used — it's a standalone `chatCompletion` call with a Weaver-flavored system prompt in `App.tsx`.
- **Session closing button mobile positioning**: On mobile (≤768px), the "done for now" button sits at `bottom: 56px` to clear the InnerWeather widget at `bottom: 20px` and iOS Safari's bottom chrome. Styled via `.session-close-trigger` class in `atmosphere.css`.
- **Data export is Markdown, not JSON**: `exportAllData()` produces a `.md` file with human-readable diary content. Part UUIDs are resolved to names via a lookup map built from the parts collection.
