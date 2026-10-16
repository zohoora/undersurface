# Key Files Reference

## AI & Prompts

| File | Purpose |
|------|---------|
| `src/ai/openrouter.ts` | Client-side API calls to `/api/chat` (legacy filename — calls the OpenAI proxy). `classifyCrisisRisk` (L2), `<<RISK:N;…>>` preamble parsing/stripping, `analyzeEmotionAndDistress()` (emotion tag; distress level is informational only) |
| `src/ai/therapistPrompts.ts` | Therapist companion prompts — `THERAPIST_CORE` (warm), `REAL_TALK_CORE` (calling-out coping patterns), `SAFETY_RULES`, `buildTherapistSystemPrompt` / `buildTherapistMessages`, session note + reflection prompts, the recommendation block (teaches only available surfaces). Mode swap is gated on `mode==='real_talk' && !isGrounding` — grounding always reverts to the warm core |
| `src/ai/voiceInstructions.ts` | `buildVoiceCompanionInstructions` — the single Realtime prompt for Speak and Room (live grounding, lexicon, HRV, flag gating) + `buildCurrentSessionSeed` (≤ 16 recent turns of THIS session, ≤ 6k chars, untrusted-wrapped; kept in Fresh eyes). Pure + synchronous so Room can reach `getUserMedia` inside the tap on iOS |
| `src/ai/roomPrompts.ts` | `buildRoomInstructions` — wraps the voice companion prompt with Room's approach/length/density contract; drops the "handled locally" claim for non-English sessions |
| `src/ai/partPrompts.ts` | System prompts for 7 seeded parts + `SHARED_INSTRUCTIONS` + emergence, reflection, growth, grounding prompts + `languageDirective()` |
| `src/ai/crisisClassifierPrompt.ts` / `signalClassifierPrompt.ts` | Browser-side builders for the `crisis_check` and `signal_check` classifier routes |
| `src/ai/therapistRecommendationParser.ts` | Parses `[phrase](#switch:target)` and `[phrase](#end:session)` into tappable segments |
| `src/ai/ambiguityPrismParser.ts` | Validates the three `[text](#prism:h1..h3)` lines of an ambiguity-prism turn |
| `src/ai/partProposalParser.ts` / `intentionOfferParser.ts` / `promiseParser.ts` | Marker parsers for part/value proposals, intention offers, companion promises |
| `src/ai/promptSafety.ts` | Prompt-injection defenses: `wrapUserContent`, `sanitizeForPrompt` |
| `src/ai/registerTiers.ts` | Register tiers + therapy-jargon bans |
| `src/ai/llmCorrect.ts` | LLM-based autocorrect — sentence-level correction. All languages with sentence-ending punctuation. Exports `shouldTriggerAutocorrect()`, `isCJK()`, `SENTENCE_END_PUNCT`, `CJK_SENTENCE_END` |
| `functions/src/shared/crisisClassifier.ts` | Canonical calibrated L2 prompt + structured-output schema shared by browser chat and SMS |
| `functions/src/shared/crisisFloor.ts` | Canonical narrow L1 floor (`detectCrisisKeywords`) shared by every channel, with the pills-intent, negation and distant-past precision guards |
| `functions/src/shared/companionKernel.ts` | Pure cross-channel companion contract: shared principles, response modes, web/voice/SMS capability matrix, memory aperture, alliance preferences, continuity blocks (incl. living hypotheses), grounding policy |

## Engines

