# Folio: feedback for the next draft

**Reviewer:** Codex

**Date:** 2026-10-15

**Reviewed draft:** [2026-10-15-folio.md](2026-10-15-folio.md), the 1,501-line draft identifying `35f8297` as its code-reference baseline.

**Draft SHA-256 at handoff creation:** `3949210560158b4c1a345738e560130bfb864e260291261a9e584353beb195d7`

**Other material read:** [The Deep](2026-10-14-the-deep.md), [Below the page](2026-10-14-below-the-page.md), and focused current-source checks.

**Purpose:** Feedback for the author to create the next draft. This is not approval to implement or deploy.

## Overall judgment

Folio makes the authorship ethic clearer and takes preservation seriously. It is a coherent synthesis, with useful distinctions between writing, invited conversation, historical originals, and generated material.

However, **the implementation is now more fully imagined than the artistic experience**. The early product could become an elegant annotation editor with an ambient reading view. Most of the spatial strangeness is parked in Phase 8, while time and return—the strongest contribution from *The Deep*—arrive after AI replies.

The next revision should make one artistic operation unmistakable, test that operation earlier, and resolve several contracts that currently promise more than their proposed implementations support.

This critique accepts the owner's three decisions:

1. Writing tool first.
2. A complete, separate mode alongside Sessions.
3. The existing crisis-safety stack applies to Folio.

None of the recommendations below requires reopening those decisions.

## What to preserve

- Equal standing for the surface and underside. The second passage is never declared the more honest one.
- The absence of an obligation to converse.
- Intentional keeping, exact original wording, dates, and source links.
- Explicit boundaries between Folio and Sessions, with deliberate transfer by the writer.
- Plain language for controls and companion speech, with artistic expression carried by interaction and material.
- Immediate exits, meaningful keyboard operation, and reduced-motion behavior.
- Space for unresolved relationships between passages.
- The separation of writer-authored and companion-authored material.

## Findings and revision requests

Severity here distinguishes **blockers to implementing the specified contract**, **major design revisions**, and **smaller consistency corrections**. A blocker does not mean the whole vision should be abandoned.

### F1 — Give the first version one consequential artistic gesture

**Severity:** Major

**Sections:** §3.3, §4.6–4.7, §4.11

Lift is promising, but an expandable second text field is not inherently a new medium. Step inside currently changes spacing, light and sound; writing is unavailable, and the arrangement is discarded. Keep preserves the text but not a spatial composition.

The next draft should identify one thing the writer can *make* through the interaction that ordinary annotations do not readily provide.

For example: separating two passages opens a blank space in which a third passage can be written. Keeping preserves that relationship, alongside an understandable linear representation. Another possibility is turning a single object so two readings occupy the same place from different perspectives.

These are examples, not requests to add both features. Choose one meaningful operation and prototype it early. Its distinction should survive with animations disabled.

**Revision requested:**

- Describe the writer's action, what changes, and what remains afterward.
- Distinguish temporary viewing preferences from an intentionally authored composition.
- Make Keep preserve whatever the design claims the writer made. Distance need not always be saved, but the authored relationship should not disappear accidentally.
- Promote one small expressive operation into the early experiment instead of promoting the entire Phase 8 portfolio.

**Evidence to seek:** People use the operation to make a relationship between passages that they would not otherwise have made, and can describe that relationship without repeating the product's explanation.

### F2 — Test the artistic premise before completing the production editor

**Severity:** Major

**Sections:** §7 Phases 0–4; §8

Phase 0 tests technical feasibility. The main creative gate comes after several weeks of engineering, localization and integration. That risks validating a polished implementation of an unproven artistic premise.

The current moderated study also directs participants through the intended loop. It could establish that people can operate the feature without establishing that they would choose to use it.

**Revision requested:**

- Add an early experience study using disposable prototypes: an ordinary expandable annotation, the proposed fold, and one spatial variation.
- Observe whether the forms lead people to compose different relationships between the same words—not merely whether they discover Lift or enjoy the appearance.
- After directed tasks, include unprompted writing. Observe whether participants choose to lift anything and ask what they were trying to do.
- Keep the later integrated study for reliability, accessibility, preservation, and sustained use.
- Include a return after time has passed. Initial curiosity and a meaningful encounter two weeks later are different hypotheses.

