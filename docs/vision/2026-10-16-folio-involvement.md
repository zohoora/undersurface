# Folio: companion involvement (2026-10-16)

The owner's request: "Let's add in a 'Companion Involvement' slider. So the current is a level 1. A level 5 is when we use as much AI as possible to automate things… Level 5 should feel like magic with the app reading and nudging and guiding me: minimal if any decision-making on my part." And then: "at the highest AI setting, it's not just about the companion being more automated. All decisions from a user interface are automated. Some things that the user would normally write is automated… an organic dance with the AI mind in the self-discovery process."

Designed with Fable (two rounds: a proposal, then a red-team of the level-5 additions), built and shipped autonomously. Where Fable advised against something the owner asked for (the companion writing text, choosing distances, closing folds), the owner's words decided; the safeguards Fable asked for were kept.

## 1. The levels

One slider in Folio settings ("Companion involvement"), stored per account in `folioPreferences/current.involvement`. Each level includes everything below it. The line beside each stop names what the companion reads first.

| # | Name | Reads | Does unasked | Still the writer's |
|---|---|---|---|---|
| 1 | Quiet | The Ask selection only. | Nothing (Folio as it shipped). | Everything. |
| 2 | Points | The rested paragraph and its neighbours (writer's words only). | After a paragraph rests with the caret elsewhere, a dot beside one sentence. Pressing it lifts that sentence, with the companion's question waiting beneath. | Every act. |
| 3 | Asks | As 2. | A ghost question in an empty beneath when the writer lifts, and in a new between; an opening ghost on a blank page; after the writer keeps, a one-tap name and come-back day. | Every act; the companion only fills empties and offers. |
| 4 | Arranges | As 3, plus the composition it keeps. | Lifts the marked line itself (touching, caret untouched); keeps a composition that has rested 60 s with the caret elsewhere; names it; sets its come-back; one unasked margin note per visit. | The words, distance, closing, deleting, Step inside. |
| 5 | Dances | As 4, plus the end of the writer's last Folio page and their kept titles. Nothing from Sessions. | **Arrival**: opens a blank page by lifting one of the writer's own sentences from their last page (marked "from ‹date›"), choosing the distance, writing the between, and starting the beneath with an unfinished half-sentence the caret continues; or begins the page with an opening line. **While writing**: its lifts choose a distance and write the between. **After a keep**: Step inside opens itself once per visit after 30 s of rest; the fold closes after 60 s with the caret elsewhere. **Return** may bring kept things back without the setting (a trace's own "Don't bring this back" still holds). Two unasked notes per visit. | The words beyond what the companion starts, and every exit. |

Defaults: writers who saw Folio before the slider (`firstVisitSeenAt` set) stay at 1 and see a one-time line, "The companion can now take part in Folio. Choose how much". New writers start at 3, so the blank page is no longer blank. The admin switch `folioInvolvement` (on unless false) puts everyone at 1 when off.

## 2. The rules every level keeps

1. **Crisis owns the page.** Nothing unasked under Shore, Quiet or Recent (72 h after any grounding activation), while the crisis card shows, while grounding is active, while this tab doesn't hold the page, or while the save chain is in trouble. A closed gate clears every ghost and mark at once and aborts any call. Ask is unchanged.
2. **It acts only on checked text.** A unit the companion reads must already be in the page's checked set (C4), so at levels 2–4 no text leaves the device that hadn't already gone for the safety check.
3. **Never under the writer's hands.** An act applies only after a rest (8 s with no writer edit), with the caret outside its target, the target unchanged since the call, and the level's budget left. A stale offer is dropped, never applied late. A companion lift never moves the caret or scrolls; the page compensates so the writer's line stays where it was. The companion never acts twice in a row without a writer action between (its follow-ups to a keep excepted).
4. **Everything shows and can be undone.** Each act is announced, with a notice that offers Undo for 30 s or until the writer's next edit. An Undo pauses that act for 10 minutes; a second Undo in a visit pauses it for the visit. Two dismissed marks in a row pause marks for the visit.
5. **The companion's words are visibly its own.** Text it writes (level 5: the between, a starter, an opening line) carries a `companionText` mark: graphite italic on the page, in kept traces, Reading view and export (labelled "Companion"). A writer's edit inside that text makes the whole run the writer's; typing after it doesn't (that is how a starter is continued).
6. **The safety checks read the writer, not the companion.** Safety units, L1, L2 samples and check keys are built from the writer's words only (`writerText`, `writerPassageText`); a page with no companion text has exactly the keys it had before. Every generated output passes L1 before it's used; a hit drops it silently (`folio.companion.l1Out`) and never grounds, because the writer didn't write it. An unasked note that comes back grounded is not shown.
7. **Silence is the fallback.** Every call returns one JSON object, parsed strictly (`calls.ts`); a chosen sentence must be an exact substring of the writer's paragraph, a name must take at least half its words from the composition. Anything else, or a reply slower than 12 s, is dropped.

## 3. Limits (per visit: a load, or 30 minutes hidden)

| | 2 | 3 | 4 | 5 |
|---|---|---|---|---|
| Model calls | 8 | 12 | 16 | 24 |
| Marks | 6, ≥ 90 s apart | same | same | same |
| Ghosts | — | 10 | 10 | 10 |
| Companion lifts | — | — | 4, ≥ 3 min apart | 6, ≥ 2 min apart |
| Companion keeps | — | — | 3 | 3 |
| Unasked notes | — | — | 1 | 2 |

The come-back day is deterministic (a first keep with a short beneath: tomorrow; otherwise a week; a re-keep: a month).

## 4. Privacy

The first-visit line says what the chosen level reads (level 1 keeps "The companion doesn't read them."; 2–4 "reads this page as you write"; 5 "reads your Folio pages and kept things and writes alongside you. Nothing from Sessions."). The policy's "How AI works" says the same in all 17 languages. Law 2 holds at every level: nothing from Sessions' memory enters Folio, and nothing from Folio enters Sessions unless the writer brings it.

## 5. Where it lives

`src/folio/companion/`: `levels.ts` (powers, limits, timing), `calls.ts` (prompts and parsers), `conductor.ts` (when: the preconditions, budgets, back-off), `acts.ts` (companion lift, arrival, opening, close), `presence.ts` (ghosts and marks, decorations only), `companionText.ts` (the mark and the take-over), `useCompanion.ts` (the page wiring), `visit.ts`. Provenance: `underside.attrs.liftedBy`/`fromPageId`, `FolioTrace.keptBy`/`titleBy` (rules allow them at create; `titleBy` may change with a rename). Eval: `npm run test:folio-companion` (in the release gate). Production check: `scripts/folio-prodcheck/folio-involvement-check.cjs`.
