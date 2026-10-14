# Subsystem Details

Room, the July 10–11 companion programs, SMS and field windows are documented in `CLAUDE.md`.

## Dark mode

Light, dark, and system-follow themes via `[data-theme="dark"]` on `<html>`. All colors are CSS custom properties in `atmosphere.css`. Dark mode uses warm charcoals, not blue-blacks. Each of 9 emotions has dark variants. Components with inline styles use `var(--bg-primary)` etc. Part thought alpha is boosted from `'25'` to `'30'` in dark mode via `boostAlpha()`.

Adding new themed components: use CSS `var()` for all colors. For React inline styles: `style={{ background: 'var(--bg-primary)' }}`. The `[data-theme="dark"]` block in `atmosphere.css` handles the rest.

## Adaptive parts system

Parts (Journal surface only) learn through five layers:
1. **Dynamic scoring** — `partOrchestrator.ts` uses `ifsRole`-based lookup tables, so emerged parts score correctly out of the box
2. **Observation memories** — every thought creates a `type: 'observation'` memory; TOL interactions create `type: 'interaction'` memories
3. **Session reflection** — `sessionReflectionEngine.ts` runs after a session closes (skipped in Fresh eyes) and produces summaries, reflection/pattern/somatic memories, profile updates
4. **Enhanced prompts** — `buildPartMessages()` injects categorized memories, user profile, summaries
5. **Part growth** — `partGrowthEngine.ts`, triggered from session reflection, evolves `systemPromptAddition`, `learnedKeywords`, `learnedEmotions`

Key types: `PartMemory.type` (`'observation' | 'interaction' | 'reflection' | 'pattern' | 'somatic'`), `EntrySummary`, `UserProfile`, `Part.learnedKeywords`, `Part.systemPromptAddition`.

`SHARED_INSTRUCTIONS` from `partPrompts.ts` is the single source of truth for all parts (seeded + emerged). Parts speak in `...phrase...` format — one short phrase (3-12 words), plain language, no poetry or metaphors.

## i18n

17 LTR languages. No library — flat key-value objects per language. `t(key)` for non-React, `useTranslation()` hook for React. English bundled inline; others lazy-loaded as `locale-<lang>-<hash>.js` chunks (runtime-cached by the service worker, not precached). `preloadLanguage` never rejects.

- AI system prompts stay English; `languageDirective()` appends the response language to user-facing prompts
- Internal prompts (reflection, growth, emotion) stay English because output feeds back into English-keyed logic
- Seeded part names translated via `getPartDisplayName()`; emerged parts keep LLM-generated names
- Room's spoken controls are English-only (`roomVoiceCommandsSupported`); other languages use the on-screen controls

English fallback blocks (`personalScienceEnglish` in `src/i18n/translations/sessionCopy.ts`, and `src/i18n/roomFallback.ts`) are spread FIRST in every locale, so a locale's own translation always wins. New keys: add English to the fallback (or `en.ts`) and a real translation to each locale. `untranslated.test.ts` fails on values identical to English unless allowlisted with a reason; key parity across all 17 locales is also enforced.

### Adding a new language

1. Add entry to `SUPPORTED_LANGUAGES` in `src/i18n/languages.ts`
2. Create `src/i18n/translations/{code}.ts` with all keys from `en.ts`
3. No other changes needed — `import.meta.glob` auto-discovers new files

## Emergency grounding

Grounding is activated by the crisis stack on any surface: L1 (`detectCrisisKeywords`) and the raced L2 classifier on every user turn (Talk, Journal, voice transcripts), plus the in-stream `<<RISK:2>>` preamble. It is not gated by a flag: `features.emergencyGrounding` is only read by the admin UI. State lives in `src/store/groundingState.ts` (`activateGrounding`, `isGroundingActive()`, `onGroundingActivated` sinks).

While grounding is active:
- `data-grounding="true"` on `<html>` — desaturated greens, slower breathing, overrides emotion atmosphere
- The therapist prompt is built with `isGrounding: true` (Real Talk off; repair/pivot/soften, proposals, offers, experiments, `#end:session` and surface handoffs suppressed)
- Journal parts are silenced (`SessionJournalSurface` gate); `partOrchestrator.ts` also keeps the grounding score shift (self-role +40, others -30 via `grounding.selfRoleScoreBonus` / `otherRolePenalty`)
- Room is hidden and closed, the conductor/research/prism/Field Mosaic/arcs are suppressed, letters are hidden
- `CrisisResources.tsx` renders helpline links
- Every activation merges `lastGroundingAt` into `companionPreferences/current` so SMS grounds replies and suppresses proactive texts for 72h
- Auto-exits after `grounding.autoExitMinutes` (default 5); a re-trigger resets the timer