| File | Purpose |
|------|---------|
| `src/engine/sessionOrchestrator.ts` | Session phase detection, L1 `checkCrisisKeywords` (activates grounding), emotion check, session note |
| `src/engine/turnResponder.ts` | `respondToUserTurn`: conductor → research → model routing; reads `isGroundingActive()` at call time and after every await, cancels research arms under grounding |
| `src/engine/adaptiveConductor.ts` | `planAdaptiveConductor` — shadow/live response-mode and surface-arm selection (`adaptive-conductor-v1`) |
| `src/engine/personalScience.ts` | `planResearchTurn`, research arms/protocols, transfer ladder, half-life/finding derivations (several now test-only) |
| `src/engine/freshEyes.ts` | `isFreshEyesSession`, `normalizeSessionMemoryAperture` |
| `src/engine/surfaceAvailability.ts` | `isRoomEnabled` (effective Room flag), `isVoiceEnabled`, `canOpenSurface` (surface + `#switch:` target gate, Room never under grounding) |
| `src/engine/roomEngine.ts` | Room clock: `buildRoomScore` (arrival/company/return cues), `roomCuesInWindow`, `ROOM_CUE_GRACE_MS`, `roomCueInstruction` (cue purposes), `detectRoomCommand` (English-only anchored spoken controls), `roomVoiceDensityAfter` |
| `src/engine/sessionFinalizer.ts` | Closes other active sessions when a new one starts, skipping any with activity in the last 30 minutes |
| `src/engine/sessionContextLoader.ts` | Browser-side bounded companion context: memories, profile, facts, recent notes, field notes, parts, intentions, stance, values, promises, protocols, hypotheses, recent Room visits, preferences |
| `src/engine/sessionReflectionEngine.ts` | Post-session reflection — memories, profile, somatic signals, personal facts, part/value/intention/stance observations, field moments, ambient assessment; triggers part growth and letters |
| `src/engine/partOrchestrator.ts` | Selects which part responds in Journal (role-based scoring); journal-mode crisis checks; pre-warms DB caches in `loadParts()` |
| `src/engine/pauseDetector.ts` | Detects writing pauses from keystroke timing |
| `src/engine/emergenceEngine.ts` | Detects new parts emerging from writing |
| `src/engine/partGrowthEngine.ts` | Part evolution — updates prompts, keywords, emotions (run from session reflection) |
| `src/engine/ruptureDetector.ts` / `signalTracker.ts` | Companion signals: deterministic rupture facts; hysteresis/cooldown for the per-turn signal classifier |
| `src/engine/userPartTracker.ts` / `userValueTracker.ts` / `intentionTracker.ts` / `storyArc.ts` | Companion depth state machines |
| `src/engine/letterEngine.ts` | Letters from parts after sessions close. Feature-flagged (`lettersFromParts`) |
| `src/engine/weatherEngine.ts` | Inner weather tracking from emotional tone shifts |
| `src/engine/ritualEngine.ts` | Session logging for ritual detection (writing habits) |
| `src/engine/disagreementEngine.ts` | Parts respectfully disagree. Feature-flagged (`partsDisagreeing`) |
| `src/engine/echoEngine.ts` / `threadEngine.ts` / `quoteEngine.ts` | Echoes, unfinished threads, quotes (flag-gated; read legacy `entries`) |
| `src/engine/bodyMapEngine.ts` | Computes HomunculusState from somatic memories |
| `src/engine/memoryPruner.ts` | Bounded pruning of high-growth collections after reflection |
| `src/engine/quietTracker.ts` | Tracks periods of silence/no writing |
| `src/engine/hrvEngine.ts` | Webcam HRV — `getUserMedia` + ROI extraction + Web Worker spawn. Feature-flagged (`webcamHrv`) |
| `src/engine/hrvSignalWorker.ts` | Web Worker — CHROM rPPG, Butterworth bandpass, FFT, derived metrics, respiratory bandpass. Exports `computeHrvMetrics` / `classifyAutonomicState` / `computeDerivedMetrics` / `respiratoryBandpass` — reused by the H10 path |
| `src/engine/hrvTimeline.ts` | Source-agnostic timeline: autonomic shifts, behavioral correlations, `hrvContext` builder |
| `src/engine/polarH10Engine.ts` | Polar H10 via Web Bluetooth — HRM parser, PMD ACC parser, streaming breathing extractor. Feature-flagged (`polarH10`) |

## TipTap Extensions

