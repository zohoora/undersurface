# Room — unified voice, sound, and quiet

## Product decision

Room replaces the user-facing Relax and Drift surfaces. The old implementations
remain in the repository for historical records and compatibility, but no longer
appear in session navigation. Old `relax`, `relax-arc`, and `drift-arc`
recommendation targets redirect to Room.

Room is not a guided recording. It is the ordinary UnderSurface companion in a
different spatial and temporal form: conversation may gradually give way to
sound and silence, and the writer can speak again at any time.

## Entry choices

- **Listen first:** opens a two-way Realtime conversation. The immersive clock
  begins only when the writer chooses to let the exchange become quieter.
- **Lead me:** opens two-way Realtime voice and begins the ambient arc at once.
  The model chooses natural wording within deterministic cue windows.
- **Quiet company:** begins sound and light immediately. It neither requests a
  microphone nor opens a Realtime session.

## Load-bearing invariants

1. `roomEngine.ts` owns time. The model never advances phases or schedules cues.
2. Voice cues are purposes, not scripts. `promptAssistant()` never says “say
   exactly” and `roomPrompts.ts` bans meditation-narrator performance.
3. Silence is valid. Sparse voice emits an arrival, at most one middle cue in a
   five-minute-or-longer room, and a return cue. Quiet emits none.
4. The writer can interrupt. Natural phrases such as “less voice,” “quiet,”
   “change the sound,” “another minute,” and “that’s enough” also change the
   local runtime; the model is not the sole control path.
5. One clock drives the arc. Visual atmosphere never contains an independent
   set timer or a moving object that can cross text.
6. Fresh eyes passes no previous Room history into the model. Its Room record
   and transcript remain part of history/export, but are filtered from future
   personalization.
7. Returning from Room never opens a questionnaire. Research provenance and the
   Room record remain in the background.
8. Every active state has an obvious 44px leave control. Unmount stops voice,
   microphone tracks, sound, timers, and wake lock.

## Continuity and learning

Both sides of a Room voice exchange are appended to the parent session transcript
with `surface: 'room'`, so the existing reflection and continuity system sees the
same conversation as Talk or Speak. A separate `roomSessions` record stores the
chosen shape, final voice density, sound, natural-language controls, elapsed time,
and transcript. Recent non-Fresh-eyes Room shapes initialize the next device and
enter the Room prompt as background preferences; the present choice always wins.

`roomSessions` is included in account deletion and full data export.