Grounding events go to first-party diagnostics only, never to Google Analytics (GA shares a property with Ads conversions).

Tuning: admin Settings → Safety & Wellbeing → `GlobalConfig.grounding`.

## Crisis keyword floor (L1)

`detectCrisisKeywords` in `functions/src/shared/crisisFloor.ts` (re-exported to the browser via `sessionOrchestrator.ts`) is a synchronous, NFKC-normalized check for sincere, present, first-person methods/plans and unmistakable farewell-note framing. It deliberately does not catch passive death wishes, metaphor, grief or hyperbole — those are L2's job. It runs before generation in Talk, on voice/Room transcripts, in journal mode and as the first SMS check.

- **No cooldown, no feature flag** — runs on every user turn
- **Precision guards** (2026-10-14): pill patterns need an intent/overdose form; negation that directly governs the method defers unless doubted or conditional; clearly historical attempts (past framing + distance marker, no recency marker) defer
- **On SMS an L1 hit replaces the whole reply** with the fixed emergency text, so false positives are costly
- Changes require `npm run test:crisis` (live) on top of `crisisFloor.test.ts`

All prompt files (`partPrompts.ts`, `therapistPrompts.ts`) include hardened safety instructions: never affirm death wishes, treat "rest forever"/"be with God" style metaphor as possible ideation, ask when unsure.

## Bundle splitting

**manualChunks** (`vite.config.ts`): `firebase`, `react-vendor` (react, react-dom, framer-motion), `editor` (`@tiptap` + `prosemirror`), `sentry`.

**Lazy-loaded components:**
- `SessionView`, `AdminDashboard`, `Onboarding`, `CrisisResources` — `App.tsx` (its own local retry-then-reload wrapper)
- `VoiceField`, `RoomField` — `SessionView.tsx` via `src/utils/lazyWithRetry.ts`
- `DeleteAccountModal` — settings click; `BodyMapTab` — sidebar Body tab (`bodyMap` flag)

**Lazy-loaded translations**: 16 non-English files via `import.meta.glob`.

## PWA updates

`vite-plugin-pwa` with `skipWaiting` + `clientsClaim`. The precache leaves out locale chunks, `AdminDashboard-*`, `vision_bundle-*` (MediaPipe) and marketing images (`globIgnores`); those hashed chunks are cached on first use (`CacheFirst`, `on-demand-assets`, 40 entries, 60 days). After a deploy an open tab can fail to import an old-hash chunk: `lazyWithRetry` retries once and then reloads once per chunk (sessionStorage guard), `main.tsx` reloads once on `vite:preloadError`, and Room/Voice sit inside `SurfaceErrorBoundary` so a failure there doesn't take down the session. Native builds skip service-worker registration.

## Session closing

"End session" (or a tapped `[phrase](#end:session)` optimal-ending link) runs `handleEndSession` in `SessionView.tsx`: one closing companion turn, then the session note (skipped in Fresh eyes), `status: 'closed'`, post-session reflection and weather persistence (both skipped in Fresh eyes), and a biometric flush.

## Autocorrect

`src/ai/llmCorrect.ts` — LLM-based sentence-level correction, wired via `useAutocorrect` into the session composer and journal. Works in all languages with sentence-ending punctuation.

- Triggers on sentence-ending punctuation (`.!?।。！？`) — Latin/Hindi + space, CJK fullwidth punctuation without space (via `shouldTriggerAutocorrect()`)
- The client sends `model: 'qwen/qwen-2.5-7b-instruct'`, but the chat function ignores client model fields, so autocorrect actually runs on the pinned chat model
- `extractCompletedSentence()` finds the last completed sentence, skipping abbreviations (multilingual), ellipsis, and short sentences (< 3 words for Latin/Hindi, < 4 chars for CJK)
- `correctSentence()` validates the response (word count for Latin/Hindi, length-only for CJK, <30% length change)
- Thai: no standard sentence-ending punctuation — autocorrect silently does nothing
- Throttled: min 3s between calls, skips if a call is in flight
- Undo on Backspace (`useAutocorrect`, single-shot, cleared on any other keypress)

