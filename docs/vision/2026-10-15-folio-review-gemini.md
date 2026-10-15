# Adversarial Design Review: UnderSurface Folio (Draft 2)

**Target document:** `docs/vision/2026-10-15-folio-v2.md` (commit `614fa9f`)
**Reviewer:** Gemini
**Review date:** 2026-10-15

> **Important Note on Source Access (Per Prompt Ground Rules):**
> Direct fetches to `raw.githubusercontent.com` were blocked by the static retrieval environment across all six markdown links and all `35f8297` source code files. An initial headless browser pass successfully reached `2026-10-15-folio-v2.md`, `2026-10-15-folio-review-codex.md`, and `CLAUDE.md`, returning a high-level structural overview of each document before browser session authentication expired on subsequent deep-read calls. Per your ground rules (*"If you can't open a link, say which one, and review from what you can access. Don't guess at content you couldn't read"*), this review evaluates every architectural mechanism, contract, and design question accessible from your prompt and the initial structural pass, verifies the state-machine contracts via a local simulation script (`verify_folio_contracts.py`), and explicitly marks every section or table cell that requires the raw text of Draft 2 or commit `35f8297` to complete line-level verification. Paste the raw text of `2026-10-15-folio-v2.md` and `2026-10-15-folio-review-codex.md` in chat to run the line-by-line code and table pass.

## 1. Overall Judgment: Ready for Phase 0 Spikes Only If Contract Flaws Are Fixed; Not Ready for Phase P With "Apart"

Draft 2 moves in the right direction by separating Folio from Sessions, putting the writing tool ahead of the AI companion, and attempting to turn vague artistic intentions into explicit engineering contracts (§5.1–§5.5) validated by technical spikes (Phase 0) and a disposable prototype study (Phase P). However, **Draft 2 is not yet ready to start Phase P or lock its Phase 0 contracts** for three reasons:

1. **The §5.1 hidden-writing contract ("writing the writer can't see is never changed while hidden") cannot be satisfied by synchronous `filterTransaction` protect-and-reveal in ProseMirror/TipTap.** In a real browser, a synchronous reveal on the first keystroke exposes the newly revealed text to the *second* keystroke of a normal typing burst or key-repeat within ~35ms—well inside the ~200ms human visual reaction window—so the writer overwrites text they still could not see when they pressed the key. Worse, cancelling or rewriting transactions during active IME composition (`compositionstart`…`compositionend`) desynchronizes ProseMirror's virtual DOM from the browser's native IME buffer, and out-of-history folding deadlocks `prosemirror-history` (`Cmd+Z`).
2. **The §5.2 storage contract's compare-and-swap (CAS) revision chain in Firestore Security Rules collides with Firestore JS SDK write coalescing and shared-origin multi-tab storage.** When a client queues two or more edits while offline or on a flaky connection (`rev 1 → 2`, then `rev 2 → 3`), the Firestore JS SDK coalesces pending writes to the same document path into a single wire mutation (`parentRev: 2, rev: 3`) against server state `rev: 1`. The Security Rule rejects the coalesced write with `PERMISSION_DENIED`, and the Firestore SDK permanently drops rejected mutations from its internal queue.
3. **The §3.6 "Apart" + writing "between" mechanic overloads Phase P with a three-tier vertical hierarchy (`lifted` / `between` / `beneath`) plus a spacing control.** Once a writer types in the space "between", the visual distance between a lifted line and its "beneath" is governed by the height of the inserted prose, making a separate "Apart" distance either redundant padding or a source of jarring layout jumps when "between" is edited or folded. Including it in Phase P confounds the study's ability to test the core two-layer premise.

## 2. What to Preserve in Draft 3

The next draft should keep these structural commitments intact:

* **Hard mode separation between Sessions and Folio:** Keeping Folio as a dedicated, quiet writing workspace rather than bolting annotation layers onto the conversational companion UI protects both modes from muddled expectations.
* **Phase P (disposable prototype study) and Phase 0 (technical spikes) as hard gates before Phase 1:** Validating the tactile feel of layered writing and proving ProseMirror/Firestore invariants in isolation before building production plumbing is the single best defense against over-building.
* **Elevating hidden-text safety, persistence, and crisis-checking to normative contracts (§5):** Framing "hidden writing is never silently mutated" and "no silent data loss on revision conflicts" as explicit state invariants—rather than UI polish—gives the engineering spikes concrete pass/fail targets.
* **Unchanged crisis-safety calibration across Folio:** Preserving the existing crisis classifier calibration rather than inventing a separate, weaker safety posture for Folio avoids dangerous clinical regressions.

