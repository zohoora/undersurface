# Bilateral Stimulation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add subtle visual bilateral stimulation (alternating left/right edge pulses) that adapts rhythm to emotional state.

**Architecture:** A new `BilateralPulse` atmosphere component renders two fixed-position bars at screen edges. A `requestAnimationFrame` loop drives smooth sine-wave opacity alternation. Speed is derived from the current `EmotionalTone` via a lookup map, with smooth interpolation between speed changes. Feature-flagged and user-toggleable.

**Tech Stack:** React, CSS custom properties, requestAnimationFrame, existing EmotionalTone type

---

### Task 1: Feature Flag & Admin Toggle

**Files:**
- Modify: `src/admin/adminTypes.ts:22` (add flag after `bodyMap`)
- Modify: `src/admin/AdminSettings.tsx:24,532` (add default + toggle)

**Step 1: Add type**

In `src/admin/adminTypes.ts`, add after `bodyMap?: boolean` (line 22):

```typescript
    bodyMap?: boolean
    bilateralStimulation?: boolean
```

**Step 2: Add default**

In `src/admin/AdminSettings.tsx`, add after `bodyMap: false` (line 24):

```typescript
    bodyMap: false,
    bilateralStimulation: false,
```

**Step 3: Add admin toggle**

In `src/admin/AdminSettings.tsx`, add after the Body Map `<ToggleRow>` block (after line 532):

```tsx
        <ToggleRow
          label="Bilateral Stimulation"
          checked={!!config.features.bilateralStimulation}
          onChange={(v) => setFeature('bilateralStimulation', v)}
        />
```

**Step 4: Verify**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 5: Commit**

```bash
git add src/admin/adminTypes.ts src/admin/AdminSettings.tsx
git commit -m "feat: add bilateralStimulation feature flag and admin toggle"
```

---

### Task 2: User Settings Toggle & i18n

**Files:**
- Modify: `src/store/settings.ts:20-21,36-37` (add setting)
- Modify: `src/i18n/translations/en.ts:58` (add label)
- Modify: `src/components/Sidebar/SettingsPanel.tsx:209-223` (add toggle)

**Step 1: Add to settings interface and defaults**

In `src/store/settings.ts`, add after the `ghostText: boolean` line (line 21):

```typescript
  ghostText: boolean
  bilateralStimulation: boolean
```

And in the DEFAULTS object, add after `ghostText: true` (line 37):

```typescript
  ghostText: true,
  bilateralStimulation: true,
```

**Step 2: Add i18n key**

In `src/i18n/translations/en.ts`, add after `'settings.ghostText'` (line 58):

```typescript
  'settings.bilateralStimulation': 'Bilateral Rhythm',
```

**Step 3: Add user toggle in SettingsPanel**

In `src/components/Sidebar/SettingsPanel.tsx`, find the AI Interactions section visibility check (line 209). Update the condition and add the toggle:

Update the section visibility condition (line 209) to also check `bilateralStimulation`:

```tsx
          {(globalConfig?.features?.textHighlights === true || globalConfig?.features?.ghostText === true || globalConfig?.features?.bilateralStimulation === true) && (
```

Add after the Ghost Text toggle (after line 221, before the closing `</div>`):

```tsx
              {globalConfig?.features?.bilateralStimulation === true && (
                <SettingRow label={t['settings.bilateralStimulation']}>
                  <Toggle checked={settings.bilateralStimulation} onChange={(v) => set('bilateralStimulation', v)} />
                </SettingRow>
              )}
```

**Step 4: Verify**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 5: Commit**

```bash
git add src/store/settings.ts src/i18n/translations/en.ts src/components/Sidebar/SettingsPanel.tsx
git commit -m "feat: add bilateral stimulation user toggle in settings"
```

---

### Task 3: BilateralPulse Component

**Files:**
- Create: `src/components/Atmosphere/BilateralPulse.tsx`

This is the core component. It renders two fixed-position bars and drives their opacity via `requestAnimationFrame`.

**Step 1: Create the component**

Create `src/components/Atmosphere/BilateralPulse.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { EmotionalTone } from '../../types'
import { isGroundingActive } from '../../hooks/useGroundingMode'

const EMOTION_SPEED: Record<EmotionalTone, number> = {
  neutral: 4.5,
  contemplative: 4.5,
  tender: 3.5,
  hopeful: 3.5,
  joyful: 3.5,
  sad: 3.0,
  conflicted: 2.5,
  anxious: 2.0,
  fearful: 2.0,
  angry: 1.8,
}

interface Props {
  emotion: EmotionalTone
  enabled?: boolean
}

export function BilateralPulse({ emotion, enabled = true }: Props) {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const currentSpeed = useRef(4.5)
  const startTime = useRef(0)

  useEffect(() => {
    if (!enabled) return

    startTime.current = performance.now()

    const animate = (now: number) => {
      // Smooth speed interpolation toward target
      const targetSpeed = isGroundingActive() ? 4.5 : (EMOTION_SPEED[emotion] || 4.5)
      const lerp = 0.02
      currentSpeed.current += (targetSpeed - currentSpeed.current) * lerp

      const elapsed = (now - startTime.current) / 1000
      const phase = (elapsed / currentSpeed.current) * Math.PI * 2
      // Sine wave: 0 to 1 for left, inverted for right
      const leftOpacity = 0.05 + 0.35 * ((Math.sin(phase) + 1) / 2)
      const rightOpacity = 0.05 + 0.35 * ((Math.sin(phase + Math.PI) + 1) / 2)

      if (leftRef.current) leftRef.current.style.opacity = String(leftOpacity)
      if (rightRef.current) rightRef.current.style.opacity = String(rightOpacity)

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => cancelAnimationFrame(rafRef.current)
  }, [emotion, enabled])

  if (!enabled) return null

  return (
    <>
      <div ref={leftRef} className="bilateral-pulse bilateral-pulse-left" />
      <div ref={rightRef} className="bilateral-pulse bilateral-pulse-right" />
    </>
  )
}
```

