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
- **`chat`** — proxies AI requests to OpenRouter (512MiB, 30s timeout, minInstances: 1 for warm starts)
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
| `src/ai/openrouter.ts` | Client-side API calls (sends to `/api/chat` with Firebase auth token); `analyzeEmotionAndDistress()` for combined emotion + distress LLM check |
| `src/ai/partPrompts.ts` | System prompts for all 6 seeded parts + exported SHARED_INSTRUCTIONS + emergence, reflection, growth, grounding, intention prompts + `languageDirective()` for i18n. No engine-specific prompt builders — engines build prompts inline |
| `src/engine/partOrchestrator.ts` | Selects which part responds based on pause type, emotion, content (role-based scoring); LLM-based distress detection triggers grounding; passes intention to prompts; pre-warms profile/summaries/memories cache in `loadParts()` |
| `src/engine/pauseDetector.ts` | Detects writing pauses from keystroke timing |
| `src/engine/emergenceEngine.ts` | Detects new parts emerging from writing (imports `SHARED_INSTRUCTIONS` from partPrompts) |
| `src/engine/reflectionEngine.ts` | Entry reflection — creates memories, summaries, profile updates on entry switch |
| `src/engine/partGrowthEngine.ts` | Periodic part evolution — updates prompts, keywords, emotions every 5 entries |
| `src/engine/spellEngine.ts` | Autocorrect (Damerau-Levenshtein + Typo.js) |
| `src/engine/weatherEngine.ts` | Inner weather tracking from emotional tone shifts |
| `src/engine/ritualEngine.ts` | Session logging for ritual detection (writing habits) |
| `src/engine/fossilEngine.ts` | Resurfaces old entry commentary when revisiting past entries. Lazy-loaded on first entry switch. Includes `languageDirective()` for i18n |
| `src/engine/explorationEngine.ts` | AI-generated personalized writing prompts from user profile + recent summaries. Lazy-loaded on first new entry |
| `src/store/db.ts` | Firestore wrapper — mimics Dexie.js API surface; 12 collection proxies + translated Markdown data export |
| `src/store/settings.ts` | User settings in localStorage (3-tier cascade: hardcoded < globalConfig < localStorage); includes `language` setting |
| `src/i18n/index.ts` | Translation system — `t()` for non-React, `useTranslation()` hook for React, `getLanguageCode()`, `getLLMLanguageName()`, `getPartDisplayName()`, `languageDirective()` re-export |
| `src/i18n/languages.ts` | Language metadata (17 supported languages) + `detectBrowserLanguage()` |
| `src/i18n/translations/en.ts` | English translations (~169 keys including policy content) — source of truth for `TranslationKey` and `TranslationStrings` types |
| `src/i18n/translations/*.ts` | 16 non-English translation files (es, fr, de, pt, it, ru, zh, ja, ko, tr, nl, vi, hi, id, th, pl) |
| `src/store/globalConfig.ts` | Real-time listener on `appConfig/global` Firestore doc, provides `useGlobalConfig()` hook |
| `src/firebase.ts` | Firebase/Firestore initialization with offline persistence |
| `src/auth/authContext.ts` | Auth context type: `signIn` (Google), `signInWithEmail`, `signUpWithEmail`, `resetPassword`, `signOut` |
| `src/services/analytics.ts` | Firebase Analytics wrapper — lazy-initializes on first `trackEvent()`, guards SSR/test; also exports `setAnalyticsUser`/`clearAnalyticsUser` |
| `src/auth/AuthContext.tsx` | Auth provider — Google + Email/Password + password reset; sets Sentry user context + analytics user on auth state change |
| `src/auth/useAuth.ts` | Hook for consuming auth context |
| `src/api/accountApi.ts` | Client-side account API caller for `deleteAccount` and `submitContact` actions |
| `src/components/LoginScreen.tsx` | Two-section scrollable landing page: hero section (typing animation demo cycling through 5 examples with different parts, feature callouts, CTA) + auth section (email/password form, Google sign-in). Designed for Google Ads cold traffic |
| `src/components/Onboarding.tsx` | Post-signup consent flow (terms acceptance) |
| `src/components/CrisisResources.tsx` | Crisis resource links shown during grounding mode |
| `src/components/DeleteAccountModal.tsx` | Account deletion confirmation modal. Lazy-loaded from SettingsPanel — default export |
| `src/components/PolicyContent.tsx` | Privacy policy and disclaimer content — fully translated via `useTranslation()` |
| `src/components/PolicyModal.tsx` | Modal wrapper for policy content — default export |
| `src/components/InnerWeather.tsx` | Inner weather display widget |
| `src/components/SessionClosing.tsx` | Session closing overlay — shows The Weaver's closing thought with fade-in/out animation |
| `src/components/AnnouncementBanner.tsx` | Fixed banner from global config, dismissible via sessionStorage |
| `src/components/Editor/LivingEditor.tsx` | TipTap-based rich text editor with part thoughts, autocorrect, color bleed. Lazy-loaded via `React.lazy` — default export |
| `src/components/Editor/IntentionInput.tsx` | Subtle per-entry intention input (ghost button → inline edit, 120 char max) |
| `src/components/Editor/ExplorationCard.tsx` | Clickable exploration prompt card with dismiss button |
| `src/components/Sidebar/EntriesList.tsx` | Entry list sidebar |
| `src/components/Sidebar/SettingsPanel.tsx` | User settings panel (appearance, model, speed, data export, contact form, delete account). Opens as a slide-up overlay above the gear button. Auto-scroll is admin-controlled only (not shown in user settings) |
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
| `vite.config.ts` | Vite + React + Tailwind CSS v4 + VitePWA + Sentry source map upload; `manualChunks` splits TipTap/ProseMirror into `editor` chunk and Sentry into `sentry` chunk |
| `public/robots.txt` | SEO: allows all except `/admin`, references sitemap |
| `public/sitemap.xml` | SEO: single URL entry for `https://undersurface.me/` |
| `public/og-image.png` | 1200x630 Open Graph image (warm background, Spectral title, Inter tagline) |