This does not require production data, difficult disclosures, or relaxing the safety requirements for an integrated slice.

### F3 — Bring time into the core experiment; separate Return from Overnight

**Severity:** Major

**Sections:** §2, §4.9, §7 Phases 5–6

The synthesis says time is fundamental, but the first study barely experiences it. The margin's AI replies arrive before the work's main temporal behavior.

Overnight is also a separate and weaker proposition as specified. Delaying an ordinary model call does not, by itself, make the answer different or more considered. The honest implementation description is good, but the artistic reason for the delay remains underdeveloped.

**Revision requested:**

- Test a simple, writer-chosen return before adding the AI margin: set something aside, encounter it later, and place new words beside the original.
- Separate Return and Overnight into independent hypotheses and decisions.
- Consider making Overnight **“Come back to this tomorrow.”** The writer encounters yesterday's question and can write again before optionally inviting the companion. Waiting then changes the writer's encounter with the material.
- If delayed AI generation remains, state what the delay contributes beyond withholding an otherwise immediate reply.
- Define the global Return default. Keeping something and allowing it to resurface unsolicited are separate choices; the current per-trace default risks making them feel like one.

### F4 — Define originality positively

**Severity:** Major

**Sections:** §3.2, §3.5–3.6

“Could a chat window do this?” is too broad a rejection test. Universal statements about what chat interfaces can remember, schedule, preserve or generate are unnecessary to the argument and make the vision brittle.

Removing search, lists and formatting also does not prevent Folio from becoming a notes app. It can simply make saved writing harder to use.

**Suggested replacement criterion:**

> Folio lets the writer compose relationships between passages, preserve those relationships, and encounter them differently over time.

**Revision requested:** Judge supporting features against that purpose. Search may eventually help someone return to their own material without becoming the center of the experience. Preserve a small first scope, but do not confuse useful omissions with proof of originality.

### F5 — Preserve history without making Keep feel like an irrevocable statement

**Severity:** Major

**Sections:** §4.7, §6.7; Phase 3 acceptance criteria

Dated originals are valuable. Immutable additions, no correction path, and accumulating versions could nevertheless make people reluctant to Keep. This is an interaction hypothesis worth testing, not an established user response.

There is also a narrower technical mismatch: the proposed rules prohibit updates but permit deleting and recreating a trace at the same ID with different content. Layers have the same property. They therefore do not establish permanently immutable identities, and references can resolve to replacement content.

**Revision requested:**

- Specify an immediate undo and a clear way to create a corrected version while preserving earlier wording.
- Keep deletion understandable and available.
- Choose deliberately between **snapshots the application never silently rewrites** and **identities that can never be reused after deletion**.
- If the former is sufficient, narrow the wording and acceptance criteria. Do not introduce permanent identity machinery unless the artistic purpose requires it.

The point of preserving history is to support authorship and return, not to make a writer feel that an accidental word has become testimony.

### F6 — Replace the save protocol before relying on its no-loss guarantee

**Severity:** Blocker before implementation

**Sections:** §6.6, particularly lines 944–957; Phase 1 lines 1238–1241

Two devices can both load revision 10 and independently save revision 11. The later full-document write replaces the earlier one, while the proposed detector only recognizes a *higher* remote revision. Both writes can be acknowledged and their local recovery copies cleared without preserving both versions.

“Local copy newer than server wins” also needs a defined response to remote deletion; otherwise reconnecting an offline editor can recreate a deleted page.

**Revision requested:**

- Specify a conflict-preserving commit protocol before settling its UI. Possible approaches include independently durable revisions with a reconciled current version, or conditional commits with durable pending local versions.
- Separate local editing from server-acknowledged canonical content.
- Define the relationship between acknowledgement of an older save and a newer unsaved local edit.
- Define offline editing versus remote deletion explicitly.
- Make equal-base concurrent writes, delayed acknowledgements, offline reconnect, and edit-versus-delete mandatory S4 outcomes. Phase 0 should not exit solely because S1 and S2 succeeded.
- Show “Your words are safe on this device” only after a successful durable local write. localStorage can fail; retaining text in memory does not establish reload recovery.

