# Subsystem Details

## Dark mode

Light, dark, and system-follow themes via `[data-theme="dark"]` on `<html>`. All colors are CSS custom properties in `atmosphere.css`. Dark mode uses warm charcoals, not blue-blacks. Each of 9 emotions has dark variants. Components with inline styles use `var(--bg-primary)` etc. Color bleed is disabled in dark mode. Part thought alpha is boosted from `'25'` to `'30'` in dark mode via `boostAlpha()`.

Adding new themed components: use CSS `var()` for all colors. For React inline styles: `style={{ background: 'var(--bg-primary)' }}`. The `[data-theme="dark"]` block in `atmosphere.css` handles the rest.

## Adaptive parts system

Parts learn through five layers:
1. **Dynamic scoring** — `partOrchestrator.ts` uses `ifsRole`-based lookup tables, so emerged parts score correctly out of the box
2. **Observation memories** — every thought creates a `type: 'observation'` memory; TOL interactions create `type: 'interaction'` memories
3. **Reflection engine** — on entry switch, analyzes full entry + thoughts. Produces summaries, reflection/pattern memories, keyword suggestions, profile updates (~1 API call)
4. **Enhanced prompts** — `buildPartMessages()` injects categorized memories, user profile, entry summaries
5. **Part growth** — every 5 entries, evolves parts: updates `systemPromptAddition`, `learnedKeywords`, `learnedEmotions` (~1 API call)

Key types: `PartMemory.type` (`'observation' | 'interaction' | 'reflection' | 'pattern' | 'somatic'`), `EntrySummary`, `UserProfile`, `Part.learnedKeywords`, `Part.systemPromptAddition`.

`SHARED_INSTRUCTIONS` from `partPrompts.ts` is the single source of truth for all parts (seeded + emerged). Parts speak in `...phrase...` format — one short phrase (3-12 words), plain language, no poetry or metaphors.

## i18n

17 LTR languages. No library — flat key-value objects per language. `t(key)` for non-React, `useTranslation()` hook for React. English bundled inline, others lazy-loaded (~4-5KB each).

- AI system prompts stay English; `languageDirective()` appends response language to user-facing prompts (parts, fossils, letters, blank page, session closing)
- Internal prompts (reflection, growth, emotion) stay English because output feeds back into English-keyed logic
- Autocorrect is LLM-based and works in all languages
- Seeded part names translated via `getPartDisplayName()`; emerged parts keep LLM-generated names
- Distress detection is LLM-based via `analyzeEmotionAndDistress()` — works in any language

### Adding a new translation key

1. Add key + English text to `src/i18n/translations/en.ts`
2. Add to all 16 other language files
3. Use `t('key')` in non-React or `useTranslation()` hook in React

### Adding a new language

1. Add entry to `SUPPORTED_LANGUAGES` in `src/i18n/languages.ts`
2. Create `src/i18n/translations/{code}.ts` with all keys from `en.ts`
3. No other changes needed — `import.meta.glob` auto-discovers new files

## Emergency grounding

Controlled by `features.emergencyGrounding`. LLM-based distress detection via `analyzeEmotionAndDistress()` (piggybacked on emotion check, zero additional API calls). Distress level 0-3; activates at `intensityThreshold` (default 2).

- Grounding state sets `data-grounding="true"` on `<html>` — desaturated greens, slower breathing, overrides emotion atmosphere
- Self-role parts score +40, others -30
- Grounding prompt overrides intention in `buildPartMessages`
- Auto-exits after `autoExitMinutes` (default 5)
- Manual toggle in Settings when feature enabled
- `CrisisResources.tsx` renders helpline links during grounding

Tuning: admin Settings -> Safety & Wellbeing -> `GlobalConfig.grounding`.

## Crisis keyword detection (defense-in-depth)

Fast synchronous keyword check in `sessionOrchestrator.ts` — 20 regex patterns for suicidal ideation, self-harm, and passive death wishes. Runs BEFORE therapist LLM response generation in session mode.

- **No cooldown** — always runs on every message (unlike emotion check which has 30s cooldown)
- **No feature flag gate** — always active regardless of `emergencyGrounding` setting
- **Activates grounding immediately** — `activateGrounding('auto')` before LLM generates response, so `isGrounding: true` is passed to therapist prompt
- **Catches metaphor escalation** — patterns include "rest forever", "with Jesus", "don't want to be alive", "should I die"
- **Pure function available** — `detectCrisisKeywords()` exported for use without side effects (e.g., in tests)
- Works alongside async LLM-based emotion detection as defense-in-depth

All three prompt files (`partPrompts.ts`, `sessionPrompts.ts`, `therapistPrompts.ts`) include hardened safety instructions: never affirm death wishes, detect metaphor escalation, ask when unsure about "rest" meaning.

## Bundle splitting