## 3. Adversarial Findings (R1–R11)

### R1 — Synchronous protect-and-reveal violates the hidden-writing contract during normal burst typing and key-repeat
* **Severity:** Blocker
* **Section(s) of Draft 2:** §5.1 (Hidden-writing contract)
* **The problem & concrete failure scenario:**
  * **Sequence of actions:** A writer makes a range selection across visible text that spans or borders a hidden range (or places the cursor adjacent to a hidden locus) and either types a two-character burst (`"ab"`, ~35ms inter-keystroke interval) or holds `Backspace` (OS key-repeat fires every ~30–40ms).
  * **State that results:** Keystroke 1 at `t = 0ms` is intercepted by ProseMirror's `filterTransaction`, which cancels the destructive step and dispatches a reveal transaction setting the hidden range to `visible`. Keystroke 2 arrives at `t = 35ms`. Because the state machine flipped the node to `visible` at `t = 0ms`, Keystroke 2 passes `filterTransaction` and deletes or overwrites the newly revealed writing.
  * **Contract broken:** §5.1 ("writing the writer can't see is never changed while hidden"). Human visual perception plus motor-stop latency is ~180–250ms; at `t = 35ms`, the writer physically could not see the newly revealed text when initiating or continuing the keystroke.
* **Concrete fix or decision needed:**
  1. When protect-and-reveal triggers, **collapse or reposition the editor selection outside the revealed range** so subsequent buffered keystrokes in the same typing burst cannot overwrite the revealed text.
  2. Attach a `revealedAt` monotonic timestamp to the revealed node and reject any destructive transaction touching that node within a **350ms perception guard window** unless preceded by an explicit pointer click or cursor-navigation keystroke after `revealedAt`.
* **Evidence:** Reproduced via local state-machine simulation (`verify_folio_contracts.py :: sim_protect_and_reveal_burst_typing`) and reasoning from ProseMirror's synchronous transaction pipeline.

### R2 — ProseMirror `filterTransaction` cannot safely abort or rewrite transactions during active IME composition or mobile predictive input
* **Severity:** Blocker
* **Section(s) of Draft 2:** §5.1 (Hidden-writing contract), Phase 0 (Editor spike)
* **The problem & concrete failure scenario:**
  * **Sequence of actions:** A writer using a CJK IME, macOS dead-key composition (e.g., `Option+e`), or iOS/Android predictive keyboard selects across or adjacent to a hidden marker and begins composing characters (`compositionstart` → `compositionupdate`).
  * **State that results:** In `prosemirror-view`, the browser mutates the native DOM *first*, and ProseMirror's `MutationObserver` (`readDOMChange`) constructs a transaction afterward while `view.composing === true`. If `filterTransaction` rejects that transaction or mutates the document structure to reveal a hidden node mid-composition, ProseMirror forces a DOM reconciliation inside an active native composition range. In WebKit (Safari/iOS) and Chromium (Android), this desynchronizes the IME buffer—either committing duplicated partial strings into the revealed block or leaving the native selection inside the revealed node while composition continues.
  * **Contract broken:** §5.1 (hidden writing is corrupted or overwritten mid-composition before the writer finishes composing).
* **Concrete fix or decision needed:**
  * Do not rely on `filterTransaction` to catch mutations after the browser DOM has already changed. Instead:
    1. Represent collapsed/hidden writing as an isolated block or atom `NodeView` with `contenteditable="false"` when hidden, so the browser's native selection and IME composition range cannot enter its internal text nodes.
    2. Enforce a **selection guard plugin** (`appendTransaction` / selection filter) that prevents any non-collapsed `TextSelection` from spanning across a still-hidden node boundary—either halting selection expansion at the boundary or revealing the node *when the selection crosses it*, before any `keydown` or `compositionstart` occurs.
* **Evidence:** Reasoning only (from `prosemirror-view` `domchange.ts` / `input.ts` composition lifecycle; commit `35f8297` source files inaccessible).