This finding follows from the proposed protocol. It is not a claim that an implemented Folio currently loses data; Folio is not built.

### F7 — Define what hidden writing means to editing operations

**Severity:** Blocker before implementation

**Sections:** §4.5, particularly lines 277–286; §6.5, lines 817–850

With the proposed schema, a selection whose endpoints lie outside a closed underside still contains that underside. The proposed selection guard addresses a selection landing inside a hidden node; it does not address a selection spanning across one.

A focused reproduction using the installed ProseMirror packages and a minimal version of the proposed schema confirmed that spanning copy includes the hidden text and Delete can remove the underside despite `isolating: true`.

Splitting a marked line also produces fragments with the same fold ID in two paragraphs. A single underside cannot sit immediately after both paragraphs. Stripping the later mark to satisfy ID uniqueness silently changes the lifted range.

**Revision requested:**

- Specify spanning selection, copy, cut, replacement, Select All, deletion, splitting, and undo/redo behavior when folds are closed.
- Decide whether splitting a lifted line preserves a multi-paragraph anchor, retains one fragment, or explicitly breaks the fold.
- Distinguish intentional deletion of an entire document from unintended deletion of text the writer cannot see.
- Test these semantics before treating schema A as the recommended solution.
- Replace “switch architectures if two cases fail” with hard requirements. One reproducible case of unintended hidden deletion is sufficient to reject the design until resolved.

These are product semantics before they are editor implementation details.

### F8 — Make safety coverage an explicit, testable contract

**Severity:** Major; resolve before claiming Phase 1 coverage

**Sections:** §5.2, §5.5, §6.8; §4.9 Overnight

Reusing the existing shared classifier is appropriate. The new scheduler and result handling around it need revision.

**Different paragraphs can be lost from the queue.** While one request is running or cooling down, paragraph A settles and is queued; B then replaces it under “newest text wins.” A may never receive L2 classification, and reopening without editing does not trigger another check.

**The context budget can defeat the paired-text promise.** Prefixing an underside with its lifted line and retaining only the last 1,000 characters can remove the very context the design says is necessary.

**Unavailable is indistinguishable from clear.** The current `classifyCrisisRisk` returns risk 0 for HTTP failures, malformed responses, timeouts and network failures as well as successful negative classifications. A dependency exposing only risk cannot reliably implement the promised retry, deduplication and holding semantics. Failure could be recorded as having checked a sample.

**Ask has two incompatible contracts.** The gate signature says it awaits L2; the margin sections describe a race.

**Revision requested:**

- Coalesce revisions of the same unit rather than replacing unrelated pending paragraphs.
- Preserve pending unit identities and specify bounded backlog handling.
- Budget paired context explicitly and define coverage for a long paste.
- Introduce an additive distinction between a classified result and an unavailable check, preserving existing callers' fail-open behavior.
- Define whether an unchecked Overnight request remains pending; do not label failure as successful clearance.
- Choose one Ask contract.
- Evaluate the complete Folio trigger pipeline before Phase 1, including ordinary narrative, quoted speech, literary material, multilingual text, and the established active-risk fixtures. Do not defer all behavioral evaluation until the margin exists.

The request is to repair the surrounding contract, not to retune the shared classifier casually.

### F9 — Treat the cost of a false Shore activation as an open question

**Severity:** Major design clarification

**Sections:** §3.4, §5.1–5.3, §8–9

Keeping the page editable is valuable. It does not establish that Shore is “cheap to be wrong about.” Unexpectedly changing the environment, disabling a chosen experience, and showing crisis resources can feel consequential even when no words are removed.

**Revision requested:**

- Describe the observable state change accurately, without assuming its emotional cost.
- Evaluate false activations during ordinary dark, historical and fictional writing as a distinct usability concern.
- Give the next draft one authoritative state table covering active grounding, the rest-of-visit quiet presentation, and the 72-hour resurfacing exclusion.
- Keep the shared safety stack and its established calibration. This critique does not recommend a new clinical threshold or an unreviewed bypass.

### F10 — Make the plain alternative fully usable for writing

**Severity:** Major

**Sections:** §4.4, §4.13

