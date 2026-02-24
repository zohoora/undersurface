# Key Files Reference

## AI & Engines

| File | Purpose |
|------|---------|
| `src/ai/openrouter.ts` | Client-side API calls to `/api/chat`; `analyzeEmotionAndDistress()` for combined emotion + distress check |
| `src/ai/partPrompts.ts` | System prompts for 7 seeded parts + `SHARED_INSTRUCTIONS` + emergence, reflection, growth, grounding, intention prompts + `languageDirective()` for multilingual AI response directives |
| `src/ai/sessionPrompts.ts` | Session mode prompts for parts — `SESSION_INSTRUCTIONS`, `buildSessionMessages()`, `buildSessionNotePrompt()` |
| `src/ai/therapistPrompts.ts` | Therapist companion prompts — `THERAPIST_CORE`, `buildTherapistMessages()`, `buildTherapistSessionNotePrompt()`, `buildSessionReflectionPrompt()` |
| `src/engine/partOrchestrator.ts` | Selects which part responds (role-based scoring); distress detection; intention passing; pre-warms DB caches in `loadParts()` |
| `src/engine/pauseDetector.ts` | Detects writing pauses from keystroke timing |
| `src/engine/emergenceEngine.ts` | Detects new parts emerging from writing |
| `src/engine/reflectionEngine.ts` | Entry reflection — creates memories, summaries, profile updates on entry switch |
| `src/engine/partGrowthEngine.ts` | Part evolution — updates prompts, keywords, emotions every 5 entries |
| `src/ai/llmCorrect.ts` | LLM-based autocorrect — sentence-level spelling/capitalization correction via small model. All languages with sentence-ending punctuation. Exports `shouldTriggerAutocorrect()`, `isCJK()`, `SENTENCE_END_PUNCT`, `CJK_SENTENCE_END` |
| `src/engine/sessionOrchestrator.ts` | Session phase detection, crisis keyword detection (20 regex patterns, no cooldown), emotion check with grounding activation |
| `src/engine/sessionReflectionEngine.ts` | Post-session reflection — extracts memories, profile updates, somatic signals from session transcripts |
| `src/engine/sessionContextLoader.ts` | Loads session context (memories, profile, recent notes) for therapist prompts |
| `src/engine/weatherEngine.ts` | Inner weather tracking from emotional tone shifts |
| `src/engine/ritualEngine.ts` | Session logging for ritual detection (writing habits) |
| `src/engine/fossilEngine.ts` | Resurfaces old entry commentary. Lazy-loaded on first entry switch |
| `src/engine/explorationEngine.ts` | AI-generated writing prompts. Lazy-loaded on first new entry |
| `src/engine/blankPageEngine.ts` | Opening thought on new blank entries. Feature-flagged (`blankPageSpeaks`) |
| `src/engine/letterEngine.ts` | Periodic letters from parts. Feature-flagged (`lettersFromParts`) |
| `src/engine/disagreementEngine.ts` | Parts respectfully disagree. Feature-flagged (`partsDisagreeing`). Uses `ROLE_OPPOSITION` mapping (protector<>exile, manager<>firefighter) |
| `src/engine/echoEngine.ts` | Resurfaces patterns from past entries. Feature-flagged (`echoes`) |
| `src/engine/threadEngine.ts` | Resumes unfinished themes across sessions. Feature-flagged (`threads`) |
| `src/engine/bodyMapEngine.ts` | Computes HomunculusState from somatic memories — emotion-to-color mapping, region sizing, dominant emotions |
| `src/engine/quoteEngine.ts` | Highlights meaningful quotes. Feature-flagged |
| `src/engine/quietTracker.ts` | Tracks periods of silence/no writing |

## TipTap Extensions