### Data storage

- **Firestore**: User data under `users/{uid}/` — 12 subcollections: entries, parts, memories, thoughts, interactions, entrySummaries, userProfile, fossils, letters, sessionLog, innerWeather, consent
- **Firestore**: Global config at `appConfig/global` — readable by all authenticated users, writable only via `adminApi` Cloud Function (Admin SDK bypasses rules)
- **Firestore**: Contact messages at top-level `contactMessages` — deny-all in client rules, written by `accountApi` Cloud Function via Admin SDK, read by `adminApi`
- **localStorage**: Device-specific settings (theme, model choice, visual effect toggles, response speed, language)
- **Google Secret Manager**: The OpenRouter API key (`OPENROUTER_API_KEY`)

### Auth

Firebase Authentication with Google Sign-In and Email/Password. The auth flow:
- `src/auth/AuthContext.tsx` provides user state and auth methods: `signIn` (Google popup), `signInWithEmail`, `signUpWithEmail`, `resetPassword` (sends Firebase password reset email), `signOut`
- `src/auth/authContext.ts` defines the `AuthContextValue` interface
- `src/auth/useAuth.ts` is the hook components use
- `App.tsx` gates the entire app behind auth — unauthenticated users see `LoginScreen`
- The `LoginScreen` is a two-section scrollable page: a hero section (viewport-height) with an animated demo showing 5 cycling examples of the AI thought experience, feature callouts, and a CTA that smooth-scrolls to the auth section below. The auth section has email/password form (sign-in, sign-up, password reset modes) and Google sign-in
- The Cloud Functions verify Firebase ID tokens on every request
- `adminApi` additionally checks email against `ADMIN_EMAILS` allowlist (hardcoded in both `functions/src/index.ts` and `src/App.tsx`)
- On auth state change, `AuthContext.tsx` sets Sentry user context (`Sentry.setUser`) and Firebase Analytics user ID (`setAnalyticsUser`); clears both on sign-out
- `signIn`, `signInWithEmail`, and `signUpWithEmail` fire analytics events (`sign_in`/`sign_up`) after successful auth

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

### Internationalization (i18n)

