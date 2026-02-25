# Entry Choice Screen Design

**Date:** 2026-02-25
**Status:** Approved

## Overview

A full-screen choice screen that appears whenever a user starts something new — both after onboarding and from the sidebar. Replaces the current two-button sidebar pattern ("+ New entry" / "+ New conversation") with a single "+ New" button that navigates to this screen.

## Route

`/new` → `EntryChoice` screen

## Layout

- **Desktop (>768px):** Two cards side by side, vertically centered, ~45% width each
- **Mobile (<768px):** Cards stacked vertically, full width, scrollable if needed

## Card Anatomy

```
┌─────────────────────────────┐
│     [subtle animation]      │
│     Title (Spectral, 24px)  │
│     Tagline (Spectral italic, 15px) │
│     Description (Inter, 14px, 2-3 lines) │
│     [optional: last-used glow] │
└─────────────────────────────┘
```

### Journal Card
- **Title:** "Journal"
- **Tagline:** "Write freely — inner voices listen"
- **Description:** "Write at your own pace. When you pause or trail off, inner voices stir — not to judge, but to sit beside you in the words."
- **Animation:** Slow radial ink-drop ripple, warm tones, CSS only

### Conversation Card
- **Title:** "Conversation"
- **Tagline:** "Sit with a companion"
- **Description:** "A gentle back-and-forth. Share what's on your mind, and a companion responds — following where you lead."
- **Animation:** Soft breathing glow at top of card, CSS only

## Visual Design

- **Background:** `var(--bg-primary)` — no overlay, feels native
- **Cards:** `var(--surface-primary)`, subtle border, 16px border-radius, 40px padding (28px mobile)
- **Hover/touch:** `translateY(-2px)`, soft shadow expansion, animation intensifies
- **Dark/light theme:** CSS variables handle all colors
- **Quick-pick glow (return visits):** Most-recently-used card gets faint warm `box-shadow`

## Transitions

- **Entrance:** Staggered fade-in (0ms + 120ms), `opacity + translateY` animation
- **Exit:** Selected card scales up, other fades out, ~300ms total fade to destination

## Integration

### Triggers
1. After onboarding completes → navigate to `/new`
2. Sidebar "+ New" button → navigate to `/new`

### Actions
- Picking "Journal" → creates entry in Firestore → navigates to `/`
- Picking "Conversation" → navigates to `/session/new` (session created by SessionView)

### Quick-pick detection
- Check most recent entry `updatedAt` vs most recent session `startedAt`
- `lastUsedType: 'journal' | 'conversation' | null`
- `null` = first-time user, both cards equally weighted

### Sidebar changes
- Remove two-button container (`sidebar-new-buttons`)
- Single button: "+ New" (i18n translated)
- Click: `navigateTo('/new')`

## Accessibility

- Cards: `role="button"`, `tabIndex={0}`, Enter/Space to select
- `aria-label` with full description
- Focus ring using existing app focus styles

## What stays the same

- Existing entries/sessions in sidebar navigate directly to content
- Session view, journal editor, all AI flows unchanged
- Sidebar search, favorites, entry previews unchanged
- Firestore data model unchanged
