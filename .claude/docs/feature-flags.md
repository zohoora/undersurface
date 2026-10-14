# Feature Flags & Global Config

`appConfig/global` provides feature flags toggleable via admin Settings (real-time via `onSnapshot`). The type is `GlobalConfig.features` in `src/admin/adminTypes.ts`; the server allowlist is `FEATURE_KEYS` in `functions/src/admin/configSchema.ts` (41 keys, booleans only; an unknown key rejects the whole save). Cost paths re-read flags server-side through `functions/src/shared/featureFlags.ts` (60s in-instance cache).

## Core flags — default **enabled**, checks use `!== false`

| Flag | Effect when off |
|------|-----------------|
| `features.partsEnabled` | No Journal part thoughts; the Inner voices toggle is hidden |
| `features.visualEffectsEnabled` | Static background (master switch for the three below) |
| `features.autocorrectEnabled` | Skip correction |
| `features.paragraphFade` | No paragraph settle animation |
| `features.inkWeight` | No text weight variation |
| `features.breathingBackground` | No breathing animation |
| `features.smsEnabled` | SMS kill switch: the webhook replies "paused" (opt-out still honored); the processor makes no model calls and sends only the fixed paused reply, or the fixed crisis reply when L1 fires; field windows stop. Server-only — the Settings phone-link UI is not gated (`functions/src/sms/state.ts`) |

## Experimental flags — default **disabled**, checks use `=== true`

| Flag | Effect when on |
|------|----------------|
| **Atmosphere** | |
| `features.timeAwareAtmosphere` | Time-of-day hue shifts |
| `features.seasonalShifts` | Seasonal color shifts |
| `features.flowStateVisuals` | Flow state glow effects |
| `features.handwritingMode` | Handwriting font mode |
| **Part Intelligence** | |
| `features.partsDisagreeing` | Parts respectfully disagree with each other |
| `features.partsQuoting` | Parts quote the writer's past writing |
| `features.partQuietReturn` | Bonus for parts that haven't spoken recently |
| `features.partCatchphrases` | Parts develop signature phrases |
| `features.silenceAsResponse` | Silence as a valid part response in flow |
| `features.quietOneEnabled` | The Quiet One seeded part (avoidance-aware) |
| `features.bodyMap` | Body Map (emotional homunculus) in sidebar |
| `features.bilateralStimulation` | Subtle alternating left/right edge pulses, rhythm adapts to emotion |
| **Memory/Engagement** | |
| `features.echoes` | Resurface patterns from past writing |
| `features.innerWeather` | Inner weather tracking |
| `features.lettersFromParts` | Letters from parts after sessions close; read in the settings sheet (`LettersSection`) |
| `features.ritualsNotStreaks` | Ritual detection from writing habits |
| `features.unfinishedThreads` | Resume unfinished themes across sessions |
| **Safety & companion** | |
| `features.emergencyGrounding` | Legacy: only the admin UI reads it. Grounding is always on via the L1/L2 crisis stack; the section's tuning (`grounding.*`) still applies |
| `features.ruptureRepair` | Alliance-rupture detection (abandoned session / terse ending / atypical gap) + explicit repair at the next opener + silent mid-session stance softening on live withdrawal. Suppressed under grounding |
| `features.ruminationPivot` | Rumination-loop detection (live per-turn classifier + cross-session reflection streak) + silent register pivot. Suppressed under grounding. Spec: `docs/superpowers/specs/2026-07-03-rupture-rumination-design.md` |
| `features.userParts` | Collaborative user-parts mapping (`#propose-part` marker + consent card); active parts + shared lexicon enter the prompt; "Parts of you" settings section. Spec: `docs/superpowers/specs/2026-07-04-user-parts-model-design.md` |
| `features.sessionIntentions` | Between-session intentions (volunteered via reflection or offered via `#offer-intention` + IntentionCard), warm opener follow-up, 3×"not yet" → once-ever pattern naming. Spec: `docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md` |
| `features.stanceAdaptation` | Per-session stance observations consolidated every 5th into ≤6 internal tendencies injected as prompt context. The closing check-in UI was retired 2026-10-14 |
| `features.userValues` | Collaborative values map (`#propose-value` + card); intentions link the value they serve; "What matters to you" in Settings. Spec: `docs/superpowers/specs/2026-07-04-companion-depth-program.md` |
| `features.companionInteriority` | Process disclosure (grounded only in stance data), companion promises (`#promise[:date]`, cap 2, `#kept-promise:<id>`), carrying |
| `features.companionPresence` | Designed silence: `[line](#presence)` renders one line + breathing indicator. Never during grounding |
| `features.earnedHumor` | Rare callback levity, stance-suppressed when it doesn't land |
| `features.storyArcs` | Story-so-far reflections at long-gap returns / anniversaries, ≥30-day cooldown, consume-once |
| **Biometric** (Session Mode only) | |
| `features.webcamHrv` | Webcam-based HRV via CHROM rPPG; populates `hrvContext` |
| `features.polarH10` | Polar H10 (or any standard BLE HR monitor) over Web Bluetooth; takes priority over the webcam. Hidden without Web Bluetooth (Safari, iOS) |
| **Voice** | |
| `features.voiceEnabled` | Speak surface; also the only way Room offers its voice approaches (without it Room offers Quiet company only). Server: `realtimeTokenApi` mints when this or Room is on |
| **Room** | |
| `features.roomEnabled` | Room surface (hidden and closed under grounding). See effective state below |

