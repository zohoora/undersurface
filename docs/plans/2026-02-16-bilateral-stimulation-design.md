# Bilateral Stimulation — Design

## Goal

Add subtle, always-on visual bilateral stimulation (alternating left/right edge pulses) that adapts its rhythm to the user's emotional state. EMDR-informed but not clinical — a processing aid integrated into the writing atmosphere.

## Architecture

A new atmosphere-layer component `BilateralPulse` renders two fixed-position bars at screen edges that alternate opacity in a smooth sine-wave pattern. Speed maps to the current emotion detected by the existing emotion engine. No new API calls or detection logic needed.

## Visual Form

- Two vertical gradient bars at left and right screen edges
- ~8px wide on desktop, ~5px on mobile
- Color: warm tint derived from `var(--atmo-2)`, slightly more opaque
- Alternating opacity: when left glows (opacity ~0.4), right fades (opacity ~0.05), and vice versa
- Smooth sine-wave interpolation — no abrupt on/off

## Adaptive Rhythm

Cycle duration (one full left-right-left oscillation) maps to current emotion:

| Emotion | Cycle | Feel |
|---------|-------|------|
| neutral, contemplative | 4.5s | Slow, ambient |
| tender, hopeful, joyful | 3.5s | Gentle |
| sad | 3.0s | Steady |
| conflicted | 2.5s | Moderate |
| anxious, fearful | 2.0s | Quicker |
| angry | 1.8s | Fastest |

Speed transitions are smooth (interpolated over ~2s when emotion changes).

## Grounding Mode Override

During grounding (`data-grounding="true"`), rhythm locks to slowest speed (4.5s) regardless of emotion. Calming, not stimulating.

## Feature Flag & Settings

- New experimental flag: `features.bilateralStimulation` (default disabled)
- User toggle in Settings panel under existing "AI Interactions" section
- i18n key for the toggle label

## Files

| File | Action |
|------|--------|
| `src/components/Atmosphere/BilateralPulse.tsx` | **New** — component |
| `src/styles/atmosphere.css` | Add pulse bar styles + keyframes |
| `src/admin/adminTypes.ts` | Add `bilateralStimulation?: boolean` |
| `src/admin/AdminSettings.tsx` | Add toggle + default |
| `src/App.tsx` | Render `BilateralPulse` with emotion prop |
| `src/i18n/translations/en.ts` | Add settings label |
| `src/store/settings.ts` | Add to user-toggleable settings (if needed) |

## Not in Scope

- Haptic feedback (mobile vibration)
- Audio bilateral stimulation (alternating tones)
- User-adjustable speed override
- Clinical EMDR framing or language
