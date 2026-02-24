# Feature Flags & Global Config

`appConfig/global` provides feature flags toggleable via admin Settings (real-time via `onSnapshot`).

## Core flags — default **enabled**, checks use `=== false` or `!== false`

| Flag | Effect when off |
|------|-----------------|
| `features.partsEnabled` | No AI thoughts |
| `features.visualEffectsEnabled` | Static background (master switch) |
| `features.autocorrectEnabled` | Skip correction |
| `features.paragraphFade` | No paragraph fade animation |
| `features.inkWeight` | No text weight variation |
| `features.colorBleed` | No part color tinting (also disabled in dark mode) |
| `features.breathingBackground` | No breathing animation |

## Experimental flags — default **disabled**, checks use `=== true`

| Flag | Effect when on |
|------|----------------|
| **Atmosphere** | |
| `features.timeAwareAtmosphere` | Time-of-day hue shifts |
| `features.seasonalShifts` | Seasonal color shifts |
| `features.flowStateVisuals` | Flow state glow effects |
| `features.handwritingMode` | Handwriting font mode |
| **Part Intelligence** | |
| `features.blankPageSpeaks` | Opening thought on new blank entries |
| `features.partsDisagreeing` | Parts respectfully disagree with each other |
| `features.partsQuoting` | Parts quote user's past writing |
| `features.partQuietReturn` | Bonus for parts that haven't spoken recently |
| `features.partCatchphrases` | Parts develop signature phrases |
| `features.silenceAsResponse` | Silence as a valid part response in flow |
| `features.quietOneEnabled` | The Quiet One seeded part (avoidance-aware) |
| `features.bodyMap` | Body Map (emotional homunculus) in sidebar |
| `features.bilateralStimulation` | Subtle alternating left/right edge pulses, rhythm adapts to emotion |
| **Memory/Engagement** | |
| `features.echoes` | Resurface patterns from past entries |
| `features.innerWeather` | Inner weather tracking |
| `features.entryFossils` | Commentary on revisited old entries |
| `features.lettersFromParts` | Periodic letters from parts |
| `features.ritualsNotStreaks` | Ritual detection from writing habits |
| `features.unfinishedThreads` | Resume unfinished themes across sessions |
| **Text Interaction** | |
| `features.textHighlights` | User-toggleable text highlights from AI parts |
| `features.ghostText` | User-toggleable ghost text annotations from AI parts |
| **Safety & Guidance** | |
| `features.emergencyGrounding` | Distress detection + grounding mode |
| `features.intentionsEnabled` | Per-entry writing intentions |
| `features.guidedExplorations` | AI writing prompts on new entries |

## Settings cascade

`user localStorage > appConfig/global defaults > hardcoded DEFAULTS`

When globalConfig updates, `invalidateSettingsCache()` propagates new defaults. Existing users keep their localStorage values for settings they've explicitly changed.

## Adding a new feature flag

Use `=== true` for experimental (disabled by default) or `=== false` for core (enabled by default). Add to `GlobalConfig` type in `adminTypes.ts` and admin Settings UI.

## Global config tuning

Admin Settings exposes tunable parameters beyond feature flags:

- **Defaults**: `defaultModel`, `defaultResponseSpeed`, `defaultTypewriterScroll` (`'off' | 'comfortable' | 'typewriter'`)
- **Atmosphere** (`GlobalConfig.atmosphere`): `timeShiftIntensity`, `morningHue`, `afternoonHue`, `eveningHue`, `nightHue`, `seasonalIntensity`, `seasonOverride`, `flowThresholdSeconds`, `flowGlowIntensity`, `handwritingFont`, `handwritingEffectBoost`
- **Part Intelligence** (`GlobalConfig.partIntelligence`): `quoteMinAge`, `quoteChance`, `disagreeChance`, `disagreeMinParts`, `quietThresholdDays`, `returnBonusMultiplier`, `catchphraseMaxPerPart`, `silenceFlowThreshold`, `silenceChance`, `blankPageDelaySeconds`
- **Engagement** (`GlobalConfig.engagement`): `echoMaxAge`, `echoChance`, `echoMaxPerSession`, `weatherUpdateInterval`, `fossilMinAge`, `fossilChance`, `letterTriggerEntries`, `letterMinParts`, `ritualDetectionWindow`, `threadMaxAge`, `threadChance`
- **Grounding** (`GlobalConfig.grounding`): `autoExitMinutes`, `selfRoleScoreBonus`, `otherRolePenalty`, `intensityThreshold`
- **Explorations** (`GlobalConfig.explorations`): `maxPrompts`, `triggerOnNewEntry`
- **Announcements**: `config.announcement` with `info`/`warning` types, dismissible via sessionStorage
- **Version signal**: `buildVersion` bumped via "Signal Update" button; clients detect via `onSnapshot` and show refresh banner