### Room's effective state

`roomEnabled === true || (roomEnabled unset && (relaxEnabled === true || driftEnabled === true))`

- Client: `isRoomEnabled` in `src/engine/surfaceAvailability.ts`, used by `SessionView` and, via `effectiveRoomEnabled` in `src/admin/featureFlags.ts`, by the admin toggle. Server: `isRoomEnabled` in `functions/src/shared/featureFlags.ts` (Realtime mint gate).
- `relaxEnabled` / `driftEnabled` are legacy keys kept only for this derivation; the admin UI no longer shows them. An explicit `roomEnabled` (either value) wins.
- `roomEnabled` is left out of `ADMIN_CONFIG_DEFAULTS` (`src/admin/adminDefaults.ts`) so an unset flag keeps deriving; Reset Defaults writes it `false` explicitly.

### Retired

- `customSoundscapesEnabled` (gated the removed `soundscapeApi`): stripped by `withoutRetiredFeatures` before an admin save and dropped server-side (`RETIRED_FEATURE_KEYS` in `configSchema.ts`), so stale stored copies never fail a save.
- `colorBleed`, `blankPageSpeaks`, `textHighlights`, `ghostText`, `intentionsEnabled`, `guidedExplorations` no longer exist.

### Not flag-gated

The July 10–11 programs (adaptive conductor, personal science, ambiguity prism, Fresh eyes, surface arcs, optimal endings) have no global flag: they run in every active, non-Fresh-eyes session and are suppressed under grounding. Field Mosaic and field windows are per-user preferences on `users/{uid}/companionPreferences/current` (`fieldMosaicEnabled`, `fieldWindows`).

## Settings cascade

`user localStorage > appConfig/global defaults > hardcoded DEFAULTS` (`src/store/settings.ts`)

When globalConfig updates, `invalidateSettingsCache()` propagates new defaults. Existing users keep their localStorage values for settings they've explicitly changed. Global overrides: `defaultResponseSpeed` → `responseSpeed`; `features.autocorrectEnabled === false` forces `autocorrect` off.

## Adding a new feature flag

1. Add it to `GlobalConfig.features` in `src/admin/adminTypes.ts`
2. Add it to `FEATURE_KEYS` in `functions/src/admin/configSchema.ts` (and its tests)
3. Add the admin Settings control and, if it should reset, `src/admin/adminDefaults.ts`
4. Use `=== true` for experimental or `!== false` for core; if a cost path depends on it, also check it server-side via `loadFeatureFlags`
5. Deploy functions before hosting, or admin saves that include the new key are rejected

## Global config tuning

Admin Settings exposes tunable parameters beyond feature flags (allowlist in `configSchema.ts`):

- **Defaults**: `defaultResponseSpeed` (0.5–2)
- **Voice** (`GlobalConfig.voice`): `defaultVoice` (Realtime voice used by Speak; Room uses the server default `marin`)
- **Atmosphere** (`GlobalConfig.atmosphere`): `timeShiftIntensity`, `morningHue`, `afternoonHue`, `eveningHue`, `nightHue`, `seasonalIntensity`, `seasonOverride`, `flowThresholdSeconds`, `flowGlowIntensity`, `handwritingFont`, `handwritingEffectBoost`
- **Part Intelligence** (`GlobalConfig.partIntelligence`): `quoteMinAge`, `quoteChance`, `disagreeChance`, `disagreeMinParts`, `quietThresholdDays`, `returnBonusMultiplier`, `catchphraseMaxPerPart`, `silenceFlowThreshold`, `silenceChance`
- **Engagement** (`GlobalConfig.engagement`): `echoMaxAge`, `echoChance`, `echoMaxPerSession`, `weatherUpdateInterval`, `letterTriggerEntries`, `letterMinParts`, `ritualDetectionWindow`, `threadMaxAge`, `threadChance`
- **Grounding** (`GlobalConfig.grounding`): `autoExitMinutes`, `selfRoleScoreBonus`, `otherRolePenalty`, `intensityThreshold` (the last has no runtime reader since distress-level grounding was retired)
- **Quota** (`GlobalConfig.quota`): `{ enabled, monthlyTokenCap, perRoleCaps }` for the chat token quota
- **Announcements**: `config.announcement` with `info`/`warning` types, dismissible via sessionStorage
- **Version signal**: `buildVersion` bumped via "Signal Update" button; clients detect via `onSnapshot` and show refresh banner