| File | Purpose |
|------|---------|
| `src/extensions/inkWeight.ts` | Varies text weight based on writing intensity |
| `src/extensions/paragraphSettle.ts` | Visual settling animation for paragraphs |

## Store & Config

| File | Purpose |
|------|---------|
| `src/store/db.ts` | Firestore wrapper for user collections and nested session messages |
| `src/store/settings.ts` | User settings in localStorage (3-tier cascade: hardcoded < globalConfig < localStorage); Room choices as `lastRoom*` |
| `src/store/globalConfig.ts` | Real-time listener on `appConfig/global`, `useGlobalConfig()` hook |
| `src/store/groundingState.ts` | Grounding state, auto-exit, `isGroundingActive()`, `onGroundingActivated` sinks; first-party diagnostics only (never GA) |
| `src/store/groundingPersistence.ts` | Merges `lastGroundingAt` into `companionPreferences/current` on every activation (installed in `main.tsx`) |
| `src/store/personalScience.ts` / `interventionOutcomes.ts` / `ambiguityPrism.ts` | Research-event, outcome and prism-feedback writers |
| `src/store/dataExport.ts` | `exportAllData()` → Markdown export (incl. Room visits, letters, session transcripts) |
| `src/firebase.ts` | Firebase/Firestore initialization with offline persistence |

## i18n

| File | Purpose |
|------|---------|
| `src/i18n/index.ts` | `t()` for non-React, `useTranslation()` hook, `getLanguageCode()`, `getLLMLanguageName()`, `getPartDisplayName()`, `preloadLanguage` |
| `src/i18n/languages.ts` | 17 supported languages + `detectBrowserLanguage()` |
| `src/i18n/translations/en.ts` | English source of truth for `TranslationKey` |
| `src/i18n/translations/*.ts` | 16 non-English files (lazy-loaded as `locale-<lang>-<hash>.js`) |

Each locale is assembled as `{ ...personalScienceEnglish, ...roomFallback, ...<lang>Base, ...sessionCopy.<lang> }`: English fallbacks come first so a real translation always wins. `src/i18n/untranslated.test.ts` fails when a non-English locale value equals English (with a reasoned allowlist); `src/i18n/policy.test.ts` pins the privacy-policy processor disclosure.

## Auth & Services

| File | Purpose |
|------|---------|
| `src/auth/AuthContext.tsx` | Auth provider — Google + Email/Password + password reset; sets Sentry + analytics user context; fires the Ads sign-up conversion |
| `src/auth/authContext.ts` | `AuthContextValue` interface |
| `src/auth/useAuth.ts` | Hook for consuming auth context |
| `src/auth/consentGate.ts` | First-run consent check |
| `src/services/analytics.ts` | Firebase Analytics wrapper — lazy-initializes on first `trackEvent()` |
| `src/services/diagnostics.ts` | First-party `engineLog` diagnostics (cooldown-limited) |
| `src/api/accountApi.ts` | Client-side account API caller, including SMS link/status/unlink actions |
| `src/api/apiBase.ts` / `authedFetch.ts` | Native origin prefixing; authenticated fetch |
| `src/security/contentSecurityPolicy.ts` | Derives the native meta CSP from the `firebase.json` header |
| `src/utils/lazyWithRetry.ts` | Retry-once-then-reload-once lazy import (sessionStorage loop guard) |
| `src/utils/connectionBanner.ts` | Pre-React IndexedDB/auth failure banner, removed once auth resolves |

## Components