A read-only Plain view is not a complete alternative to an authoring experience. It can be a useful reading and export view, but it does not establish equivalent access to creating and editing folds.

**Revision requested:** Either provide equivalent editing in the plain representation or demonstrate that the primary editor supports creation, editing, movement and reopening with assistive technology. State which route is the complete authoring path.

Reconsider fading essential controls to 30%. Still visible does not necessarily mean readily perceivable or discoverable. Quietness can come from composition and restraint without making exits or saving status harder to perceive. Assess the actual rendered contrast and focus behavior, not opacity alone.

### F11 — Give delight an interaction, not merely permission to exist

**Severity:** Minor in scope, important to the artistic direction

**Sections:** §3.4, §4.12, §4.14

Currently, play mostly means funny words inside the same solemn presentation. The strange world is described more strongly than it is demonstrated.

**Revision requested:** Add one worked encounter where the writer deliberately makes something disproportionate, awkward or surprising: an enormous blank between two tiny sentences, a fold whose inside exceeds its outside, or a sentence facing its reflection.

Let the writer cause the oddness. Do not classify the text as joyful and automatically apply an effect. Keep the voice plain while allowing the form a wider emotional range than reassurance.

## Consistency corrections

| Sections | Contradiction or ambiguity | Requested decision |
| --- | --- | --- |
| §4.5 / §6.5 / Phase 1 | Closing is view-only, but closing an empty fold deletes document content. | Define this exception and its undo behavior, or stop making closure delete content. |
| §4.6 / §5.7 | Distance is “never recorded,” but the privacy table lists it in local view state. | Choose one and describe it consistently. |
| §3.4 / §5.3 | The narrative disables Step inside for days; the state specification restores features after grounding exits. | Use one authoritative timeline. |
| §4.6 / Phase 2 | Return places the caret at the underside's end; acceptance requires its exact prior position. | Distinguish ordinary Return from Back and write, or choose one behavior. |
| §3.3 / §4.8 | “The writer makes everything that lasts” conflicts with deliberately kept companion notes. | Distinguish authorship from the writer's decision to retain material. |
| §4.9 / §6.8 | Overnight refuses any crisis signal, while the proposed watcher activates on risk 2. | Define what “any crisis signal” means in each gate without silently changing shared thresholds. |
| §5.5 / §6.8 / Phase 5 | Ask races L2 in one place and awaits it in another. | Specify one request/display/cancellation sequence. |

## Suggested shape of the next draft

1. **A short artistic proposition:** the distinctive act, one ordinary encounter, one playful encounter, and one meaningful return after time has passed.
2. **An early experience experiment:** what is being compared, what participants may discover without instruction, and what evidence would change the direction.
3. **A small integrated slice:** the expressive operation plus the preservation, accessibility, and shared-safety requirements that make it trustworthy.
4. **Resolved contracts:** editor selections, conflict-preserving storage, trace guarantees, safety scheduling, and state transitions. Put detailed implementation options beneath those contracts.
5. **Later hypotheses:** margin replies, automatic Return, Overnight, editions and further spatial experiments. They should earn inclusion independently rather than becoming an inevitable roadmap.

Do not respond to this review by adding every suggested feature. The objective is a smaller, more distinctive first experience with stronger promises about how it behaves.

The question the next draft should answer precisely is:

> **What can I make here that I would not have thought to make on an ordinary page?**

That answer should determine the first prototype and its evaluation.

## Verification and limits

- The full Folio draft and both source visions were read during the review.
- Findings about the proposed save protocol and security rules are contract analysis, not production defect reports.
- Hidden-selection copy/deletion and split-anchor behavior were locally reproduced against installed ProseMirror packages with a minimal version of the draft schema. This was not an implemented Folio editor or a complete browser/device test.
- The classifier's conflation of failed checks with risk 0 was checked in `src/ai/openrouter.ts`; grounding behavior was checked in `src/store/groundingState.ts` and its persistence integration.
- No Folio implementation, full application test run, live model evaluation, clinical validation, or deployment was performed for this review.
- Creative conclusions are design judgments and hypotheses to test, not measured outcomes.
- Line references describe the reviewed draft and may shift in subsequent revisions.
- This handoff adds only this Markdown file. It does not alter the Folio draft or application code.