| File | Purpose |
|------|---------|
| `src/extensions/colorBleed.ts` | Tints recent text with part color; disabled in dark mode (returns `DecorationSet.empty`) |
| `src/extensions/marginTraces.ts` | Visual traces/marks in the editor margin |
| `src/extensions/inkWeight.ts` | Varies text weight based on writing intensity |
| `src/extensions/paragraphSettle.ts` | Visual settling animation for paragraphs |
| `src/extensions/typewriterScroll.ts` | Typewriter-style scroll (admin-controlled via `defaultTypewriterScroll`) |

## Store & Config

| File | Purpose |
|------|---------|
| `src/store/db.ts` | Firestore wrapper — 12 collection proxies + translated Markdown data export |
| `src/store/settings.ts` | User settings in localStorage (3-tier cascade: hardcoded < globalConfig < localStorage) |
| `src/store/globalConfig.ts` | Real-time listener on `appConfig/global` Firestore doc, `useGlobalConfig()` hook |
| `src/firebase.ts` | Firebase/Firestore initialization with offline persistence |

## i18n

| File | Purpose |
|------|---------|
| `src/i18n/index.ts` | `t()` for non-React, `useTranslation()` hook, `getLanguageCode()`, `getLLMLanguageName()`, `getPartDisplayName()` |
| `src/i18n/languages.ts` | 17 supported languages + `detectBrowserLanguage()` |
| `src/i18n/translations/en.ts` | English translations (~199 keys) — source of truth for `TranslationKey` type |
| `src/i18n/translations/*.ts` | 16 non-English files (lazy-loaded, ~4-5KB each) |

## Auth & Services

| File | Purpose |
|------|---------|
| `src/auth/AuthContext.tsx` | Auth provider — Google + Email/Password + password reset; sets Sentry + analytics user context |
| `src/auth/authContext.ts` | `AuthContextValue` interface |
| `src/auth/useAuth.ts` | Hook for consuming auth context |
| `src/services/analytics.ts` | Firebase Analytics wrapper — lazy-initializes on first `trackEvent()` |
| `src/api/accountApi.ts` | Client-side account API caller |

## Components

| File | Purpose |
|------|---------|
| `src/components/LoginScreen.tsx` | Two-section landing page: hero (animated demo, 5 examples) + auth section. Designed for Google Ads |
| `src/components/Onboarding.tsx` | Post-signup consent flow |
| `src/components/Editor/LivingEditor.tsx` | TipTap rich text editor. Lazy-loaded — default export |
| `src/components/Editor/IntentionInput.tsx` | Per-entry intention input (ghost button -> inline edit, 120 char max) |
| `src/components/Editor/ExplorationCard.tsx` | Clickable exploration prompt card |
| `src/components/Editor/PartThoughtBubble.tsx` | Part thought rendering in editor margin |
| `src/components/Editor/HandwritingText.tsx` | Handwriting font text rendering |
| `src/components/ThinkingOutLoud/ThinkingSpace.tsx` | "Thinking Out Loud" UI for user-part conversations |
| `src/components/Atmosphere/BreathingBackground.tsx` | Breathing background animation |
| `src/components/Atmosphere/CursorGlow.tsx` | Visual glow effect around cursor |
| `src/components/Atmosphere/BilateralPulse.tsx` | Bilateral stimulation edge pulses — rhythm adapts to emotional tone |
| `src/components/Atmosphere/PauseRipple.tsx` | Visual ripple during writing pauses |
| `src/components/Atmosphere/usePauseRipple.ts` | Pause ripple hook (co-located with component) |
| `src/components/BodyMap/BodyMapTab.tsx` | Body Map tab container — loads somatic memories, computes HomunculusState, handles dormant state |
| `src/components/BodyMap/HomunculusSVG.tsx` | SVG homunculus figure with 10 animated body regions (Framer Motion), click-to-select, breathing animation |
| `src/components/BodyMap/RegionDetail.tsx` | Region detail panel — emotion pills, recent somatic quotes, entry dates |
| `src/components/Session/SessionView.tsx` | Session/conversation mode UI — therapist companion chat with crisis keyword detection before LLM generation |
| `src/components/Sidebar/EntriesList.tsx` | Unified sidebar — entries + sessions in one chronological list with Body Map tab (when `bodyMap` feature flag enabled) |
| `src/components/Sidebar/SettingsPanel.tsx` | Settings panel — slide-up overlay above gear button |
| `src/components/Sidebar/ModelSelector.tsx` | LLM model selection dropdown |
| `src/components/SessionClosing.tsx` | Session closing overlay — The Weaver's closing thought |
| `src/components/InnerWeather.tsx` | Inner weather display widget |
| `src/components/AnnouncementBanner.tsx` | Banner from global config, dismissible via sessionStorage |
| `src/components/CrisisResources.tsx` | Crisis helpline links shown during grounding |
| `src/components/DeleteAccountModal.tsx` | Account deletion confirmation. Lazy-loaded — default export |
| `src/components/PolicyContent.tsx` | Privacy policy + disclaimer, fully translated |
| `src/components/PolicyModal.tsx` | Modal wrapper for policy content — default export |
| `src/components/ErrorBoundary.tsx` | Only class component — `Sentry.captureException()` in `componentDidCatch` |