**Step 2: Verify**

Run: `npm run build`
Expected: Clean build (component not yet mounted, just compiled).

**Step 3: Commit**

```bash
git add src/components/Atmosphere/BilateralPulse.tsx
git commit -m "feat: add BilateralPulse atmosphere component"
```

---

### Task 4: CSS Styles

**Files:**
- Modify: `src/styles/atmosphere.css` (add after cursor glow styles, around line 170)

**Step 1: Add bilateral pulse styles**

In `src/styles/atmosphere.css`, add after the cursor glow tint block (around line 170, after the `.cursor-glow-tint` rules end):

```css
/* ── Bilateral Stimulation Pulses ─────────────────────── */

.bilateral-pulse {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 8px;
  z-index: 1;
  pointer-events: none;
  opacity: 0.05;
  transition: opacity 0.05s linear;
}

.bilateral-pulse-left {
  left: 0;
  background: linear-gradient(
    to right,
    var(--atmo-2) 0%,
    transparent 100%
  );
}

.bilateral-pulse-right {
  right: 0;
  background: linear-gradient(
    to left,
    var(--atmo-2) 0%,
    transparent 100%
  );
}

@media (max-width: 768px) {
  .bilateral-pulse {
    width: 5px;
  }
}
```

**Step 2: Verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/styles/atmosphere.css
git commit -m "feat: add bilateral pulse CSS styles"
```

---

### Task 5: Mount in App.tsx

**Files:**
- Modify: `src/App.tsx:497-498` (add BilateralPulse after CursorGlow)

**Step 1: Add import**

At the top of `src/App.tsx`, add after the CursorGlow import (line 3):

```typescript
import { BilateralPulse } from './components/Atmosphere/BilateralPulse'
```

**Step 2: Mount component**

In `src/App.tsx`, add after the `<CursorGlow>` line (line 498):

```tsx
      <CursorGlow partTint={activePartColor} />
      <BilateralPulse
        emotion={emotion}
        enabled={
          visualEffectsEnabled
          && globalConfig?.features?.bilateralStimulation === true
          && settings.bilateralStimulation !== false
        }
      />
```

The `enabled` prop requires all three conditions:
1. Visual effects are globally on
2. Admin has enabled the feature flag
3. User hasn't turned it off in their settings

**Step 3: Verify**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: mount BilateralPulse in App with feature gating"
```

---

### Task 6: Documentation Update

**Files:**
- Modify: `CLAUDE.md:112` (bump flag count)
- Modify: `.claude/docs/feature-flags.md:43-45` (add flag)
- Modify: `.claude/docs/subsystems.md` (mention in atmosphere or add section)
- Modify: `.claude/docs/key-files.md` (add file reference)

**Step 1: Update CLAUDE.md**

Change experimental flag count from `27` to `28`.

**Step 2: Update feature-flags.md**

In the Text Interaction section (after `ghostText`), add:

```markdown
| `features.bilateralStimulation` | Subtle alternating left/right edge pulses, rhythm adapts to emotion |
```

**Step 3: Update subsystems.md**

Add a new subsection after the Body Map section:

```markdown
## Bilateral stimulation

Subtle visual bilateral stimulation via alternating left/right edge pulses. EMDR-informed but not clinical. Controlled by `features.bilateralStimulation` + user toggle in Settings.

- `BilateralPulse.tsx` renders two fixed-position bars at screen edges
- requestAnimationFrame drives smooth sine-wave opacity alternation
- Rhythm adapts to current emotion: 4.5s (calm) to 1.8s (angry)
- During grounding, locks to slowest speed (4.5s)
- Requires both admin flag and user setting enabled
```

**Step 4: Update key-files.md**

Add after the PauseRipple entry in the Components table:

```markdown
| `src/components/Atmosphere/BilateralPulse.tsx` | Bilateral stimulation edge pulses — rhythm adapts to emotional tone |
```

**Step 5: Commit**

```bash
git add CLAUDE.md .claude/docs/feature-flags.md .claude/docs/subsystems.md .claude/docs/key-files.md
git commit -m "docs: add bilateral stimulation to documentation"
```

---

## Verification

1. Enable `bilateralStimulation` in `/admin` → Settings → Part Intelligence
2. Open the diary — subtle edge pulses should appear at left and right screen edges
3. Write calm content → verify slow rhythm (~4.5s cycle)
4. Write anxious/intense content → verify rhythm quickens (~2s)
5. Verify smooth transition between speeds (no jumping)
6. Toggle off in user Settings → pulses should disappear
7. Toggle visual effects off → pulses should disappear
8. Enable grounding mode → pulses should slow to 4.5s regardless of emotion
9. Check dark mode — pulses use `--atmo-2` which adapts automatically
10. Check mobile — bars should be 5px wide
11. Run `npm run build` — clean build
12. Run `npm run lint` — no warnings
