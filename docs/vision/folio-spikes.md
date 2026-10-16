# Folio Phase 0: what the spikes showed

**Date:** 2026-10-15 to 2026-10-16
**Plan:** [`folio-build-plan.md`](folio-build-plan.md), step 2. Design: [draft 4](2026-10-15-folio-v4.md).
**Code:** branch `feat/folio-step2-core` (PR #6). The spikes were built as the real modules, not as throwaway code.

Phase 0's exits are in draft 4 §7. The build plan replaced the real-device matrix with an automated one (decision 6): Playwright in Chromium, WebKit and Firefox, desktop plus Pixel 7 and iPhone 14 emulation, with axe, synthetic key repeat and Chromium's CDP IME. Real devices, screen readers and IME keyboards are on the owner's checklist (§6 below), which never blocks.

---

## 1. S1: hidden writing

**Exit:** zero changes to hidden writing, and no composition glitch that loses or duplicates visible text. **Met on the automated matrix.**

**What was built.** `src/folio/page/`: the schema, the four C1 layers, integrity (I1–I5, I7, I9), the selection remap (I8), the commands and the key table. See draft 4 §5.1, with the build plan's italic.

**Evidence.**
- 30 jsdom tests (`hiddenWriting.test.ts`), one per C1 row, plus K1–K4, the invariants, the history guard, and the safety net, including a placeholder removed from the DOM.
- Mutation checks: disabling the deletion guard fails 6 tests; disabling the selection remap fails I8.
- 17 browser scenarios (`e2e/folio/hiddenWriting.spec.ts`) on all five projects:
  - no hidden text in the DOM
  - Backspace: select, hold, then a fresh press
  - Backspace in an empty paragraph after a closed fold (B4)
  - deleting a span, and typing over one
  - native cut from the keyboard: asserted as a real cut, handled by layer 2 and not the net
  - a stray modifier chord
  - keyboard undo, and `beforeinput historyUndo`
  - an Android-style `deleteContentBackward`
  - Enter after a lifted line
  - lift
  - axe
  - Chromium IME composition over and beside a fold
  - the key table

**Found and fixed.**
- **The editable region had no accessible name** (axe, `aria-input-field-name`). The core now always labels it a multi-line textbox.
- **StarterKit 3 adds a trailing paragraph** after a final underside. It's kept, because it gives the writer somewhere to write after a fold at the end of a page.
- **jsdom doesn't reflect `contentEditable`** as an attribute. The core sets the attribute directly, which is right in every browser too.

**Limits.**
- Real IME keyboards (Japanese and Korean), iOS text replacement, Android autocorrect and grammar extensions weren't run. CDP composition in Chromium is the closest automated stand-in.
- WebKit and Firefox composition were checked only through the pre-input collapse on `compositionstart`.

---

## 2. S4: storage

**Exit:** all thirteen outcomes pass. **Met.**

| # | Outcome | Where | Result |
|---|---|---|---|
| 1 | Concurrent writes online | emulator (`tests/folio-save.test.ts`) | One accepted; the other is one conflict copy |
| 2 | Concurrent writes offline, either order | emulator | One copy per conflict, both orders |
| 3 | Delayed acknowledgement | emulator | Status and store stay honest |
| 4 | Rejected chain | emulator | Every queued write rejected; nothing applied |
| 5 | Edit versus delete | emulator | Never recreated; the words are offered back |
| 6 | localStorage unavailable | emulator and unit | Never "Saved on this device" |
| 7 | IndexedDB unavailable (memory cache) | emulator | Reload: committed on top, not copied |
| 8 | Reload in the middle of a chain | emulator | Same as 7 |
| 9 | Not a conflict, both codes | emulator | `permission-denied` (rules cap) and `invalid-argument` (1 MiB): no copy, "Couldn't save", retried |
| 10 | Reload with the SDK's own queue | browser (`e2e/folio/save.spec.ts`), Chromium, WebKit, Firefox | No false copy; the latest words win |
| 11 | Two tabs | browser | The second tab waits and never touches the first's entry; Edit here hands over; closing the first hands over |
| 12 | A landed write re-sent | emulator and browser | Classified as landed, never as a conflict |
| 13 | One conflict, several queued writes | emulator | Exactly one copy |

**Fable's B1 and B2, seen in real browsers.** Test 12 cuts the network around writes. Across 18 runs in Chromium, WebKit and Firefox, the logged diagnostics show the SDK re-sending writes that had already landed in 13 runs. The server rejected those re-sends, often several from one chain. Every one was classified as landed, with no conflict copy and nothing lost. Draft 3.1's design would have made a false conflict copy in each of those 13 runs.

**Found and fixed.** Classification re-read the server on a 30-second, 2-minute, 10-minute backoff when the first read failed. A reconnect blip therefore held "Saved on this device" for 30 seconds or more. Classification now retries at 2, 5, 15 and 60 seconds, and on the browser's `online` event. The slow backoff is kept only for writes that break a rule.

**Limits.**
- The emulator is not production. Whether the production backend deduplicates a re-sent write is unknown, and the design doesn't depend on it.
- In WebKit, a closed tab's IndexedDB lease takes about 5 seconds to expire, so a waiting tab can take that long to become editable.

---

## 3. S5: the key table

**Exit:** a final binding table. **Met, with a device check on the owner's list.**

| Action | Keys | Why these |
|---|---|---|
| Lift, or open and close from the lifted line | `Mod+Shift+Enter` | Free in every engine tested |
| Close a written fold, or unlift an empty one | `Esc` (inside the underside) | — |
| Closer / Farther | `Mod+Alt+[` / `Mod+Alt+]` | ProseMirror's keymap falls back to the key code, so a Mac's Option-characters still match |
| Next / previous lifted line, announced | `Mod+Alt+.` / `Mod+Alt+,` | Draft 4's `Mod+Alt+J/K` open the browser consoles on a Mac (Chrome ⌘⌥J, Firefox ⌘⌥K) |
| Step inside (H1) | `Mod+Alt+Enter` | — |

**Avoided:**
- `Ctrl+Alt+arrows`: some Windows graphics drivers rotate the screen.
- `Option+letter` on a Mac: it types an accented character.

**Delivery** was checked in Chromium, WebKit, Firefox and iPhone emulation.

**Android Chrome:** ProseMirror lets the browser handle Enter there and reads the DOM change, instead of running keymaps. Enter-based chords aren't a path on Android, and Lift there is the touch control (step 4, S2).

---

## 4. S6: safety coverage

**Exit:** recall meets the shared bar, and the false-activation rates are reported. **Met.**

**What was built.**
- `checkCrisisRisk`, deployed in step 1.
- `src/folio/safety/`: reading-order units, sample windows, check keys, `FolioSafetyWatch` and the live eval `test:folio-safety`, which now joins the release evals.

**The live eval**, two runs after the fix below, with gpt-5-nano and the deployed prompt and settings:

| Fixtures | Count | Flagged | L1 | L2 |
|---|---|---|---|---|
| Must flag | 40 | **40** (recall 100%) | 3 | 40 |
| Ambiguous (a composition the precision-tuned classifier calls 0 or 1) | 1 | 0 | 0 | 0 |
| Ordinary | 2 | 0 | 0 | 0 |
| Literary | 4 | 2 | 2 | 0 |
| Dark (grief, a letter to the dead, history, humor) | 4 | 1 | 1 | 0 |

About 75 classifier calls per run, at roughly 0.75 seconds each.

**Found and fixed: a floor that misses short crisis text in Japanese and Chinese.**
- **The bug.** The first runs missed two shared must-flag cases: the Japanese もう死にたい。本当に。今夜やる。 ("I want to die. Really. I'll do it tonight.") and a Chinese sentence. Called directly, the classifier flagged both 8 times out of 8. The cause was Folio's minimum-length rule, copied from the Journal: no L2 check for a sample under 20 characters. Those two sentences are 16 and 19 characters, so they were never sent.
- **The fix.** The minimum is now a count of words, using `Intl.Segmenter` (which splits Chinese and Japanese text into words). Only a sample of a single word is skipped. Two new fixtures cover it.

**For the owner, not changed here** (calibration is outside this build's authority):
- **The Journal has the same gap, and a wider one.** Its pause handler returns before any check when the whole text is under 20 characters (`src/engine/partOrchestrator.ts:202`). That skips L1 as well. A Japanese or Chinese writer's short, explicit statement on a nearly empty Journal page is never checked while it's written.
- **L1 activated on 3 of 8 non-crisis fixtures:**
  - `she said "I want to kill myself" and laughed`
  - a persona poem: "Some nights I wanted to end my life, he wrote,"
  - "Ten years ago I tried to end my life. Today I ran my first half marathon."

  The last one should have deferred under L1's "clearly historical" guard and didn't. In Folio, "I'm okay" and the already-shown rule (draft 4 §5.5) limit what this costs a writer. The floor itself is unchanged.

---

## 5. Decisions the run made

| Decision | Why |
|---|---|
| The L2 floor counts words, not characters | The live eval (above) |
| L1 runs on each unit and adjacent pairs, and late L1 hits follow the late-check rule | A sentence split by Enter is still caught. On an old page, a hit found only now is treated like a late L2 result |
| Classification retries fast (2, 5, 15, 60 s, and on `online`) | A reconnect blip shouldn't hold "Saved on this device" for 30 seconds |
| The key table above | Collisions found in documentation and in the matrix |
| `created` tracked in each pending entry and chain | A rejected first save of a new page isn't a remote delete |
| A queued page lock, plus Edit here | Decision 8 restored Edit here. The queued lock still hands over when a tab closes |
| Playwright 1.57.0 and `@axe-core/playwright` 4.11.0 as dev dependencies; a `browsers` CI job | Decision 6: the automated device gate |

---

## 6. The owner's checklist (from these spikes; never blocks)

- On an iPhone and an Android phone: each row of draft 4 §5.1's table, especially Backspace in an empty paragraph after a closed fold, native Cut from the menu, and drag and drop.
- Japanese and Korean keyboards next to and across folds; iOS text replacement; Android autocorrect; Grammarly or LanguageTool with folds closed.
- VoiceOver (macOS and iOS) and NVDA: the six scripted tasks in draft 4 §3.10, and `Mod+Alt+.` / `,` as the discovery path.
- The key table on Windows (NVDA running) and macOS (VoiceOver running).
- Two tabs in Safari: how long the waiting tab takes to become editable after the first closes (expected: about 5 seconds).