17 LTR languages supported: English, Spanish, French, German, Portuguese, Italian, Russian, Chinese (Simplified), Japanese, Korean, Turkish, Dutch, Vietnamese, Hindi, Indonesian, Thai, Polish. RTL languages (Arabic, Farsi, Hebrew) deferred. Admin dashboard stays English-only. Privacy policy and disclaimer are translated.

#### Architecture

1. **Translation system** — Lightweight, no library. Flat key-value objects per language in `src/i18n/translations/*.ts`. English is the fallback. TypeScript enforces key completeness via `TranslationKey` type derived from `en.ts`.
2. **`t(key)`** — Non-React synchronous function. Safe in class components (e.g., ErrorBoundary) and non-React code (e.g., `db.ts` export).
3. **`useTranslation()`** — React hook via `useSyncExternalStore` (same pattern as `useSettings()`). Reactive to language changes.
4. **Lazy loading** — English is bundled inline. Non-English translation files are lazy-loaded via `import.meta.glob` (16 separate chunks, ~4-5KB each). Current language is pre-loaded at module init; falls back to English while loading.
5. **AI prompts** — System prompts stay English (best instruction-following). `languageDirective()` appends `"You MUST respond in {language}"` to all user-facing prompt builders (partPrompts, fossilEngine, letterEngine, blankPageEngine, session closing). Internal prompts (reflection, growth, emotion analysis) stay English-only.
6. **Distress detection** — LLM-based via `analyzeEmotionAndDistress()`, replacing English keyword array. Works in any language. Zero additional API calls (combined with emotion check).
7. **Autocorrect** — Hidden from Settings for non-English. Autocorrect code path and "i"→"I" fix skipped when `getLanguageCode() !== 'en'`.
8. **Crisis resources** — English shows US resources (988, Crisis Text Line) + findahelpline.com. Non-English shows only findahelpline.com with translated labels.
9. **Seeded part names** — Translated display names via `getPartDisplayName()` at all UI-facing output points (orchestrator callbacks, App.tsx fossil, LivingEditor disagreement/emergence, blankPageEngine, letterEngine). Emerged part names stay in their original language (LLM-generated).
10. **Data export** — Section headers translated, dates localized via `getLanguageCode()` in `toLocaleDateString()`.

#### Adding a new translation key

1. Add the key + English text to `src/i18n/translations/en.ts`
2. Add translations to all 16 other language files (same key, translated value)
3. Use `t('key.name')` in non-React code or `tr['key.name']` with `const tr = useTranslation()` in React

#### Adding a new language

1. Add entry to `SUPPORTED_LANGUAGES` array in `src/i18n/languages.ts`
2. Create `src/i18n/translations/{code}.ts` with all keys from `en.ts`
3. No other changes needed — the `import.meta.glob` pattern auto-discovers new files

### Emergency grounding

When the writer is in distress, the app shifts to a calming mode. Controlled by `features.emergencyGrounding`.

#### How it works

1. **Distress detection** — `partOrchestrator.ts` uses LLM-based analysis via `analyzeEmotionAndDistress()` (combined with the emotion check every 30s, zero additional API calls). Returns a distress level 0-3 (none/mild/moderate/severe). Works in any language since the LLM reads text directly. If level >= `intensityThreshold` (default 2), activates grounding.
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

A warm closing ritual when the user taps "close session" in the toolbar above the editor.

#### How it works

1. **Trigger** — A subtle "close session" text button sits in the toolbar row above the editor, right-aligned next to the intention input (CSS class `session-close-trigger`). It shares a flex row with `IntentionInput` — when intentions are disabled, the button still appears top-right of the editor area.
2. **Save + AI call** — `handleSessionClose` in `App.tsx` saves the current entry, then sends the last ~600 characters to The Weaver via `chatCompletion` with a special closing prompt (max 80 tokens, 15s timeout).
3. **Overlay** — `SessionClosing.tsx` renders a full-screen overlay: backdrop fades in (0.5s), breathing dots pulse while loading, then the phrase floats in with a subtle upward animation. "— The Weaver" attribution appears below in purple (`--color-weaver`).
4. **Dismiss** — User taps anywhere to fade out (0.5s) and return to the editor.
5. **Fallback** — If the AI call fails, the fallback phrase is: "You showed up today. That matters."

### Bundle splitting

