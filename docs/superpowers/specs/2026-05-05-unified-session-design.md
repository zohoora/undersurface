# Unified Session — Design

**Status:** Draft
**Date:** 2026-05-05
**Scope:** Front-of-house unification of all four interaction surfaces (Journal, Conversation/Companion, Real Talk, Voice) into a single product with one front door, one noun, and one mental model. Below the surface — engines, prompts, schemas, crisis guard, HRV, memories — is unchanged.

## Problem

UnderSurface today presents four interaction surfaces, each with its own front door, vocabulary, and mental model:

- **Journal** — rich-text page, AI parts respond to pauses (`src/components/Editor/LivingEditor.tsx`)
- **Conversation** — text chat with companion-toned therapist (`src/components/Session/SessionView.tsx`, `mode: 'standard'`)
- **Real Talk** — text chat with sharper therapist persona (`mode: 'real_talk'`)
- **Voice** — real-time spoken conversation via OpenAI realtime (`src/hooks/useVoiceSession.ts`)

A 3-card choice screen at `/new` (`src/components/EntryChoice.tsx`) forces the user to pick a mode *before* they know what they need. The sidebar (`EntriesList.tsx`) uses different glyphs (`◆`, `◇`) per type. The product has multiple nouns ("entry," "session") for what is, in the user's experience, one act of going underneath.

All four surfaces share most of the architecture — parts engine, therapist prompts, HRV, memories, crisis guard, language directive — but the front-of-house presents them as four sibling products rather than four facets of one. The result: the product *feels like four apps, not one*. The unifying philosophy gets fragmented across separate front doors.

## Goals

- **Conceptual coherence.** UnderSurface feels like one product. The user reaches for the *product*, not a *mode*.
- **Single noun.** "Session" replaces "entry" in user-facing language. The unit of UnderSurface is a session.
- **Single front door.** No mode-choice screen. One `Begin a session` action.
- **Forms become surfaces *within* a session.** Journal, Talk, Speak, Real Talk are switchable surfaces inside a single session — not separate sessions.
- **Therapist as agent of modality.** The therapist can recommend form switches when therapeutically apt, woven into prose. Mode-switching becomes therapeutic, not just a UI feature.
- **Preserve form-fit.** The four interaction shapes remain distinct — they fit different psychological positions (solo-vulnerable, relational-warm, relational-confronting, embodied-realtime). We unify the *frame*, not the *forms*.

## Non-goals

- **The system does not infer or pick the form.** The user (or the therapist as their proxy) chooses. The AI does not read HRV or content and decide "now you should be journaling."
- **No re-architecture of underlying engines.** `partOrchestrator`, `sessionOrchestrator`, `pauseDetector`, `partPrompts`, `therapistPrompts`, `sessionPrompts`, `weatherEngine`, `ritualEngine`, `hrvEngine`, etc., are unchanged.
- **No prompt-content rewrites.** `THERAPIST_CORE`, `REAL_TALK_CORE`, `SAFETY_RULES` stay as written. The prompt builder gains *one* new optional block (recommendation vocabulary); existing blocks are not touched.
- **No data migration in V1.** `entries` and `sessions` Firestore subcollections stay separate. The unified UI stitches them on read.
- **Mobile shipping is in scope.** The Capacitor build (`ios/`, `android/`) must work. Bottom-bar UI must be touch-friendly.
- **The crisis-override invariant is non-negotiable.** `useRealTalk = mode === 'real_talk' && !isGrounding` in `buildTherapistSystemPrompt` is preserved verbatim. Tests at `therapistPrompts.test.ts` and `realTalkFlow.test.ts` are not modified.

## The unified product

### Front door

The `/new` route and `EntryChoice` component are removed. Replaced by a single affordance — **Begin a session** — surfaced in the sidebar `+` button and via keyboard shortcut.

Click → land directly in the canvas. No mode picker.

### Canvas

Chat surface, default. The therapist's opening message is rendered immediately (using existing `THERAPIST_CORE` + companion tone). The user types in a compose area at the bottom of the screen.

A **bottom bar** sits above the compose, persistently visible across all surfaces:

