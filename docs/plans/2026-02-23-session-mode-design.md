# Session Mode: Conversational Parts Work

**Date:** 2026-02-23
**Status:** Design approved

## Overview

A separate mode where the user sits in sustained dialogue with their inner parts. Unlike journal mode — where parts whisper 5-25 word nudges that vanish on typing — session mode is a dedicated conversational space. The dialogue IS the reflective writing. The full transcript is saved as a first-class artifact alongside journal entries.

**Goals:** IFS-style dialogue as therapy, going deeper on threads, active co-creation between user and parts, and companionship/presence.

## Space & Entry

Sessions live in a dedicated section of the app — their own area in the sidebar, their own URL routes, separate from the diary.

### Starting a session

The user opens "New Session" and lands in a quiet, empty space — visually warmer/darker than the editor, like entering a different room. A brief moment of stillness before a part speaks.

### Who speaks first

Three paths:

1. **Auto-selected** (default) — The orchestrator picks a part based on recent journal entries, emotional patterns, time of day, and recency. The part opens with something grounded in real context, not generic ("...you wrote about your mother three times this week and stopped each time...").

2. **User-chosen** — The user selects a specific part to sit with. Shown with name, color, and one-line role description.

3. **Open invitation** — The user writes first, into silence. The most relevant part responds.

### Session list

Past sessions are browsable: date, participating parts (color dots), session note or first line as preview. Searchable. Favoritable.

## Conversation Flow & Pacing

### Three-act arc

Sessions have a natural shape, gently guided by prompt phase hints:

- **Opening** (first 2-3 exchanges) — Grounding. The part meets the user where they are. Short, warm, spacious. References recent context.
- **Deepening** (3+ exchanges) — More substantive responses. Harder questions. Naming what the user is circling around. Gentle disagreement or reframes. Other parts may emerge.
- **Closing** — The host part offers a 2-3 sentence closing reflection. A distillation the user can carry with them.

### Message lengths

| Speaker | Opening | Deepening | Closing |
|---------|---------|-----------|---------|
| Part | 1-2 sentences | 2-4 sentences | 2-3 sentences |
| User | No constraint | No constraint | No constraint |

### Pacing

- No typing indicators. Responses appear after a natural beat.
- Parts can choose silence: respond with just "..." to hold space.
- Input placeholder: "take your time" not "type a message."
- Users can pause mid-session and return later. The part acknowledges the gap.

### Ending a session

- User explicitly closes via "End session" option.
- Part can suggest closing ("...I think we've found something today...") but user decides.
- After closing, a session note is generated (2-4 sentence summary of themes/breakthroughs).
- Only one session active at a time. Starting a new one soft-closes the previous.

## Part Emergence

Parts don't barge in. They emerge gradually, like thoughts — at the edges, when something in the conversation pulls them forward.

### Three emergence triggers

**1. Emotional gravity** — The orchestrator monitors the conversation's emotional trajectory. When the topic shifts into another part's domain, that part steps forward. Threshold is high: strong relevance AND the current part has been speaking for 3+ exchanges.

**2. Tension or disagreement** — The most powerful trigger. If the user pushes back on the active part, or reveals an internal contradiction, a second part can voice the other side. Not as debate — as honesty.

Example:
> **The Watcher:** *...you keep saying you're fine with it...*
> **User:** I am fine with it. I've moved on.
> **The Quiet One:** *...your hands were shaking when you wrote about it on Tuesday...*

**3. User invitation** — The user can @-mention or tap to invite a specific part. The invited part responds as if it's been listening.

### Emergence constraints

- Maximum **3 parts** per session.
- Minimum **3 exchanges** between new part entries (cooldown).
- Parts that aren't speaking stay "present but quiet" — shown as muted indicators.
- No consecutive turns from two different parts — conversation alternates user/part.
- The **host part** (opener) retains priority and handles the closing reflection.
- Parts are aware of each other. A part can reference what another said.

### What the orchestrator tracks

- Emotional arc (sentiment trajectory across messages)
- Topic keywords and theme shifts
- Which parts' domains are being activated
- Current part's tenure (how long since another part spoke)
- Contradiction or resistance signals
- Emergence cooldown timer

## Prompt Architecture

### Core approach

Each part message is its own LLM call with its own system prompt. We don't make one prompt produce multiple voices. When The Watcher speaks, the call uses The Watcher's prompt. When The Quiet One emerges, it's a fresh call with The Quiet One's prompt. The conversation history is shared; the lens changes.

### System prompt structure

```
[Part identity — who you are, your role, your voice]
[Session instructions — conversation mode behavior]
[User profile — innerLandscape, recurringThemes, avoidancePatterns]
[Relevant memories — this part's memories of this user]
[Conversation transcript — full history with speaker labels]
[Other parts present — who else is in the room, what they've said]
[Phase hint — opening / deepening / closing]
[Emergence context — if entering mid-conversation, why]
```

### Session instructions (replaces SHARED_INSTRUCTIONS for this mode)

- You are in a session — a sustained conversation, not a one-line nudge.
- Respond in 1-4 sentences. Be present, not performative.
- Ask at most one question per message.
- You can sit in silence: respond with just "..." if the moment calls for it.
- You are not a therapist. You are a part of the writer's inner world. Speak from your perspective, not clinical distance.
- Be specific. Reference their actual words, entries, patterns. Never be generic.
- If another part has spoken, you're aware of it. You may agree, gently push back, or build on it.
- Don't mirror ("It sounds like you're feeling...").
- In the closing phase, offer a distillation — a mirror, not advice.