Main chunk ~228KB gzipped.

**manualChunks**: `@tiptap`+`prosemirror` -> `editor` (~119KB), `@sentry` -> `sentry` (~30KB).

**Lazy-loaded components** (React.lazy, require default exports):
- `LivingEditor` — after auth + consent
- `AdminDashboard` — /admin route
- `DeleteAccountModal` — settings click

**Lazy-loaded engines/components** (dynamic import):
- `FossilEngine` — first entry switch
- `ExplorationEngine` — first new entry with feature enabled
- `BodyMapTab` — sidebar Body tab selection (when `bodyMap` feature enabled)

**Lazy-loaded translations**: 16 non-English files via `import.meta.glob`.

## Intentions

Per-entry writing intentions that persist and influence AI responses. Controlled by `features.intentionsEnabled`.

- `IntentionInput.tsx` renders above the editor (ghost button -> text input, 120 char max). The "set an intention" prompt only shows on blank pages; once an intention is set, it persists while writing
- Stored as `intention` field on entry document (accessed via cast, not in `DiaryEntry` interface)
- `buildPartMessages` appends intention guidance (skipped during grounding)
- `reflectionEngine.ts` prepends intention to entry text for summaries

## Guided explorations

AI-generated personalized writing prompts on new blank entries. Controlled by `features.guidedExplorations`.

- `explorationEngine.ts` uses profile + recent summaries to generate prompts
- Selecting a prompt sets it as the entry's intention
- Suppressed during grounding. Single-shot guard (`hasSuggested`) prevents duplicate API calls
- Tuning: `GlobalConfig.explorations` -> `maxPrompts`, `triggerOnNewEntry`

## Session closing

A warm closing ritual via "end session" button, fixed-positioned at top-right (always visible even when scrolled).

- Saves current entry, sends last ~600 chars to The Weaver via `chatCompletion` (max 80 tokens, 15s timeout)
- `SessionClosing.tsx` renders full-screen overlay with fade-in animation
- Fallback: "You showed up today. That matters."
- Uses The Weaver specifically (hardcoded prompt, not part ID lookup)

## Autocorrect

`src/ai/llmCorrect.ts` — LLM-based sentence-level correction. Works in all languages.

- Triggers on sentence-ending punctuation (`.!?。！？`) + space — sends the completed sentence to a small, cheap LLM (`google/gemini-2.0-flash-lite-001`)
- `extractCompletedSentence()` finds the last completed sentence, skipping abbreviations (Dr., etc., e.g., etc.), ellipsis, and short sentences (< 3 words)
- `correctSentence()` calls the LLM with temperature 0 and validates the response (same word count, <30% length change)
- Throttled: min 3s between calls, skips if a call is in-flight
- Undo on Backspace: `lastAutocorrectRef` in `LivingEditor.tsx` and `SessionView.tsx` (single-shot, cleared on any other keypress)
- Shown in Settings for all languages (no English-only guard)

## Body map (emotional homunculus)

A persistent SVG visualization of the user's somatic emotional life, rendered as a homunculus figure in the sidebar. Controlled by `features.bodyMap`.

- Somatic memories detected by `reflectionEngine.ts` during entry reflection (no extra API calls). Stored in `memories` collection with `type: 'somatic'` and `partId: '_somatic'`
- `bodyMapEngine.ts` computes `HomunculusState` client-side (never persisted) — maps emotions to 7 color families, normalizes region sizes (0.6-1.8) based on signal count
- `BodyMapTab.tsx` loads somatic memories, shows dormant state when < 5 signals ("Write. I'll take shape.")
- `HomunculusSVG.tsx` renders 10 body regions as animated SVG paths (Framer Motion), chest has breathing animation
- `RegionDetail.tsx` shows emotion pills and recent quotes when a region is tapped
- Sidebar shows Entries | Body tab bar when feature enabled; settings gear remains at bottom
- Somatic memories capped at 100 (pruned oldest-first)

## Bilateral stimulation

Subtle visual bilateral stimulation via alternating left/right edge pulses. EMDR-informed but not clinical. Controlled by `features.bilateralStimulation` + user toggle in Settings.

- `BilateralPulse.tsx` renders two fixed-position bars at screen edges
- `requestAnimationFrame` drives smooth sine-wave opacity alternation
- Rhythm adapts to current emotion: 4.5s (calm) to 1.8s (angry)
- During grounding, locks to slowest speed (4.5s)
- Requires both admin flag and user setting enabled
- Uses `var(--atmo-2)` so color automatically matches emotional atmosphere and dark mode

## Data export

`exportAllData()` in `db.ts` exports all user data as a human-readable Markdown document. Includes: user profile, parts with reflections, journal entries with thoughts/TOL/summaries/fossils, letters, writing sessions. Part IDs resolved to names.