| File | Purpose |
|------|---------|
| `src/components/LoginScreen.tsx` | Landing page (hero + auth section) |
| `src/components/Onboarding.tsx` | Post-signup consent flow |
| `src/components/Session/SessionView.tsx` | Session shell — Talk composer, surface switching (`canOpenSurface`), recommendation taps, surface arcs, Room/Voice mounting, biometrics, end-session. Accepts `initialMode` for new sessions and persists `session.mode` |
| `src/components/Session/SessionBottomBar.tsx` | Surface pills (Talk, Journal, Speak, Room) + options menu (Fresh eyes, Inner voices, Real Talk) |
| `src/components/Session/SessionMessage.tsx` | Message rendering: recommendation segments, prism card, conductor offer, proposal/intention cards |
| `src/components/Session/SessionJournalSurface.tsx` | In-session TipTap journal + parts |
| `src/components/Session/Room/RoomField.tsx` | Room modal dialog (portaled, focus-trapped, `#root` inert): choose screen, immersion, controls |
| `src/components/Session/VoiceField.tsx` | Speak overlay; rendered for any non-idle voice state |
| `src/components/Session/SurfaceErrorBoundary.tsx` | Local error boundary around Room and Voice |
| `src/components/Session/ConductorOfferCard.tsx` | Conductor surface offer + "Not now" (`markResearchOverridden`) |
| `src/components/Session/AmbiguityPrism.tsx` | Prism feedback card (fits / maybe / not this, rewrite) |
| `src/components/Session/FieldMosaic.tsx` | Unreviewed field moments at the top of a fresh session |
| `src/components/Session/SurfaceArc.tsx` | `SurfaceArcGuide` (Journal timer) + `SurfaceArcReturn` (outcome on return) |
| `src/components/Session/PartProposalCard.tsx` / `ValueProposalCard.tsx` / `IntentionCard.tsx` | Consent cards for parts, values, intentions |
| `src/components/Session/cardControls.ts` | Shared 44px-target / minimum-font styles for session cards |
| `src/components/Session/HrvAmbientBar.tsx` | `BiometricsBar` (HR, HRV, H10 respiration panel) |
| `src/components/Session/HrvConsentDialog.tsx` / `PolarH10ConsentDialog.tsx` / `PolarH10ConnectButton.tsx` | Biometric consent + connect |
| `src/components/Editor/useJournalParts.ts` / `PartThoughtBubble.tsx` / `HandwritingText.tsx` | Journal parts pipeline + rendering |
| `src/components/ThinkingOutLoud/ThinkingSpace.tsx` | "Thinking Out Loud" multi-turn part dialogue |
| `src/components/Atmosphere/*` | Breathing background, cursor glow, bilateral pulse, pause ripple |
| `src/components/BodyMap/*` | Body Map tab, homunculus SVG, region detail (`bodyMap` flag) |
| `src/components/Sidebar/EntriesList.tsx` | Session list (100 newest, live) + Body Map tab |
| `src/components/Sidebar/SettingsPanel.tsx` | Settings sheet |
| `src/components/Sidebar/SmsSettingsSection.tsx` | Expiring link codes, link state, SMS composer, disconnect; mounts `FieldWindowSettings` when linked |
| `src/components/Sidebar/FieldWindowSettings.tsx` | Field-window editor (≥ 15-minute windows, consent stamp) |
| `src/components/Sidebar/CompanionPreferencesSection.tsx` | Companion memory review, Field Mosaic toggle, alliance preferences |
| `src/components/Sidebar/LettersSection.tsx` | Letters from parts (hidden under grounding / until one exists) |
| `src/components/Sidebar/UserPartsSection.tsx` / `UserValuesSection.tsx` | "Parts of you" / "What matters to you" |
| `src/components/InnerWeather.tsx` | Inner weather display widget |
| `src/components/AnnouncementBanner.tsx` | Banner from global config, dismissible via sessionStorage |
| `src/components/CrisisResources.tsx` | Crisis helpline links shown during grounding |
| `src/components/DeleteAccountModal.tsx` | Account deletion confirmation. Lazy-loaded — default export |
| `src/components/PolicyContent.tsx` / `PolicyModal.tsx` | Privacy policy + disclaimer (processor disclosure: OpenAI, Twilio, Firebase, Sentry, Google Analytics/Ads; pinned by `policy.test.ts`) |
| `src/components/ErrorBoundary.tsx` | Root error boundary — `Sentry.captureException()` in `componentDidCatch` |

## Hooks

