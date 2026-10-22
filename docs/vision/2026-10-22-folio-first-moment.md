# Folio: the first moment (2026-10-22)

The owner, after using Folio: "Overall when using the folio interface it doesn't feel intuitive. I don't think a user will naturally know how to do things and what is going on. And most users don't read instructions." Then: "build it all out — I really want this to feel smooth, easy and intuitive and magical from the first moment. The perfect mesh of form and function."

This document is the design. It changes how Folio teaches itself and what its controls are called. It doesn't change what Folio is (draft 4 §1–§2), its contracts (C1–C6), safety, saving or the companion's levels.

## 1. Why it wasn't intuitive

1. **The core idea has no familiar equivalent.** Writing beneath a line, folded away until opened, isn't like anything people already use. The only teaching was the placeholder "Write anything. Select a line to lift it.", gone at the first keystroke.
2. **The main action was invisible.** Lift appeared only after selecting text inside one paragraph, and people rarely select a line they've just written.
3. **The words didn't predict what happens.** Lift, Unlift, Closer, Farther, Keep, Step inside, Ask: each is evocative, none says what it does. Draft 4's own Law 3 asks for plain labels and strange material; the labels had drifted into the material.
4. **A closed fold looked like nothing.** A faint underline and a dog-ear that reads as a page icon.
5. **Five equal controls.** "Close · Closer · Farther · Keep · Step inside", same weight, no order of use.
6. **Things happened without a reason.** The companion's dot, its questions, and where kept things went were never explained where they happened.
7. **On a phone, the bottom bar sits under the keyboard on iOS**, so even a selection's Lift could be out of reach.

## 2. Principles

1. **Name things by what they do.** A label predicts its outcome. The material keeps the poetry.
2. **Show the next step where the eye already is.** The way to write beneath a line appears at that line, when the writer pauses, not in an instruction.
3. **Explain once, at the moment, then get out of the way.** Each mechanic gets at most one line of explanation, the first time it happens, triggered by what the writer did; remembered per account.
4. **Motion says where things go.** A lift opens under the line; folding tucks it under; a kept copy flies into Kept.
5. **The companion signs its work.** Its questions carry its name; its first mark is explained where it appears.

## 3. What changes

Built in two passes. The first pass was then judged three ways: two blind usability runs and a critique from Fable, who art-directed Folio (§7). The second pass is what this section describes.

### 3.1 The corner (the way in)

