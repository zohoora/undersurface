# Fable's review of Folio draft 3.1

**Reviewer:** Fable 5.1 (Claude), as two independent reviewers
**Date:** 2026-10-15
**Reviewed:** [`docs/vision/2026-10-15-folio-v3.md`](https://raw.githubusercontent.com/zohoora/undersurface/ef1530e/docs/vision/2026-10-15-folio-v3.md) at commit `ef1530e` (draft 3.1)
**Answered in:** [draft 4](2026-10-15-folio-v4.md), Appendix J

The two parts below are reproduced verbatim. Part 1 covers the art, the study, honesty and the experience of safety (findings A1 to A13). Part 2 covers the engineering contracts and the technical design (findings B1 to B21).

The reviewers wrote their scripts and logs in a local scratch folder. They're published in this repository, unchanged except that the logs end in `.txt` (the repository ignores `*.log`), so the paths in the text map as follows:

| Path in the text | Published at |
|---|---|
| `scratchpad/fable/art/contrast.mjs` | not published; it computes WCAG contrast from the hex tokens in §3.11, and its result (2.93:1) was recomputed independently |
| `scratchpad/fable/eng/repro-eng-state.cjs`, `.log` | [`folio-repros/repro-eng-state.cjs`](folio-repros/repro-eng-state.cjs), [`repro-eng-state.log.txt`](folio-repros/repro-eng-state.log.txt) |
| `scratchpad/fable/eng/repro-eng-view.cjs`, `.log` | [`folio-repros/repro-eng-view.cjs`](folio-repros/repro-eng-view.cjs), [`repro-eng-view.log.txt`](folio-repros/repro-eng-view.log.txt) |
| `scratchpad/fable/eng/emu/` (`probe-eng.cjs`, `folio-eng.rules`, `firebase.json`, `probe-eng.log`) | [`folio-repros/fable-emulator/`](folio-repros/fable-emulator/), with the log as `probe-eng.log.txt` |

---

# Part 1: the art, the study, honesty and the experience of safety


**Reviewer:** Fable 5.1 (Claude)
**Date:** 2026-10-15
**Reviewed:** `docs/vision/2026-10-15-folio-v3.md` at `ef1530e` (draft 3.1), with both source visions, the Codex and Gemini reviews, and the code at `35f8297` (identical to the working tree for the files cited).
**Lens:** proposition and art (§1–§3, §9, App. D), the prototype study (§4), honesty and copy (§2.3, §3.12, §5.3, §5.6), the experience of safety (§3.9, §5.4 late check, §5.5, §8, §11), accessibility as lived (§3.10), scope (§7), coherence. The editor, storage and scheduler contracts (C1, C2, C4 mechanics) are another reviewer's; I touch them only where they change what a writer feels.

Scratch: `scratchpad/fable/art/contrast.mjs` (WCAG contrast of the §3.11 tokens).

---

## 1. Verdict

Not yet ready to pre-register the study, and ready to prototype only after §4.4 is rewritten so it can fail where it matters: D5 (the return) and D6 (harm) cannot stop anything as written, D1 leans on a yes/no question asked after an hour with a novel tool, and D2 would ship Apart on three people who set a distance after being told to "try the controls". The art is in better shape than the study: the fold with equal standing, the inside bigger than its outside, and time as material are the distinctive things here, and the draft is honest that Apart may be a margin with a name. What the draft still underplays is that Folio inherits a grounding mechanism built for a conversation and makes it a whole-page material change with no exit, no explanation, and a 72-hour reach into SMS and Sessions that §3.2 doesn't admit; a late check on a page opened weeks later, or a persona poem that trips L1 on every settle, turns the quiet page into the clipboard the source visions were written against. The first things to change: rewrite D1/D2/D5/D6 (A1, A10), decide the manual exit and the late-check rule together (A2–A4), and name the second crossing of the memory boundary (A2). The scope can lose translation and corrected copies from Phases 1–2 without breaking any promise to the writer (A9).

---

## 2. Findings

### A1. The study can still be argued into "proceed": D5 and D6 have no stop, D1 rests on a leading question, D2 is contaminated by the directed task

- **Severity:** blocker (for the pre-registration step in §4.4 and §7 Phase P)
- **Sections:** §4.3, §4.4, §0.3 (draft 3 change 10), Appendix H R11
- **Evidence basis:** document only; reasoning about demand characteristics in moderated studies

**The problem.** Gemini's R11 was adopted for D1 (a numeric stop exists) but not for the rest of the table.

- **D5 cannot fail.** Session 2: the slip appears, the participant opens it, and the moderator says "Write beside it if you want." In a 20-minute moderated session, almost everyone writes a sentence when the person running the study invites them to. Then the moderator asks "Does the arrangement mean anything now?", which invites yes. D5's bar is 3 of 9 who either write or say yes. It will pass with any nine people, and "Come back is built as specified" follows.
- **D6 cannot stop or redesign.** "Anyone who feels interpreted or managed, or feels the second passage must be the real one" leads only to "fix the copy and visuals, re-test with 3 people". *Below the page* (its "What to learn" section) said to **stop or redesign** if the fold consistently reads as the app exposing a hidden truth. The draft's own kill criteria in §8 repeat that for Phase 3, but Phase P, the study designed to catch it early, downgrades it to a copy fix.
- **D1 counts a yes.** The third condition is "answered yes, with a concrete example, to *Did any version let you make something you wouldn't have made on a normal page?*" After 45 minutes using two novel variants, with the moderator present, yes is the socially easy answer; "concrete example" is the only brake, and an example that is an elaboration (a note) still counts under the coding in §4.4, because "elaboration" and "correction" are relationship codes, not note codes. Meanwhile the study's best question, "Which felt like taking notes, and which felt like making something?", feeds no rule.
- **D2 is scored on a task that forces the behaviour.** The first directed prompt in every variant is "Try the controls on one line." In A, that means pressing Closer/Farther. D2 then counts participants who "set a distance on purpose". Three of nine is a low bar for something everyone was instructed to do, and the denominator is undefined ("of the participants who used A" is everyone).

**Scenario.** Nine participants, none of whom would ever lift a line at home. Directed tasks produce three beneaths each (they were told to). Six prefer N for unprompted writing (D4 fires, capping D1 at "2 or 3"). Two weeks later, seven write a sentence beside their kept thing when invited (D5 passes). Four say the beneath felt like "the real one" (D6: fix copy). Result under the table: one redesign of the fold, Come back built in full, copy tweaked. Nothing stops.

**The fix.**
1. **D1:** count a participant only when (a) a coder-rated artifact from F or A carries a relationship in the non-note set, defined now as *contradiction, joke, question, unresolved* (elaboration and correction count as note-like unless the participant's own description shows otherwise), **and** (b) the participant names F or A, unprompted, in answer to "Which felt like taking notes, and which felt like making something?" Drop the yes/no question or keep it as colour only.
2. **D2:** score only artifacts from "Make something you'd want to keep" and from the unprompted segment, never from "Try the controls". Require that the kept artifact *has* a between or a non-default distance (the choice survived to the thing they chose to keep), and that the participant's description of it is not spacing/decoration. Denominator: of 9. Consider 4 of 9, since Apart is the thing the whole first version bets on.
3. **D5:** Session 2 opens with three silent minutes: the slip is on screen, the moderator says nothing. Count only participants who open it and write without invitation, or who, before any prompt, say something about the arrangement. Invited writing is observed and reported but doesn't count. See A6 for what else Session 2 should test.
4. **D6:** make it a stop-capable rule: 3 or more of 9 who feel interpreted or managed, or who read the beneath as "the real one", counts against D1 the way D4 does (D1's result is lowered to "2 or 3"), and any single report still triggers the copy/visual fix. This matches the source vision and §8.
5. Keep the sentence "these numbers are commitments, not statistics" and add: "the owner may not add a measure after seeing data".

### A2. A late check can start shore on a page opened weeks later, and every Folio activation reaches SMS and Sessions for 72 hours; §3.2 says the only crossing is Bring

- **Severity:** major
- **Sections:** §5.4 ("A late check can start shore"), §5.5, §3.8 (Safety), §3.2 (Memory boundary), §5.6 (Grounding timestamp row), §3.12 (`folio.comeBack.waiting`), §11 question 15
- **Evidence basis:** read the code: `src/store/groundingPersistence.ts:20–37` (every activation stamps `companionPreferences/current.lastGroundingAt`, best effort, throttled to one write per 30 s); `src/store/groundingState.ts:54–71` (sinks fire on every activation and re-trigger); CLAUDE.md "Cross-channel crisis memory" (SMS reads it to ground replies and suppress proactive texts for 72 h). Nothing in `src/` outside `main.tsx` and types reads `lastGroundingAt` today, so Folio's Recent overlay would be the first client reader, and it has no named module in §6.2.

**The problem.** Two things compound.

*First, the crossing §3.2 doesn't name.* "Folio pages, folds and traces never enter the companion's prompts" is true. But a Folio activation changes how the companion *behaves* everywhere for three days: SMS replies go grounded, field windows are cancelled, Sessions' `lastGroundingAt` reads change. The draft lists the timestamp in §5.6 as "existing behavior" and in §3.2 as a shared thing ("the crisis stack and grounding state"), but then says "the only crossing is shore's Bring what you just wrote". That sentence is the one a reviewer of honesty relies on, and it's incomplete. The first-visit line's "The companion doesn't read them" stays true (text never crosses), but the writer who later gets a grounded SMS reply after a dark poem in Folio has crossed a boundary they were told doesn't exist.

*Second, the late check.* §5.4 is right that unchecked text should be checked. It then applies "the shared rule unchanged": risk 2 activates. Sessions never faces this case; Sessions checks at write time, so "just as it covers Sessions" doesn't actually dictate what to do with text written six weeks ago. Activating shore on old text produces every cost in §5.5's list, plus the 72-hour reach above, for a cause the writer can't see.

**Scenario.** On 3 September a writer drafts a bleak paragraph on the train, offline; the tab closes before it settles (L1 ran on hide and didn't fire; L2 never ran). On 15 October they open Folio to write about a good day. The sweep schedules the old unit; the classifier returns 2. The paper flattens, "If things feel like too much right now…" appears, the resources card appears, `lastGroundingAt` is stamped. Their come-back for tomorrow goes to "Waiting" with no reason shown and no way to open it. That evening the SMS companion answers in a grounded register and the week's field window is cancelled (`recent_crisis`). The writer has no idea why any of this happened; it looks like the app decided something about them. This is the "being watched" cost §5.5 says we don't yet know, delivered in its worst form.

**The fix.**
1. **§3.2:** "In the first version there are two crossings: *Bring what you just wrote* (text, by the writer's tap) and the shared grounding timestamp (no text; a shore activation in Folio changes the companion's register in Sessions and SMS for 72 hours, and pauses proactive texts). Nothing else crosses." Add the same sentence to the policy update in §5.6.
2. **Late checks (answer to question 15):** always *check* and *record*. *Activate* only when the page itself was edited within the last 72 hours (`updatedAt`, already stored). For older text with a risk-2 result: add the key to the checked set, show the crisis resources card (the plain door) without flattening the page, without the shore line, and **without stamping `lastGroundingAt`**. This keeps decision 3 intact for anything a writer wrote recently and stops a six-week-old paragraph from re-shaping their SMS channel. Log a code (`folio.l2.lateRisk`) so §8 can count it.
3. **Waiting (see also A4):** the hold applies to the *unasked* slip at the top only. In Kept, each held trace offers **Open**. Law 1 ("only the writer's decisions make anything last") and Law 4 ("things come back when the writer asked them to") both argue that an explicit request should never be silently refused for three days; the safety intent (nothing is pushed at someone in distress) is preserved by holding only what the app would have pushed.
4. Give the Recent overlay a reader and a module (`safety/recent.ts`), and say in §5.5 that the timestamp write is throttled and best effort, so a second device may see Recent late.

### A3. The state table's "Shore ends only through the automatic exit" is false, and "I'm okay" doesn't end it either

- **Severity:** major
- **Sections:** §5.5 (The states), §3.9, §2.2 Law 5, §6.7 (`visit.ts`)
- **Evidence basis:** read the code: `src/store/groundingState.ts:5` (module-level boolean; nothing persists it), `src/components/CrisisResources.tsx:15–19, 116–132` (the "I'm okay" button sets local `dismissed`; there is no `deactivateGrounding` caller anywhere in `src/` outside the store), `src/main.tsx:118–123` (`vite:preloadError` reloads the tab once), `src/utils/lazyWithRetry.ts` (reload on a failed chunk import)

**The problem.** Grounding lives in one tab's memory. It ends when the tab reloads, when the writer opens the page in a new tab, and when the app reloads itself after a deploy (which the repo does deliberately: stale chunk → `reloadOnce`). §5.5 says Shore "ends only through the shared automatic exit, 5 minutes after the last trigger", and defines Quiet as "Shore has ended, and the visit hasn't. A visit ends when Folio reloads". So after any reload during shore the table lands the writer in **Normal** (materials "Full", motion on), not Quiet. The safety law in §2.2 says "motion stops" when distress is detected; a deploy during a crisis turns it back on.

Separately, the existing crisis card's primary button reads "I'm okay" (`crisis.dismiss`). It dismisses the card and changes nothing else. In Sessions that is tolerable because grounding there is mostly a change in the companion's register. In Folio, grounding is the whole page: the writer taps "I'm okay" and the paper stays flat, the shore line stays, and (A4) it may stay for an hour. The button promises an exit the state machine doesn't have. This is the one place where fixed decision 3 ("just as it covers Sessions") produces a problem: the mechanism was built for a conversation, and a writing page has no conversation to absorb the shift.

**Scenario.** A writer in shore reads the card, taps "I'm okay", goes back to writing. Nothing changes. Four minutes later a service-worker update reloads the tab (`skipWaiting` + `clientsClaim` are on). The page returns with full materials and motion, the shore line gone, the card gone, mid-crisis. Neither event matched what the writer was told.

**The fix.**
1. Correct §5.5: "Shore ends through the shared automatic exit (5 minutes after the last trigger), or when the tab reloads or is replaced, because grounding is held in the tab's memory." Then make Folio tolerant of that: on load, if `lastGroundingAt` is within 30 minutes (mirror it to localStorage at activation so the check doesn't wait for Firestore), Folio starts in **Quiet**, not Normal. That keeps motion off through a reload without re-showing the shore line.
2. Decide §11 question 6 now, and decide it yes (see A4): a manual exit that calls `deactivateGrounding()`. Either make the card's "I'm okay" do that in Folio, or relabel it there ("Close") so it doesn't claim to.
3. Note in §5.5 that Shore is per tab, not "any surface in this app": Sessions grounded in tab A does not flatten Folio in tab B; only Recent crosses tabs.

### A4. L1 re-fires on every settle, so a persona poem keeps a writer in shore for as long as they work on it, with no exit

- **Severity:** major
- **Sections:** §5.4 ("When checks run": settle row), §5.5 ("What a false activation costs"), §11 question 6, §8
- **Evidence basis:** read the code: `functions/src/shared/crisisFloor.ts:35–63` (method patterns are first-person and have no fiction, quotation or persona exemption; only negation and distant-past guards), `functions/src/shared/crisisClassifier.ts:140` (L2's rule 11 returns 0 for dark fiction, but L2 never gets a say once L1 has fired), `src/store/groundingState.ts:54–59` (a re-trigger resets the 5-minute timer); the §5.4 table runs L1 "on the unit's full text, immediately" at every settle, with no dedup against the checked set

**The problem.** Folio is a writing tool, so it will be used for poems, fiction and letters in a voice that isn't the writer's. L1 is deliberately blind to that (CLAUDE.md: it is the deterministic floor). The Journal has the same property, but a Journal paragraph is committed and left behind; a poem is edited for an hour. Every two-second pause in a paragraph containing "I want to kill myself" (a line of a persona poem) re-activates grounding and resets the auto-exit. There is no manual exit. The checked set doesn't help: it dedups L2, and L1 runs regardless. §5.5's cost list ("the paper flattens… for 72 hours afterwards, come-backs wait") omits the duration: *for as long as you keep editing that paragraph, plus five minutes*.

**Scenario.** A writer spends forty minutes on a poem in a dead friend's voice that includes the line "some nights I wanted to end my life". Forty minutes of flat paper with a crisis line at the top. Each time they stop to think, the line re-asserts itself. They finish, close the tab, and get a grounded SMS reply that night. They don't open Folio again.

**The fix.**
1. Answer question 6 **yes**: Folio offers a manual exit ("I'm okay" that calls `deactivateGrounding()`), leaving the Recent overlay untouched (the 72-hour hold on unasked slips stays; A2's "Open" in Waiting covers the asked ones). A manual exit is new in the app; say so in §5.5 and give it a component test.
2. State the re-trigger behaviour in §5.5's cost list, so the owner's false-activation tolerance (question 12) is set with it in view.
3. Consider, as a Folio scheduling rule and not a threshold change: the first L1 hit on a unit always activates; the *same check key* (same `pid`, same text) does not re-extend the timer on later settles. The writer has already been brought to shore for those words; re-extending for identical text adds no safety. Any change to the text (new key) re-arms. Flag this as a departure from the Journal and let the owner decide.
4. Add persona/epistolary fiction fixtures to `test:folio-safety` and report L1's false-activation rate separately from L2's; the two have different remedies.

### A5. Apart is a stepped margin with a name; the draft never says what it adds beyond pressing Enter, and D2 would ship it anyway

- **Severity:** major
- **Sections:** §1.3, §3.6, §4.4 D2, §9 E3, Appendix E F1, Appendix H R10
- **Evidence basis:** document only; design reasoning

**The problem.** §1.3's caveat is honest: you could do this with blank lines. The five reasons for Apart in §3.6 (extends the fold, survives without animation, prints, gives play a lever, observable) are true of any layout property. What Apart *uniquely* gives the writer is never stated, and I think it is this: the distance is a **saved, named stance** ("far", "very far") that is announced to a screen reader, written into export ("set far apart"), kept with the trace, and hidden behind the crease when the fold is closed, so a closed fold carries a secret of *how far*. And the between is a passage that cannot exist at "touching": its existence depends on an act of separation. Those are real, but thin. Blank lines are not named, not kept, and not hidden. If the owner can't say more than this, the honest framing is: "Apart is the hypothesis most likely to fail; F is the core." The draft half-says that ("If writers treat it as decoration, that's the result Phase P is designed to detect"), but D2's bar (A1) means Phase P would not detect it.

On the alternatives: keeping Apart in the study over Gemini's R10 is right, and Apart over E3 is right for the stated reasons (E3 adds a second object type and depends on sequence). But the comparison that would actually sharpen the bet is missing: F against A tells you whether distance adds anything; nothing tells you whether the *between* is the operation and the distance merely its precondition. Gemini's point that the distance is "dead whitespace once there's a between" was answered with "that's the material", which is a taste claim, not a test.

**The fix.**
1. In §1.3, state what Apart gives that Enter doesn't (above), in plain words, so the study and the owner judge the same thing.
2. In Phase P, score the between and the distance separately (D2a: wrote a between in something they chose to keep; D2b: set a non-default distance in something they chose to keep and described it as other than spacing). Ship Apart only if D2b passes; ship the between alone (a fixed small gap) if only D2a passes. The schema already allows it (`gap` stays 0; `between?` exists).
3. Give the prototype's A variant a sixth control for the moderator only: a toggle that removes Closer/Farther but keeps the between at a fixed gap. If participants' kept artifacts don't change, the distance is decoration.

### A6. "Meet them again over time" is a side column and a slip; the source visions' time-as-composition is lost, and Session 2 tests reading, not making

- **Severity:** major
- **Sections:** §1.1, §1.2, §3.7 (Add), §3.8, §4.3 (Session 2), §4.4 D5, Appendix D, §2.2 Law 4
- **Evidence basis:** document and source visions (*Below the page*, "A tide through time": "A phrase from last winter can show through a phrase from today, if the writer chooses to overlap them"; "Return": "Later words can sit beside earlier words")

**The problem.** The one-sentence proposition promises three acts: compose, keep, *meet again*. The third is implemented as reading a slip and writing in a column beside a read-only snapshot. That is exactly the annotation shape Codex warned against, moved to the floor. The strongest idea in both source visions, that time can be a *compositional* material (an old phrase placed under a new one, a sentence showing through), survives only as "Add" and "Go to the page". Session 2 of the study therefore tests how it feels to re-read a kept thing in a lab, which is a different hypothesis from whether anyone would compose with it. D5 ("Come back is built as specified") would pass without the writer ever *making* anything with time.

**The fix.**
1. Add one authored time operation to Phase 2 that reuses the fold: from a trace, **Lift into today's page**: the trace's lifted line (or its beneath) becomes the lifted line of a new fold on today's page, carrying its date, and the writer writes beneath it today. Same schema (a fold whose `surfaceSnapshot` carries a date and a `traceId`), same C1, same checks. It makes Law 4 ("new words go beside old ones") a composition rather than a column.
2. Test it in Session 2 with the F/A prototype: after the silent minutes (A1), offer "Put the line you kept into today's page" and observe whether anyone writes beneath their own two-week-old words. Count that for D5.
3. Record in Appendix D that "A tide through time" (overlap) was kept only as Add, and why.

### A7. The study handles real personal writing with no consent, retention or deletion rule

- **Severity:** major
- **Sections:** §4.2 (Safety in the study), §4.3 (Unprompted, Choosing, Session 2), §4.4 (Coding), §8
- **Evidence basis:** document only

**The problem.** The unprompted segment says "Write about anything from this week." That is real personal writing, stored unencrypted in a static page's localStorage on the moderator's laptop or phone for two weeks (the return depends on it), then read by two coders from transcripts. §4.2's "No production data is involved" is true and beside the point. Nothing says participants are told their writing will be kept, read and coded; nothing says when it is deleted; nothing stops the moderator from reading the unprompted page before the interview. "Nobody is asked to disclose anything difficult" is not enforced by the prompt.

**The fix.** A one-page consent sheet (what is kept, who reads it, deletion within 30 days of the report, the right to use invented material); the unprompted prompt becomes "Write about something ordinary from this week, or make something up"; the moderator reads nothing until the participant has described it; the study plan (`folio-study-1-plan.md`) names a deletion date. If participants take the prototype home (A10, question 5), the sheet covers that too.

### A8. "Bring what you just wrote" has no defined content for a window, a composition or a late check, and the sections disagree about where the tap lives

- **Severity:** major
- **Sections:** §1.4 (A hard night), §3.2, §3.9, §3.12 (`folio.shore.bring`), §6.3 (`goToSessions(handoff)`), Appendix B (SessionView row), §10 (last row)
- **Evidence basis:** document only; `src/components/CrisisResources.tsx` and `src/App.tsx:375–389` for what exists

**The problem.** Three descriptions, three flows. §3.9: *Talk now* opens a Session, and "the Session offers Bring what you just wrote; tapping it puts the paragraph that triggered shore into the composer". §3.12 puts the string under `folio.*`, which is Folio's copy. §6.3: `goToSessions(handoff)` leaves text in a one-time `sessionStorage` key "which the Talk composer reads once", so the text lands on arrival; the only tap would then be *Talk now* itself, which contradicts §3.2's "only when the writer taps it". Appendix B's SessionView row only says the composer reads the key.

"The paragraph that triggered shore" is also undefined for the cases §5.4 introduces: an L2 result applies to a 1,000-character reading-order window (several paragraphs), a composition (line + between + beneath) may carry risk only together, and a late check may have fired on text from weeks ago while the writer was writing something unrelated. In the last case "what you just wrote" is a mislabel, and bringing an old paragraph into Talk without the writer seeing it first is the memory boundary crossed by surprise.

**The fix.**
1. Put the choice in Folio, before leaving: the shore line offers **Talk now** and **Talk now, bringing this** (the second only when there is something to bring). Tapping the second shows the text that will be brought, in Folio, with Go / Not this. Only then is the handoff key written.
2. Define "this": the unit (paragraph) whose check produced the activation, plus its lifted line when it is an underside unit; never the full window. For an L1 hit, the unit that matched. For a late check (A2) or a Sessions-triggered grounding visible in Folio, offer nothing to bring.
3. Make §3.9, §3.12, §6.3 and Appendix B say the same thing, and move the string to the shore line's own section of the copy table.

### A9. Phases 1 and 2 carry work that no writer needs before Phase 3

- **Severity:** major
- **Sections:** §7 (Phase 1 task 9, Phase 2), §6.9, §5.2 (Two tabs: Handover), §3.7 (Make a corrected copy)
- **Evidence basis:** document only

**The problem.** The draft asks which guarantee could wait and answers that every one protects words or safety. Three items don't:
- **Translation into 16 locales in Phase 1** (§6.9, Phase 1 task 9), for a phase that opens Folio to admins only. `untranslated.test.ts` forces it, but a Folio allowlist in the test costs an hour. Phase 3 feedback will change copy, and the translations get redone.
- **Corrected copies** (`correctedFromId`, "Earlier wording", "Versions and corrected copies sit together") in Phase 2. Codex's F5 asked for a correction path so Keep isn't testimony; **Undo for 10 seconds + delete + keep again from the page** is a correction path. The versioned-copy machinery exists for the case where the page has since changed. That case can wait for evidence from Phase 3 that anyone wanted it.
- **Two-tab handover ("Edit here")** in Phase 1. Correctness comes from compare-and-swap and separate pending entries (§5.2 says so). A read-only second tab with "This page is open in another tab" is enough for admins; the handover protocol is a Phase 3 nicety.

Phase 1 also commits to Reading view, export, 17-locale policy copy and a browser test harness; those protect data duties and should stay.

**The fix.** Move translation and the policy's 16 other locales to Phase 3's build (its "2 days" becomes 3–4; the gate "before Folio opens beyond admins" in §5.6 already says this), with a Folio allowlist in `untranslated.test.ts` until then. Move corrected copies to a Phase 2b or §9. Ship the second tab read-only in Phase 1. Roughly three to four days come off Phases 1–2, and nothing a writer was promised changes.

### A10. The study's design undermines its own coding: one seed paragraph three times, coders who can't be blind, and a return on the moderator's device

- **Severity:** major
- **Sections:** §4.3 (Participants, Directed, Session 2), §4.4 (Coding)
- **Evidence basis:** document only

**The problem.**
- **Same seed, three times.** Each participant works the same dinner paragraph in N, F and A. By the third variant they have already written a beneath for it once or twice. "The coders can't tell it apart from what that participant made in N" is then nearly guaranteed, not because the fold adds nothing but because the participant is repeating themselves. The criterion for "the same as a note" measures fatigue.
- **Blindness.** "They work blind to the variant wherever the material allows." Transcripts in A will say Closer, Farther, between; in F lift, beneath; in N note. Blinding is impossible for A and unlikely for F. Say so and drop the claim.
- **Latin square.** Three orders (ABC, BCA, CAB) balance first-order position but not carryover direction. With nine people that is the best available; the limit should be written down.
- **The return is staged.** The prototype's storage is the moderator's device, so the two-week "return" is a lab visit, not a return in life. D5 is labelled "Return" and its pass condition is "Come back is built as specified", but what is measured is the experience of re-reading in front of a moderator.

**The fix.** Three seed paragraphs of equal weight, counterbalanced with the variants (a Graeco-Latin square gives nine cells for nine people). State which codes are note-like (A1). Drop the blindness claim and have the coders code the *relationship* from the participant's words, not the artifact's features. For the return, offer participants the prototype on their own phone (a static page; consent per A7) and count a real return for D5; if the owner declines, rename D5 "Re-encounter" and narrow its consequence to "the slip and Add are built as specified; automatic resurfacing stays out".

### A11. Accessibility as lived: the crease fails its own contrast target, status announcements will chatter, and no assistive-technology user is committed to the study

- **Severity:** minor (the contrast figure is a fact; the rest are experience risks)
- **Sections:** §3.10, §3.11 (Tokens), §7 Phase 1 acceptance, §8
- **Evidence basis:** ran `scratchpad/fable/art/contrast.mjs` (WCAG 2.x relative luminance) on the §3.11 tokens; document for the rest

**The problem.**
- **Crease contrast.** `--folio-crease #B9853F` on `--folio-paper #F7F3EC` is **2.93:1**, and on the composited underside paper **2.75:1**. §3.10 requires 3:1 for the crease glyph. Dark mode passes (8.0:1 and 6.5:1). The other light tokens pass: control 4.97:1 on paper and 4.67:1 on the underside, ink 12.8:1 on the underside. §3.11 says contrast is measured in Phase 1; the starting value already fails, so the amber will have to darken (`#A8763A` reaches 3.6:1 on paper and 3.4:1 on the underside) and the thin-film colour that "shows only while a fold is opening" should not be the only cue.
- **Status chatter.** §3.10 announces "changes of save status, only when the status changes". With a 1.2-second debounce, continuous typing flips Saved → Saved on this device → Saved every couple of seconds. A screen-reader user writing a paragraph hears the status more than their own words.
- **Discovery while reading.** Closed undersides are out of the accessibility tree and the lifted line is "described as 'has writing beneath it, closed'", but no mechanism is named. Inside a `contenteditable`, VoiceOver reading by line does not read `aria-description` on inner spans; the crease widget, if a pseudo-element, is silent. The honest statement is: a blind writer finds folds with `Mod+Alt+J/K`, not by reading. Voice Control users need a speakable name on the crease ("Open writing beneath") or they are reduced to "Show numbers".
- **"Without sighted help"** in Phase 1 acceptance will in practice be a sighted developer with VoiceOver on. §8 asks whether AT participants completed what they wanted, but recruitment of any AT user isn't committed.
- The 600 ms fence and K1 are fine for switch and dwell users; worth a sentence in §3.10 since switch scanning relies on key repeat.

**The fix.** Darken the crease or add a second cue; announce only degradations ("Not saved yet…", "Couldn't save…") and a single "Saved" after five quiet seconds; write the J/K discovery path plainly in §3.10; give the crease widget an accessible name; commit to at least two assistive-technology users among Phase 3's six to eight.

### A12. Honesty nits in the copy and the copy test

- **Severity:** minor
- **Sections:** §2.3, §3.7 (The promise), §3.12, §5.4 (Short text), §5.6 (Policy), onboarding copy (`en.ts:24`)
- **Evidence basis:** document; `src/i18n/translations/en.ts:24, 208–222`; `src/engine/partOrchestrator.ts:202`

- **"Everything you write here is checked for safety by an AI service… as you go."** Samples under 20 characters never go to the AI (L1 only), offline nothing goes until later, and a late check isn't "as you go". Suggested: "What you write here is checked for safety, including by an AI service, in short pieces, usually as you go." §2.3's "Everything written goes to an AI service" has the same gap.
- **The banned-words test** as described is a substring match. "private" matches "Privacy Policy" (the first-visit line links to it); "hidden" would match "unhidden". Use word boundaries and an allowlist. Add "nobody", "no one", "safe", "always", "never" (as in "never changes"; see next item) to the review list, even if only as warnings.
- **"Kept words are a dated snapshot. Folio never changes them."** is called the app's own words (§3.7) but has no `folio.*` key, so the copy test never sees it. Give it a key. "Never changes" is true of the app; a corrected copy and deletion still exist, which the sentence doesn't deny. Fine, once it's testable.
- **Policy.** `policy.devicePreferencesBody` says drafts are the only writing kept on the device and "None of this leaves your browser." Folio adds pending saves and view state to the device; the same words also go to Firestore by a different path. Add Folio's device store to that paragraph, not only to `whatWeStoreBody` and `howAiWorksBody`. Add the second crossing (A2) to `howAiWorksBody`.
- **Onboarding** step 1 ("UnderSurface opens into a private reflection session") becomes untrue for a writer whose `lastHome` is Folio. Phase 3 item.
- **"The companion doesn't read them"** is true as to text and I'd keep it; it is the second sentence of the first-visit line that carries the honesty, and A2's crossing belongs in the policy, not the line.

### A13. Coherence: places where sections disagree or a number doesn't match

- **Severity:** minor
- **Evidence basis:** document; code where cited

| Where | Issue | Fix |
|---|---|---|
| §3.6 linear form | The diagram says "none, 1, 2, 4 or 8 blank lines, by stop"; the rule below says each *half* is 1, 2, 4, 8 and "with an empty between, the two halves join", which gives 2, 4, 8, 16 for an empty between and 1+n+1 … for a full one. On screen the totals are 1, 3, 7, 15. Correction 9 of §0.3 didn't finish the job. | Pick one derivation and print one table: stop → on-screen total → linear blank lines (empty between) → linear blank lines each side (with between). |
| §5.5 Keep row vs §5.4 Traces too | §5.5: Keep in Shore is "Available (L1 and L2 run on the new text)". §5.4: on Keep the text is recorded as checked *without* a run when its page paragraphs are already in the checked set. | §5.5: "Available; the kept text is checked unless its page paragraphs already were." |
| §3.9 Find help vs `CrisisResources.tsx` | "Shows the crisis resources card again, even if it was dismissed." The component's `dismissed` is local state with no reset; it only resets when `visible` goes false. Making Find help re-show it needs a `key` or reset prop on `CrisisResources`, which is a change outside `src/folio/` missing from Appendix B. | Add the row to Appendix B. |
| §5.5 Shore definition | "The shared global state, set by either layer on any surface in this app" is per tab (A3). | Say "in this tab". |
| §5.6 Grounding timestamp row | "On activation" is throttled to one write per 30 s and best effort (`groundingPersistence.ts:17–23, 33–36`); offline it isn't written until a later activation. Recent on another device can lag or miss. | Note it, and mirror to localStorage for the same-device case (A3). |
| §1.4 "A few seconds later the paper goes flat" | Settle is 2 s, calls are 6 s apart, the timeout is 5 s, and a backlog drains slowly. Tens of seconds is realistic; minutes with a long paste. | "Soon after", or state the range in §5.4 and let §1.4 say "a little later". |
| §4.4 D2 | "Of the participants who used A" is all nine. | "of 9". |
| §0.3 correction 3 | "It's the Journal's 20 characters" is loose: the Journal's floor (`partOrchestrator.ts:202`) returns before L1 as well, so under 20 characters the Journal runs nothing. Folio runs L1 regardless, which is stricter. | Say "stricter than the Journal". |
| §4.2 "No production data is involved" | True, but participant data is (A7). | Replace with the consent and deletion rule. |
| §3.2 "the only crossing" | Incomplete (A2). | As A2. |

---

## 3. What must not change

1. **Equal standing, and the app never interprets.** Law 2 and §3.6's "whatever the writer means by it" are the whole difference between this and a mood tool. Any redesign that lets the distance or the beneath mean something to the system reintroduces the clipboard.
2. **Closing never edits; hidden writing is never changed while hidden.** The C1 principle (not its mechanics, which the other reviewer covers) is what makes a fold trustworthy enough to put something real in it.
3. **Keep is a snapshot with a 10-second undo and deletion always available, and no copy says permanent.** Codex's F5 resolution is right; don't let correction machinery (A9) grow back into identity machinery.
4. **A disposable prototype study with a numeric stop before the production editor.** Even with A1's rewrite, the order (P → 0 → decision → 1) is the best thing in the plan.
5. **No notifications, no analytics, codes-only telemetry, and the calibration unchanged.** Law 6 and C6 are what let the honesty copy be honest.

---

## 4. Follow-through check

| Item | Verdict | Reason |
|---|---|---|
| 3.1 #1: only orphaned entries resolved, by the lock holder | sound (reading only) | Engineering reviewer's depth; the writer-facing consequence (no false conflict copy of a live tab) follows. |
| 3.1 #2: nothing sent before server-confirmed state | sound (reading only) | Same; the status "Saved on this device" while waiting is honest. |
| 3.1 #3: L2 floor on the sample, at 20 characters | sound, loosely worded | Correct change; "the Journal's floor" gates L1 too in the Journal (`partOrchestrator.ts:202`), so Folio is stricter, not matching. Say so (A13). |
| 3.1 #4: `pid` in the check key | sound | Repeated refrains in darker places are exactly the case; the cost (every paste re-checks) is acceptable and bounded by the rate. |
| 3.1 #5: traces carry a checked set | sound | Closes a real hole; A2's late-check rule must apply to trace sweeps too. |
| 3.1 #6: 12,000-key backstop behind the size guard | sound | 12,000 × ~100 bytes > 900 KB, so the guard trips first as claimed. |
| 3.1 #7: a selection can't rest inside a closed underside | sound (reading only) | Engineering reviewer's depth. |
| 3.1 #8: D4 can only lower D1 | weak | The interaction is stated but not justified: 9 of 9 making relationships plus 6 of 9 preferring N for "anything from this week" yields a redesign. N may be chosen because free writing about a week doesn't call for folds, not because the fold isn't wanted. Make D4 lower D1 only when D3 also fails (nobody lifted unprompted in F/A). |
| 3.1 #9: linear blank lines derived from stops | weak | The two sets of numbers still don't agree (A13, first row). |
| E F1: one authored operation (Apart) | weak | The operation is specified; what it adds beyond blank lines is not (A5), and its test can't fail it (A1). |
| E F2: test the premise first | sound | Right order; the study's rules need A1/A10. |
| E F3: time in the core; Return separate from Overnight | weak | Come back is deterministic and the writer's, which is right; but "meet again" is a column and a slip, and Session 2 doesn't test making with time (A6). |
| E F4: originality defined positively | sound | §2.1 is the right criterion; §1.3's caveat is honest. |
| E F5: history without testimony | sound | Undo + corrected copy + deletion; corrected copies can wait (A9) without weakening it. |
| E F9: cost of a false shore as an open question | weak | The observable list omits duration under re-trigger (A4), the 72-hour reach into SMS/Sessions (A2), and the table's own exit claim is wrong (A3). |
| E F10: the editor is the authoring path | sound, under-specified | Right decision; the discovery mechanism for screen readers is unnamed and no AT user is committed (A11). |
| E F11: delight as an interaction | sound, thin | Absurd distances and long beneaths are the writer's; honest that the app adds nothing. The source visions had more (the spoon), and the draft is right to leave it out. |
| H R8: coverage defined by content | sound | The checked set is the right model; A2 only changes what a late result *does*. |
| H R9: line, between and beneath read together | sound | Reading-order windows restore the Journal's context and answer R9. |
| H R10 rejected: keep Apart in Phase P | sound in conclusion, weak in consequence | Keeping A in the study is right; D2 as written can't fail it (A1, A5). |
| H R11: pre-registered thresholds and copy | weak | Only D1 gained a stop; D5 and D6 can't fail (A1). The first-visit line is better but still overstates "everything… by an AI service… as you go" (A12). |
| H consistency: undo/IME belong to C1, not §5.5 | sound | They don't interact with Shore/Quiet/Recent. |
| H Gemini Q3: the honest one-sentence privacy promise | sound with a gap | The first-visit line is honest about text; the policy must carry the grounding-timestamp crossing (A2). |
| H Gemini Q4: what would make you abandon the beneath | weak | D1–D4 answer it for the fold's *use*; nothing in Phase P can stop on *harm* (D6, A1). |

---

## 5. Questions for the owner

1. **Manual exit from shore in Folio (§11 q6).** Recommended: **yes**, calling `deactivateGrounding()`, leaving the 72-hour Recent overlay as it is, with "Open" available on held traces. Folio has no conversation to absorb a register change; the flat page *is* the intervention, and a writer who says "I'm okay" must be believed about the page even if the SMS channel stays cautious.
2. **Late checks (§11 q15).** Recommended: check and record always; activate shore only when the page was edited within 72 hours; otherwise show the resources card quietly and don't stamp `lastGroundingAt`. The 30-day limit in the question is an alternative but still lets a month-old paragraph change the SMS channel.
3. **Should a Folio activation reach SMS and Sessions for 72 hours?** Recommended: yes for recent text (safety is one stack), but name it in §3.2 and the policy, and exempt late checks on old text.
4. **Who are the nine?** Recommended: people who already write for themselves (notes, a diary, poems) at least weekly; the premise is about writers, and a general sample tests something else. For Phase 3, at least two assistive-technology users.
5. **Do participants take the prototype home for the two weeks?** Recommended: yes, as a static page on their own phone with the consent sheet from A7, so D5 measures a return rather than a lab visit. If no, rename D5 and narrow its consequence (A10).
6. **Defer translation to Phase 3, corrected copies to after Phase 3, and ship the second tab read-only?** Recommended: yes to all three (A9).
7. **May held come-backs be opened from Kept during Recent?** Recommended: yes; hold only the unasked slip (A2).
8. **Where does "Bring what you just wrote" live?** Recommended: in Folio's shore line, as a second door that shows the text before leaving, and never after a late check (A8).
9. **Is the distance or the between the operation?** Recommended: pre-register them separately (D2a/D2b, A5) so Phase P can ship the between without the distance.
10. **Lift into today's page from a trace (A6).** Recommended: add it to Phase 2 as the one authored time operation, and test the gesture in Session 2.

---

## 6. Limits of this review

- No prototype or editor exists; everything about the lived experience of shore, folds and the study is reasoning from the document and the current code, not observation.
- I did not run the ProseMirror or Firestore reproductions and did not audit C1/C2/C4 mechanics; where I touch them (A2, A4) it is only for what a writer would see.
- Contrast figures are computed from the hex tokens, not rendered pixels, and ignore the thin-film colour and anti-aliasing; the draft's own method (axe plus manual) is the authority. The 2.93:1 result is close enough to the line that rendering could move it either way.
- No live classifier eval was run; claims about L1 behaviour are from reading `crisisFloor.ts`, and claims about L2's fiction handling are from the prompt text, not from results.
- I checked only the English copy and policy; the 16 other locales were not read.
- No network calls were made and nothing in the repository, its git state or any service was changed.

---

# Part 2: the engineering contracts and the technical design


**Reviewed:** `docs/vision/2026-10-15-folio-v3.md` at `ef1530e` (draft 3.1), against the working tree, which is byte-identical to `35f8297` outside `docs/` (`git diff 35f8297 --stat -- . ':!docs'` is empty), and against the installed packages: prosemirror-model 1.25.4, -state 1.4.4, -view 1.41.6, -transform 1.11.0, -history 1.5.0, -commands 1.7.1, -gapcursor 1.4.0; @tiptap/* 3.23.1; firebase 12.13.0 (@firebase/firestore 4.14.1); @firebase/rules-unit-testing 5.0.0; firebase-tools 15.17.0; jsdom 29.1.1.

**What I ran** (all under `scratchpad/fable/eng/`, logs beside the scripts):
- `repro-eng-state.cjs` → `repro-eng-state.log`: state-level ProseMirror checks with the full §6.5 schema (`underside = between? beneath`, isolating + defining).
- `repro-eng-view.cjs` → `repro-eng-view.log`: `EditorView` under jsdom: a node view with no `contentDOM`, position mapping inside it, the native `cut` event, a DOM mutation that removes the placeholder.
- `emu/probe-eng.cjs` with `emu/folio-eng.rules` (the §6.6 rules verbatim, including the 3.1 `safety.checked` clauses) on the Firestore emulator, project `demo-folio-fable`, port 8094 → `emu/probe-eng.log`. 31 checks, all passed; several of them pass by *confirming a hazard*.

Lens: engineering contracts and technical design only. The art, the study design and copy honesty are another reviewer's.

---

## 1. Verdict

Phase 0 can start on this design. The spikes are the right spikes, the reproductions in Appendices G and I are honest and reproduce, and the four-layer structure of C1 and the compare-and-swap chain of C2 are the right shapes. Two things must change before Phase 1 is planned on top of them. First, C2's rejection classification (§5.2) has a hole that the installed SDK makes real: the Firestore Web SDK re-sends every in-flight write after a stream drop without a resumption token, so a write that *did* commit comes back `permission-denied` with the server holding that write's own `revId`, and the table calls that a conflict and makes a copy of the writer's own words; the same chain also produces one rejection event per queued write, so one conflict would make several copies. Second, C1's table is missing four paths that reach hidden or equal-standing writing in one press or one menu action (native Cut, Backspace in an empty paragraph after a closed fold, selecting the `between`/`beneath` nodes, and programmatic loads tripping the safety net). Beyond those, Folio's L2 traffic shares the chat function's single 30-a-minute all-task limiter with Sessions' own safety backstop, and the Phase 0/1 estimates are roughly 40–60% low for what §6 and §7 actually specify.

---

## 2. Findings

### B1. A committed write that is re-sent is classified as a conflict, and a conflict copy of the writer's own words is made

- **Severity:** major (blocks Phase 1; not Phase 0, where S4 should add it as an outcome)
- **Sections:** §5.2 (rejection classification table, "The model"), §6.6 (save controller step 4–5), §10 ("A false conflict copy… Low")
- **Evidence basis:** read the SDK and ran the emulator.
  - `node_modules/@firebase/firestore/dist/common-b12d6a5a.node.mjs` (4.14.1): `PersistentWriteStream.start()` resets `this.lastStreamToken = undefined` (`:24984`); `writeHandshake()` carries the comment `// TODO(dimond): Support stream resumption. We intentionally do not set the stream token on the handshake, ignoring any stream token we might have.` (`:25015–25021`); `onWriteHandshakeComplete` re-sends **every** batch in `writePipeline` (`:25924–25930`); `onWriteStreamClose` fails a batch only for a *permanent* error, otherwise the stream restarts and the pipeline is re-sent (`:25939–25950`); up to `MAX_PENDING_WRITES = 10` batches are in flight (`:25380`).
  - `emu/probe-eng.cjs` R3: `PASS R3 first send of r2 accepted` · `PASS R3 resend of the identical r2 write rejected` (`permission-denied`) · `PASS R3 server revId equals the rejected write's own revId (not its parent)` · `PASS R3 §5.2 row 2 would classify this as a conflict`.
- **Failure scenario:** The writer types online. The controller sends r2 (parent r1). Firestore commits r2; the write stream drops before the `WriteResponse` arrives (a Wi-Fi/cellular handoff, a laptop lid, a proxy reset). The SDK restarts the stream and re-sends r2. The rules reject it (`parentRevId r1 != resource.revId r2`). The promise rejects with `permission-denied`. The controller reads the server: `revId` is r2, which "differs from the rejected write's parent" → row 2 → a conflict copy "‹first line› (this device, …)" is created and a notice says another device changed the page. No other device exists; the content on the server is exactly what the writer typed. Worse after an offline period: with k of n queued batches committed before a drop, the k re-sends are rejected, batches k+1…n are *accepted* (their parents now match), and the controller sees k rejection events while the server already holds the latest content. Guarantee 4 ("Saved means the server has acknowledged exactly the words on screen") is also broken: the controller never receives the acknowledgement for r2 and would show "Saved on this device" or the conflict state for content that is on the server. The production backend may or may not deduplicate on its side; the SDK sends no token, so Folio cannot rely on it, and the emulator does not.
- **The fix:**
  1. The controller keeps the editor's **whole chain**: every `revId` it has sent since its base, acknowledged or not (`sentRevIds`), not just `pendingRevIds`.
  2. Add a first row to the classification table: **server `revId` ∈ `sentRevIds`** → "our write landed; the acknowledgement was lost". Treat every revision up to and including it as acknowledged (clear or trim the pending entry), and continue the chain from the server's `revId`; if the editor's current content is newer, send it as a new revision with parent = server `revId`. Never a copy.
  3. Only then apply today's rows (gone → remote delete; outside the chain → conflict; equals the rejected parent → not a conflict).
  4. S4 gains **outcome 12**: a committed write re-sent (deterministic version: `setDoc` of the identical revision twice, as R3 does; browser version: cut the network between send and acknowledgement).
  5. Keep the §10 row but change its likelihood to "medium" and its mitigation to this row; "nothing is sent before confirmation" (3.1 #2) covers the on-load case only and does not touch this one.

### B2. One conflict produces one rejection event per queued write; the design makes a copy per event

- **Severity:** major
- **Sections:** §5.2 ("A rejection is classified before anything else happens", "A conflict"), §6.6 (save controller step 5)
- **Evidence basis:** ran `emu/probe-eng.cjs` R4: three writes queued offline behind a remote write → `PASS R4 three rejection events for one conflict` (`['rejected:permission-denied' ×3]`), `PASS R4 server at r9`. Appendix I's own check 2 shows two.
- **Failure scenario:** Offline, the writer makes three saves (r2→r3→r4). Another device writes r9. On reconnect, three promises reject in order. The controller "stops writing, keeps the editor content and reads the page" **three times**; each read finds r9, each is "a real conflict", each creates a page "(this device, 15 Oct 14:02)". Three identical conflict copies and three notices for one event. The copies are made "from its pending entry", so they are identical, not successive.
- **The fix:** Classification is per **chain**, not per rejection: the first rejection whose parent is in the editor's chain resolves the chain (copy, remote-delete prompt, or "not a conflict"); every later rejection whose `revId`/parent is in the same already-resolved chain is logged and ignored. Equivalent: resolve on the rejection of the chain's **head** only, after waiting for the SDK to drain (no `hasPendingWrites` for the page). Add the N-rejection case to S4 outcome 2 and to the controller's unit tests ("exactly one copy per conflict").

### B3. Native Cut (Edit menu, context menu, `Shift+Delete`) bypasses layer 2 and deletes the closed underside through ProseMirror's own handler

- **Severity:** major (a named row of C1's table is delivered by the last-resort layer, not by the layer the design assigns it to)
- **Sections:** §5.1 (table rows "Cut" and "Delete… over a spanning selection"; layer 2), §6.5 ("Commands", "Clipboard")
- **Evidence basis:** read `prosemirror-view/dist/index.js:3619–3638` (1.41.6): `handlers.copy = editHandlers.cut = …; if (cut) view.dispatch(view.state.tr.deleteSelection()…setMeta("uiEvent","cut"))`. The `cut` DOM event never consults `handleKeyDown` or `handleTextInput`; `transformCopied` shapes only what goes to the clipboard. Ran `repro-eng-view.cjs` B5: with a spanning selection, `handleKeyDown` returning false and `transformCopied` dropping closed undersides, dispatching a native `cut` event gives `underside before = true | after = false`. B5b: a `handleDOMEvents.cut` handler runs first and `underside survives = true`.
- **Failure scenario:** The writer selects from the paragraph before a closed fold to the paragraph after it and chooses Edit → Cut (or right-click → Cut, or `Shift+Delete` on Windows). The clipboard holds the visible text (correct). ProseMirror deletes the whole selection, including the closed underside, in a transaction tagged `uiEvent: cut` and **not** `folio:visibleEdit`. Layer 4 then restores it, logs `folio.hidden.restored`, and the restore is appended to the cut transaction. The writer's words survive, but: (a) the design's own diagnostic for "should never fire" fires on an ordinary menu action, so it can't be used as a production tripwire; (b) the "kept, opened, fenced, notice" behaviour of the Delete row is not produced (layer 4 only restores).
- **The fix:** Layer 2 gains `handleDOMEvents.cut` (and `copy`, so the two paths share the serializer) that preempts ProseMirror's handler: serialize the visible slice to `event.clipboardData`, `preventDefault`, then run `visibleDelete` with the `folio:visibleEdit` tag and the protection notice. Add "Cut from the Edit menu / context menu" to C1's table as its own row and to S1's cases; add it to the layer-2 unit tests (a synthetic `cut` event, as B5 does).

### B4. Backspace in an empty paragraph after a closed fold deletes the paragraph **and** moves the caret inside the hidden beneath in one press; the next character is typed into hidden writing

- **Severity:** major
- **Sections:** §5.1 (row "Backspace or Delete at the edge of an underside"; layer 1's 3.1 selection remap), §6.5 S1 case 5
- **Evidence basis:** ran `repro-eng-state.cjs` A3 (plain `baseKeymap['Backspace']`, prosemirror-commands 1.7.1 `joinBackward`'s empty-textblock branch): `doc = paragraph("Before.") paragraph(lifted) underside | selection = TextSelection(71) | caret now INSIDE the underside: true` · `A3 next typed character landed inside the underside: true`. `repro-eng-view.cjs` B3 shows what the view does with such a selection: `view.domAtPos` returns `{node: DIV.closed-underside, offset: 0}`, the dispatch does not throw, the DOM selection is anchored in the `contenteditable="false"` placeholder, and an inserted character is `in the hidden beneath: true | visible in DOM: false`.
- **Failure scenario:** The writer closes a fold, presses Enter below it, changes their mind and presses Backspace on the empty paragraph. One press: the empty paragraph is removed (a legitimate visible edit) and the caret is placed at the end of the closed beneath's last paragraph. They keep typing. Nothing appears on screen; every character goes into hidden writing. This is the first press, so K1 (`event.repeat`) does not apply, and it is a visible edit, so layer 4 sees a transaction that does not change closed content and stays silent. Only the 3.1 selection remap (layer 1) stands between the writer and silent hidden typing, and the table's row ("the first press selects the underside") does not describe this press.
- **The fix:** (1) The remap of 3.1 #7 must be a **plugin `appendTransaction` on every transaction whose selection ends inside a closed underside** (not a view-side correction), so it is applied atomically before the next keystroke can be read; the remapped target for this case is the NodeSelection of the underside (consistent with the row). (2) Add the row "Backspace or Delete in an empty paragraph next to a closed underside: the paragraph is removed and the underside is node-selected; the caret never enters it". (3) Add it to S1 case 5 and to the K-rule unit tests, with the assertion that a character typed after the press is **not** in any closed underside. (4) Audit the other `prosemirror-commands` branches that move a cursor across a cut (`joinForward`'s mirror case for an empty paragraph *before* a closed underside with Delete; `selectNodeBackward/Forward`) with the same assertion.

### B5. Programmatic document loads (hydrating a pending entry, adopting a remote revision, `setContent`) trip the safety net, which resurrects deleted closed undersides and writes a spurious revision

- **Severity:** major
- **Sections:** §5.1 (layer 4; I6), §5.2 ("On load… adopts the newest orphaned entry"), §6.6 ("The snapshot listener… never loads remote content over local edits")
- **Evidence basis:** reasoning from the design's own definition: layer 4 "compares the closed undersides before and after every transaction that changes the document" and restores unless the transaction is tagged `folio:visibleEdit`; `repro-eng-view.cjs` B6 confirms the mechanism restores whenever a closed underside is missing afterwards (`doc equals original = true`).
- **Failure scenario:** Device A edits a page, deletes a lifted line's underside with **Remove**, saves r7. Device B has the page open read-only with fold f3 closed in its view state, no local edits. The snapshot listener delivers r7 and the editor loads it (`setContent` or a full `replaceWith` transaction). The closed set still contains f3; after the transaction f3's underside is gone; the transaction carries no `folio:visibleEdit`; the net restores f3 "loose and open", logs `folio.hidden.restored`, and the editor now holds content the server does not have. If B then takes the lock and saves, r8 (parent r7) re-creates the removed underside on the server, silently undoing A's deliberate Remove, which is a C2 guarantee-1 violation by the safety machinery itself. The same happens on hydrating an adopted pending entry whose content predates the view state.
- **The fix:** Define a second exemption tag, `folio:load`, for every programmatic replacement of the document (hydrate, adopt, remote adoption, conflict resolution, `setContent`), applied with `addToHistory: false`; on a load, the `foldView` plugin **re-derives its closed set** from the new document (drop ids that no longer exist) in the same transaction, so I6's comparison starts from the loaded state. Write it into I6 ("a closed underside's content changes only through `folio:visibleEdit` or `folio:load`"). Unit test: a remote load that removes a closed underside does not fire the net and does not re-create it.

### B6. Folio's L2 traffic (10 a minute) shares the chat function's single per-user, all-task limiter with Sessions' own safety backstop

- **Severity:** major (a background Folio tab can make Talk's independent L2 check fail open)
- **Sections:** §5.4 ("Rate"), Appendix F.7, §6.11 (offline retries)
- **Evidence basis:** read `functions/src/chat.ts:182` (`makeRateLimiter({ windowMs: 60_000, max: 30 })`), `:287–290` (a tripped limit returns `429` with a generic body for **every** task, including `crisis_check` and the therapist turn), and `functions/src/shared/rateLimit.ts` (in-memory, per instance). `src/ai/openrouter.ts` `classifyCrisisRisk` returns `{ risk: 0 }` on `!response.ok` (Appendix F.1), so a 429 on Talk's standalone L2 race is a fail-open for that turn.
- **Failure scenario:** The writer has Folio open in one tab and pastes a long document (or opens a never-checked page on a new device): the sweep runs at the design's ceiling, 10 calls a minute, for several minutes. In another tab they send a message in Talk. The therapist turn (1), its standalone `crisis_check` race (1), `signal_check` (1), plus autocorrect on each finished sentence (up to ~10) and the Folio sweep (10) approach 30. When the limiter trips, the therapist stream gets 429 (the message fails) or the standalone `crisis_check` gets 429 and fails open, removing Sessions' backstop for that turn. Folio's own checks become "unavailable" and back off correctly, but Folio has degraded Sessions' safety, which violates §6.1's "No change in Sessions behavior".
- **The fix:** Server side (cheap and the right place): give the pinned classifier routes their own limiter (`makeRateLimiter` keyed by `uid` for `crisis_check`/`signal_check`, e.g. 20/min) so classifier traffic can never consume the therapist budget, and return a machine-readable code (`rate_limited`) so `checkCrisisRisk` can record `cause: 'rate_limited'` and back off longer. Client side: lower Folio's ceiling to **6 a minute (10 s apart)** for sweeps and pastes, keeping 10 a minute only for settles while the writer is typing (which cannot exceed one unit per 2 s anyway). Add a functions test for the separate limiter and a Folio scheduler test for the 429 path.

### B7. The `between` and `beneath` nodes are selectable as nodes; held Backspace at the start of the beneath deletes the whole between in two presses

- **Severity:** major (the R1 hazard, on a passage the design calls equal in standing, inside an open fold)
- **Sections:** §5.1 (K1, K2 name "an underside" only), §3.6, §6.5 schema
- **Evidence basis:** ran `repro-eng-state.cjs` A4a/A4b with plain `baseKeymap['Backspace']`: at the start of the beneath's first paragraph when a between exists, `handled = true | sel = NodeSelection(between)`; the same from an empty beneath paragraph. A second press (`deleteSelection`) removes the selected node; the underside's content expression `between? beneath` permits it. The same chain applies to `Delete` at the end of the between.
- **Failure scenario:** The writer has written a between and a beneath, puts the caret at the start of the beneath and holds Backspace to remove a word. Press 1 node-selects the between; the repeat (30–40 ms later) deletes the entire between passage. It is visible, so it is not a C1 failure, and undo recovers it, but it is exactly the "revealed 35 ms earlier" class Gemini's R1 made a blocker, on text the design says must never be styled or treated as less than the page.
- **The fix:** Extend K1–K3 from "an underside" to "an underside, a between or a beneath" (any node of Folio's schema that is not a paragraph). In layer 2, Backspace at the start of the first paragraph of a beneath (or Delete at the end of a between) should do nothing or move the caret, never node-select the sibling. Add `selectable: false` to `between` and `beneath` (they then can't be NodeSelected at all; the underside stays selectable for the edge rows). Add the case to the layer-2 tests and S1 case 5.

### B8. The estimates for Phase 0 and Phase 1 are not credible for what §6 and §7 specify

- **Severity:** major (planning)
- **Sections:** §7 (table; "Why the estimates grew"), §6.12
- **Evidence basis:** reasoning from the itemised scope.
  - **Phase 0 (8–10 days).** S4 alone requires a working draft of `PageSaveController` + `pendingStore` + `classifyRejection` + the Web Lock (the probe is "a head start, not the spike"), eleven automated outcomes, and **a browser harness against the emulator for the persistent multi-tab cache that the repository does not have** (Playwright or similar, IndexedDB, two tabs, network cut): 5–7 days by itself. S1 on five browsers plus VoiceOver and NVDA, with Japanese and Korean IME, a grammar extension, Edit-menu undo and shake-to-undo, needs the schema, the node views and layers 1–4 built well enough to test: 4–6 days. S6 (additive `checkCrisisRisk`, a sampler, fixtures in five languages, a live run): 2 days. S2, S5: 1–2 days. Total 12–17 days.
  - **Phase 1 (15–18 days).** Schema + 5 plugins + 4 commands + clipboard + `LiftControl` + view state (6–8), persistence incl. lock/handover/classification/conflict copies (4–5), rules + emulator tests (1), safety watch + samples + checked set + shore presentation + Talk-now handoff (3–4), shell/pages list/Reading view/first-visit (3), routing seams incl. `resolveSessionsHome`, `useGlobalConfigStatus`, sidebar door (1–2), export/registry/local cleanup (1), copy in 17 locales + policy + tests (2, before native review), accessibility acceptance scripted in VoiceOver/NVDA/keyboard-only with fixes (2–3), art pass (2), no-leak test, device matrix, and the eight gates per phase. Total 25–35 days.
- **Failure scenario:** Not a runtime failure; a schedule that is set at 15–18 days for Phase 1 will either slip by half or shed the guarantees under pressure, which the document itself says must not happen.
- **The fix:** Re-plan at Phase 0 = 12–17 days and Phase 1 = 25–35 days for one engineer, or move scope that is not a guarantee: ship Phase 1 **admin-only in English** (gate `untranslated.test.ts` on a locale allowlist until the "opens beyond admins" milestone, which already gates the policy change), defer the art pass beyond tokens and the crease, and defer Reading view's print layout. Name the browser harness as its own task with its own estimate.

### B9. Orphan resolution is specified "on load" only; the lock holder after a crash or a handover, and the editor's content after a conflict copy, are undefined

- **Severity:** minor
- **Sections:** §5.2 ("On load", "Two tabs", "A conflict")
- **Evidence basis:** reading the design; the gaps are omissions, not errors.
- **Failure scenario:** (a) Tab A holds the lock and has an unsent entry; A crashes. Tab B is open read-only. The Web Lock is released by the browser; B is still read-only until the writer presses **Edit here**, which "loads the page from server-confirmed state before it allows editing" but the text does not say it also resolves A's now-orphaned entry. If it does not, A's words sit in localStorage until some future load. (b) After a conflict copy is made, which content does the editor show, the server's version (replacing what the writer was looking at, their text now on another page) or the local version (now a different page under a different id)? The status and the notice are specified; the editor's own content is not.
- **The fix:** State that **every transition to editable** (first load, Edit here, lock acquisition after a release) runs the same adopt-and-resolve procedure. State that after a conflict copy the editor **switches to the new copy** (the writer's own words stay under their caret; the server's version stays as the original page), and that this is what the notice says.

### B10. The pending entry does not carry the checked set, so resolution commits and conflict copies write an empty `safety.checked`

- **Severity:** minor (cost and a possible late shore, not a miss)
- **Sections:** §5.2 (the entry is `{ baseRevId, pendingRevIds, doc }`), §5.4 ("The checked set"), §6.6 (`validPage` requires `safety.checked`)
- **Evidence basis:** reading the design; `emu/probe-eng.cjs` R1 shows a create without `safety` is rejected, so the committing code must synthesise a set.
- **Failure scenario:** Tab A's entry (orphaned) is resolved by a later editor that has no in-memory set for A's content. It commits `safety: { checked: [] }`. The next open re-schedules every unit of a fully-checked page (hundreds of calls at 6 s apart) and, if an old unit now classifies as risk 2, starts shore on a page that had been checked. Same for every conflict copy.
- **The fix:** The entry is `{ baseRevId, sentRevIds, doc, checked }`, written together; a resolution commit or conflict copy carries the entry's set. The `pid`s are unchanged in a copy, so the keys remain valid.

### B11. Rejections arrive with codes other than `permission-denied`; the table names only one

- **Severity:** minor
- **Sections:** §5.2 ("The rules return the same error…"), §6.6 step 5
- **Evidence basis:** ran `emu/probe-eng.cjs` R6: a document over 1 MiB whose `doc` string passes the 950,000 rule → `rejected:invalid-argument`, server unchanged. R1: a rules *evaluation error* (missing `safety` map) is also `permission-denied`. R5: `getDocFromServer` offline → `unavailable`.
- **Failure scenario:** A page just under the client's 900 KB guard in UTF-8, with a large checked set, exceeds Firestore's own limit (which counts field names and the path too). The write is rejected `invalid-argument`. A controller that classifies only `permission-denied` either treats it as a conflict or as a transient failure to retry forever.
- **The fix:** Classify **every** permanent rejection (`permission-denied`, `invalid-argument`, `failed-precondition`, `unauthenticated` after a refresh attempt, `resource-exhausted`) with the same server read; retry only `unavailable`/`deadline-exceeded`. Say so in §5.2 and test `invalid-argument` in S4 outcome 9.

### B12. The size-guard arithmetic that makes the 12,000-key backstop unreachable fails for empty paragraphs

- **Severity:** minor
- **Sections:** §0.3 correction 6, §5.2 ("Size guard"), §5.4 ("Units")
- **Evidence basis:** arithmetic on the schema. An empty paragraph serialises to ~52 bytes (`{"type":"paragraph","attrs":{"pid":"<12 chars>"}}`); its key costs 19 bytes in the array. 12,000 × 71 ≈ 852 KB < 900 KB, so the backstop is reached before the guard if empty units are recorded. For a one-character paragraph the figure is ~107 bytes and the claim holds (12,000 × 107 ≈ 1.28 MB). Ran R2: 12,001 keys are rejected.
- **Failure scenario:** A writer who uses blank paragraphs as spacing (poets do) accumulates thousands of empty units; each is "checked" (its sample is its context) and keyed; the page hits 12,000 keys under 900 KB and every save is rejected as "Couldn't save to your account".
- **The fix:** Empty and whitespace-only paragraphs are **not units**: not sampled, not keyed. Also prune keys of units that no longer exist on every save (the type comment already says "pruned"; make it normative). Then the claim holds for every page.

### B13. Folio's L1 runs on the unit alone; the Journal's L1 runs on the whole text

- **Severity:** minor (cheap fix; strict superset)
- **Sections:** §5.4 ("When checks run": L1 "on the unit's full text"), goal "at least as reliable as the Journal"
- **Evidence basis:** read `functions/src/shared/crisisFloor.ts:99–104` (normalisation keeps newlines; patterns are regexes over the normalised string) and `partOrchestrator.ts:557–559` (L1 on `text`, the whole editor).
- **Failure scenario:** A sentence that L1 would match is split by a paragraph break mid-sentence (Enter instead of a space). The Journal's L1 sees both halves in one string; Folio's per-unit L1 sees two fragments and matches neither.
- **The fix:** Run L1 on the unit's **window** (the same reading-order sample built for L2, including the line anchor), not on the unit alone. It is a regex; the cost is nil, and it is then never weaker than the Journal.

### B14. Read-only tabs run the L2 sweep but cannot persist its results

- **Severity:** minor
- **Sections:** §5.4 ("Every unchecked unit is compared and scheduled: on open…"), §5.2 ("A second tab opens read-only")
- **Evidence basis:** reading the design.
- **Failure scenario:** Two tabs open the same never-finished page. Both sweep; both call L2 for every unchecked unit (double traffic, see B6); the read-only tab's results are never saved. Every open of the page in a read-only tab repeats the whole sweep.
- **The fix:** Only the lock holder sweeps and schedules L2. A read-only tab runs nothing (its text is unchanged and will be checked by the holder, or on its own next editable open).

### B15. Layer 2 must intercept every deletion binding, not only Backspace, Delete and Mod+X

- **Severity:** minor
- **Sections:** §5.1 layer 2, §6.5 "Commands"
- **Evidence basis:** ran `repro-eng-state.cjs` A7 (prosemirror-commands 1.7.1): `macBaseKeymap` deletion keys are `Ctrl-h, Alt-Backspace, Ctrl-d, Ctrl-Alt-Backspace, Alt-Delete, Alt-d, Backspace, Mod-Backspace, Shift-Backspace, Delete, Mod-Delete`; all chain to `deleteSelection → join → selectNode`. A1 shows forward Delete at the end of a lifted line node-selects the underside on press 1 and deletes it on press 2, the mirror of G.2.
- **Failure scenario:** On a Mac, the writer holds `Alt+Backspace` (delete word) at the start of the paragraph after a closed fold. Layer 2 handles "Backspace" only; the Alt variant reaches the base chain and deletes the underside on repeat.
- **The fix:** Layer 2 binds the full set above (and `Shift+Delete` as cut on Windows), and its tests enumerate them. Also: the K2 fence must lift on `blur`/`visibilitychange` and have a hard maximum (a lost `keyup` when focus leaves the window would otherwise hold the fence indefinitely).

### B16. The history guard's follow-up "open" must be dispatched asynchronously, and the `pid` fixer can fight the safety net

- **Severity:** minor (implementation traps that will cost a day each if not written down)
- **Sections:** §5.1 layer 3 and layer 4, §6.5 (`historyGuard`, `pid.ts`)
- **Evidence basis:** reasoning from prosemirror-state's `applyTransaction` (filter runs inside it; a nested `view.dispatch` would compute a state from the pre-filter state and then be overwritten by the outer `updateState`) and from the design's layer 4 compare ("removed or changed" presumably via `Node.eq`, which includes attrs). `repro-eng-state.cjs` A10 confirms a metadata-only transaction leaves `undoDepth` unchanged, so the deferred open is safe once dispatched.
- **Failure scenario:** (a) The guard calls `view.dispatch(openTr)` from inside `filterTransaction`; the open is applied and then clobbered when the outer dispatch finishes with the unchanged state; the fold stays closed and the announced "Undo again" never applies. (b) `pid.ts` fixes a duplicate `pid` by re-assigning the one inside a closed underside; layer 4 sees a changed closed node and restores the old attrs; `pid.ts` fixes it again; ProseMirror's `appendTransaction` loop never terminates.
- **The fix:** (a) Queue the open in a microtask (`queueMicrotask(() => view.dispatch(…))`). (b) I6 compares **content** (`node.content.eq`) plus `foldId`, not whole-node equality; and the duplicate fixer always re-ids the paragraph *outside* closed undersides.

### B17. Enter at the end of a lifted line is an unnamed path: the new paragraph lands between the line and its underside

- **Severity:** minor
- **Sections:** §5.1 (row "Enter inside a lifted line"), I2
- **Evidence basis:** ran `repro-eng-state.cjs` A2: `paragraph("Before.") paragraph(lifted) paragraph("") underside paragraph("After.")`; `I2 violated until integrity reorders: true`; the caret is in the new paragraph.
- **Failure scenario:** The writer presses Enter at the end of a lifted line to continue the page. `splitBlock` inserts the paragraph before the underside. The integrity plugin moves the underside back up to satisfy I2, so with an *open* fold the caret jumps below the whole beneath on screen, which reads as the editor fighting the writer; with a closed fold it is invisible and fine.
- **The fix:** Add the row: "Enter at the end of a lifted line: the new paragraph is placed after the line's undersides, and the caret with it." Decide and state the mirror (Enter at the *start* of a lifted line).

### B18. Routing details: the root visit may resolve before the config arrives; `useGlobalConfigStatus` never becomes ready offline without a cache; claims need a refresh

- **Severity:** minor
- **Sections:** §6.3, §6.4
- **Evidence basis:** read `src/App.tsx:147–175`: `initGlobalConfig()` is called at `:147` and the root visit is resolved a few awaits later; `src/store/globalConfig.ts` has no ready signal and `cache` is null until the first snapshot (the design says so).
- **Failure scenario:** (a) A non-admin with `lastHome === 'folio'` opens the app; the config snapshot has not arrived when `isRootVisit` is evaluated; `canOpenFolio` is false; they land in Sessions. (b) A non-admin opens `/folio` offline on a device whose cache never held `appConfig/global`; `useGlobalConfigStatus` stays `'loading'`; the skeleton shows forever. (c) An admin sets the `folio` claim; the writer's ID token still lacks it for up to an hour.
- **The fix:** (a) Expose `whenGlobalConfigReady(): Promise<void>` (resolves on the first snapshot, cache or server) and await it in init when `lastHome === 'folio'` and the user is not an admin. (b) After a bounded wait (e.g. 4 s) treat `'loading'` as "no access" and bounce. (c) Read claims with `getIdTokenResult(true)` once on first `/folio` visit, and in the admin action's UI tell the admin the writer must sign in again or wait.

### B19. The pending entry is a synchronous localStorage write of the whole serialised page on every debounced save

- **Severity:** minor (performance, measure in S4)
- **Sections:** §5.2 ("A store of pending saves"), §6.6 ("Timing")
- **Evidence basis:** reasoning; a 400–900 KB JSON string is `JSON.stringify`'d and written to localStorage (stored as UTF-16, so 0.8–1.8 MB) every 1.2 s of typing on a long page, on the main thread, plus the `setDoc` serialisation.
- **Failure scenario:** On a long page on a mid-range phone, each debounced save blocks the main thread for tens of milliseconds; typing stutters at the exact page sizes the 400 KB warning is meant to handle gracefully. Two tabs' entries plus view state can approach the origin's localStorage quota (≈5 MB), after which the honest "Not saved yet" status appears for pages that are nowhere near Firestore's limit.
- **The fix:** Scale the debounce with size (1.2 s under 50 KB, 3 s above), measure in S4 outcome 6, and lower the warning threshold if the quota is hit first.

### B20. A long paste of short paragraphs costs one classifier call per paragraph; a classified window could settle every unit it fully contains

- **Severity:** minor (optimisation; keep calibration in mind)
- **Sections:** §5.4 ("Samples", "Backlog"), §6.7 tests ("Coverage of long text")
- **Evidence basis:** arithmetic on the design: 20,000 characters as one paragraph → ~24 overlapping windows; as 40 paragraphs of 500 characters → 40 windows of ~1,000 characters that overlap heavily; at 6 s apart that is 4 minutes, and 10× redundant text sent.
- **Failure scenario:** Not a miss (L1 has covered the text; nothing is dropped). A 100 KB paste takes ~20 minutes of background calls and traffic (see B6).
- **The fix:** For sweeps and pastes only, let a classified window mark **every unit fully inside it** as checked, provided the window's result is risk 0 or 1. The classifier was tuned on windows whose newest text sits at the end, so S6 should report whether mid-window placement changes recall before this is turned on.

### B21. Three small spec gaps in C4 worth one line each

- **Severity:** minor
- **Sections:** §5.4, §5.5
- **Evidence basis:** reading the design.
- (a) `hidden()` runs L1 synchronously on `pagehide` and a hit calls `activateGrounding`, whose sink persists `lastGroundingAt` through an async Firestore write that may not leave the tab; state the best-effort nature (it mirrors Sessions today).
- (b) The key for an underside unit includes the lifted line (up to 240 characters, middle-trimmed); say that the **trimmed** form is what is hashed, or two lines differing only in their trimmed middle share keys.
- (c) "A late check can start shore" (§5.4) should also say that the sweep runs **after** the `Recent` overlay is read, so a page opened within 72 h of a grounding does not stack a second activation on top of the first; today the text implies independence.

---

## 3. Claims verified

| Claim (section) | How checked |
|---|---|
| Code references in Appendix A resolve at `35f8297`: `App.tsx:157–175, 238–253, 375–389, 38–40, 9–11`; `openrouter.ts:452–516`; `partOrchestrator.ts:130, 195–208, 553–581`; `firestore.rules:15–28`; `chat.ts:52–58, 77–78, 182`; `firebase.ts:17–19`; `journalDrafts.ts:55–82`; `SessionJournalSurface.tsx:56–59, 61–77`; `SessionView.tsx:547, 872`; `paragraphSettle.ts` (`doc.forEach` at :28); `AuthContext.tsx:94`; `DeleteAccountModal.tsx:44`; `dataExport.ts:487–502`; `configSchema.ts:10–29` | `sed -n` on each range; every excerpt in Appendix F matches verbatim; the working tree equals `35f8297` outside `docs/` |
| Installed versions as stated (prosemirror-view 1.41.6, -history 1.5.0, -state 1.4.4, -commands 1.7.1; TipTap 3.23; firebase 12.13.0 / @firebase/firestore 4.14.1; rules-unit-testing 5.0.0; firebase-tools 15.17.0) | `package.json` of each |
| prosemirror-history 1.5.0: `appendedTransaction` meta at `dist/index.js:264`; `beforeinput` `historyUndo`/`historyRedo` → `undo`/`redo` at `:386–390`; `isHistoryTransaction` exported (`:449–453`); `newGroupDelay` default 500 (`:374`) | read the file |
| prosemirror-commands 1.7.1: Backspace = `deleteSelection, joinBackward, selectNodeBackward` (`:807–817`); first press at an edge node-selects, second deletes (G.2 step 4) | read; reproduced for Backspace (G.2) and for forward Delete (`repro-eng-state.cjs` A1) |
| prosemirror-view 1.41.6: `compositionstart` mark-cursor path incl. the Chrome/Windows #1500 branch (`:3471–3482`); `transformCopied` (`d.ts:768`), `clipboardTextSerializer` (`d.ts:825`), `handleDOMEvents`/`handleKeyDown`/`handleTextInput`/`handlePaste`/`handleDrop` exist | read the file |
| A node view with no `contentDOM` keeps the node's text out of the DOM; toggling a node decoration with `update` returning `false` recreates the view in the other form; no undo step (§5.1 layer 1, §6.5) | `repro-eng-view.cjs` B1: `hidden text present in DOM = false` → open → `true` → close → `false` |
| A NodeSelection of a closed underside is drawn on the placeholder (`ProseMirror-selectednode`) (§5.1 "crease as selected") | `repro-eng-view.cjs` B7 |
| When the placeholder is removed from the DOM (extension, IME), ProseMirror deletes the node from the state, and an `appendTransaction` net restores it exactly (§5.1 layer 4) | `repro-eng-view.cjs` B6: without net `underside in state = false`; with net `doc equals original = true` |
| 3.1 #7 is necessary: ProseMirror places and draws a selection inside a contentless closed node without error, and typing then goes into hidden text | `repro-eng-view.cjs` B3 |
| A keystroke in the beneath and one in the page paragraph right after it do **not** share an undo group (so "the next press applies" undoes one coherent event) | `repro-eng-state.cjs` A6: `undoDepth = 2` |
| StarterKit's Gapcursor is not a hazard: `GapCursor.valid` is false between a lifted paragraph and its underside, inside the underside, and after it | `repro-eng-state.cjs` A8 |
| `history` filter guard: refused undo leaves depth unchanged; metadata-only transaction leaves history unchanged (G.2 step 5) | `repro-eng-state.cjs` A10; G.2 re-read |
| §6.6 rules compile and behave as written, including `safety.checked is list && size() <= 12000`, `('parentRevId' in …)`, `parentRevId == null` on create, `diff().affectedKeys().hasOnly([...])` on traces, entries append/delete only, the generic rule carve-out (merge writes rejected), other users denied | `emu/probe-eng.cjs` R1, R2, R7 (31/31 pass) |
| A stale parent and any other failed clause (including a missing field → evaluation error) both return `permission-denied` (§5.2) | `emu/probe-eng.cjs` R1, R3, R4; Appendix I checks 12–13 |
| The SDK pipelines queued batches in order, up to 10, and a permanent error removes only the failed batch (`fillWritePipeline`, `handleWriteError`; `:25380, 25865–25930, 25952–25967`) | read the file |
| `hasPendingWrites` on a document is `hasLocalMutations \|\| hasCommittedMutations` (`:5764`): a write acknowledged by the write stream still counts as pending until the watch stream delivers the document, so "server-confirmed" (§5.2) is conservative, which is correct | read the file |
| Multi-tab: secondary tabs learn `pending`/`acknowledged`/`rejected` (with the error code) for every batch through WebStorage `MutationMetadata` (`:18688–18736`, applied by `syncEngineApplyBatchState` `:28129`), and target `current`/`not-current` through `QueryTargetMetadata` (`:18742`, `:28293–28296`), so `fromCache`/`hasPendingWrites` and rejection codes are visible in a secondary tab | read the file (not run: no IndexedDB in Node, `fake-indexeddb` not installed) |
| `getDocFromServer` offline rejects with `unavailable` (§5.2 "Can't be read") | `emu/probe-eng.cjs` R5 |
| A document over 1 MiB with a passing `doc.size()` is rejected server-side (as `invalid-argument`) and never touches the page (§5.2 "A write over the limit is rejected by the server") | `emu/probe-eng.cjs` R6 |
| The rules cannot prevent a client from re-creating a deleted page; "never recreated automatically" is client discipline (§5.2) | `emu/probe-eng.cjs` R8 |
| Sentry has no Replay integration (the `replays*SampleRate` options are inert without `replayIntegration()`), and console breadcrumbs are on by default (§5.6, Appendix A) | `grep` of `src/main.tsx`: no `replayIntegration`, no `integrations:` |
| The chat function's limiter is `max: 30` per `windowMs: 60_000` per uid, and trips every task alike with a 429 (`chat.ts:182, 287–290`); it is **per instance**, in memory (`shared/rateLimit.ts`) | read the files |
| Account deletion covers new subcollections without registry changes (`recursiveDelete`); `USER_SUBCOLLECTIONS` is only the test registry (§6.8) | CLAUDE.md + `functions/src/shared/collections.ts` |

---

## 4. Follow-through check

| Item | Verdict | Reason |
|---|---|---|
| 3.1 #1 only orphaned entries, by the lock holder | sound, incomplete | Right rule; it does not say that **Edit here** / lock acquisition after a crash also runs it (B9). |
| 3.1 #2 nothing sent before confirmation; commit on top when the server's `revId` is in the chain | sound for load; incomplete for live saves | The same "in the chain" test must also be the **first row** of live rejection classification, with the chain = all sent revIds (B1); otherwise a re-sent committed write becomes a conflict copy. |
| 3.1 #3 L2 floor on the sample | sound | Matches `partOrchestrator.ts:202`. |
| 3.1 #4 `pid` in the key | sound | Note the `pid` fixer vs layer 4 trap (B16b). |
| 3.1 #5 traces carry a checked set | sound | Rules for it verified (R7 `safety.checked` update allowed). |
| 3.1 #6 12,000 backstop always behind the size guard | weak | Arithmetic fails for empty paragraphs (B12); holds once empty units are excluded. |
| 3.1 #7 a selection can't rest inside a closed underside | sound, necessary | B3 shows ProseMirror will not stop it; A3 shows a one-press path; must be an `appendTransaction` remap (B4). |
| 3.1 #8 D4 lowers D1 | not assessed | Study design is outside this lens. |
| 3.1 #9 linear form / print size | not assessed | Outside this lens. |
| Codex F6 → compare-and-swap + classification (E) | weak | The chain and the rules are right; the classification table is missing the own-write-landed row and per-chain dedupe (B1, B2); codes other than `permission-denied` (B11). |
| Codex F7 → C1 table + four layers (E) | sound, incomplete | Missing rows: native Cut (B3), empty-paragraph Backspace (B4), between/beneath selection (B7), programmatic loads (B5), Enter at the end of a line (B17), Mac deletion keys (B15). |
| Codex F8 → C4 contract (E) | sound | Add the shared-limiter interaction (B6) and L1 on the window (B13). |
| Gemini R1 → K1–K3, 600 ms (H) | sound, too narrow | Extend to `between`/`beneath` and all deletion bindings (B7, B15); fence must lift on blur. |
| Gemini R2 → closed text out of the DOM + pre-input collapse (H) | sound in direction; the collapse is a hope, not a guarantee | Correctly leaning on layers 1 and 4; S1 is the right place to learn whether `compositionstart` selection changes are honoured. B6 of the view repro confirms layer 4 behaves as the fallback. |
| Gemini R3 → history guard refuse/open/announce (H) | sound | Reproduced (G.2); implementation note on deferred dispatch (B16a). |
| Gemini R4 → no hidden text in DOM; drop = cut+paste (H) | sound | The drop path is `handleDrop`-mediated (`view:3771`); cut via menu is not (B3). |
| Gemini R5 refuted (SDK merges writes) (H) | sound | Pipelining confirmed in source and emulator; but the **same** source shows no stream resumption, which is B1. |
| Gemini R6 → per-editor entries + Web Lock (H) | sound | Handover/crash gap (B9). |
| Gemini R7 → classify by reading the server (H) | incomplete | B1, B2, B11. |
| Gemini R8 → coverage defined by content (H) | sound | Pending entry should carry the set (B10). |
| Gemini R9 → reading-order windows (H) | sound | Suggest the same window for L1 (B13). |
| "Found while checking": false conflict on load → wait for server-confirmed (H) | sound | `hasPendingWrites` semantics make it conservative (claims table). |

---

## 5. Questions for the owner

1. **Should a rejected write whose `revId` already sits on the server be treated as acknowledged rather than as a conflict?** Recommended: yes; make it the first classification row and keep the whole sent chain (B1). It costs nothing and removes the only deterministic false-conflict path I found.
2. **Should classifier traffic get its own server-side limiter?** Recommended: yes, a second `makeRateLimiter` for the pinned classifier routes (`crisis_check`, `signal_check`), so Folio can never make Sessions' L2 backstop fail open; and lower Folio's sweep rate to 6/min (B6).
3. **When a selection spans a closed fold, should Folio collapse at input time (the draft) or open the folds it spans (making the text visible first)?** Recommended: keep the draft's design, but have S1 measure both; "open on span" removes every dependency on browser behaviour during composition at the cost of a surprising open.
4. **Should Phase 1 ship admin-only in English, with the 16 translations gated to "opens beyond admins"?** Recommended: yes if `untranslated.test.ts` can take a locale allowlist; it is the largest non-guarantee cost in Phase 1 (B8).
5. **Question 15 (late checks can start shore).** Recommended: accept unchanged; the alternative is unchecked text. Add the ordering rule in B21(c).
6. **Estimates.** Recommended: re-plan Phase 0 at 12–17 days and Phase 1 at 25–35 days rather than removing any guarantee; name the browser harness as its own line (B8).

---

## 6. Limits of this review

- **No real browser, device or IME.** jsdom has no layout, no caret movement, no key repeat, no `clipboardData`, no composition. Everything about `beforeinput`/`compositionstart` on iOS Safari and Android Chrome (§5.1 layer 2's pre-input collapse, S1 cases 2–4) remains open; I could only show what ProseMirror does with the state it is handed.
- **Emulator, memory cache.** The Firestore probe ran in Node with the memory cache, like Appendix I. The persistent multi-tab cache (S4 outcomes 10–11) was read in the SDK source, not run (`fake-indexeddb` is not installed). The emulator is not the production backend: in particular I could not test whether production deduplicates a re-sent batch; the SDK sends no resumption token (`:25015–25021`), so B1 stands on the client side regardless.
- **No live model eval** and no review of the classifier's behaviour on Folio's window shapes (S6).
- **No React/TipTap integration run.** The node-view switching was verified with plain ProseMirror node views; TipTap's `ReactNodeViewRenderer` exposes an `update` option (`@tiptap/react/dist/index.js:982–997`) that makes the same pattern available, but I did not mount React.
- **Scope.** Art, study design (§4, §8), copy honesty and §3.10's screen-reader claims were not assessed beyond their engineering consequences.