| Affordance | Function |
|---|---|
| **Talk** | Active by default. Text chat with the therapist. |
| **Journal** | Switch to writing-only surface. Therapist quiets. |
| **Speak** | Voice replaces the compose area. Therapist responds aloud. |
| **◇ Real Talk** | Orthogonal toggle. Switches therapist persona from companion to confronting. Persists across surface switches within the session. |

The bottom bar is the only form-switch UI in the product. There are no other mode-choice surfaces.

### Forms as surfaces

The four shapes become surfaces *within* a session, switchable at any time without leaving:

#### Talk surface
Compose area + chat history above. Typing → therapist responds (existing chat infrastructure: `src/ai/openrouter.ts` → `/api/chat` Cloud Function → streamed SSE).

#### Journal surface
The compose area is replaced by the existing `LivingEditor` component (TipTap rich text). The chat history collapses to a 1-line presence indicator at the top:

> *Therapist · 4 messages · listening*

The existing parts engine activates — pause detection, annotations, color treatment, all current Journal-mode behavior. The therapist does not take turns while Journal is active. Tap **Talk** to return; the therapist receives the journaled text as context for her next message and "catches up."

#### Speak surface
The compose area is replaced by voice UI. The existing realtime infrastructure (`useVoiceSession.ts`, `realtimeTokenApi`) is invoked from inside the session, not as a separate URL. Voice transcripts append to the chat history. Tap **Talk** to return to text.

#### Real Talk toggle
Not a surface — a *tone toggle* orthogonal to surface. Works in Talk and Speak (and persists if the user is in Journal, taking effect when they return to Talk/Speak). Therapist persona switches from `THERAPIST_CORE` to `REAL_TALK_CORE` exactly as today.

**Real Talk persistence boundary:** persists across surface switches *within* a session. Does not persist across sessions — each new session starts in companion tone. Rationale: Real Talk is a stance the user adopts in a specific moment, not a baseline disposition.

**Crisis override (preserved verbatim):** when grounding is active, Real Talk is suppressed and `THERAPIST_CORE` is used. The single guard line `useRealTalk = mode === 'real_talk' && !isGrounding` in `buildTherapistSystemPrompt` is unchanged. Tests in `therapistPrompts.test.ts` and `realTalkFlow.test.ts` continue to enforce this.

### Therapist-initiated form switches

The therapist can recommend a form switch when therapeutically appropriate. The recommendation appears as inline italicized prose with a tappable phrase, woven into a normal therapist message — never as a button or chrome element:

> "There's something brewing under what you're saying. Would you want to *write about it* for a moment, just to yourself?"

> "What if you *said it aloud*? Sometimes the body knows things the typing fingers don't."

> "*Can I be more direct with you?* I'm noticing a pattern."

Tapping the italicized phrase performs the switch:

| Phrase pattern | Action |
|---|---|
| *write about it*, *write about this*, *journal about it* | Switch to Journal surface |
| *say it aloud*, *speak it*, *say this out loud* | Switch to Speak surface |
| *can I be more direct*, *want me to be sharper* | Toggle Real Talk on |

The recommendation is generated by the therapist prompt itself, not by deterministic rule-based triggering. The prompt gains a new instruction block giving the therapist:

1. Vocabulary for these recommendations.
2. Constraints on when they're appropriate: not too often (≤ once per ~5 turns); not as the first response in a session; never when grounding is active; never to pivot away from distress that wants to be heard.

A future planning phase will decide the exact mechanism (structured annotation parsed from stream vs. Markdown link convention vs. tagged span). The design constraint: it must be inline prose, not a chrome element.

**Crisis interaction:** when grounding is active, the therapist prompt suppresses recommendations entirely. This is in addition to the Real Talk suppression. Distress wants presence, not modality games.

### Sidebar

`EntriesList.tsx` collapses today's entries + sessions split into one chronological feed. Mode glyphs (`◆`, `◇`) are removed.

Each item shows:
- Date + time
- First-line preview: the first message of the session, regardless of speaker (therapist's opener if the user hasn't replied yet; user's first message otherwise; for legacy entries from before this change, the entry's first line).

Click → reopen the session. The session reopens in the surface that was last active when the user left.

Legacy `entries` (pre-unification) and `sessions` continue to render in the same feed. Old entries open in a read-only Journal view; old sessions open in the new unified canvas.

