# Unified Session Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind a `unifiedSessionUI` feature flag, ship the foundation of the unified-session canvas: Talk / Journal / Speak / Real Talk bottom bar, Real Talk in-canvas toggle, therapist recommendation vocabulary, and the parser that turns inline recommendations into tappable spans. Journal and Speak buttons are placeholder-disabled; their surface implementations come in Plan 2.

**Architecture:** Add an experimental admin-controlled flag (default off). Extend `buildTherapistSystemPrompt` with an optional `allowRecommendations` parameter that appends an instruction block teaching the companion therapist (only) one inline recommendation format: `[be more direct](#switch:real-talk-on)`. Add a parser that extracts this convention from rendered therapist text and a renderer that turns matches into tappable spans. Modify `SessionView` to (1) render a bottom bar when the flag is on, (2) toggle Real Talk via the bar (updates `session.mode`), (3) parse and render therapist recommendations as tappable inline phrases.

**Tech Stack:** TypeScript strict, React 19, Vitest, existing Firebase/Firestore, existing i18n system.

**Spec:** `docs/superpowers/specs/2026-05-05-unified-session-design.md`

---

## File Structure

### Created
- `src/ai/therapistRecommendationParser.ts` — extracts `[phrase](#switch:target)` patterns from therapist text into structured spans
- `src/ai/therapistRecommendationParser.test.ts` — unit tests
- `src/components/Session/SessionBottomBar.tsx` — Talk / Journal / Speak / Real Talk affordances
- `src/components/Session/SessionBottomBar.test.tsx` — unit tests

### Modified
- `src/types/index.ts` — add `unifiedSessionUI?: boolean` to `GlobalConfig`
- `src/ai/therapistPrompts.ts` — add `allowRecommendations?: boolean` param + recommendation instruction block
- `src/ai/therapistPrompts.test.ts` — assert block presence/absence under various conditions
- `src/components/Session/SessionView.tsx` — flag-gated bottom bar render, Real Talk toggle wiring, recommendation rendering
- `src/components/Session/SessionView.test.ts` — bottom bar + recommendation integration
- `src/i18n/translations.ts` (and per-locale files) — bottom bar labels in 17 languages

### Untouched
All engines (`partOrchestrator`, `sessionOrchestrator`, `pauseDetector`, `weatherEngine`, `bodyMapEngine`, `ritualEngine`, `hrvEngine`, etc.). All other prompts (`partPrompts`, `sessionPrompts`). Cloud Functions. Firestore rules/subcollections. `/new` route. `EntryChoice` component. Sidebar (`EntriesList`). The load-bearing `useRealTalk = mode === 'real_talk' && !isGrounding` invariant in `buildTherapistSystemPrompt` is preserved verbatim.

---

## Conventions

**Recommendation syntax (locked in):** `[<phrase>](#switch:<target>)` Markdown link with reserved fragment.

**Targets supported in this plan (Plan 1):** only `real-talk-on`. The therapist's prompt instruction in this plan teaches *only* the Real Talk recommendation. Plan 2 will add `journal`, `speak`, and `real-talk-off`. The parser is forward-compatible — it parses any `#switch:<target>` — but unknown targets dispatch a console warning and a no-op handler in this plan.

**Real Talk toggle storage:** the existing `session.mode: 'standard' | 'real_talk'` field continues to drive the persona. Toggling in-canvas writes to this field. No schema change.

**Feature flag tier:** experimental (default off). Same pattern as `webcamHrv`. Admin-controlled via `appConfig/global` Firestore doc; toggleable from the admin dashboard's Settings tab without redeploy.

---

## Tasks

### Task 1: Add `unifiedSessionUI` experimental flag to types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Locate the `GlobalConfig` interface and identify the experimental block**

Run: `grep -n "webcamHrv\|GlobalConfig" src/types/index.ts`

Read the surrounding ~20 lines to understand how experimental flags are organized (alphabetical within categories, or grouped, or at the end). Match the existing convention.

- [ ] **Step 2: Add the flag**

Modify `src/types/index.ts`. Inside the `GlobalConfig` interface, add (positioned to match the established organization — likely alphabetical or near other UI flags):

```typescript
unifiedSessionUI?: boolean
```

- [ ] **Step 3: Typecheck**

Run: `tsc -b`
Expected: PASS — the field is optional, all existing usage compiles.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add unifiedSessionUI experimental flag"
```

---

### Task 2: Build the recommendation parser

**Files:**
- Create: `src/ai/therapistRecommendationParser.ts`
- Create: `src/ai/therapistRecommendationParser.test.ts`

The parser takes a therapist message string and returns an array of segments — either `text` segments (plain prose) or `recommendation` segments (a phrase + a switch target). The renderer in Task 6 walks this array.

- [ ] **Step 1: Write the failing test file**

Create `src/ai/therapistRecommendationParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseRecommendations } from './therapistRecommendationParser'