The frontend uses code splitting to reduce the initial bundle size. The main chunk is ~228KB gzipped (down from ~397KB before splitting).

#### Lazy-loaded components (React.lazy)

| Component | Loaded when | Chunk |
|-----------|------------|-------|
| `LivingEditor` | After auth + DB init + consent | `LivingEditor` (~53KB) |
| `AdminDashboard` | `/admin` route | admin chunk |
| `DeleteAccountModal` | Settings → "Delete account" click | included in main (small) |
| `PolicyModal` | Settings → "Privacy & Terms" click | not split (statically imported by LoginScreen/Onboarding) |

`LivingEditor` wraps in `<Suspense fallback={<EditorSkeleton />}>` — a lightweight placeholder matching the editor layout.

#### Lazy-loaded engines (dynamic import)

| Engine | Loaded when | Why lazy |
|--------|------------|----------|
| `FossilEngine` | First entry switch (revisiting old entry) | Only needed for past entries, not new ones |
| `ExplorationEngine` | First new entry with feature enabled | Experimental feature, often disabled |

Both use `await import('./engine/...')` at their call sites in `App.tsx`. Refs are `useRef<... | null>(null)`.

#### Lazy-loaded translations

Non-English translation files (16 languages) are lazy-loaded via `import.meta.glob` in `src/i18n/index.ts`. Each produces a separate ~4-5KB chunk. Only the current user's language is fetched at module init; English is always bundled inline as the fallback.

#### manualChunks

`vite.config.ts` groups dependencies:
- `@tiptap/*` + `prosemirror-*` → `editor` chunk (~119KB gzipped)
- `@sentry/*` → `sentry` chunk (~30KB gzipped)

### Firebase Analytics

Product analytics via Firebase Analytics, lazy-initialized on first event.

#### Service module

`src/services/analytics.ts` wraps Firebase Analytics:
- `trackEvent(name, params?)` — logs a custom event; lazy-initializes analytics on first call
- `setAnalyticsUser(uid)` — sets user ID after auth
- `clearAnalyticsUser()` — clears user ID on sign-out
- Guards against SSR (`typeof window === 'undefined'`) and missing analytics config

#### Event catalog

| Event | File | Trigger | Params |
|-------|------|---------|--------|
| `app_launch` | `App.tsx` | After `isReady` set to true | — |
| `sign_in` | `AuthContext.tsx` | After successful auth | `method: 'google' \| 'email'` |
| `sign_up` | `AuthContext.tsx` | After `createUserWithEmailAndPassword` | — |
| `onboarding_complete` | `App.tsx` | `handleOnboardingComplete` | — |
| `new_entry` | `App.tsx` | `handleNewEntry` | — |
| `entry_switch` | `App.tsx` | `handleSelectEntry` | `entry_age_days` |
| `session_close` | `App.tsx` | `handleSessionClose` | `word_count` |
| `export_data` | `SettingsPanel.tsx` | Export button click | — |
| `part_thought` | `partOrchestrator.ts` | After thought generated | `part_name`, `emotion`, `pause_type` |
| `thinking_out_loud` | `LivingEditor.tsx` | User responds to TOL | `part_name`, `status` |
| `grounding_activated` | `useGroundingMode.ts` | `activateGrounding()` | `trigger: 'auto' \| 'manual'` |
| `exploration_shown` | `App.tsx` | Explorations generated | `count` |
| `exploration_selected` | `App.tsx` | `handleSelectExploration` | `source` |
| `intention_set` | `App.tsx` | `handleIntentionChange` (non-empty) | — |
| `emotion_shift` | `App.tsx` | `handleEmotionChange` | `from`, `to` |
| `fossil_shown` | `App.tsx` | Fossil thought rendered | `part_name` |

#### Setup note

Firebase Analytics must be enabled in Firebase Console → Project Settings → Integrations → Google Analytics. Events may take up to 24h to appear in the console.

### Google Ads conversion tracking

Tracks sign-up conversions for Google Search ad campaigns. Conversion ID: `AW-17954082823`.

#### How it works