### Storage strategy (V1: stitch on read)

The existing `users/{uid}/entries/` and `users/{uid}/sessionLog/` Firestore subcollections are unchanged.

Journal-as-surface-within-session is implemented by the session document carrying a list of `entryRefs` — when the user switches to Journal mid-session, a new entry document is created (or an existing in-progress one is updated) and its ID is appended to the session's `entryRefs`. The chat history and entry text are stitched together at render time by `SessionView`.

**Why stitch, not migrate?**
- Cheaper. No migration script, no rollback risk, no schema changes to Firestore rules.
- Reversible. If the unified UX doesn't land, we can revert routing and components without touching data.
- Future-proof enough. A V2 schema collapse (sessions own everything) is feasible but out of scope here.

### What stays the same

- **Engines:** `partOrchestrator`, `sessionOrchestrator`, `pauseDetector`, `weatherEngine`, `ritualEngine`, `quoteEngine`, `disagreementEngine`, `echoEngine`, `threadEngine`, `quietTracker`, `bodyMapEngine`, `sessionReflectionEngine`, `sessionContextLoader`, `hrvEngine`, `hrvSignalWorker`, `hrvTimeline`.
- **Prompts:** `partPrompts.ts`, `sessionPrompts.ts`, `therapistPrompts.ts` (only the recommendation block is added — existing content untouched).
- **Cloud Functions:** `chat`, `accountApi`, `adminApi`, `mcpApi`, `realtimeTokenApi`. No deployments to functions/.
- **Firestore:** all subcollections under `users/{uid}/`. No rules changes. No new collections.
- **localStorage:** device settings unchanged.
- **Auth, admin, smoke test, CI, deploy pipeline.**
- **Feature flags:** the 7 core + 25 experimental flags. The unified UI does *not* gate behind a new flag in V1 — it ships as a route swap. (Optional: a `unifiedSessionUI` admin-controlled flag for staged rollback if the team wants one. Decided in planning.)

### What goes away

- `/new` route handler in `App.tsx`
- `src/components/EntryChoice.tsx` component
- Mode glyphs in `EntriesList.tsx` (`◆`, `◇`)
- The `flint-spark` and `breath-glow` choice-card animations (component is removed)
- The `pendingSessionMode` state machinery in `App.tsx` (mode is no longer pre-selected — sessions always start in companion, Real Talk is toggled in-canvas)
- User-facing copy referring to "entries" vs. "sessions" as separate things
- The mental fork "should I journal or have a session?"

### What changes

- **`App.tsx` routing:** `/new` either redirects to `/session/new` or is removed. The `pendingSessionMode` state is removed. New sessions are created in companion tone by default.
- **`SessionView.tsx`:** gains the bottom bar (Talk / Journal / Speak / Real Talk). Surface state becomes a discriminated union (`'talk' | 'journal' | 'speak'`). The `mode` field on the session doc continues to drive Real Talk persona, but is now toggle-controlled in-canvas rather than URL-derived.
- **Journal-within-session:** SessionView embeds `LivingEditor` when surface = `'journal'`. The chat history collapses to a presence indicator. On surface change to `'talk'`, the journaled text becomes context for the therapist's next message.
- **Speak-within-session:** SessionView invokes the existing voice infrastructure when surface = `'speak'`. The realtime token endpoint and stream handling are unchanged.
- **Real Talk toggle UI:** lives in the bottom bar. Toggling on within a session updates `session.mode` to `'real_talk'` and persists for the session.
- **`buildTherapistSystemPrompt`:** gains an optional `allowRecommendations: boolean` parameter. When true (companion mode, not grounding, not the first response), appends a "form recommendation vocabulary" block. The block teaches the therapist the inline phrasing patterns and the cadence constraint. Real Talk persona never gets this block — the therapist who is calling the writer out doesn't soften by suggesting they journal.
- **`EntriesList.tsx`:** unified chronological feed. Mode glyphs removed. First-line preview computed from session messages (with entry fallback for legacy items).
- **Session schema:** `Session` interface gains `entryRefs: string[]` and `lastSurface: 'talk' | 'journal' | 'speak'`. Both optional for backward compat.