## Body map (emotional homunculus)

A persistent SVG visualization of the user's somatic emotional life, rendered as a homunculus figure in the sidebar. Controlled by `features.bodyMap`.

- Somatic memories come from session reflection (`sessionReflectionEngine.ts`, no extra API call), stored in `memories` with `type: 'somatic'`
- `bodyMapEngine.ts` computes `HomunculusState` client-side (never persisted) — maps emotions to 7 color families, normalizes region sizes (0.6-1.8) based on signal count
- `BodyMapTab.tsx` loads somatic memories and shows a dormant state with few signals
- `HomunculusSVG.tsx` renders 10 body regions as animated SVG paths (Framer Motion), chest has breathing animation
- `RegionDetail.tsx` shows emotion pills and recent quotes when a region is tapped

## Bilateral stimulation

Subtle visual bilateral stimulation via alternating left/right edge pulses (`BilateralPulse.tsx`, mounted in `App.tsx`). Controlled by `features.bilateralStimulation` + user toggle in Settings.

- Two fixed-position bars at screen edges; `requestAnimationFrame` drives sine-wave opacity alternation
- Rhythm adapts to current emotion: 4.5s (calm) to 1.8s (angry); during grounding, locks to the slowest speed
- Uses `var(--atmo-2)` so color matches the emotional atmosphere and dark mode

## Data export

`exportAllData()` in `src/store/dataExport.ts` exports user data as a human-readable Markdown document: profile, parts, legacy journal entries with thoughts/summaries, session transcripts (`sessions/{id}/messages`), Room visits (approach, length, sound, density, time spent, transcript), letters, SMS messages, and the experience/science collections. Part IDs resolved to names. Server-owned state (`smsSettings`, `quotas`) is not exported.

## HRV biofeedback (Session Mode)

Two interchangeable signal sources both emit the same `HrvMeasurement` shape; the downstream timeline and prompt context (Talk, Speak and Room voice) are source-agnostic.

**Webcam (`features.webcamHrv`)** — CHROM rPPG on skin-colored pixels from forehead + cheeks, processed in a Web Worker with windowed CHROM + Butterworth bandpass (1.2–2.5 Hz) + FFT. Camera auto-exposure / white-balance locked to manual. Respiration from a MediaPipe FaceLandmarker motion channel. Accuracy ±5–15 BPM of Apple Watch. Files: `hrvEngine.ts` (camera + ROI), `hrvSignalWorker.ts` (CHROM + FFT + derived metrics + respiratory bandpass), `HrvConsentDialog.tsx`.

**Polar H10 (`features.polarH10`)** — Web Bluetooth. Standard Heart Rate service (0x180D) yields HR + RR intervals at 1/1024-s resolution; Polar's proprietary PMD service streams 50 Hz / 16-bit accelerometer for chest-motion respiration. Magnitude → `respiratoryBandpass` (0.1–0.5 Hz, reused from worker) → envelope-normalized `breathingScale ∈ [0,1]` → rising zero-crossings give breath onsets → median of inter-crossing intervals = respiratory rate. Only works on Chrome/Edge/Opera/Samsung Internet; hidden on Safari/iOS. Files: `polarH10Engine.ts`, `usePolarH10Session.ts` (consent + Firestore flush + `getBreathingScale` stable getter), `PolarH10ConnectButton.tsx`, `PolarH10ConsentDialog.tsx`.

**Mutex.** H10 takes priority. `useSessionBiometrics.ts` stops any running webcam stream when `polar.enabled` becomes true; the webcam toggle is hidden while H10 is active. The same hook builds the `BiometricSource` that `useSessionStream`, `useSessionVoice` and Room's voice instructions read.

**Shared math.** `hrvSignalWorker.ts` exports `computeHrvMetrics`, `classifyAutonomicState`, `computeDerivedMetrics`, `respiratoryBandpass` — both engine paths import them. `HrvTimeline` consumes `HrvMeasurement` regardless of origin.

**Animation sync.** The `BiometricsBar` expanded view shows an H10 respiration panel with a live position bar driven by `getBreathingScale()` (rAF polling). Nothing else follows the chest signal since Relax was retired.

**Persistence.** `HrvSessionData` written to `hrvSessions/{sessionId}` every 10s with optional `source: 'camera' | 'polarH10'`. Webcam path stores signal dumps (raw RGB/CHROM/FFT) for offline algo analysis; H10 path leaves `signalDumps: []`.