1. **Google tag** — `index.html` loads `gtag.js` with the Google Ads conversion ID on every page.
2. **Conversion event** — `AuthContext.tsx` fires `gtag('event', 'conversion', { send_to: 'AW-17954082823/TuxaCPeu0vgbEIeglvFC' })` on:
   - **Email sign-up** — always (explicit `createUserWithEmailAndPassword`)
   - **Google sign-in** — only for new users (`creationTime === lastSignInTime` check avoids counting returning users)
3. **`gclid` parameter** — Google Ads auto-appends `?gclid=...` to landing page URLs. The gtag script handles attribution automatically.

#### Logo assets

Brand logo files in `public/` for Google Ads and marketing:

| File | Size | Use |
|------|------|-----|
| `logo-square-1200.png` | 1200x1200, transparent | Google Ads square logo |
| `logo-square-1200-opaque.png` | 1200x1200, cream bg | Google Ads (requires opaque) |
| `logo-landscape-1200x300.png` | 1200x300, transparent | Google Ads landscape logo |
| `logo-landscape-1200x300-opaque.png` | 1200x300, cream bg | Google Ads (requires opaque) |
| `logo-icon-512.png` | 512x512, transparent | App stores / large icon |
| `logo-icon-192.png` | 192x192, transparent | PWA / smaller contexts |

### Landing page (LoginScreen)

The `LoginScreen` is designed for cold traffic from Google Ads. Two scrollable sections:

1. **Hero section** (viewport height) — "UnderSurface" title, "A diary that listens back" headline, animated demo editor, 3 feature callouts, CTA button
2. **Auth section** — existing sign-up/sign-in form with Google and email options

#### Demo editor animation

A self-contained carousel cycling through 5 demo examples, each showing a different AI part responding to writing:

| # | Part | Color | Theme |
|---|------|-------|-------|
| 1 | The Watcher | `#5A7F94` (steel blue) | Masking emotions |
| 2 | The Tender One | `#B58548` (amber) | Self-sabotage patterns |
| 3 | The Weaver | `#7E6BA0` (purple) | Quiet grief |
| 4 | The Still | `#628E66` (green) | Anxiety |
| 5 | The Spark | `#A06A7A` (rose) | Unspoken truth |

Each demo: text types character-by-character (40ms/char) → 800ms pause → thought bubble fades in (600ms) → holds 4s → fades out → next demo after 1s. Full cycle ~50s.

The demo content is hardcoded in `LoginScreen.tsx` (not i18n) since Google Ads initially target English-speaking countries. The `landing.*` i18n keys are used for the headline, feature points, and CTA text.

### Sentry (frontend error monitoring)

Catches unhandled exceptions, API failures, and React render errors in production.

#### Configuration

- **Init**: `src/main.tsx` — `Sentry.init()` before `ReactDOM.createRoot()`, production-only
- **User context**: `src/auth/AuthContext.tsx` — sets `Sentry.setUser({ id, email })` on auth, clears on sign-out
- **Error boundary**: `src/components/ErrorBoundary.tsx` — `Sentry.captureException()` in `componentDidCatch`
- **Source maps**: `@sentry/vite-plugin` uploads source maps during `npm run build` (requires `SENTRY_AUTH_TOKEN`)

#### Sample rates