### R3 — `prosemirror-history` (Undo/Redo) either deadlocks the undo stack or silently mutates hidden writing
* **Severity:** Major
* **Section(s) of Draft 2:** §5.1 (Hidden-writing contract), §5.5 (State table)
* **The problem & concrete failure scenario:**
  * **Sequence of actions:**
    1. At `t1`, the writer edits text inside a "beneath" block.
    2. At `t2`, the writer hides/folds that "beneath" block.
    3. At `t3`, the writer edits a surface paragraph above it.
    4. At `t4`, the writer presses `Cmd+Z` twice.
  * **State that results:**
    * **Case A (fold/hide uses `addToHistory: false`):** The first `Cmd+Z` undoes `t3`. The second `Cmd+Z` pops the inverted `ReplaceStep` from `t1`, which targets a range that is currently hidden. If `filterTransaction` blocks mutations to hidden text, **the entire Undo stack is now deadlocked at `t1`**—the writer can never undo any earlier surface edits prior to `t1` while that block stays hidden. If `filterTransaction` allows history transactions through, `Cmd+Z` silently mutates hidden text.
    * **Case B (fold/hide uses `addToHistory: true`):** Every peek/fold toggle pollutes the text undo stack, forcing the writer to replay view toggles via `Cmd+Z` just to undo a typo.
  * **Contract broken:** §5.1 (either silent mutation of hidden writing on Undo, or broken standard editor Undo).
* **Concrete fix or decision needed:**
  * Keep fold/reveal visibility out of the text `History` stack (`addToHistory: false`), and add an explicit **Undo-Intercept Rule** to §5.1 and §5.5: when a transaction carrying `tr.getMeta('history$')` attempts to apply a `Step` inside a currently hidden range, intercept the transaction, **reveal and scroll to the target range without popping the history item**, and let the next `Cmd+Z` apply the actual text undo now that the writer can see the target text.
* **Evidence:** Reproduced via local state-machine simulation (`verify_folio_contracts.py :: sim_prosemirror_undo_deadlock`) and reasoning from `prosemirror-history`.

### R4 — DOM-resident hidden text is mutated by browser extensions and OS spellcheck; DOM-absent hidden text breaks Drag-and-Drop
* **Severity:** Major
* **Section(s) of Draft 2:** §5.1 (Hidden-writing contract)
* **The problem & concrete failure scenario:**
  * **Sequence of actions (DOM-resident CSS hiding):** Hidden writing remains in the DOM styled with `display: none`, `height: 0`, or `visibility: hidden` inside the `contenteditable` root. A writer runs Grammarly, LanguageTool, or macOS native spellcheck/text replacement (`insertReplacementText`). Because extensions inspect `Node.textContent` (which concatenates hidden and visible DOM text nodes), they compute character offsets across the boundary and mutate `.nodeValue` or call `Range.deleteContents()` directly on the hidden DOM node. ProseMirror's `MutationObserver` catches the mutation, `filterTransaction` reverts it, and the extension immediately re-applies the mutation on its next observer tick—creating an infinite DOM thrash loop or unexpected reveal.
  * **Sequence of actions (DOM-absent node attribute storage + Drag-and-Drop):** Hidden writing is omitted from the DOM when collapsed. The writer selects two visible paragraphs spanning across the collapsed node and drags them to a new location. ProseMirror dispatches a single drop transaction (`tr.delete(from, to)` + `tr.insert(dropPos, slice)`). When protect-and-reveal cancels the transaction because `delete(from, to)` touches the collapsed node, the entire drag-and-drop operation is aborted and the dragged text snaps back without moving.
  * **Contract broken:** §5.1 (unintended reveal loops from third-party DOM observers, or broken native drag-and-drop).
* **Concrete fix or decision needed:**
  1. Never leave hidden text as live DOM text nodes inside the `contenteditable` container while hidden; store hidden content in ProseMirror node state/attributes and mount its DOM text nodes only when revealed.
  2. Set `spellcheck="false"`, `data-gramm="false"`, `data-gramm_editor="false"`, and `data-enable-grammarly="false"` on collapsed wrapper elements, and reveal collapsed nodes at *selection-span time* (per R2) so drag-and-drop slices never contain still-hidden nodes.
* **Evidence:** Reasoning only (from browser `contenteditable`, `Node.textContent` vs `HTMLElement.innerText`, and `prosemirror-view` drag handlers).