A faint page corner and the words *write beneath this* appear after the last sentence of a written page paragraph, in three cases:
- **The caret rests** in that paragraph: after 1.2 s if the sentence is finished, 3 s mid-sentence (a pause to think shouldn't flash anything).
- **The caret rests on the empty line** just after it (Enter is a natural pause).
- **The mouse rests on the line** for 350 ms. Any hovering pointer counts, read from `pointermove`; a finger never does. The first blind tester typed and reached for the mouse at once, so it never paused. Exploring with the mouse now finds the corner.

**What it does:**
- Hovering the corner underlines, dashed, the sentence it will lift. Pressing it lifts exactly that sentence: the sheet swings down under the line and the caret waits beneath.

**Where and when it shows:**
- It sits at the paragraph's end on a zero-width anchor, so no character ever moves when it comes and goes.
- Its words drop away where they would run off the screen.
- It goes at the next keystroke, at a selection, or when the pointer leaves. It never shows during an IME composition, in Shore or Quiet, in a tab that doesn't hold the page, or on a full page.
- After two lifts, the words show only on hover and focus.
- It never offers a lifted line or one only the companion wrote. It never sits on the companion's marked sentence.

**Its form:**
- The words are set in the controls' face (Inter 13 px), so they read as something to press, not ghost text.
- The glyph is a drawn page corner, never a second tiny page. It is the same triangle as the crease, in a third weight: faint, not yet folded.
- On desktop its tooltip names the key (⌘⇧↵ / Ctrl+Shift+Enter).

Selection still works: selecting text shows **Write beneath** and **Ask the companion** on a slip with the notice's amber top edge. After Ask, the selection collapses, so the slip never covers the note.

### 3.2 Plain labels

| Was | Now | Where |
|---|---|---|
| Write anything. Select a line to lift it. | Write anything, and what's beneath it. | the blank page |
| Lift | Write beneath | selection, phone bar |
| Ask | Ask the companion | selection, phone bar |
| Unlift | Cancel | an empty fold |
| Close | Fold away | an open fold |
| Closer / Farther | Move closer / Move apart | an open fold |
| Keep | Keep a copy | an open fold |
| Step inside | Read it alone | an open fold |
| between | write between them | an empty between |
| Lifted. Writing beneath. | Writing beneath the line. | announcement |
| Unlifted. | Cancelled. | announcement |
| Farther: far, 4 of 5 | Moved apart: far, 4 of 5 | announcement |
| Lift into today's page | Write beneath it again today | a kept thing |

**Tooltips.** Each control has a tooltip that says what it does:
- Fold away: "Tuck this under its line. It stays on the page."
- Move apart: "More space between the line and what's beneath it"
- Keep a copy: "Save a dated copy to Kept"
- Read it alone: "Just this piece, full screen"
- Sessions: "Sessions: talk with the companion"

The concept names in code and in draft 4 don't change: lift, fold, underside, Step inside.

### 3.3 The fold's controls

**An empty fold** offers only **Cancel**, quietly, at the far end. The page never opens a fold by offering to undo it, and there's no placeholder competing with the caret.

**A written fold**, ordered by use: **Fold away** (in ink) · Keep a copy · Read it alone …… Move apart · Move closer.
- Move apart and Move closer are always there, disabled at the ends (`aria-disabled`, still focusable), so the row never jumps.

**Dragging.** The beneath's corner, a short amber tick where the fold's edge meets it, can be dragged: down to move apart, up to move closer.
- It snaps to the five stops, which show as hairlines on the fold's edge while dragging.
- It's a pointer aid only (aria-hidden). The buttons and keys do the same, so dragging is never the only way (§3.10 of draft 4).

### 3.4 Closed folds say what they are

- **The glyph:** the crease is a page corner. Filled when folded flat with something under it; an outline when its flap is lifted.
- **The tint:** a closed fold's line carries a faint cool tint, the sheet beneath seen through the paper. It shows no text and puts nothing in the DOM.
- **Folding away:** the passages go under the line (a wash rising into it, 520 ms).
- **Hover:** hovering or focusing the crease shows *open* or *fold away* beside it.
- **The first fold:** the first time the writer folds something away, *folded here · open* sits beside the crease for 6 s. Pressing it opens the fold. It drops under the line where the column ends.

### 3.5 Keeping shows where kept things go

- **The flight:** the kept words lift off the page and settle into **Kept** in the top bar (ink alone, 750 ms), and Kept takes a moment's amber dot. Before, the words dropped to the bottom edge.
- **The first keep:** says *Kept a copy, dated today. Find it in Kept.* with only Undo. *Come back to this…* is offered from the second keep.
- **Wide screens:** the notice keeps to one row.

### 3.6 The companion signs its work

- Its questions read *What was it like? — the companion*.
- The first time it marks a line, a notice says what the dot is: *The companion points at a line it would ask about. Press the dot to write beneath it.*
- The dot's tooltip says the same in a few words.

### 3.7 The first visit

The first-visit line keeps every honesty requirement (§5.6 of draft 4). It adds **Choose how much** beside **Got it** when the companion reads the page, so a writer who never chose a level can.

Fable suggested moving it below the page. It stays above, so it's seen before writing on any screen; that was the earlier decision, and honesty outranks first-impression polish.

### 3.8 Phones and steadiness

- **The phone bar:** Write beneath and Ask the companion ride above the on-screen keyboard (the visual viewport), so they're reachable on iOS while writing.
- **Notices:** on a phone, a notice stands above that bar when it shows.
- **The save status:** "Saved on this device" shows only once that state has lasted 2 s, so the status doesn't flicker between two words while writing.
- **The ••• menu:** New page comes first and Find help last on every view, so no item moves under the pointer. A blind tester opened the help card by accident when the items shifted.
- **New page** also sits beside the Pages title, where two testers looked for it.
- **Kept's Add** shows the new entry at once, with its Undo on its own row. Before, the page jumped twice (an "Added · Undo" line, then the entry arriving from the store), and two testers' next clicks missed.

### 3.9 Keys, findable

**Keyboard shortcuts** in the ••• menu, on devices with a keyboard, lists every key from §3.10 of draft 4. It opens over the page gone soft (paper, not a dark scrim).

## 4. The switch

`folioGuides` (on unless false) turns off the corner, the first-time lines, the first-mark notice and the first-keep wording. The plain labels, New page on the Pages list, the tooltips, the drag, the hover labels, the closed-fold tint and Keep's flight stay: they're how Folio works, not guidance.

## 5. Remembered per account

`folioPreferences/current.learned`: `{ lifts?: number; fold?: number; keep?: number; mark?: number }`. `lifts` is a count; the rest are timestamps. The fields are merged one by one, and a new device doesn't show a first-time line again.

## 6. Not changed

The contracts (C1–C6), shore and Quiet, the safety checks, saving, the companion's levels and its voice, Return, Ask's contract, the art (paper, light, wash, film) except the additions above, every key binding.

## 7. How it was judged

**Blind usability runs.** An agent with no knowledge of Folio used it only through screenshots, clicking by position, as a first-time person would. It wasn't allowed to read the code or the docs. Each run was signed in as the Folio test account, against the live site or a local build, with the same instructions every time.

| Run | Rating | What it found on its own | What still confused it |
|---|---|---|---|
| Live Folio | 6/10 | Lift, through the old placeholder's "Select a line" | Lift, Closer, Farther, "between", Step inside, Sessions |
| First build | 6/10 | Write beneath, only by selecting; it never paused, so the corner never showed | "between", Fold away, Move apart, Sit with it; the menu shifting under the pointer |
| Second build | 6/10 | The corner, then lift, fold away and reopen | Sit with it, Put it back |
| Third build (this) | 7/10 | Nearly everything: the corner, Move apart and the between, Fold away and the reopening line, Keep, Kept and its come-back, Write beneath it again today, Read it alone, the menu | Sessions; Move apart until clicked. Native tooltips don't show in its screenshots, so it never saw them. |

The second and later runs were told to act at a human pace: one action at a time, with a short wait before each screenshot. The first run chained typing and a screenshot, which is part of why it never saw the corner. Hover discovery was added in the second pass for writers who don't pause.

**Fable's critique** of the first build's renders, ranked, gave the second pass most of its form:
- the triangle glyph and the corner's typeface
- the quiet empty fold and the controls' order
- the first-fold line beside the crease
- the closed-fold tint and the tuck
- timings within 750 ms, ink-only Keep, the soft backdrop and the popover's edge

Moving the first-visit line below the page was declined (§3.7).

**Left for the owner:**
- "Sessions" means nothing to a Folio-first writer, even with its tooltip.
- An Ask note once called a typo "gently suspended"; Ask's voice is unchanged by design.
- Native review of the 16 translations.

