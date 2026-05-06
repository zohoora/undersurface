# Unified Session — Surfaces (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Journal and Speak buttons in the unified-session bottom bar actually do something. When the user (or the therapist via recommendation) switches to Journal, the chat collapses to a presence indicator and a writing surface opens; switching back returns to chat with the journaled text in context. When the user switches to Speak, the existing voice infrastructure activates inline. Update the therapist prompt to teach all three recommendation patterns (currently only Real Talk is taught).

**Architecture:** Builds on Plan 1 (`docs/superpowers/plans/2026-05-05-unified-session-foundation.md`). The bottom bar already exists; the parser already exists; the prompt already has a recommendation block. Plan 2 extends the existing pieces:
- Journal: a flag-gated branch in `SessionView` that, when `surface === 'journal'`, replaces the chat list and compose with a chat-collapsed presence indicator + a writing area. The writing area uses a basic `<textarea>` for Plan 2 (full `LivingEditor` parts integration is out of scope; that's Plan 4 if pursued).
- Speak: a flag-gated branch that, when `surface === 'speak'`, calls into the existing voice infrastructure (`useVoiceSession`). The bottom bar's Speak button toggles it on; tapping Talk returns to text.
- Prompt: extend `RECOMMENDATION_BLOCK` from one pattern to three. Add per-pattern guidance: when each is therapeutically apt, when it's wrong.
- Tap dispatch: `journal` and `speak` targets in `handleRecommendationTap` now actually switch the surface state instead of `console.warn`.

**Tech Stack:** TypeScript strict, React 19, Vitest, existing `useVoiceSession` hook.

**Spec:** `docs/superpowers/specs/2026-05-05-unified-session-design.md`

---

## File Structure

### Modified
- `src/ai/therapistPrompts.ts` — extend `RECOMMENDATION_BLOCK` to teach all three patterns
- `src/ai/therapistPrompts.test.ts` — assert the new patterns appear / don't appear under the same conditions
- `src/components/Session/SessionView.tsx` — render Journal surface (chat-collapse + textarea), Speak surface (voice activation); wire journal/speak recommendation taps; persist journal text as user message when switching back to Talk
- `src/components/Session/SessionBottomBar.tsx` — un-disable Journal and Speak buttons (they now do something)
- `src/components/Session/SessionBottomBar.test.tsx` — update tests (Journal/Speak no longer disabled)

### Created
- `src/components/Session/SessionJournalSurface.tsx` — small component encapsulating the journal-within-session UI (chat-collapse indicator + textarea + "back to talk" affordance)

### Untouched
The existing `LivingEditor`, parts engine, and voice infrastructure are unchanged. Plan 2 invokes them, doesn't modify them.

---

## Tasks

### Task 1: Extend `RECOMMENDATION_BLOCK` to teach all three patterns

**Files:**
- Modify: `src/ai/therapistPrompts.ts`
- Modify: `src/ai/therapistPrompts.test.ts`

The current block (Plan 1) teaches one pattern: `[<phrase>](#switch:real-talk-on)`. Extend it to teach two more:

- `[<phrase>](#switch:journal)` — suggest writing privately for a moment
- `[<phrase>](#switch:speak)` — suggest saying it aloud

Existing suppression conditions stay the same (companion-only, not grounding, not first turn). Crisis-override invariant unchanged.

- [ ] **Step 1: Read the current `RECOMMENDATION_BLOCK` constant**

```bash
grep -n "RECOMMENDATION_BLOCK" src/ai/therapistPrompts.ts
```

- [ ] **Step 2: Write failing tests that assert the new patterns are present when allowRecommendations is true and absent when suppressed**

Add to `therapistPrompts.test.ts` inside the `'buildTherapistSystemPrompt — recommendations'` describe block:

```typescript
  it('teaches the journal recommendation pattern when allowed', () => {
    const prompt = buildTherapistSystemPrompt({
      phase: 'deepening',
      mode: 'standard',
      isGrounding: false,
      isFirstTurn: false,
      allowRecommendations: true,
    })
    expect(prompt).toContain('#switch:journal')
  })

  it('teaches the speak recommendation pattern when allowed', () => {
    const prompt = buildTherapistSystemPrompt({
      phase: 'deepening',
      mode: 'standard',
      isGrounding: false,
      isFirstTurn: false,
      allowRecommendations: true,
    })
    expect(prompt).toContain('#switch:speak')
  })

  it('omits all three patterns during grounding', () => {
    const prompt = buildTherapistSystemPrompt({
      phase: 'deepening',
      mode: 'standard',
      isGrounding: true,
      isFirstTurn: false,
      allowRecommendations: true,
    })
    expect(prompt).not.toContain('#switch:real-talk-on')
    expect(prompt).not.toContain('#switch:journal')
    expect(prompt).not.toContain('#switch:speak')
  })
```

- [ ] **Step 3: Run tests, confirm fail**

Run: `npx vitest run src/ai/therapistPrompts.test.ts`
Expected: FAIL — new patterns not yet in the prompt.

- [ ] **Step 4: Replace `RECOMMENDATION_BLOCK` with the three-pattern version**

```typescript
const RECOMMENDATION_BLOCK = `You can occasionally suggest a tonal or modal shift when therapeutically apt, using inline phrases woven into prose. Use these EXACT formats — the bracketed phrase is what the writer reads, the (#switch:...) anchor is hidden but tells the interface this phrase is tappable:

  [Can I be more direct with you?](#switch:real-talk-on)
  [write about it for a moment](#switch:journal)
  [say it aloud](#switch:speak)

When to use each:
- #switch:real-talk-on — when softness is becoming avoidance, when the writer would benefit from being called out kindly. Once they accept, your tone sharpens.
- #switch:journal — when something is brewing under the surface that doesn't want a back-and-forth. The writer steps into a private writing space; you wait quietly.
- #switch:speak — when the body knows something the typing fingers don't. Voice often surfaces what text holds back.

Hard rules:
- At most one recommendation per ~5 turns. Most responses contain none.
- Never on the first response. Never when the writer is grounding through distress. Never as a way to deflect from what they are actually saying.
- Make the bracketed phrase fit naturally into your sentence. Keep the (#switch:...) anchor exact — do not paraphrase the URL part.
- Never offer two recommendations in the same response.`.trim()
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx vitest run src/ai/therapistPrompts.test.ts`
Expected: PASS — 9 recommendation tests passing (6 from Plan 1 + 3 new).

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 7: Lint + typecheck**

Run: `npm run lint && npx tsc -b`
Expected: PASS.

- [ ] **Step 8: Verify branch and commit**

```bash
pwd && git branch --show-current   # Verify worktree path + unified-session-foundation
git add src/ai/therapistPrompts.ts src/ai/therapistPrompts.test.ts
git commit -m "feat(prompts): teach the journal and speak recommendation patterns

Extends RECOMMENDATION_BLOCK from one pattern to three. The therapist
can now suggest writing privately ([phrase](#switch:journal)) or
speaking aloud ([phrase](#switch:speak)) in addition to the existing
Real Talk recommendation. All three are suppressed under the same
conditions (Real Talk persona, grounding, first turn).

Adds per-pattern guidance for when each is therapeutically apt and a
'never two in one response' constraint."
```

---

### Task 2: Build the `SessionJournalSurface` component

**Files:**
- Create: `src/components/Session/SessionJournalSurface.tsx`

A small focused component that encapsulates the chat-collapsed + writing-surface layout. Receives the chat presence (message count) and a controlled textarea value + onChange. Used by SessionView when `surface === 'journal'`.

- [ ] **Step 1: Create the component file**

```typescript
import { useEffect, useRef } from 'react'

interface Props {
  messageCount: number
  value: string
  onChange: (next: string) => void
  placeholder?: string
}

export function SessionJournalSurface({ messageCount, value, onChange, placeholder }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus the textarea when the surface mounts so the writer can start typing immediately.
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="session-journal-surface">
      <div className="session-journal-presence">
        <div className="session-journal-presence__dot" />
        <span>Therapist · {messageCount} {messageCount === 1 ? 'message' : 'messages'} · listening</span>
      </div>
      <textarea
        ref={textareaRef}
        className="session-journal-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Write privately. The therapist is here, quiet, while you find what wants to be said.'}
        rows={12}
      />
    </div>
  )
}
```

- [ ] **Step 2: Add CSS in `src/styles/atmosphere.css`**

```css
.session-journal-surface {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 16px 0;
}

.session-journal-presence {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--overlay-subtle);
  border-radius: 6px;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  font-style: italic;
}

.session-journal-presence__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent-warm);
  opacity: 0.7;
}

.session-journal-textarea {
  width: 100%;
  min-height: 240px;
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-primary);
  color: var(--text-primary);
  font-family: Georgia, serif;
  font-size: 16px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.session-journal-textarea:focus {
  border-color: var(--accent-warm);
}
```

- [ ] **Step 3: Lint + typecheck**

Run: `npm run lint && npx tsc -b`
Expected: PASS.

- [ ] **Step 4: Verify branch and commit**

```bash
git add src/components/Session/SessionJournalSurface.tsx src/styles/atmosphere.css
git commit -m "feat(session): add SessionJournalSurface component

Encapsulates the journal-within-session UI: chat-collapsed presence
indicator plus a focused textarea. Auto-focuses on mount so the writer
can start typing immediately. Plan 2 uses the basic textarea; full
LivingEditor + parts integration is deferred."
```

---

### Task 3: Wire the Journal surface into `SessionView`

**Files:**
- Modify: `src/components/Session/SessionView.tsx`
- Modify: `src/components/Session/SessionBottomBar.tsx`
- Modify: `src/components/Session/SessionBottomBar.test.tsx`

When `surface === 'journal'` and the flag is on, render `SessionJournalSurface` in place of the chat history and compose. Local state holds the journal text. When user switches back to Talk, the journal text is appended as a user message (so the therapist sees what was written).

- [ ] **Step 1: Un-disable the Journal button in `SessionBottomBar`**

In `src/components/Session/SessionBottomBar.tsx`, remove the `disabled` attribute from the Journal button:

Before:
```typescript
<button
  type="button"
  className="session-bottom-bar__pill"
  aria-pressed={activeSurface === 'journal'}
  disabled
  title={t('session.bottomBar.journalDisabled')}
>
  {t('session.bottomBar.journal')}
</button>
```

After:
```typescript
<button
  type="button"
  className="session-bottom-bar__pill"
  aria-pressed={activeSurface === 'journal'}
  onClick={() => handleSurfaceClick('journal')}
>
  {t('session.bottomBar.journal')}
</button>
```

(The `journalDisabled` i18n key is no longer used in the bar but the locale file entries can stay for now — Plan 3 might add a different use, or they can be cleaned up later.)

- [ ] **Step 2: Update bottom-bar tests to reflect Journal being interactive**

In `SessionBottomBar.test.tsx`, replace the "Journal/Speak disabled" assertion. Find the test:

```typescript
it('disables Journal and Speak in this plan (no surface implementations yet)', () => {
  ...
  expect(screen.getByRole('button', { name: /journal/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /speak/i })).toBeDisabled()
})
```

Replace with:
```typescript
it('clicking Journal fires onSurfaceChange with journal', () => {
  const onSurfaceChange = vi.fn()
  render(<SessionBottomBar activeSurface="talk" realTalkOn={false} onSurfaceChange={onSurfaceChange} onRealTalkToggle={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /journal/i }))
  expect(onSurfaceChange).toHaveBeenCalledWith('journal')
})
```

(If the codebase doesn't have @testing-library/react, write the equivalent in the source-text inspection style used elsewhere — e.g., assert that the file no longer contains `disabled` on the Journal button.)

- [ ] **Step 3: Add Journal-text state to `SessionView`**

Near the existing surface state:

```typescript
const [journalDraft, setJournalDraft] = useState<string>('')
```

- [ ] **Step 4: Add the surface-change handler that flushes journal text on exit**

Replace the existing `setSurface` direct prop with a wrapped handler:

```typescript
const handleSurfaceChange = (next: SessionSurface) => {
  // When leaving Journal with non-empty text, append it as a user message so the
  // therapist receives it as context on her next turn.
  if (surface === 'journal' && next !== 'journal' && journalDraft.trim()) {
    void appendUserMessage(journalDraft.trim(), 'desktop')
    setJournalDraft('')
  }
  setSurface(next)
}
```

Find the existing `appendUserMessage` (or similar) helper in SessionView — it's the function called when the user submits a chat message. Use the same path so the message appears in the chat history identically.

If `appendUserMessage` requires an `inputMode`, pass `'desktop'` (the journaled text was typed). If voice transcripts use a different mode and there's a constant for it, use that.

- [ ] **Step 5: Update the `SessionBottomBar` invocation in SessionView**

```tsx
<SessionBottomBar
  activeSurface={surface}
  realTalkOn={session?.mode === 'real_talk'}
  onSurfaceChange={handleSurfaceChange}
  onRealTalkToggle={handleRealTalkToggle}
/>
```

- [ ] **Step 6: Render the Journal surface when active**

Find the chat-history block (around `messages.map(...)` and the streaming block). When `unifiedUI && surface === 'journal'`, render the journal surface instead. When `unifiedUI && surface === 'talk'`, render the chat as before. The compose form should ALSO be hidden when surface !== 'talk'.

A sensible structure:

```tsx
{unifiedUI && surface === 'journal' ? (
  <SessionJournalSurface
    messageCount={messages.length}
    value={journalDraft}
    onChange={setJournalDraft}
  />
) : (
  <>
    {/* existing messages.map + streaming + compose */}
  </>
)}
```

Take care to leave the bottom bar render path unchanged — the bar should always be visible when `unifiedUI && !isClosed`, regardless of which surface is active.

- [ ] **Step 7: Wire the recommendation tap for `journal`**

In `handleRecommendationTap`, replace the journal case:

Before:
```typescript
case 'journal':
case 'speak':
  console.warn(`[unifiedSession] Recommendation target "${target}" not yet implemented (Plan 2)`)
  return
```

After:
```typescript
case 'journal':
  handleSurfaceChange('journal')
  return
case 'speak':
  // Wired in Task 5 below.
  console.warn('[unifiedSession] speak target wired in Task 5')
  return
```

- [ ] **Step 8: Run tests + lint + typecheck**

Run: `npm run test && npm run lint && npx tsc -b`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/Session/SessionView.tsx src/components/Session/SessionBottomBar.tsx src/components/Session/SessionBottomBar.test.tsx
git commit -m "feat(session): wire Journal surface within a session

Tapping Journal in the bottom bar (or accepting the therapist's
[write about it](#switch:journal) recommendation) replaces the chat
list and compose with a chat-collapsed presence indicator + textarea.
Returning to Talk flushes the journaled text as a user message so the
therapist receives it as context. Speak surface is still placeholder
(Task 5)."
```

---

### Task 4: Wire the Speak surface — invoke voice from inside the session

**Files:**
- Modify: `src/components/Session/SessionView.tsx`
- Modify: `src/components/Session/SessionBottomBar.tsx`

When user taps Speak (or accepts the therapist's `[say it aloud](#switch:speak)` recommendation), invoke the existing voice infrastructure (`useVoiceSession` hook). The voice mode plays the most recent therapist message aloud and accepts spoken user input. When user taps Talk to return, voice ends.

- [ ] **Step 1: Read the existing voice integration in `SessionView`**

```bash
grep -n "voice\.\|handleStartVoice\|useVoiceSession" src/components/Session/SessionView.tsx | head -20
```

Identify:
- How voice is started (`handleStartVoice`)
- How voice is stopped (`voice.stop` or similar)
- The voice state machine (`voice.state`)

- [ ] **Step 2: Un-disable the Speak button in `SessionBottomBar`**

In `src/components/Session/SessionBottomBar.tsx`:

Before:
```typescript
<button
  type="button"
  className="session-bottom-bar__pill"
  aria-pressed={activeSurface === 'speak'}
  disabled
  title={t('session.bottomBar.speakDisabled')}
>
  {t('session.bottomBar.speak')}
</button>
```

After:
```typescript
<button
  type="button"
  className="session-bottom-bar__pill"
  aria-pressed={activeSurface === 'speak'}
  onClick={() => handleSurfaceClick('speak')}
>
  {t('session.bottomBar.speak')}
</button>
```

- [ ] **Step 3: Extend `handleSurfaceChange` in SessionView to start/stop voice**

```typescript
const handleSurfaceChange = (next: SessionSurface) => {
  // Leaving Journal: flush draft (Task 3).
  if (surface === 'journal' && next !== 'journal' && journalDraft.trim()) {
    void appendUserMessage(journalDraft.trim(), 'desktop')
    setJournalDraft('')
  }
  // Entering Speak: invoke existing voice infrastructure.
  if (surface !== 'speak' && next === 'speak') {
    void handleStartVoice()
  }
  // Leaving Speak: stop voice.
  if (surface === 'speak' && next !== 'speak' && voice.state !== 'idle') {
    voice.stop()
  }
  setSurface(next)
}
```

(Match the actual voice-stop method name from existing code — likely `voice.stop()` but confirm.)

- [ ] **Step 4: Wire the recommendation tap for `speak`**

In `handleRecommendationTap`:

```typescript
case 'speak':
  handleSurfaceChange('speak')
  return
```

(Remove the placeholder warning added in Task 3.)

- [ ] **Step 5: Hide the legacy Voice button when unifiedUI is on**

The existing voice toggle (around `handleStartVoice`) currently has its own button. Find it (search `session-voice-btn`) and gate behind `!unifiedUI`:

```tsx
{!unifiedUI && voiceEnabled && !isClosed && voice.state === 'idle' && (
  <button onClick={handleStartVoice} className="session-voice-btn" ...>
    Voice
  </button>
)}
```

The unified UI's Speak pill replaces this affordance.

- [ ] **Step 6: Render the Speak surface state**

When `surface === 'speak'`, the chat list still shows but the compose area is hidden (voice replaces text input). The voice UI elements (`HrvAmbientBar` or similar) handle their own state. For Plan 2, this is sufficient — we're not designing a new voice UI, just gating activation.

If there's a compose form/input, hide it when `unifiedUI && surface === 'speak'`:

```tsx
{!(unifiedUI && surface !== 'talk') && (
  // existing compose form
)}
```

- [ ] **Step 7: Run tests + lint + typecheck**

Run: `npm run test && npm run lint && npx tsc -b`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/Session/SessionView.tsx src/components/Session/SessionBottomBar.tsx
git commit -m "feat(session): wire Speak surface within a session

Tapping Speak (or accepting the therapist's [say it aloud](#switch:speak)
recommendation) invokes the existing voice infrastructure. Tapping Talk
to return stops voice. The legacy Voice button is hidden when the
unified UI is on — the Speak pill in the bottom bar replaces it."
```

---

### Task 5: Update SessionView tests for the new surface behaviors

**Files:**
- Modify: `src/components/Session/SessionView.test.ts`

Add structural tests for:
- Journal switch path (tapping Journal triggers state change; returning to Talk flushes journal text)
- Speak switch path (tapping Speak invokes voice start; returning to Talk stops voice)
- Recommendation taps for journal/speak no longer log warnings

If the codebase's test pattern is source-text inspection (per Plan 1), use that pattern. Match what's already there.

- [ ] **Step 1: Identify the test pattern in SessionView.test.ts**

```bash
head -100 src/components/Session/SessionView.test.ts
```

- [ ] **Step 2: Add tests in the established pattern**

Add tests that verify:
- The string `'case \\'journal\\':'` followed by `handleSurfaceChange('journal')` appears in the file (no longer a `console.warn`)
- Same for `'case \\'speak\\':'`
- The Journal button no longer has `disabled` attribute
- The Speak button no longer has `disabled` attribute

Or if the codebase has a different testing approach for component integration, use that. The point is: assert the behavior changed in the code.

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Session/SessionView.test.ts
git commit -m "test(session): cover Journal and Speak surface switching

Asserts that Plan 2 wired the journal/speak recommendation taps to
actual surface changes (not console.warn placeholders), and that the
Journal/Speak buttons no longer carry the 'disabled' attribute."
```

---

### Task 6: Manual smoke test

**Files:** none modified.

Build, dev server, manual verification of the full unified flow with all three surfaces.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Run the full test suite one final time**

Run: `npm run test`
Expected: 600+ tests passing.

- [ ] **Step 3: Manual checklist (deferred to user)**

The flag-on path requires sign-in + admin toggle. Document for the user:

With the unifiedSessionUI flag ON:
- New session → bottom bar visible
- Tap Journal → chat collapses to presence indicator, textarea opens
- Type in textarea, tap Talk → text appears in chat as a user message; therapist responds
- Toggle Real Talk → next response is in sharper persona
- Tap Speak → voice activates inline; ESC or tap Talk to return
- Therapist may emit inline recommendations like "*write about it*" — tap → journal opens

With the flag OFF:
- Everything looks unchanged from before Plan 1.

---

## Self-Review Pass

After all tasks:

1. **Spec coverage:** Plan 2 delivers the spec's "Forms as surfaces" goal for Journal and Speak. Real Talk was already covered in Plan 1. The four forms are now all reachable from inside one session.
2. **Crisis override:** still preserved (no changes to `useRealTalk` or grounding logic).
3. **Recommendation block:** now teaches three patterns; tests cover each appearing/absent under the same conditions.
4. **No new dependencies on `LivingEditor` or parts engine:** Plan 2 uses a basic textarea for Journal-within-session. Full parts integration is Plan 4 if pursued.

## What Plan 2 Does NOT Deliver (covered in Plan 3)

- Sidebar unification (collapse entries + sessions, remove glyphs)
- `/new` and `EntryChoice` removal
- Default-on flag for the whole product
- First-session UX polish (opener latency, error states)