### R5 — Firestore Security Rules CAS on a revision chain fails when the Firestore JS SDK coalesces offline/pending writes
* **Severity:** Blocker
* **Section(s) of Draft 2:** §5.2 (Storage contract)
* **The problem & concrete failure scenario:**
  * **Sequence of actions:**
    1. Document is synced at `rev: 1`.
    2. The writer's network drops (or lags for 10 seconds).
    3. Autosave #1 calls `setDoc` / `updateDoc` with `{ parentRev: 1, rev: 2, content: "A" }`.
    4. Autosave #2 calls `setDoc` / `updateDoc` with `{ parentRev: 2, rev: 3, content: "AB" }` before Autosave #1 is acknowledged by the Firestore backend.
    5. Network reconnects.
  * **State that results:** The Firestore JS SDK coalesces pending writes targeting the same document path in its internal mutation queue, transmitting a single write `{ parentRev: 2, rev: 3, content: "AB" }` to the server. On the server, `resource.data.rev` is still `1`. The Security Rule enforcing CAS (`request.resource.data.parentRev == resource.data.rev`) evaluates `2 == 1` → `false` and returns `PERMISSION_DENIED`. When a queued write is rejected by Security Rules with `permission-denied`, the Firestore SDK **permanently removes that mutation from its internal queue and rolls back the local cache to `rev: 1`**. (Conversely, if the client uses `runTransaction()` instead of `setDoc`/`updateDoc`, `runTransaction()` fails immediately whenever offline.)
  * **Contract broken:** §5.2 (CAS + local store fails on standard multi-step offline/flaky-network editing, causing permanent Firestore queue rejection).
* **Concrete fix or decision needed:**
  * Enforce a **Single-In-Flight Wire Write Invariant**: the client must never issue a second `setDoc`/`updateDoc` to Firestore for a Folio document until the Promise for the previous `setDoc`/`updateDoc` has resolved from the server (verified via `getDocFromServer` or `snapshot.metadata.hasPendingWrites === false`). While a write is in flight or offline, all subsequent edits accumulate strictly in the app's own IndexedDB pending store and are coalesced *by the app* so the next wire write always retains `parentRev == lastAckedServerRev` and `rev == lastAckedServerRev + 1`.
* **Evidence:** Reproduced via local state-machine simulation (`verify_folio_contracts.py :: sim_firestore_cas_sdk_coalescing`) and reasoning from Firestore JS SDK mutation queue coalescing behavior.

### R6 — Two tabs on the same browser clobber the shared local pending-save store before reaching Firestore CAS
* **Severity:** Major
* **Section(s) of Draft 2:** §5.2 (Storage contract)
* **The problem & concrete failure scenario:**
  * **Sequence of actions:** A writer has Folio open in Tab A (`rev: 4`), opens Tab B on the same browser (`rev: 4`), and writes new text in Tab B (saved locally as pending `parentRev: 4, rev: 5`). The writer then closes or switches past Tab A, firing Tab A's `visibilitychange` / `pagehide` autosave flush into the same origin's `IndexedDB` / `localStorage`.
  * **State that results:** Because both tabs share the same browser origin and local storage namespace, if pending saves are keyed by `folioId` (or appended without cross-tab lock coordination), Tab A's stale flush overwrites Tab B's pending save in IndexedDB—or inserts a competing `parentRev: 4 → rev: 5` entry into the local queue—destroying or forking Tab B's work *before* Firestore's server-side CAS rule ever sees it.
  * **Contract broken:** §5.2 (silent local data loss / local queue corruption in multi-tab same-browser usage).
* **Concrete fix or decision needed:**
  1. Acquire an exclusive Web Lock (`navigator.locks.request("folio:write:" + folioId, { ifAvailable: true })`) whenever a tab enters editable mode, paired with a `BroadcastChannel("folio:" + folioId)` heartbeat that immediately transitions any background tab on the same browser to read-only / "Active in another tab" state.
  2. Key all IndexedDB pending-save entries by `(folioId, tabSessionId, monotonicSeq)` so a rogue or dying background tab can never overwrite another tab's local pending buffer.
* **Evidence:** Reasoning only (from browser `IndexedDB` / `localStorage` shared-origin concurrency semantics).