### Conversation history format

```
{ role: 'assistant', name: 'The Watcher', content: '...' }
{ role: 'user', content: '...' }
{ role: 'assistant', name: 'The Quiet One', content: '...' }
{ role: 'user', content: '...' }
```

### Speaker selection

After each user message:

1. Score all present parts for relevance to the latest message.
2. Check emergence conditions (emotional gravity, tension, cooldown).
3. Pick the speaker — usually the host, unless another part scores 1.5x higher or emergence is triggered.
4. Fire LLM call with that part's system prompt + full transcript.

### Phase detection

| Signal | Phase |
|--------|-------|
| < 3 exchanges | Opening |
| 3+ exchanges, deepening topics | Deepening |
| User signals closure / 12+ exchanges | Approaching close |
| User clicks "End session" | Closing |

### Token budget

| Phase | Max tokens |
|-------|-----------|
| Opening | 100 |
| Deepening | 200 |
| Closing reflection | 250 |
| Session note (post-close) | 300 |

**Temperature:** 0.85 (lower than journal mode's 0.9 — coherence matters more in sustained conversation).

### Safety

Existing distress detection and grounding system carries over. If grounding activates mid-session, the active part shifts to grounding behavior and part emergence is suppressed. The session becomes a holding space rather than a probing one.

## Data Model

### New Firestore collections under `users/{uid}/`

**`sessions/{sessionId}`**

```typescript
Session {
  id: string
  startedAt: number
  endedAt: number | null           // null while open
  status: 'active' | 'closed'
  hostPartId: string               // the part that opened
  participantPartIds: string[]     // all parts that spoke
  openingMethod: 'auto' | 'user_chose' | 'open_invitation'
  chosenPartId?: string            // if user picked a part
  sessionNote: string | null       // AI summary, written on close
  messageCount: number
  firstLine: string                // preview text, truncated
  phase: 'opening' | 'deepening' | 'closing'
}
```

**`sessions/{sessionId}/messages/{messageId}`**

```typescript
SessionMessage {
  id: string
  speaker: 'user' | 'part'
  partId: string | null
  partName: string | null          // denormalized for display
  content: string
  timestamp: number
  phase: 'opening' | 'deepening' | 'closing'
  isEmergence: boolean             // true if part's first message
  emergenceReason?: 'emotional_gravity' | 'tension' | 'user_invitation'
}
```

Messages are a subcollection (not an array) for real-time streaming, no document size limits, session resumption, and individual message referencing.

### Memory integration

Sessions write to the existing `memories` collection with a new source field:

```typescript
PartMemory {
  // ...existing fields
  source?: 'journal' | 'session'   // new, defaults to 'journal'
  sessionId?: string
}
```

Two kinds of memories created per session:

1. **Per-part memories** — Each participating part gets a memory summarizing what happened from its perspective.
2. **Cross-session reflections** — The session note stored as a `'reflection'` memory on the host part, enabling continuity between sessions.

### Existing feature updates

- **Data export** (`db.ts`): Add `sessions` + `messages` subcollection.
- **Account deletion** (Cloud Functions): Add `sessions` subcollection cleanup.
- **Admin dashboard**: New "Sessions" tab in UserDetail.

## Integration & Boundaries

### What flows between modes

**Journal → Session:**
- Parts carry journal-learned memories into sessions (existing memory pipeline).
- Auto-selection for "who speaks first" draws on recent journal activity.

**Session → Journal:**
- Session memories are available to parts in journal mode.
- A journal-mode part might reference "...what you realized last time we talked..."
- Session artifacts stay separate from journal entries.

### What does NOT cross over

- Session conversation style doesn't leak into journal prompts. Parts in the diary still speak in 5-25 words.
- Journal pause detection doesn't trigger during sessions.
- Session mode doesn't use TipTap. It's a simple message-based component.

### Sidebar

```
[Entries]
  Today
  Yesterday
  ...

[Sessions]
  Session with The Watcher — "the thing about your mother"
  Session with The Spark, The Quiet One — "what the anger was protecting"
  ...
```

### URL routes

- `/` — diary (unchanged)
- `/session/new` — start a new session
- `/session/{id}` — view or resume a session
- `/admin` — admin (unchanged)

### Session view

Vertically scrolling conversation:
- **User messages:** full-width, user's text color.
- **Part messages:** preceded by part name in its color. Slightly muted tone.
- **Emergence:** subtle visual break (thin colored line or extra spacing) when a new part enters.
- **Session note:** at top of closed sessions, in a distinct card/style.
- No individual message timestamps (breaks flow). Session date at top.

### Feature integration

| Feature | Impact |
|---|---|
| Sidebar | Add sessions section |
| Search | Sessions searchable alongside entries |
| Favorites | Sessions can be favorited |
| Data export | Sessions included |
| Inner weather | Sessions contribute to emotional tracking |
| Admin dashboard | New Sessions tab in user detail |
| Analytics | `session_started`, `session_closed`, `part_emerged`, `session_note_generated` |
| Safety / grounding | Carries over into sessions |