describe('parseRecommendations', () => {
  it('returns a single text segment when there are no recommendations', () => {
    const result = parseRecommendations('I hear you. Tell me more about that.')
    expect(result).toEqual([
      { type: 'text', text: 'I hear you. Tell me more about that.' },
    ])
  })

  it('extracts a single recommendation surrounded by text', () => {
    const input = "I'm noticing a pattern. [Can I be more direct with you?](#switch:real-talk-on) It might help."
    const result = parseRecommendations(input)
    expect(result).toEqual([
      { type: 'text', text: "I'm noticing a pattern. " },
      { type: 'recommendation', phrase: 'Can I be more direct with you?', target: 'real-talk-on' },
      { type: 'text', text: ' It might help.' },
    ])
  })

  it('handles multiple recommendations in one message', () => {
    const input = '[Write about it](#switch:journal) or [say it aloud](#switch:speak).'
    const result = parseRecommendations(input)
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ type: 'recommendation', phrase: 'Write about it', target: 'journal' })
    expect(result[1]).toEqual({ type: 'text', text: ' or ' })
    expect(result[2]).toEqual({ type: 'recommendation', phrase: 'say it aloud', target: 'speak' })
    expect(result[3]).toEqual({ type: 'text', text: '.' })
  })

  it('preserves a recommendation at the very start of the message', () => {
    const input = '[Be more direct?](#switch:real-talk-on) Tell me what you really think.'
    const result = parseRecommendations(input)
    expect(result[0]).toEqual({ type: 'recommendation', phrase: 'Be more direct?', target: 'real-talk-on' })
  })

  it('preserves a recommendation at the very end of the message', () => {
    const input = "There's more here than words. [Write about it](#switch:journal)"
    const result = parseRecommendations(input)
    expect(result[result.length - 1]).toEqual({ type: 'recommendation', phrase: 'Write about it', target: 'journal' })
  })

  it('does not match plain Markdown links (no #switch: prefix)', () => {
    const input = 'See [this article](https://example.com) for more.'
    const result = parseRecommendations(input)
    expect(result).toEqual([{ type: 'text', text: 'See [this article](https://example.com) for more.' }])
  })

  it('does not match Markdown emphasis without the link form', () => {
    const input = 'Sometimes the *body knows* things the mind does not.'
    const result = parseRecommendations(input)
    expect(result).toEqual([{ type: 'text', text: 'Sometimes the *body knows* things the mind does not.' }])
  })

  it('returns the recommendation target verbatim, even if unknown to this version', () => {
    const input = '[Try this](#switch:future-mode) sometime.'
    const result = parseRecommendations(input)
    expect(result[0]).toEqual({ type: 'recommendation', phrase: 'Try this', target: 'future-mode' })
  })

  it('handles streaming-style partial input gracefully (open bracket not closed)', () => {
    const input = "I'm noticing a pattern. [Can I be more"
    const result = parseRecommendations(input)
    expect(result).toEqual([{ type: 'text', text: "I'm noticing a pattern. [Can I be more" }])
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx vitest run src/ai/therapistRecommendationParser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `src/ai/therapistRecommendationParser.ts`:

```typescript
export type RecommendationTarget = 'real-talk-on' | 'real-talk-off' | 'journal' | 'speak' | string

export type RecommendationSegment =
  | { type: 'text'; text: string }
  | { type: 'recommendation'; phrase: string; target: RecommendationTarget }

const PATTERN = /\[([^\]]+)\]\(#switch:([\w-]+)\)/g

export function parseRecommendations(input: string): RecommendationSegment[] {
  const segments: RecommendationSegment[] = []
  let cursor = 0
  for (const match of input.matchAll(PATTERN)) {
    const start = match.index ?? 0
    if (start > cursor) {
      segments.push({ type: 'text', text: input.slice(cursor, start) })
    }
    segments.push({ type: 'recommendation', phrase: match[1], target: match[2] })
    cursor = start + match[0].length
  }
  if (cursor < input.length) {
    segments.push({ type: 'text', text: input.slice(cursor) })
  }
  return segments.length > 0 ? segments : [{ type: 'text', text: input }]
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run src/ai/therapistRecommendationParser.test.ts`
Expected: PASS — 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/ai/therapistRecommendationParser.ts src/ai/therapistRecommendationParser.test.ts
git commit -m "feat(ai): add therapist recommendation parser

Extracts inline [phrase](#switch:target) patterns from therapist
streamed text into structured segments. Forward-compatible with
unknown targets — they parse but the renderer treats them as no-ops."
```

---

### Task 3: Add `allowRecommendations` to `buildTherapistSystemPrompt`

**Files:**
- Modify: `src/ai/therapistPrompts.ts`
- Modify: `src/ai/therapistPrompts.test.ts`

The prompt builder gains an optional parameter. When `allowRecommendations: true` AND the persona is companion (not Real Talk) AND grounding is not active AND it is not the very first response, append an instruction block teaching the Real Talk recommendation pattern.

In this plan, only `[<phrase>](#switch:real-talk-on)` is taught. Plans 2 will extend the block to include journal/speak patterns when those surfaces exist.

- [ ] **Step 1: Read the current prompt builder to understand structure**

Read `src/ai/therapistPrompts.ts` end-to-end. Identify:
- The `TherapistPromptOptions` type
- The `buildTherapistSystemPrompt` function
- Where `THERAPIST_CORE` and `REAL_TALK_CORE` are conditionally selected (the `useRealTalk` guard)
- Where existing optional blocks (HRV, personalFacts, intentions) are appended

- [ ] **Step 2: Write a failing test for the recommendation block presence (companion + allowed + not grounding + not first)**

Modify `src/ai/therapistPrompts.test.ts`. Add this test alongside existing ones:

```typescript
describe('buildTherapistSystemPrompt — recommendations', () => {
  it('appends the recommendation block when companion mode and allowRecommendations is true and not grounding and not first turn', () => {
    const prompt = buildTherapistSystemPrompt({
      mode: 'standard',
      isGrounding: false,
      isFirstTurn: false,
      allowRecommendations: true,
      // ... other required fields per existing test fixtures
    })
    expect(prompt).toContain('#switch:real-talk-on')
    expect(prompt).toMatch(/sparingly|at most once/i)
  })

  it('omits the recommendation block when allowRecommendations is false', () => {
    const prompt = buildTherapistSystemPrompt({
      mode: 'standard',
      isGrounding: false,
      isFirstTurn: false,
      allowRecommendations: false,
    })
    expect(prompt).not.toContain('#switch:real-talk-on')
  })

  it('omits the recommendation block in Real Talk mode (the calling-out persona does not soften by recommending)', () => {
    const prompt = buildTherapistSystemPrompt({
      mode: 'real_talk',
      isGrounding: false,
      isFirstTurn: false,
      allowRecommendations: true,
    })
    expect(prompt).not.toContain('#switch:real-talk-on')
  })

  it('omits the recommendation block during grounding (distress wants presence, not modality games)', () => {
    const prompt = buildTherapistSystemPrompt({
      mode: 'standard',
      isGrounding: true,
      isFirstTurn: false,
      allowRecommendations: true,
    })
    expect(prompt).not.toContain('#switch:real-talk-on')
  })

  it('omits the recommendation block on the first turn (do not pivot before establishing connection)', () => {
    const prompt = buildTherapistSystemPrompt({
      mode: 'standard',
      isGrounding: false,
      isFirstTurn: true,
      allowRecommendations: true,
    })
    expect(prompt).not.toContain('#switch:real-talk-on')
  })
})
```

(Adapt the option-object fields to match the existing `TherapistPromptOptions` shape — read the type and copy the minimum required fixture from existing tests. The `isFirstTurn` field is new; Step 4 adds it.)

- [ ] **Step 3: Run the test, confirm it fails**

Run: `npx vitest run src/ai/therapistPrompts.test.ts`
Expected: FAIL — `allowRecommendations` and `isFirstTurn` not on the type, or block not present.

- [ ] **Step 4: Add `allowRecommendations` and `isFirstTurn` to `TherapistPromptOptions`**

Modify the options interface in `src/ai/therapistPrompts.ts` to include:

```typescript
allowRecommendations?: boolean
isFirstTurn?: boolean
```

Both default-undefined → falsy, so existing call sites are unaffected.

- [ ] **Step 5: Implement the recommendation block**

In `src/ai/therapistPrompts.ts`, after the persona core selection but before the SAFETY_RULES append, add:

```typescript
const useRealTalk = mode === 'real_talk' && !isGrounding
const includeRecommendations =
  Boolean(allowRecommendations) &&
  !useRealTalk &&
  !isGrounding &&
  !isFirstTurn

const RECOMMENDATION_BLOCK = `
You can occasionally suggest a tonal shift when therapeutically apt, using this exact inline format woven into prose:

  [Can I be more direct with you?](#switch:real-talk-on)

The phrase inside the brackets is what the writer reads. The (#switch:real-talk-on) part is a hidden anchor — it tells the interface this phrase is tappable. Make the bracketed phrase fit naturally into your sentence; keep the URL part exact.

Use this sparingly: at most once per ~5 turns. Never on the first response. Never when the writer is grounding through distress. Never as a way to deflect from what they are saying. Use it when you sense the writer would benefit from being called out kindly — when softness is becoming avoidance.
`.trim()

const recommendationBlock = includeRecommendations ? `\n\n${RECOMMENDATION_BLOCK}\n` : ''
```

Then include `recommendationBlock` in the assembled prompt string at the appropriate position (typically after the persona/context blocks, before SAFETY_RULES).

- [ ] **Step 6: Run the new tests, confirm they pass**

Run: `npx vitest run src/ai/therapistPrompts.test.ts`
Expected: PASS — all five new tests, plus all existing tests (the optional fields don't change existing behavior).

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: PASS — 559+ tests, no failures. The crisis-override and Real Talk persona-swap tests in `realTalkFlow.test.ts` and the rest of `therapistPrompts.test.ts` continue to pass.

- [ ] **Step 8: Commit**

```bash
git add src/ai/therapistPrompts.ts src/ai/therapistPrompts.test.ts
git commit -m "feat(prompts): teach companion therapist to recommend Real Talk inline

Adds optional allowRecommendations + isFirstTurn options to
buildTherapistSystemPrompt. When companion + allowed + not grounding
+ not first turn, appends a block teaching the inline format
[phrase](#switch:real-talk-on). Real Talk persona is excluded — the
calling-out tone doesn't soften by recommending mode shifts. Grounding
suppresses recommendations entirely. Crisis override invariant preserved."
```

---

### Task 4: Build the SessionBottomBar component

**Files:**
- Create: `src/components/Session/SessionBottomBar.tsx`
- Create: `src/components/Session/SessionBottomBar.test.tsx`
- Modify: `src/i18n/translations.ts` (or wherever the shared keys live)

The bar renders four affordances: **Talk** (active by default), **Journal** (disabled placeholder), **Speak** (disabled placeholder), and **◇ Real Talk** (toggle). Layout matches mockup C from the brainstorm session — pill-shaped affordances on the left, Real Talk toggle on the right.

- [ ] **Step 1: Add bottom-bar i18n keys to one locale (English) to drive the component**

Modify `src/i18n/translations.ts` (or the English locale file). Add:

```typescript
'session.bottomBar.talk': 'Talk',
'session.bottomBar.journal': 'Journal',
'session.bottomBar.speak': 'Speak',
'session.bottomBar.realTalk': 'Real Talk',
'session.bottomBar.journalDisabled': 'Coming soon',
'session.bottomBar.speakDisabled': 'Coming soon',
```

(Other 16 locales are added in Step 8 to keep this task self-contained until then.)

- [ ] **Step 2: Write the failing component test**

Create `src/components/Session/SessionBottomBar.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionBottomBar } from './SessionBottomBar'

describe('SessionBottomBar', () => {
  it('renders all four affordances', () => {
    render(<SessionBottomBar activeSurface="talk" realTalkOn={false} onSurfaceChange={() => {}} onRealTalkToggle={() => {}} />)
    expect(screen.getByRole('button', { name: /talk/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /journal/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /speak/i })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /real talk/i })).toBeInTheDocument()
  })

  it('marks the active surface button as pressed', () => {
    render(<SessionBottomBar activeSurface="talk" realTalkOn={false} onSurfaceChange={() => {}} onRealTalkToggle={() => {}} />)
    const talkBtn = screen.getByRole('button', { name: /talk/i })
    expect(talkBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('disables Journal and Speak in this plan (no surface implementations yet)', () => {
    render(<SessionBottomBar activeSurface="talk" realTalkOn={false} onSurfaceChange={() => {}} onRealTalkToggle={() => {}} />)
    expect(screen.getByRole('button', { name: /journal/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /speak/i })).toBeDisabled()
  })

  it('Talk button is not interactive when already active (no-op click)', () => {
    const onSurfaceChange = vi.fn()
    render(<SessionBottomBar activeSurface="talk" realTalkOn={false} onSurfaceChange={onSurfaceChange} onRealTalkToggle={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /talk/i }))
    expect(onSurfaceChange).not.toHaveBeenCalled()
  })

  it('reflects realTalkOn prop in the switch state', () => {
    const { rerender } = render(<SessionBottomBar activeSurface="talk" realTalkOn={false} onSurfaceChange={() => {}} onRealTalkToggle={() => {}} />)
    expect(screen.getByRole('switch', { name: /real talk/i })).toHaveAttribute('aria-checked', 'false')
    rerender(<SessionBottomBar activeSurface="talk" realTalkOn={true} onSurfaceChange={() => {}} onRealTalkToggle={() => {}} />)
    expect(screen.getByRole('switch', { name: /real talk/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('toggling Real Talk fires onRealTalkToggle with the new value', () => {
    const onRealTalkToggle = vi.fn()
    render(<SessionBottomBar activeSurface="talk" realTalkOn={false} onSurfaceChange={() => {}} onRealTalkToggle={onRealTalkToggle} />)
    fireEvent.click(screen.getByRole('switch', { name: /real talk/i }))
    expect(onRealTalkToggle).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 3: Run the test, confirm it fails**

Run: `npx vitest run src/components/Session/SessionBottomBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the component**

Create `src/components/Session/SessionBottomBar.tsx`:

```typescript
import { t } from '../../i18n'

export type SessionSurface = 'talk' | 'journal' | 'speak'

interface Props {
  activeSurface: SessionSurface
  realTalkOn: boolean
  onSurfaceChange: (surface: SessionSurface) => void
  onRealTalkToggle: (next: boolean) => void
}

export function SessionBottomBar({ activeSurface, realTalkOn, onSurfaceChange, onRealTalkToggle }: Props) {
  const handleSurfaceClick = (surface: SessionSurface) => {
    if (surface === activeSurface) return
    onSurfaceChange(surface)
  }

  return (
    <div className="session-bottom-bar" role="toolbar" aria-label="Session controls">
      <div className="session-bottom-bar__surfaces">
        <button
          type="button"
          className="session-bottom-bar__pill"
          aria-pressed={activeSurface === 'talk'}
          onClick={() => handleSurfaceClick('talk')}
        >
          {t('session.bottomBar.talk')}
        </button>
        <button
          type="button"
          className="session-bottom-bar__pill"
          aria-pressed={activeSurface === 'journal'}
          disabled
          title={t('session.bottomBar.journalDisabled')}
        >
          {t('session.bottomBar.journal')}
        </button>
        <button
          type="button"
          className="session-bottom-bar__pill"
          aria-pressed={activeSurface === 'speak'}
          disabled
          title={t('session.bottomBar.speakDisabled')}
        >
          {t('session.bottomBar.speak')}
        </button>
      </div>
      <button
        type="button"
        role="switch"
        className="session-bottom-bar__realtalk"
        aria-checked={realTalkOn}
        aria-label={t('session.bottomBar.realTalk')}
        onClick={() => onRealTalkToggle(!realTalkOn)}
      >
        ◇ {t('session.bottomBar.realTalk')}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Add minimal CSS**

Locate the existing Session-related CSS file (likely `src/components/Session/SessionView.css` or a global stylesheet). Append:

```css
.session-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-elevated, rgba(0, 0, 0, 0.03));
  border-radius: 8px;
  margin: 8px 0;
  font-size: 12px;
}

.session-bottom-bar__surfaces {
  display: flex;
  gap: 6px;
}

.session-bottom-bar__pill {
  padding: 4px 10px;
  border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.15));
  border-radius: 999px;
  background: var(--bg-primary, rgba(255, 255, 255, 0.6));
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary);
}

.session-bottom-bar__pill[aria-pressed="true"] {
  background: var(--bg-accent-soft, rgba(0, 0, 0, 0.05));
  border-color: var(--border-strong, rgba(0, 0, 0, 0.4));
}

.session-bottom-bar__pill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.session-bottom-bar__realtalk {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-muted, rgba(0, 0, 0, 0.6));
  padding: 4px 8px;
}

.session-bottom-bar__realtalk[aria-checked="true"] {
  color: var(--accent-warm, #b87333);
  font-weight: 500;
}
```

(Use existing CSS variable names if these don't exist verbatim — match the codebase's theme variable conventions per `CLAUDE.md`.)

- [ ] **Step 6: Run the test, confirm it passes**

Run: `npx vitest run src/components/Session/SessionBottomBar.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: 0 new errors.

- [ ] **Step 8: Add bottom-bar i18n keys to all 17 locales**

Identify all locale files (search for `session.mode.realTalk` translations to find the locale list — those keys already exist in every locale per the existing `translations.test.ts`).

For each locale file, add the same 6 keys (`session.bottomBar.talk`, `session.bottomBar.journal`, `session.bottomBar.speak`, `session.bottomBar.realTalk`, `session.bottomBar.journalDisabled`, `session.bottomBar.speakDisabled`) with appropriate translations.

If translations are uncertain for a given language, use a minimal but accurate translation (for example, in Japanese: 話す / 書く / 声で / 直球モード). The user can refine post-merge — what matters is that `translations.test.ts` (which enforces "every language has all keys") passes.

- [ ] **Step 9: Run the i18n test to confirm coverage**

Run: `npx vitest run src/i18n/translations.test.ts`
Expected: PASS — every locale has all 6 new keys.

- [ ] **Step 10: Commit**

```bash
git add src/components/Session/SessionBottomBar.tsx src/components/Session/SessionBottomBar.test.tsx src/components/Session/*.css src/i18n/
git commit -m "feat(session): add bottom-bar component with Real Talk toggle

Talk / Journal / Speak / Real Talk affordances. Talk is active default;
Journal and Speak are placeholder-disabled (Plan 2 implements those
surfaces). Real Talk is a switch (orthogonal to surface). i18n keys
added to all 17 locales."
```

---

### Task 5: Wire the bottom bar into `SessionView` behind the feature flag

**Files:**
- Modify: `src/components/Session/SessionView.tsx`
- Modify: `src/components/Session/SessionView.test.ts`

When the `unifiedSessionUI` flag is on, `SessionView` renders the bottom bar above the compose area. The Real Talk toggle reads from / writes to `session.mode`. Toggling persists immediately to Firestore.

- [ ] **Step 1: Read `SessionView.tsx` to understand its current structure**

Run: `wc -l src/components/Session/SessionView.tsx`

Read the full file. Identify:
- Where the session document is loaded (probably an `onSnapshot` subscription)
- Where the compose area is rendered
- Where the existing `mode` field is read (for UI like the mode badge `◆ Real Talk`)
- Where messages are sent / how the `mode` field flows into `buildTherapistSystemPrompt`

- [ ] **Step 2: Read `globalConfig.ts` to understand flag access**

Run: `grep -n "useGlobalConfig\|getGlobalConfig" src/store/globalConfig.ts | head -5`

Note the pattern for reading flags inside React components (`useGlobalConfig()`).

- [ ] **Step 3: Write the failing test for flag-gated rendering**

Modify `src/components/Session/SessionView.test.ts` (or create a focused new test file if the existing one is integration-shaped). Add tests:

```typescript
describe('SessionView — bottom bar (unifiedSessionUI flag)', () => {
  it('does NOT render the bottom bar when the flag is off', () => {
    // Mock globalConfig to return { unifiedSessionUI: false }
    // Render SessionView with a fixture session
    // Assert: queryByRole('toolbar', { name: /session controls/i }) is null
  })

  it('renders the bottom bar when the flag is on', () => {
    // Mock globalConfig to return { unifiedSessionUI: true }
    // Render SessionView with a fixture session
    // Assert: getByRole('toolbar', { name: /session controls/i }) exists
  })

  it('Real Talk switch reflects session.mode (off when standard, on when real_talk)', () => {
    // Mock unifiedSessionUI: true, session.mode: 'standard'
    // Assert: aria-checked='false'
    // Re-render with session.mode: 'real_talk'
    // Assert: aria-checked='true'
  })

  it('toggling Real Talk writes session.mode to Firestore', async () => {
    // Mock unifiedSessionUI: true, session.mode: 'standard'
    // Mock the db update method (db.sessionLog.update or whatever the codebase uses)
    // Click the Real Talk switch
    // Assert: mock was called with mode: 'real_talk'
  })
})
```

(Match the existing test patterns in `SessionView.test.ts` for mocking — copy a fixture and a render harness from there. The exact Firestore mock pattern follows the convention in the existing test file.)

- [ ] **Step 4: Run the test, confirm it fails**

Run: `npx vitest run src/components/Session/SessionView.test.ts`
Expected: FAIL — bottom bar not rendered, mode toggle wiring not present.

- [ ] **Step 5: Integrate the bottom bar into SessionView**

In `src/components/Session/SessionView.tsx`:

1. Import the component:
   ```typescript
   import { SessionBottomBar, type SessionSurface } from './SessionBottomBar'
   import { useGlobalConfig } from '../../store/globalConfig'
   ```

2. At the top of the component body, read the flag:
   ```typescript
   const globalConfig = useGlobalConfig()
   const unifiedUI = globalConfig?.unifiedSessionUI === true
   ```

3. Add local surface state (for now, only `'talk'` is reachable — Journal and Speak are placeholder-disabled):
   ```typescript
   const [surface, setSurface] = useState<SessionSurface>('talk')
   ```

4. Wire the Real Talk toggle to the existing session-mode update path:
   ```typescript
   const handleRealTalkToggle = async (next: boolean) => {
     const nextMode: 'standard' | 'real_talk' = next ? 'real_talk' : 'standard'
     await db.sessionLog.update(sessionId, { mode: nextMode })
     // Mode change triggers re-subscription via onSnapshot; UI updates automatically.
   }
   ```

   (Use the actual update method from `src/store/db.ts` — `db.sessionLog.update` or equivalent.)

5. Render the bottom bar above the existing compose area when `unifiedUI` is on:
   ```typescript
   {unifiedUI && (
     <SessionBottomBar
       activeSurface={surface}
       realTalkOn={session?.mode === 'real_talk'}
     onSurfaceChange={setSurface}
       onRealTalkToggle={handleRealTalkToggle}
     />
   )}
   ```

6. **Important:** when `unifiedUI` is on, hide the existing `◆ Real Talk` header badge (which is now redundant with the bottom-bar switch). Preserve the badge when the flag is off (legacy UI):

   Locate the existing badge render. Wrap with `{!unifiedUI && existingBadgeJSX}`.

- [ ] **Step 6: Run the tests, confirm they pass**

Run: `npx vitest run src/components/Session/SessionView.test.ts`
Expected: PASS — 4 new tests, plus existing tests unchanged.

- [ ] **Step 7: Run the full suite**

Run: `npm run test`
Expected: PASS — no regressions.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: 0 new errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/Session/SessionView.tsx src/components/Session/SessionView.test.ts
git commit -m "feat(session): render bottom bar when unifiedSessionUI flag is on

Bar appears above the compose area. Real Talk toggle reads/writes
session.mode (same Firestore field that drives persona today). Existing
◆ Real Talk header badge is hidden when the flag is on (the bottom-bar
switch makes it redundant). Flag default is off, so existing UX is
unchanged."
```

---

### Task 6: Render therapist recommendations as tappable inline phrases

**Files:**
- Modify: `src/components/Session/SessionView.tsx` (or whichever component renders therapist message bubbles)
- Modify: `src/components/Session/SessionView.test.ts`

When the flag is on, therapist message rendering uses the parser. Recommendation segments render as `<button>` elements inline (semantically a button, styled as italic text). Tapping dispatches via a single handler that maps targets to actions; in this plan, `real-talk-on` is the only target with a wired action.

- [ ] **Step 1: Locate the therapist message renderer**

Run: `grep -n "therapist\|message\|bubble" src/components/Session/SessionView.tsx | head -20`

Find where therapist messages are rendered (likely a map over `session.messages` filtering by `role === 'assistant'` or similar). Note the current rendering — probably plain text or basic Markdown.

- [ ] **Step 2: Write the failing test**

Add to `SessionView.test.ts`:

```typescript
describe('SessionView — recommendation rendering (unifiedSessionUI flag)', () => {
  it('renders an inline button when a therapist message contains [phrase](#switch:real-talk-on)', () => {
    // Mock unifiedSessionUI: true
    // Render SessionView with a session whose latest therapist message is:
    //   "I'm noticing a pattern. [Can I be more direct with you?](#switch:real-talk-on) It might help."
    // Assert: getByRole('button', { name: /can i be more direct/i }) exists
    // Assert: the surrounding text "I'm noticing a pattern." and "It might help." are also present (as plain text)
  })

  it('clicking the inline button toggles Real Talk on', async () => {
    // Same setup as above
    // Click the button
    // Assert: db.sessionLog.update was called with mode: 'real_talk'
  })

  it('renders plain text when the flag is off (no parsing)', () => {
    // Mock unifiedSessionUI: false
    // Same therapist message
    // Assert: queryByRole('button', { name: /can i be more direct/i }) is null
    // Assert: the raw '[Can I be more direct with you?](#switch:real-talk-on)' text is present in the document (or however the legacy renderer handles it — match existing behavior)
  })

  it('treats unknown switch targets as no-op (still renders button, click logs warning, no state change)', () => {
    // Mock unifiedSessionUI: true
    // Therapist message: "[Try this](#switch:future-mode) sometime."
    // vi.spyOn(console, 'warn')
    // Click the button
    // Assert: console.warn was called with a message mentioning 'unknown' or 'future-mode'
    // Assert: db.sessionLog.update was NOT called
  })
})
```

- [ ] **Step 3: Run the test, confirm it fails**

Run: `npx vitest run src/components/Session/SessionView.test.ts -t recommendation`
Expected: FAIL — buttons not rendered.

- [ ] **Step 4: Implement the renderer**

In `src/components/Session/SessionView.tsx`:

1. Import the parser:
   ```typescript
   import { parseRecommendations, type RecommendationSegment } from '../../ai/therapistRecommendationParser'
   ```

2. Add a recommendation dispatch handler:
   ```typescript
   const handleRecommendationTap = (target: string) => {
     switch (target) {
       case 'real-talk-on':
         handleRealTalkToggle(true)
         return
       case 'real-talk-off':
         handleRealTalkToggle(false)
         return
       case 'journal':
       case 'speak':
         // Plan 2 implements these surfaces.
         console.warn(`[unifiedSession] Recommendation target "${target}" not yet implemented (Plan 2)`)
         return
       default:
         console.warn(`[unifiedSession] Unknown recommendation target: "${target}"`)
         return
     }
   }
   ```

3. Wrap the therapist message text rendering in a parser-aware function (only when the flag is on):
   ```typescript
   const renderTherapistText = (text: string) => {
     if (!unifiedUI) return text
     const segments = parseRecommendations(text)
     return segments.map((seg, i) => {
       if (seg.type === 'text') return <span key={i}>{seg.text}</span>
       return (
         <button
           key={i}
           type="button"
           className="session-recommendation"
           onClick={() => handleRecommendationTap(seg.target)}
         >
           {seg.phrase}
         </button>
       )
     })
   }
   ```

4. Replace the existing therapist text render with `{renderTherapistText(message.text)}`.

5. Add CSS for the inline recommendation button:
   ```css
   .session-recommendation {
     background: none;
     border: none;
     padding: 0;
     font-style: italic;
     font-family: inherit;
     font-size: inherit;
     color: var(--accent-warm, #b87333);
     cursor: pointer;
     text-decoration: none;
     border-bottom: 1px dotted var(--accent-warm, #b87333);
   }
   .session-recommendation:hover {
     border-bottom-style: solid;
   }
   ```

- [ ] **Step 5: Run the recommendation tests, confirm they pass**

Run: `npx vitest run src/components/Session/SessionView.test.ts -t recommendation`
Expected: PASS — 4 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm run test`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/components/Session/SessionView.tsx src/components/Session/SessionView.test.ts src/components/Session/*.css
git commit -m "feat(session): render therapist recommendations as tappable spans

When unifiedSessionUI is on, therapist messages are parsed for
[phrase](#switch:target) patterns. Each match renders as an inline
button styled as italic warm-amber underlined text. Real Talk targets
are wired (toggles session.mode); journal/speak/unknown targets log a
warning and no-op (Plan 2 implements those surfaces)."
```

---

### Task 7: Wire `allowRecommendations` and `isFirstTurn` from `SessionView` to the prompt builder

**Files:**
- Modify: `src/components/Session/SessionView.tsx` (or wherever the message-send path lives)

The prompt builder gained two new options in Task 3, but no caller passes them yet. SessionView needs to compute `isFirstTurn` (true when the session has no prior user messages) and pass `allowRecommendations: unifiedUI` (the same flag — only the unified UI knows what to do with the inline recommendations).

- [ ] **Step 1: Locate the call to `buildTherapistSystemPrompt`**

Run: `grep -rn "buildTherapistSystemPrompt" src/`

There may be one or more call sites (likely in SessionView's send-message handler or in `useChatResponse` per recent refactor). Pick the canonical one for therapist messages.

- [ ] **Step 2: Compute `isFirstTurn` and pass both options**

Modify the call site:

```typescript
const isFirstTurn = (session?.messages ?? []).filter(m => m.role === 'user').length === 0

const systemPrompt = buildTherapistSystemPrompt({
  // ... existing options ...
  allowRecommendations: unifiedUI,
  isFirstTurn,
})
```

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 0 new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Session/SessionView.tsx
git commit -m "feat(session): pass allowRecommendations + isFirstTurn to therapist prompt

allowRecommendations gates on the unifiedSessionUI flag — the prompt
only emits inline recommendations when there's a UI that can render
them as tappable spans. isFirstTurn is computed from the user message
count; the prompt suppresses recommendations on the first response."
```

---

### Task 8: Manual smoke test + admin flag verification

**Files:** none modified. Verification only.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Start dev server**

Run: `npm run dev`
Open `http://localhost:5173` in a browser.

- [ ] **Step 3: Verify legacy behavior unchanged with flag off (default)**

In the admin panel (Settings tab), confirm `unifiedSessionUI` is off (or absent — treated as off).

- Visit `/new` → 3-card choice screen renders as before
- Start a Conversation session → no bottom bar, existing UI unchanged
- Start a Real Talk session → header badge `◆ Real Talk` renders as before (bottom bar absent)

- [ ] **Step 4: Enable the flag via admin**

Toggle `unifiedSessionUI` on in admin settings. Confirm the change propagates (real-time via `onSnapshot`).

- [ ] **Step 5: Verify unified behavior with flag on**

- Start a new session
- Bottom bar renders below the chat area
- Talk pill is highlighted; Journal and Speak are visibly disabled
- Header `◆ Real Talk` badge is gone
- Toggle the bottom-bar Real Talk switch → next therapist response is in the sharper persona (`REAL_TALK_CORE`)
- Toggle off → therapist returns to companion tone
- After a few exchanges in companion mode, the therapist may emit an inline recommendation (e.g., "*Can I be more direct with you?*"). Tap → Real Talk toggles on.

- [ ] **Step 6: Verify crisis override**

In a session with the flag on, type a crisis-keyword phrase (per the existing `sessionOrchestrator.checkCrisisKeywords`). Confirm:

- Real Talk recommendation does NOT appear in the next therapist response (grounding suppresses it)
- If Real Talk was on at the moment grounding activates, the persona reverts to `THERAPIST_CORE` (the existing `useRealTalk = mode === 'real_talk' && !isGrounding` invariant)

- [ ] **Step 7: Smoke test the build**

Run: `npm run build && firebase deploy --only hosting` (only if you intend to ship Plan 1 to production behind the flag)

Run: `npm run smoke-test`

Expected: 5/5 PASS.

- [ ] **Step 8: No commit needed (verification only)**

If any defect found in Steps 5–6, return to the relevant task and add a regression test before fixing.

---

## Self-Review Pass

After completing all tasks, before declaring Plan 1 done:

1. **Spec coverage check:** does Plan 1 deliver the spec's "Goals" items 2 (single noun — partial; deferred to copy pass), 3 (single front door — deferred to Plan 3), 4 (forms as surfaces — partial; only Real Talk in this plan), 5 (therapist as agent — Real Talk recommendation only, fully wired), 6 (preserve form-fit — yes, untouched)? The plan is intentionally narrower than the spec. Plans 2 and 3 cover the rest.

2. **Placeholder scan:** any TODOs / FIXMEs / `console.warn` introduced by Plan 1? The Journal/Speak no-op handler at Step 6.4 logs a warning intentionally — that's the placeholder until Plan 2 implements those surfaces. Acceptable.

3. **Type consistency:** `SessionSurface = 'talk' | 'journal' | 'speak'` is used in `SessionBottomBar` and in `SessionView`'s local state. `RecommendationTarget` is `'real-talk-on' | 'real-talk-off' | 'journal' | 'speak' | string`. The string fallback handles forward-compat. No naming drift.

4. **Crisis-override invariant:** Task 3 explicitly preserves `useRealTalk = mode === 'real_talk' && !isGrounding`. Task 8 Step 6 verifies it manually. The existing `realTalkFlow.test.ts` and `therapistPrompts.test.ts` are not modified, so they continue to enforce the invariant in CI.

5. **No load-bearing change to non-UI engines.** Confirmed — `partOrchestrator`, `sessionOrchestrator`, `pauseDetector`, etc., are untouched.

---

## What Plan 1 Does Not Deliver (covered in Plan 2 / Plan 3)

- Journal surface implementation (LivingEditor embedded in session, chat collapse to presence indicator). **Plan 2.**
- Speak surface implementation (voice within session). **Plan 2.**
- Therapist recommendation patterns for `[write about it](#switch:journal)` and `[say it aloud](#switch:speak)`. **Plan 2** (added to the prompt block once those targets do something).
- Sidebar unification (collapse entries + sessions, remove glyphs). **Plan 3.**
- `/new` and `EntryChoice` removal. **Plan 3.**
- Session-creation animation, opener latency handling, error states. **Plan 3.**
