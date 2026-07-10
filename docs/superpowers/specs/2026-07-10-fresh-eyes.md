# Fresh Eyes Memory Boundary

**Date:** 2026-07-10
**Status:** Implemented

## Product decision

The four-way memory-aperture choice is too abstract. The product exposes one
plain binary mode instead:

- normal continuity — the companion may use and update longitudinal memory;
- Fresh eyes — the companion uses only the current session and the session
  does not update longitudinal memory.

Normal continuity is the unconditional default for every new session. Fresh
eyes is invoked explicitly for one session, like a browser's private mode; it
is not offered or remembered as a persistent preference.

The transcript remains in session history and export. Fresh eyes is a memory
boundary, not an ephemeral or incognito transcript mode.

## Read boundary

When a session is Fresh eyes:

- no prior session notes, field notes, memories, profile, facts, parts,
  intentions, stance, outcomes, protocols, hypotheses, promises, carried
  noticing, rupture repair, rumination watch, story arcs, or earned callbacks
  may shape Talk or Speak;
- Journal's memory-backed inner voices are disabled;
- Field Mosaic and delayed-outcome prompts are not shown.

Writer-selected interaction preferences such as tone, language, and directness
remain available because they are instructions, not autobiographical memory.
Safety and grounding behavior are unchanged.

## Write boundary

Fresh-eyes sessions keep their transcript and operational session record, but
do not create:

- a session note;
- reflection memories, summaries, profile/fact changes, field moments, parts,
  values, intentions, stance, carrying, promises, or companion signals;
- Personal Science assignments or intervention outcomes;
- closing outcome-learning check-ins.

Later continuity loaders exclude Fresh-eyes sessions from notes, cadence and
rupture evidence, and parent-linked Relax history.

## Compatibility

Legacy `light`, `counterstory`, and stored default-aperture values remain
readable but are ignored for new sessions. Existing session records normalize
to `fresh` or `pattern`; new sessions always start at `pattern`. SMS continues
with normal shared continuity; Fresh eyes is a session-surface mode.

## Verification

- UI tests prove the toolbar is a switch, not a multi-option selector.
- Switching before the first user turn replaces the automatic opener, so the
  first visible companion response honors the chosen boundary; the choice then
  locks for the rest of that session.
- Prompt/kernel tests prove Fresh eyes has zero durable context.
- Personal Science and reflection tests prove no learning writes occur.
- Context-loader tests prove Fresh sessions do not return later as notes,
  rupture evidence, or parent Relax history.
- Frontend (1,486 tests), Functions (143 tests), emulator rules/indexes (41
  tests), lint, and production builds are green. Production browser coverage is
  completed after deployment.