## Open questions / risks

1. **Recommendation cadence tuning.** The "≤ once per ~5 turns" constraint is a starting point. Real-world data will tell us if it's too frequent (naggy) or too rare (feature is invisible). Adjustable by editing the prompt instruction block.
2. **Voice cold-start friction.** A user who only wants to speak still has to: click Begin → land in chat → tap Speak. Two clicks vs. one. Acceptable for V1; revisit if voice usage is meaningful and friction shows in retention.
3. **Journal-form parity within session.** When `LivingEditor` runs as a surface inside a session, the parts engine consumes context that includes session chat history. Need to verify this doesn't degrade part selection or annotation quality vs. standalone Journal mode. Most likely fine — the engine is already context-aware — but worth a smoke test.
4. **Real Talk persistence on session resume.** If the user closes mid-session with Real Talk on, then reopens, Real Talk should still be on. The `session.mode` field already persists this; verify `SessionView` reads it on load.
5. **First-time experience.** A first-ever user lands directly in chat with the therapist's opening message. Onboarding (consent, name, voice intro) is *out of scope* for this spec. A separate design pass handles new-user welcome.
6. **Therapist recommendation reliability.** LLMs can be unreliable about following structured-output instructions. The recommendation phrasing patterns must be parseable from arbitrary therapist responses. Choosing a robust convention (e.g., explicit Markdown-like syntax or sentinel tags) is a planning-phase decision.
7. **Sidebar legacy items.** Old entries and sessions render in the same feed. Old entries opened from the sidebar should still work — render as standalone Journal views (read-only). The session-style canvas only applies to new sessions.

## Test surface

### New tests

- `unifiedSessionFlow.test.ts` — surface switching preserves session state; therapist-initiated recommendations parse and dispatch correctly; Real Talk persistence within session; recommendation suppression during grounding.
- `therapistRecommendationParser.test.ts` (or whatever the parsing layer is named) — recommendation phrase patterns are extracted reliably from streamed therapist responses.

### Updated tests

- `SessionView.test.ts` — bottom bar renders; surface switches don't lose state; recommendation taps trigger the correct surface change.
- `therapistPrompts.test.ts` — new recommendation block is present in companion prompts; absent in `REAL_TALK_CORE`; absent during grounding. Existing assertions about persona swap and crisis override are unchanged.
- `realTalkFlow.test.ts` — Real Talk toggle inside a session works the same as today's URL-derived mode flag. Crisis override path is unchanged.
- `translations.test.ts` — new bottom-bar labels (Talk / Journal / Speak / Real Talk) added to all 17 languages.

### Untouched

All engine tests (`partOrchestrator`, `sessionOrchestrator`, `pauseDetector`, `weatherEngine`, `bodyMapEngine`, `ritualEngine`, `hrvSignalWorker`, `hrvTimeline`, `promptSafety`, `llmCorrect`, `annotationParser`, etc.).

## Implementation order (high-level)

A planning-phase plan will refine these into concrete tasks. Sketch:

1. **Therapist prompt update** — add recommendation vocabulary block to `buildTherapistSystemPrompt` (companion only, not grounding, not first response). Update tests.
2. **Therapist recommendation parser** — extract tappable phrase patterns from streamed therapist text. Render as tappable spans in chat bubbles.
3. **SessionView bottom bar** — Talk / Journal / Speak / Real Talk affordances. Surface state in component.
4. **Journal surface within session** — embed `LivingEditor`, collapse chat history to presence indicator, append journaled text to session context on Talk return.
5. **Real Talk toggle UI** — toggle in bottom bar updates `session.mode`. Persists within session, resets on new session.
6. **Speak surface within session** — invoke existing realtime infra from inside SessionView. Wrap voice transcripts into the chat stream.
7. **Sidebar unification** — collapse entries + sessions into one chronological feed. Remove mode glyphs. Compute previews from first message.
8. **`/new` removal** — remove the route, the `EntryChoice` component, the `pendingSessionMode` machinery.
9. **First-session UX polish** — session-creation animation, opener generation latency handling, error states.

Steps 1–6 can ship behind a `unifiedSessionUI` admin-controlled feature flag for staged rollback. Steps 7–9 are no-going-back cuts.