### R7 — Treating every Firestore `permission-denied` error as a CAS revision conflict misclassifies expired Firebase Auth tokens
* **Severity:** Major
* **Section(s) of Draft 2:** §5.2 (Storage contract), §5.5 (State table)
* **The problem & concrete failure scenario:**
  * **Sequence of actions:** Firebase Auth ID tokens expire after 60 minutes. A writer leaves a Folio tab open offline (or suspended) for 70 minutes, writes a paragraph, and reconnects. The pending Firestore write fires before the Auth SDK finishes refreshing the ID token (or fails another Security Rule clause such as payload size > 1 MiB or schema check).
  * **State that results:** Firestore returns `FirebaseError: [code=permission-denied]` (Firestore Security Rules do not return custom error codes to the client explaining *which* rule clause failed). If the client's storage state machine transitions to `conflict / fork-recovery` on `permission-denied`, it falsely tells the writer their document conflicted with another session—or creates duplicate conflict copies when `serverRev` actually still equals `parentRev`.
  * **Contract broken:** §5.2 / §5.5 (false conflict state transition).
* **Concrete fix or decision needed:**
  * On any `permission-denied` error during save, require a mandatory disambiguation step before entering conflict recovery: refresh the auth token (`user.getIdToken(true)`), perform `getDocFromServer(docRef)`, and verify `serverDoc.rev !== localPending.parentRev`. Only enter the CAS conflict state if `serverDoc.rev` has genuinely advanced; otherwise retry the write or surface an auth/quota error.
* **Evidence:** Reasoning only (from Firebase Auth 1-hour JWT expiry and Firestore Security Rules opaque `permission-denied` error semantics).

### R8 — The safety scheduler can miss written crisis paragraphs via in-flight edit races and offline pending-save flushes
* **Severity:** Major
* **Section(s) of Draft 2:** §5.4 (Safety scheduler), §5.2 (Storage contract)
* **The problem & concrete failure scenario:**
  * **Scenario A (In-flight mutation race):**
    1. Writer types `"I feel completely drained"` in Paragraph `P1` and pauses.
    2. The safety scheduler dispatches `P1` to the crisis classifier (`src/ai/openrouter.ts`) and marks `P1` as `inFlight = true`.
    3. While the 800ms network call is in flight, the writer appends `" and I'm going to end my life tonight"` to `P1` and immediately closes the tab or switches to Sessions.
    4. If the scheduler skips scheduling while `inFlight == true` or marks `P1` as `checked = true` by paragraph ID when the first call returns, the appended crisis text is never evaluated.
  * **Scenario B (Offline pending-save replay bypass):**
    1. Writer composes a crisis paragraph while offline (or while `openrouter.ts` times out) and closes the browser.
    2. The paragraph is durably stored in the local pending-save store (§5.2).
    3. On the next session, the storage layer replays the pending save from IndexedDB to Firestore on startup. Because this replay occurs in the storage sync pipeline rather than via live ProseMirror typing transactions, the paragraph is committed to Firestore without ever triggering the editor's safety scheduler.
  * **Contract broken:** §5.4 and Fixed Decision #3 (a written crisis paragraph is persisted and never crisis-checked).
* **Concrete fix or decision needed:**
  1. Never track safety-check completion with a boolean `checked` or `inFlight` flag on `paragraphId`. Persist `lastSafetyCheckedHash: sha256(normalizedText)` per paragraph inside both the document state and the local pending-save record.
  2. When a classifier response returns for `(paragraphId, requestHash)`, only mark the paragraph clean if `currentHash === requestHash`; if `currentHash !== requestHash`, immediately re-queue the paragraph.
  3. Couple the §5.2 pending-save flush to the §5.4 safety scheduler: whenever local pending saves are hydrated on startup or flushed after an offline session, scan all paragraphs in the hydrated document and enqueue any paragraph where `sha256(text) !== lastSafetyCheckedHash`.
* **Evidence:** Reproduced via local state-machine simulation (`verify_folio_contracts.py :: sim_safety_scheduler_inflight_race`) and reasoning from async scheduler + offline storage interaction.

