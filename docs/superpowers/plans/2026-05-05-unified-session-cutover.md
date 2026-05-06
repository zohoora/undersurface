# Unified Session — Cutover (Plan 3 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** When the `unifiedSessionUI` flag is on, complete the cutover to the unified product:
1. Sidebar items show no mode glyphs (`◆` / chat-bubble SVG) — just date + first-line preview, regardless of whether the item is an entry or a session.
2. `/new` redirects to `/session/new` — skipping the 3-card `EntryChoice` screen.
3. First-session error robustness: if therapist opener generation fails, show a retry affordance instead of a stuck loader.

When the flag is off, everything continues to work exactly as before. This is a flag-gated cutover, not a hard deletion. The hard deletion (removing `/new` route, `EntryChoice` component, mode glyphs entirely) happens once the flag has been default-on for a while and confidence is high.

**Architecture:** Builds on Plans 1 + 2. The `useGlobalConfig()` hook already exposes `unifiedSessionUI` to React components. Plan 3 adds three flag-gated behaviors at the relevant call sites.

**Spec:** `docs/superpowers/specs/2026-05-05-unified-session-design.md`

---

## File Structure

### Modified
- `src/components/Sidebar/EntriesList.tsx` — gate mode glyphs behind `!unifiedUI`
- `src/App.tsx` — when `unifiedSessionUI === true`, redirect `/new` to `/session/new` instead of rendering `EntryChoice`
- `src/components/Session/SessionView.tsx` — show retry affordance if first opener generation fails

### Untouched (deferred to a later cleanup)
- `src/components/EntryChoice.tsx` itself (still used when flag is off)
- `/new` route handler (still routes to `EntryChoice` when flag is off)

---

## Tasks

### Task 1: Hide mode glyphs in sidebar when flag is on

**Files:**
- Modify: `src/components/Sidebar/EntriesList.tsx`

The session-item rendering at lines 312-331 conditionally renders either a `◆` glyph (Real Talk) or a chat-bubble SVG (standard). When the unified flag is on, these glyphs disappear; sidebar items show just the preview text.

- [ ] **Step 1: Add `useGlobalConfig` import and derive flag**

If not already imported:
```typescript
import { useGlobalConfig } from '../../store/globalConfig'
```

Inside the component:
```typescript
const globalConfig = useGlobalConfig()
const unifiedUI = globalConfig?.features?.unifiedSessionUI === true
```

(Confirm: `useGlobalConfig` is already imported at line 5 per a recent change. Just add the unifiedUI derivation if missing.)

- [ ] **Step 2: Gate the glyph render**

Replace the `item.mode === 'real_talk' ? (◆) : (chat-bubble SVG)` block with:

```tsx
{!unifiedUI && (
  item.mode === 'real_talk' ? (
    <span aria-hidden="true" title="Real Talk" style={{...}}>
      {'◆'}
    </span>
  ) : (
    <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11" style={{...}}>
      <path d="..." />
    </svg>
  )
)}
```

When `unifiedUI` is true, neither glyph renders. The `item.preview` text alone follows.

- [ ] **Step 3: Run tests + lint + typecheck**

Run: `npm run test && npm run lint && npx tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pwd && git branch --show-current
git add src/components/Sidebar/EntriesList.tsx
git commit -m "feat(sidebar): hide mode glyphs when unifiedSessionUI flag is on

Sidebar items show date + first-line preview only when the flag is on.
The Real Talk ◆ and chat-bubble SVG glyphs that distinguish session
modes are part of the legacy four-product framing; the unified UI
treats sessions as one kind of thing. Glyphs preserved when the flag
is off (legacy behavior unchanged)."
```

---

### Task 2: Redirect `/new` to `/session/new` when flag is on

**Files:**
- Modify: `src/App.tsx`

When the user navigates to `/new` and the flag is on, they should be sent directly to `/session/new` (which creates a new session in standard mode by default). The 3-card `EntryChoice` screen is skipped entirely.

- [ ] **Step 1: Find the route handler for `/new` in App.tsx**

```bash
grep -n "/new\|isChoiceRoute\|EntryChoice" src/App.tsx | head -10
```