| File | Purpose |
|------|---------|
| `src/hooks/useSessionStream.ts` | Message lifecycle: append queue, L1 + raced L2 on every user turn, streaming, preamble handling, research delivery, deterministic companion messages (re-check grounding) |
| `src/hooks/useSessionVoice.ts` | Speak lifecycle over `useVoiceSession`; `connecting` while instructions are prepared |
| `src/hooks/useVoiceSession.ts` | Realtime WebRTC hook — `start`/`stop`/`toggleMute`/`setMicEnabled`/`cancelResponse`/`promptAssistant` (system item + bare `response.create`); connection-drop handling. `speak()` and the `passive` option are unused leftovers |
| `src/hooks/voiceErrors.ts` | Maps `realtime-token` error codes and Realtime failures to friendly errors; `isFatalRealtimeServerError` |
| `src/hooks/useRoomSession.ts` | One running Room: lifetime token, per-Room write queue, clock + cue delivery, spoken controls, audio ducking, wake lock |
| `src/hooks/useSessionBiometrics.ts` | Camera/Polar selection + mutex; builds the `BiometricSource` |
| `src/hooks/useHrvSession.ts` / `usePolarH10Session.ts` | Biometric session lifecycles (consent, flush, `getBreathingScale`) |
| `src/hooks/useGroundingMode.ts` | Grounding state via `useSyncExternalStore`, sets `data-grounding` on `<html>` |
| `src/hooks/useModalA11y.ts` | Escape, focus trap, initial focus and focus restore for dialogs |
| `src/hooks/useAutocorrect.ts` | Autocorrect + Backspace undo for composer/journal |
| `src/hooks/useTheme.ts` / `useTimeAwarePalette.ts` / `useSeasonalPalette.ts` / `useFlowState.ts` / `useHandwritingMode.ts` | Theme and atmosphere |

## Admin

| File | Purpose |
|------|---------|
| `src/admin/adminTypes.ts` | Admin API types + `GlobalConfig` |
| `src/admin/adminDefaults.ts` | `ADMIN_CONFIG_DEFAULTS` (no `roomEnabled`, so an unset flag keeps deriving) |
| `src/admin/featureFlags.ts` | `effectiveRoomEnabled`, `effectiveSmsEnabled`, `RETIRED_FEATURE_KEYS` stripping |
| `src/admin/adminApi.ts` | Client-side admin API caller (`adminFetch(action, params)`) |
| `src/admin/AdminDashboard.tsx` | Admin shell with 6 tabs. Lazy-loaded — default export |
| `src/admin/AdminUserDetail.tsx` | 11-tab user detail view |
| `src/admin/Admin{Overview,Users,Analytics,Messages,Insights,Settings}.tsx` | Dashboard tabs |

## Functions, Config & Build

| File | Purpose |
|------|---------|
| `functions/src/index.ts` | Exports the nine functions |
| `functions/src/chat.ts` / `realtime.ts` / `account.ts` / `mcp.ts` | Chat proxy, Realtime mint, account actions, MCP server |
| `functions/src/admin/configSchema.ts` | `appConfig/global` validation (`FEATURE_KEYS`, retired keys) |
| `functions/src/shared/featureFlags.ts` | Server reads of `features` (60s cache), `isRoomEnabled`, `isRealtimeVoiceAllowed` |
| `functions/src/shared/quota.ts` | Monthly token quota + per-day budgets in `quotas/{uid}` |
| `functions/src/sms/index.ts` | `smsApi` webhook + `smsInboundProcessor` |
| `functions/src/sms/state.ts` | Server-owned SMS state: risk, opt-out, consent revocation, daily budget, kill switch, deletion checks |
| `functions/src/sms/delivery.ts` | Twilio error classification (429 retry / 4xx terminal / else ambiguous) |
| `functions/src/sms/fieldWindows.ts` / `fieldWindowLogic.ts` | Field-window scheduler, dispatcher, sweeper / pure validation + decisions |
| `functions/src/sms/context.ts` / `prompts.ts` / `openai.ts` / `localTime.ts` | SMS context loader, prompt (writer-local time), model calls, timezone math |
| `functions/src/sms/linking.ts` / `field.ts` / `media.ts` / `moments.ts` / `research.ts` | Phone linking, intents + fixed copy, Twilio media, field moments, research events |
| `firebase.json` | Hosting rewrites, the single web CSP + Permissions-Policy headers, functions predeploy build |
| `firestore.rules` / `storage.rules` / `firestore.indexes.json` | Security rules + indexes (`tests/` covers all three) |
| `vite.config.ts` | Vite + React + Tailwind v4 + VitePWA (trimmed precache, runtime cache) + native meta CSP plugin + Sentry source maps; `manualChunks` splits firebase, react-vendor, editor, sentry |
| `vitest.config.ts` | Test config — finds `src/**/*.test.{ts,tsx}` |
| `eslint.config.js` | Flat config with TypeScript ESLint, React Hooks, React Refresh |
| `src/types/tiptap.d.ts` | TipTap editor.storage type augmentation |
| `src/types/env.d.ts` | Vite environment variable type declarations |