## Hooks

| File | Purpose |
|------|---------|
| `src/hooks/useTheme.ts` | Theme resolution (light/dark/system), sets `data-theme` on `<html>` |
| `src/hooks/useGroundingMode.ts` | Grounding state via `useSyncExternalStore`, sets `data-grounding` on `<html>` |
| `src/hooks/useFlowState.ts` | Flow state from keystroke timing, sets `data-flow` + `--flow-intensity` on `<html>` |
| `src/hooks/useTimeAwarePalette.ts` | Time-of-day hue shifts |
| `src/hooks/useSeasonalPalette.ts` | Seasonal color shifts |
| `src/hooks/useHandwritingMode.ts` | Handwriting font mode |

## Admin

| File | Purpose |
|------|---------|
| `src/admin/adminTypes.ts` | TypeScript types for admin API + `GlobalConfig` + rich metric types (WritingHabits, EmotionalLandscape, FeatureAdoption, AdminSession, AdminWeather, AdminLetter, AdminFossil) |
| `src/admin/adminApi.ts` | Client-side admin API caller (`adminFetch(action, params)`) |
| `src/admin/AdminDashboard.tsx` | Admin shell with 6 tabs. Lazy-loaded — default export |
| `src/admin/AdminOverview.tsx` | Live user count + cached metric cards + writing habits, emotional landscape, feature adoption sections + recent activity |
| `src/admin/AdminUsers.tsx` | Sortable user table (9 columns: user, entries, thoughts, interactions, words, parts, sessions, signup, last active) |
| `src/admin/AdminUserDetail.tsx` | 8-tab user detail view (entries, parts, thoughts, profile, sessions, weather, letters, fossils) |
| `src/admin/Admin{Analytics,Messages,Insights,Settings}.tsx` | Analytics charts, contact messages, AI insights, global config editor |

## Config & Build

| File | Purpose |
|------|---------|
| `functions/src/index.ts` | Cloud Functions: `chat` + `accountApi` + `adminApi` |
| `firebase.json` | Hosting config + rewrites: `/api/chat`, `/api/admin`, `/api/account` |
| `firestore.rules` | Security rules |
| `vite.config.ts` | Vite + React + Tailwind v4 + VitePWA + Sentry source maps; `manualChunks` splits editor + sentry |
| `vitest.config.ts` | Test config — finds `src/**/*.test.{ts,tsx}` |
| `eslint.config.js` | Flat config with TypeScript ESLint, React Hooks, React Refresh |
| `src/types/tiptap.d.ts` | TipTap editor.storage type augmentation |
| `src/types/env.d.ts` | Vite environment variable type declarations |