Expected: line ~503 has `const isChoiceRoute = routePath === '/new'`. Around line ~633 the `EntryChoice` component is rendered when `isChoiceRoute` is true.

- [ ] **Step 2: Add the flag-gated redirect**

In the App component body (after the existing `useGlobalConfig` derivation, or add one), redirect when flag + route match:

```typescript
const globalConfig = useGlobalConfig()
const unifiedUI = globalConfig?.features?.unifiedSessionUI === true

useEffect(() => {
  if (unifiedUI && routePath === '/new') {
    navigateTo('/session/new')
  }
}, [unifiedUI, routePath])
```

(`navigateTo` is the existing pushState wrapper.)

This redirects asynchronously after render. To avoid a brief flash of the choice screen, also gate the EntryChoice render directly:

```tsx
{isChoiceRoute && !unifiedUI && (
  <EntryChoice ... />
)}
```

So if the flag is on, EntryChoice never renders even briefly.

- [ ] **Step 3: Run tests + lint + typecheck**

Run: `npm run test && npm run lint && npx tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(routing): redirect /new to /session/new when unified flag is on

The 3-card EntryChoice is the legacy front door. When unifiedSessionUI
is on, /new redirects to /session/new directly — no mode picker, no
ceremony of choosing. Sessions start in standard (companion) tone by
default; users toggle Real Talk in-canvas via the bottom-bar switch.

EntryChoice is preserved for the flag-off path. Hard removal of the
component + route is deferred until the flag has been default-on for
a while."
```

---

### Task 3: First-session opener error retry affordance

**Files:**
- Modify: `src/components/Session/SessionView.tsx`

If the first therapist message generation (in `startNewSession`) fails (network error, OpenAI down, etc.), the user currently sees an indefinite loading state. Add an error state + retry button.

This is a small polish task for V1.

- [ ] **Step 1: Find `startNewSession` and `generateTherapistMessage`**

```bash
grep -n "startNewSession\|generateTherapistMessage" src/components/Session/SessionView.tsx | head -10
```

- [ ] **Step 2: Add an error state**

```typescript
const [openerError, setOpenerError] = useState<string | null>(null)
```

- [ ] **Step 3: Wrap the opener generation in a try/catch**

In `startNewSession`, find the block:
```typescript
if (openingMethod !== 'open_invitation') {
  await generateTherapistMessage([], newSession)
}
```

Wrap:
```typescript
if (openingMethod !== 'open_invitation') {
  try {
    setOpenerError(null)
    await generateTherapistMessage([], newSession)
  } catch (err) {
    setOpenerError(err instanceof Error ? err.message : 'Failed to start session')
  }
}
```

- [ ] **Step 4: Render the error + retry**

Find a render location near the start of the session UI (above the messages). Add:

```tsx
{openerError && (
  <div style={{
    margin: '16px 0',
    padding: 12,
    border: '1px solid var(--border-subtle)',
    borderRadius: 6,
    background: 'var(--overlay-subtle)',
    fontSize: 13,
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  }}>
    <span>The therapist couldn't be reached. {openerError}</span>
    <button
      onClick={async () => {
        if (!session) return
        try {
          setOpenerError(null)
          await generateTherapistMessage([], session)
        } catch (err) {
          setOpenerError(err instanceof Error ? err.message : 'Failed to retry')
        }
      }}
      style={{
        padding: '4px 10px',
        border: '1px solid var(--accent-warm)',
        borderRadius: 4,
        background: 'transparent',
        color: 'var(--accent-warm)',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      Retry
    </button>
  </div>
)}
```

- [ ] **Step 5: Run tests + lint + typecheck**

Run: `npm run test && npm run lint && npx tsc -b`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Session/SessionView.tsx
git commit -m "feat(session): retry affordance for first-message generation failures

If the therapist opener fails (network error, model timeout, etc.),
the session now shows a small error banner with a Retry button instead
of leaving the user staring at an indefinite loader. The error state
clears on successful generation."
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full suite, lint, typecheck, build**

```bash
npm run test
npm run lint
npx tsc -b
npm run build
```

All must pass.

- [ ] **Step 2: Verify branch state**

```bash
git log --oneline main..HEAD
```

Expect to see the Plan 3 commits on top of Plan 2.