## Folio (`src/folio/`, 2026-10-16)

Design `docs/vision/2026-10-15-folio-v4.md`; runbook and log `docs/vision/folio-build-plan.md`.

| File | Role |
|---|---|
| `FolioApp.tsx` | Shell: routes, top bar (Pages, Kept, Sessions, •••), first-visit line, shore line, come-back and Return slips, settings, delete dialog, crisis card |
| `access.ts` | `canOpenFolio` (flag, admin, `folio` claim) and `folioSwitches` |
| `routes.ts` | `/folio`, `/folio/new`, `/folio/pages`, `/folio/p/:id`, `/folio/kept`, `/folio/kept/:id` |
| `page/FolioPageView.tsx` | One page: the editor, the save controller, the safety watch, Keep, Ask, Step inside, notices |
| `page/folioCore.ts` | The editor core: schema, the four C1 layers, keys, ornaments, notes plugin |
| `page/schema.ts` `foldView.ts` `protect.ts` `integrity.ts` `commands.ts` `keys.ts` | Fold/underside schema, the fold view and fences, input/history guards and the safety net, invariants, Lift/Unlift/Apart, the key table |
| `page/LiftControl.tsx` `undersideControls.ts` | Lift and Ask by the selection; an open underside's Close, Closer, Farther, Keep, Step inside |
| `save/PageSaveController.ts` `pendingStore.ts` `classify.ts` `pageLock.ts` `pageSession.ts` | C2: revisions and compare-and-swap, local pending saves, rejection classification, Web Locks and Edit here, move-to-editable |
| `safety/FolioSafetyWatch.ts` `samples.ts` `checkedSet.ts` | C4: per-unit slots, windows, the checked set |
| `safety/shorePresentation.ts` `recent.ts` | Shore / Quiet / Normal, and the Recent overlay |
| `kept/keep.ts` `traceStore.ts` `traceSafety.ts` `useKept.ts` | Snapshots, trace storage, trace safety, the shell's kept state |
| `kept/KeptView.tsx` `TraceView.tsx` `CorrectedCopy.tsx` `CompositionView.tsx` `ComeBackSlip.tsx` `ComeBackChoices.tsx` | The floor, a trace, corrected copies, the slips |
| `kept/comeBack.ts` `liftToday.ts` `goToPage.ts` `returnTide.ts` `floor.ts` | Writer-local dates, Lift into today, Go to the page, H3 eligibility, floor grouping |
| `inside/StepInside.tsx` `useStepInside.ts` `insideSound.ts` | H1 |
| `ask/askPrompt.ts` `askContract.ts` `notes.ts` `noteViews.ts` | H2 |
| `ReadingView.tsx` `PagesList.tsx` `DeletePageDialog.tsx` `handoff.ts` `viewState.ts` `zoom.ts` `folio.css` | Reading view, the pages list, deleting, Talk now bringing this, view state, pinch zoom, styles |