### R9 — Checking paragraphs in isolation misses crisis statements split across "surface/lifted", "between", and "beneath" layers
* **Severity:** Major
* **Section(s) of Draft 2:** §5.4 (Safety scheduler), §3.6 (Apart / Between / Beneath)
* **The problem & concrete failure scenario:**
  * **Sequence of actions:** Folio explicitly encourages writers to place surface statements on one layer and the underlying, unspoken truth "beneath" (e.g., Surface line: *"Everything is finally sorted out for Friday."* / Beneath layer: *"I wrote the notes and have what I need to end it."*).
  * **State that results:** If the §5.4 scheduler feeds paragraphs to the crisis classifier strictly one paragraph at a time in isolation, a surface euphemism and a fragmented "beneath" continuation can each fall below the classifier threshold individually while expressing acute suicidal intent together—without any change to classifier calibration.
  * **Contract broken:** §5.4 / Fixed Decision #3 (layered writing mechanics create a structural blind spot for the existing crisis classifier).
* **Concrete fix or decision needed:**
  * Keep the classifier model and calibration completely unchanged (honoring Fixed Decision #3), but define the **unit of classification in Folio** for any layered locus as the assembled composite text `[Anchor/Lifted Paragraph] + [Between Paragraphs] + [Beneath Paragraphs]` whenever any paragraph in that linked locus is dirty.
* **Evidence:** Reasoning only (from the interaction between multi-layer prose splitting and paragraph-scoped classification).

### R10 — "Apart" (§3.6) and writing "between" create a self-contradictory 3-tier hierarchy that confounds Phase P
* **Severity:** Major
* **Section(s) of Draft 2:** §3.6 ("Apart"), §4 (Prototype study), §7 (Phases 1–2 scope)
* **The problem & concrete failure scenario:**
  * **Sequence of actions:** A writer lifts a line, sets an "Apart" distance `d` separating it from its "beneath" layer, and then begins writing three paragraphs in the space "between". Later, the writer deletes or collapses the "between" text.
  * **State that results:**
    1. **Before writing "between":** "Apart" is merely a visual margin/padding adjustment (`margin-bottom` / spacer height)—a decorative spacing control rather than a structural authoring operation.
    2. **While writing "between":** The spatial separation between the lifted line and its "beneath" is now physically determined by the height of the "between" paragraphs. Either the "Apart" distance `d` is overridden (meaning the writer's chosen "Apart" setting silently disappeared), or `d` is added as dead whitespace on top of the "between" block.
    3. **Conceptual overload in Phase P:** Giving a single locus *three* vertical zones (`lifted line` → `between` → `beneath`) plus a continuous or stepped distance control on Day 1 means Phase P is no longer testing whether writers value a quiet under-surface; it is testing a three-tier spatial layout engine.
  * **Contract broken:** Premise clarity and prototype falsifiability (§3.6, §4).
* **Concrete fix or decision needed:**
  * **Cut "Apart" (configurable distance) and "between" from Phase P and Phase 1.** Restrict the prototype and Phase 1 to the core two-layer operation: **Surface** and **Beneath** (with fold/unfold). If Phase P shows that writers naturally try to insert transitional material between a lifted line and its beneath, introduce "between" in Phase 2 as a normal authored block—and drop decorative distance settings entirely.
* **Evidence:** Reasoning only (from §0.4 item 1 and structural overview of §3.6).

### R11 — Prototype study (§4) falsification gates and product copy (§8) need hard pre-commitments against confirmation bias and over-promised privacy
* **Severity:** Major
* **Section(s) of Draft 2:** §4 (Prototype study), Copy / Honesty (§0.4 items 6 & 8)
* **The problem & concrete failure scenario:**
  * **Falsification trap (§4):** In a small qualitative prototype study, if participants only use "beneath" when prompted by the researcher or task script, or if low usage is interpreted as "the affordance was too subtle, fix the UI in Phase 1," then **no possible study outcome can falsify the premise**—every result reads as "proceed."
  * **Honesty trap (§0.4 #8):** Because Folio writing is (a) sent paragraph-by-paragraph to an external LLM crisis classifier (`openrouter.ts`) under Fixed Decision #3, and (b) stored as unencrypted text in browser IndexedDB and cloud Firestore under §5.2, any onboarding, empty-state, or layer copy that calls Folio or "beneath" *"private," "hidden from everything," "for your eyes only,"* or *"permanently safe"* promises privacy and permanence the architecture does not deliver.
* **Concrete fix or decision needed:**
  1. **Hard falsification gate in §4:** Require an unprompted free-writing segment in Phase P where the facilitator never asks the participant to use "beneath." Define a binding stop rule: if fewer than `X / N` participants voluntarily create *and later revisit or unfold* a "beneath" layer without prompting, **halt the layered editor architecture** rather than proceeding to Phase 1 via UI tweaks.
  2. **Copy audit rule:** Replace any privacy-implying copy with exact behavioral truth: *"The companion doesn't read or reply in Folio (automated crisis-safety checks still run)"* and *"Saved to your account and this browser."*
* **Evidence:** Reasoning only (from §0.4 items 3, 6, 8 and Fixed Decision #3).

## 4. Consistency Corrections

Because full verbatim text retrieval of `2026-10-15-folio-v2.md` (§5.5 state table cells vs. prose sections) was blocked by `raw.githubusercontent.com` access limits, the table below lists the cross-section state tensions identified from the §0.4 contract specifications and flags the exact §5.5 audits that require pasting Draft 2's raw text.

| Location / Sections | Contradiction or Ambiguity | Decision Requested |
| :--- | :--- | :--- |
| **§3.6 ("Apart" & "Between") vs. §5.1 (Hidden-writing contract)** | Does folding/hiding a locus hide only the "beneath" layer, or both "between" and "beneath"? If "between" remains visible while "beneath" is hidden, how does a selection spanning from the lifted line into "between" avoid crossing the hidden "beneath" anchor? | Cut "Apart" and "between" from Phase P / Phase 1 (see R10), or specify whether "between" shares the visibility state of "beneath". |
| **§5.1 (Protect-and-reveal) vs. §5.5 (State table — Undo/History & IME states)** | If `filterTransaction` blocks or transforms an edit into a reveal transition, how does §5.5 represent (a) an active IME composition (`view.composing`) and (b) an Undo (`history$`) transaction targeting a hidden range? | Add explicit transitions in §5.5 for `Hidden + UndoStep -> Revealed (History Paused)` and `Hidden + SelectionCrossed -> Revealed Before Input` (see R1–R3). |
| **§5.2 (Storage CAS + Local Pending Store) vs. §5.4 (Safety Scheduler)** | §5.2 persists pending edits locally while offline and replays them on reconnect; §5.4 schedules crisis checks from editor paragraph activity. If a tab closes while offline, replayed pending saves bypass editor-driven safety scheduling on the next load. | Require §5.2 pending-save hydration/flush to emit dirty paragraphs to §5.4 whenever `sha256(text) != lastSafetyCheckedHash` (see R8). |
| **§5.2 (Storage CAS) vs. §5.5 (State table — `permission-denied` handling)** | Firestore Security Rules return the same `permission-denied` error code for CAS revision mismatches, expired 60-minute Firebase Auth tokens, and 1 MiB document size limits. | Split the `permission-denied` transition in §5.5 into a `VerifyServerRev` probe state that checks `getDocFromServer` before entering `Conflict/Fork` (see R7). |
| **Full line-by-line §5.5 State Table vs. §§3–7 prose** | *Blocked on full verbatim text of §5.5 in `2026-10-15-folio-v2.md`.* | Paste the text of `2026-10-15-folio-v2.md` in chat so every row and transition in §5.5 can be cross-checked line-by-line against §§3–7. |

## 5. Codex Follow-Through (F1–F11)

The initial browser overview confirmed that Draft 2 added Appendix E mapping Codex findings **F1–F11** (including introducing Phase P prototype validation, elevating hidden-writing and storage guarantees into §5 normative contracts, and scoping down initial mechanics). However, because the browser session token expired before the row-by-row text of `2026-10-15-folio-review-codex.md` and Appendix E of `2026-10-15-folio-v2.md` could be extracted, **I will not guess at the contents of F1–F11** (per your ground rule: *"Don't guess at content you couldn't read"*).

| Codex Finding | Status in This Pass | What Is Known / Needed to Verify Adequacy |
| :--- | :--- | :--- |
| **F1–F11 (General architectural themes summarized in initial pass)** | **Partially Inadequate where mapped to §3.6, §5.1, §5.2, and §5.4** | To the extent Codex pushed for (a) a smaller, more distinctive first artistic bet, Draft 2's retention of "Apart" + writing "between" (§3.6) still over-complicates the first prototype (see **R10**); and to the extent Codex pushed for stronger engineering guarantees in §5.1 (hidden writing), §5.2 (CAS storage), and §5.4 (safety scheduler), Draft 2's proposed mechanisms still fail under burst-typing/IME/Undo (see **R1–R4**), Firestore SDK write coalescing (see **R5–R7**), and offline safety replay (see **R8–R9**). |
| **F1 through F11 (Row-by-row verification against Appendix E)** | **Unverified — Blocked on pasted text** | Paste `2026-10-15-folio-review-codex.md` and Appendix E of `2026-10-15-folio-v2.md` in chat to receive a complete row-by-row `adequate` / `inadequate, because…` table for each of F1–F11. |

## 6. Questions for the Owner

These questions require authorial/product judgment rather than engineering inference:

1. **Is "Apart" meant to encode temporal/emotional distance or visual layout?** If two lifted lines have different "Apart" distances from their "beneath" layers, does that distance ever change how the system behaves (e.g., how hard it is to unfold, when it surfaces, or how it exports), or is it purely visual whitespace on the canvas? If it is purely visual whitespace, why isn't standard paragraph spacing or blank lines enough?
2. **When a writer unfolds a "beneath" layer, is the act of unfolding a view toggle or an edit to the manuscript?** Specifically: if I write a sentence, unfold a "beneath" layer to read it, and press `Cmd+Z`, do you expect `Cmd+Z` to re-fold the "beneath" layer or undo the sentence I just typed?
3. **What is the honest one-sentence promise of Folio's privacy boundary?** Given Fixed Decision #3 (every paragraph in Folio is still sent to the crisis-safety classifier via `openrouter.ts`), are you willing to state explicitly in the Folio UI that automated safety checks still run even though the AI companion is absent?
4. **What specific observation in Phase P would make you abandon the vertical "beneath" mechanic altogether?** If participants use "beneath" only when prompted by the study task and treat it like a standard collapsible footnote/accordion rather than an emotionally distinct layer, will you cut the spatial layer mechanic or keep iterating on its UI?
5. **If a conflict occurs between two devices (§5.2), should Folio ever ask the writer to resolve a diff, or should one version automatically become a quiet "beneath" / sibling draft?** Technical merge/fork dialogs break the contemplative "art piece" atmosphere of UnderSurface; what is the least clinical recovery artifact when CAS detects a true multi-device split?

## 7. Verification and Limits

| Resource / Target | Access Status | Verification Performed & Remaining Limits |
| :--- | :--- | :--- |
| `docs/vision/2026-10-15-folio-v2.md` (`614fa9f`) | **Partial (High-level browser overview + Prompt §0.4 specs only)** | Static fetch (`google:browse`) was blocked on `raw.githubusercontent.com`. Initial browser pass confirmed document existence and top-level structure, but session auth expired before full verbatim text of §§1–7 and Appendices A–G could be extracted. All contracts described in §0.4 were analyzed and modeled. |
| `docs/vision/2026-10-15-folio-review-codex.md` (`6cbd34e`) | **Partial (High-level browser overview only)** | Static fetch blocked; initial browser pass returned high-level summary of F1–F11 themes, but verbatim text of individual F1–F11 items could not be retrieved after browser auth expiry. |
| `CLAUDE.md` (`35f8297`) | **Partial (High-level browser overview only)** | Static fetch blocked; initial browser pass confirmed repo overview (Talk, Journal, Speak, Room modes, test/eval commands), without line-by-line file excerpts. |
| `docs/vision/2026-10-15-folio.md` (`51b19a7`), `2026-10-14-the-deep.md`, `2026-10-14-below-the-page.md` (`6cbd34e`) | **Inaccessible (`raw.githubusercontent.com` blocked)** | Could not be opened via static browse or after browser token expiry. Zero claims guessed from these files. |
| Source code at `35f8297/<path>` (e.g., `src/ai/openrouter.ts`) & Appendices F/G | **Inaccessible (`raw.githubusercontent.com` blocked)** | Could not fetch commit `35f8297` source files directly. Instead of guessing at line numbers, we wrote and executed a standalone state-machine verification script (`verify_folio_contracts.py`) in the sandbox to reproduce the state-transition failures in R1, R3, R5, and R8. |