- `tracesSampleRate: 0.1` — 10% of transactions for performance monitoring
- `replaysSessionSampleRate: 0` — no session replay by default
- `replaysOnErrorSampleRate: 0.1` — 10% of error sessions get replay

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
VITE_SENTRY_DSN                    # Sentry DSN for error reporting (client-side, VITE_ prefixed)
```

Build-time only (not `VITE_` prefixed, not bundled into client):

```
SENTRY_AUTH_TOKEN                  # For Sentry source map uploads during build
SENTRY_ORG                         # Sentry organization slug
SENTRY_PROJECT                     # Sentry project slug
```

The `VITE_FIREBASE_*` values are public Firebase client config (security is via Firestore rules + auth, not config secrecy). The `VITE_SENTRY_DSN` is also safe to expose — Sentry DSNs are public by design.

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
- **Admin dashboard is lazy-loaded**: `AdminDashboard` uses `React.lazy()` + `Suspense` in `App.tsx` (same pattern as `LivingEditor`). It must use a default export. All admin components (AdminOverview, AdminUsers, AdminAnalytics, AdminMessages, AdminInsights, AdminSettings, adminApi, adminTypes) are bundled into a separate chunk.
- **contactMessages Firestore rules**: `contactMessages` has `allow read, write: if false` in client rules. It's a top-level collection (not under `users/{uid}/`) written by `accountApi` Cloud Function via Admin SDK and read by `adminApi` Cloud Function.
- **Account deletion deletes 12 collections**: The `deleteAccount` action in `accountApi` must delete all subcollections under `users/{uid}/`. If a new collection is added to `db.ts`, it must also be added to the deletion list in `functions/src/index.ts`.
- **Analytics iterates all users**: `handleGetAnalytics` in `functions/src/index.ts` reads entries/parts/thoughts for every user. Fine at small scale but may need optimization (aggregation docs, Cloud Scheduler) as user count grows.
- **Session closing uses The Weaver specifically**: The closing prompt is hardcoded to The Weaver's voice (pattern-seeing, warm, connecting). The part ID isn't used — it's a standalone `chatCompletion` call with a Weaver-flavored system prompt in `App.tsx`.
- **Session closing button is in the toolbar**: The "close session" button is in the flex row above the editor (not fixed at the bottom). It shares a row with `IntentionInput`. Styled via `.session-close-trigger` class in `atmosphere.css`.
- **Data export is Markdown, not JSON**: `exportAllData()` produces a `.md` file with human-readable diary content. Part UUIDs are resolved to names via a lookup map built from the parts collection.
- **React.lazy requires default exports**: `LivingEditor`, `AdminDashboard`, `DeleteAccountModal`, and `PolicyModal` all use `React.lazy()` for code splitting. Each must have a default export. `PolicyModal` is also imported directly (not lazy) by `LoginScreen` and `Onboarding` — this is fine; Vite won't split it into a separate chunk since it's statically imported elsewhere.
- **Sentry is production-only**: `Sentry.init()` in `main.tsx` has `enabled: import.meta.env.PROD`. No error reporting in dev. To test Sentry locally, temporarily change to `enabled: true`.
- **Analytics lazy-initializes**: `src/services/analytics.ts` calls `getAnalytics()` on the first `trackEvent()`, not at module import. This avoids blocking startup. Uses `getApp()` from `firebase/app` (not a direct import of the app instance from `firebase.ts`).
- **FossilEngine and ExplorationEngine are lazy-loaded**: Both engines are initialized via dynamic `import()` at their call sites in `App.tsx` (not eagerly imported). Their refs are `useRef<... | null>(null)` and null-checked before use.
- **Settings panel is a slide-up overlay**: `.settings-body` uses `position: absolute; bottom: calc(100% + 4px)` to float above the gear button. It has `max-height: 65vh` with overflow scroll and a slide-up animation. The gear button gets an `.active` class when open.
- **manualChunks splits editor and Sentry**: `vite.config.ts` groups `@tiptap` + `prosemirror` into an `editor` chunk (~119KB) and `@sentry` into a `sentry` chunk (~30KB). The main chunk is ~228KB gzipped (down from ~397KB).
- **Sentry source map upload needs env vars**: `sentryVitePlugin` in `vite.config.ts` reads `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` from `process.env` (not `import.meta.env`). The plugin is disabled when `SENTRY_AUTH_TOKEN` is missing (e.g., local dev, CI without secrets).
- **ErrorBoundary captures to Sentry**: `componentDidCatch` in `ErrorBoundary.tsx` calls `Sentry.captureException(error)` to report React render errors. This is the only class component in the codebase.
- **Grounding activation trigger parameter**: `activateGrounding()` accepts an optional `trigger: 'auto' | 'manual'` parameter for analytics tracking. The orchestrator passes `'auto'`, the settings toggle passes `'manual'`.
- **i18n `t` function shadows loop variables**: The `t()` function is imported from `../i18n` in `db.ts`. Any `for (const t of ...)` loops in that file must use a different variable name (e.g., `th`) to avoid shadowing.
- **Translation cache invalidation has two paths**: `invalidateTranslationCache()` is called both from `invalidateSettingsCache()` (for globalConfig changes) and directly from `updateSettings()` (for explicit language changes). Both use lazy `import()` to avoid circular dependencies with `settings.ts`.
- **Autocorrect hidden for non-English**: The SettingsPanel conditionally renders the Autocorrect section only when `settings.language === 'en'`. The LivingEditor also guards autocorrect and "i"→"I" fixes with `getLanguageCode() === 'en'`.
- **Emotion analysis returns English keywords**: `analyzeEmotionAndDistress()` always returns English emotion words (from the fixed list). The `isValidEmotion()` check is English-based. UI layer translates for display via `t('emotion.${emotion}')`.
- **Seeded part names are translated, emerged are not**: `getPartDisplayName()` checks `isSeeded` flag and maps seeded IDs to `part.*` translation keys. Emerged parts use their original LLM-generated name.
- **"delete" confirmation stays English**: The DeleteAccountModal confirmation word is always "delete" regardless of language — the instruction text is translated but `confirmation.toLowerCase() === 'delete'` is hardcoded.
- **Language default is browser-detected**: `detectBrowserLanguage()` checks `navigator.language` against supported codes. Falls back to `'en'`. Only runs once as the default for `DEFAULTS.language`.
- **languageDirective() is not injected into reflection/growth prompts**: Internal metadata prompts stay English because their output feeds back into English-keyed orchestrator logic (`ROLE_KEYWORDS`, `isValidEmotion()`).
- **Distress detection is now LLM-based**: `DISTRESS_KEYWORDS` array was removed. Distress is assessed via `analyzeEmotionAndDistress()` returning a 0-3 level, piggybacking on the 30s emotion check. Default threshold changed from 3 (keyword hits) to 2 (moderate distress level).
- **chat function minInstances: 1**: Keeps one warm instance to avoid cold starts. Requires `firebase deploy --force` because it increases the minimum bill. To disable warm instances, set `minInstances: 0` and redeploy.
- **partOrchestrator pre-warms DB caches**: `loadParts()` fetches profile + summaries + memories upfront. `generateThought()` uses these cached values instead of re-reading from DB. New observation memories are pushed to the in-memory `part.memories` array to keep the cache current within a session.
- **Lazy-loaded translations fall back to English**: On first load for non-English users, there may be a brief flash of English text while the language file is fetched. The pre-load fires at module init and typically resolves before first render. `invalidateTranslationCache()` also triggers a pre-load when the language changes.
- **typewriterScroll is admin-controlled**: Added to `ADMIN_CONTROLLED_KEYS` in `settings.ts`, so localStorage values are stripped and the globalConfig default always wins. No user-facing auto-scroll toggle in SettingsPanel.
- **Settings panel uses flex-wrap for i18n**: `.settings-row` has `flex-wrap: wrap` so option groups drop below long translated labels instead of overflowing.
- **Startup parallelizes spellEngine.init() and loadOrCreateEntry()**: Both are async and independent — `Promise.all` in `App.tsx` runs dictionary fetch and Firestore entry read concurrently.
- **Privacy policy is translated**: `PolicyContent.tsx` uses `useTranslation()` with `policy.*` keys (~24 keys). `PolicyModal.tsx` nav buttons are also translated. The "delete" confirmation word in `DeleteAccountModal` remains English-only.
- **Landing page demo content is hardcoded, not i18n**: The 5 demo examples in `LoginScreen.tsx` (`DEMOS` array) are English-only constants, not translation keys. This is intentional — Google Ads initially target English-speaking countries. The headline, features, and CTA use `landing.*` i18n keys.
- **Google Ads conversion fires only for new users**: `trackAdConversion()` in `AuthContext.tsx` fires on `signUpWithEmail` always, but on Google `signIn` only when `creationTime === lastSignInTime` (new account). Returning Google users don't trigger conversions.
- **Service worker registration errors are filtered in Sentry**: `main.tsx` `beforeSend` drops `"Rejected"` errors from `registerSW.js`. These are non-critical PWA registration failures (caused by extensions, incognito mode, etc.).
- **Google tag (gtag.js) loads on every page**: The Google Ads tag in `index.html` loads for all users, not just ad visitors. This is required for conversion attribution to work (it reads the `gclid` query parameter).
