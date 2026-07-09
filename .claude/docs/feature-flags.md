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
| `features.ruptureRepair` | Alliance-rupture detection (abandoned session / terse ending / atypical gap) + explicit repair at the next opener + silent mid-session stance softening on live withdrawal. Suppressed under grounding |
| `features.ruminationPivot` | Rumination-loop detection (live per-turn classifier + cross-session reflection streak) + silent register pivot from a 4-move taxonomy. Suppressed under grounding. Spec: `docs/superpowers/specs/2026-07-03-rupture-rumination-design.md` |
| `features.userParts` | Collaborative user-parts mapping: reflection-pass observations → in-session proposal (`#propose-part` marker + consent card) → confirmed in the writer's own words; active parts + shared lexicon enter the prompt; "Parts of you" settings section. Suppressed under grounding. Spec: `docs/superpowers/specs/2026-07-04-user-parts-model-design.md` |
| `features.sessionIntentions` | The thread: between-session intentions in the writer's words (volunteered via reflection or companion-offered via `#offer-intention` + IntentionCard), warm opener follow-up, 3×"not yet" → once-ever pattern naming + avoidancePatterns. Cap 3 open. Suppressed under grounding. Spec: `docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md` |
| `features.stanceAdaptation` | N-of-1 stance learning: one-tap closing check-in (`Session.leavingFeeling`) + per-session stance observations consolidated every 5th into ≤6 internal plain-language tendencies injected as prompt context. Never touches safety/grounding behavior. Internal-only v1 |
| `features.userValues` | Collaborative values map (same propose→confirm grammar as parts, `#propose-value` + card); intentions link the value they serve; "What matters to you" in Settings. Spec: `docs/superpowers/specs/2026-07-04-companion-depth-program.md` |
| `features.companionInteriority` | Process disclosure (≤1/session, grounded ONLY in stance data), companion promises (`#promise[:date]` markers, cap 2, `#kept-promise:<id>` delivery, misses acknowledged), carrying (one reflection noticing → next opener, consume-once) |
| `features.companionPresence` | Designed silence: `[line](#presence)` renders one line + breathing indicator instead of paragraphs. Never during grounding |
| `features.earnedHumor` | Rare callback levity (lexicon/history), never at the writer's expense, stance-suppressed when observations read it as hindered |
| `features.storyArcs` | Story-so-far reflections at pivotal moments (long-gap return / anniversary), ≥30-day cooldown, declines on thin history, consume-once delivery |
| `features.intentionsEnabled` | Per-entry writing intentions |
| `features.guidedExplorations` | AI writing prompts on new entries |
| **Biometric** (Session Mode only) | |
| `features.webcamHrv` | Webcam-based HRV via CHROM rPPG; populates `hrvContext` in therapist prompt |
| `features.polarH10` | Polar H10 (or any standard BLE HR monitor) over Web Bluetooth; same downstream as webcam path. H10 takes priority when both flags are on and a device is paired. Hidden on browsers without Web Bluetooth (Safari, iOS) |
| **Relax** | |
| `features.driftEnabled` | Drift — bilateral noticing practice as its own session surface (bottom-bar pill; v2 2026-07-09, no longer inside Relax). Tap-first check-ins, 2/4/6-min lengths, engine-owned state machine, no return-to-target invariant, two-layer crisis stack reuse, voice adapter. Default OFF; entry hidden under grounding. Specs: `docs/superpowers/specs/2026-07-04-drift-design.md` (safety) + `2026-07-09-drift-v2-webapp-redesign.md` (experience) |

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
