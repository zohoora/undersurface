# Folio: the autonomous build plan

**Date:** 2026-10-15
**Status:** Ready to run. Every owner decision the build needs is recorded below.
**Design source:** [draft 4](2026-10-15-folio-v4.md) (commit `3c16b4b`). Where this file and draft 4 differ, **this file wins**: it records the owner's decisions of 2026-10-15, made after draft 4 was written.
**Who runs it:** an autonomous coding agent, across as many sessions as it takes. §9 is its progress log. A new session reads this file first, then the log, then continues from the first unfinished step.

---

## 1. The owner's decisions (2026-10-15)

Each was asked one at a time and answered by the owner. They're final for this build.

| # | Question | Decision | What it changes in draft 4 |
|---|---|---|---|
| 1 | The two human studies (Phase P, Phase 3) | **Build everything; each study decision becomes an admin switch.** The disposable prototypes aren't built. The studies stay in draft 4 as optional, for later | §4 and §8 aren't gates. D2a, D2b and D5b become the switches `folioBetween`, `folioDistance` and `folioLiftToday` (§4 below) |
| 2 | How far toward production | **Merge and deploy, flag off.** Branches, PRs, merge on green CI, deploy in order, verify end to end, roll back anything that breaks Sessions | §6 below |
| 3 | Late checks (draft 4 §11 q15) | **Card only on old pages.** A late risk-2 result on a page edited in the last 72 hours starts shore; on an older page it shows the crisis resources card only, with no flattening, no shore line and no `lastGroundingAt` | §5.4's proposed rule is adopted |
| 4 | "I'm okay" (q6) | **Calm the page only.** Moves the page to Quiet; never calls `deactivateGrounding()` | §3.9 and §5.5 as written |
| 5 | The rate limit (q16) | **A separate classifier limit:** `crisis_check` and `signal_check` get their own per-user limiter, 20 a minute, returning a machine-readable `rate_limited` | §5.4 and Appendix B as written |
| 6 | Device verification | **An automated gate here, plus a checklist for the owner.** Playwright in Chromium, WebKit and Firefox (desktop and mobile emulation), synthetic IME composition and key-repeat events, keyboard-only scripts and axe gate the work. Real devices, screen readers, IME keyboards and grammar extensions go on the owner's checklist (§8), which never blocks | S1's "device matrix" exit becomes the automated matrix (§5 below) |
| 7 | Translation | **Translate all now,** into the 16 other locales, including the policy update. No `folio.*` allowlist. Native review goes on the owner's checklist | §6.9's English-only Phase 1 is reversed |
| 8 | Scope cuts (q19) | **Build both** "Make a corrected copy" and the **Edit here** handover between tabs | Restores draft 3.1's handover (§3 below) and §3.7's corrected copy, as specified there |
| 9 | Later ideas (§9) | **H1 Step inside, H2 Ask (the margin) and H3 automatic Return** are built, each behind its own switch. H4, H5, H6 and H7 aren't | Specs in §3 below |
| 10 | Live evals | **The production OpenAI key may be used for evals only,** read inline from Secret Manager and never printed or stored. A failing eval blocks the deploy it gates; the cause is fixed, never the bar | §6 below |
| 11 | Sound in Step inside | **On the web, behind its own switch,** using Room's `forest` and `drone` tracks. `ocean` is excluded. Native apps stay silent | H1 spec |
| 12 | The Journal gap in Sessions | **Leave it.** Not part of this build | — |
| 13 | Name | **Folio** | — |
| 14 | Formatting (q5) | **Italic only:** `Mod+I`, carried through keep, export and print. No bold, headings, lists or toolbar | Schema in §3 below |
| 15 | Remaining defaults | **All accepted:** (1) every feature switch starts on, and automatic Return still needs each writer to opt in; (2) only admins and the test account can open Folio until the owner turns `folioEnabled` on, and no invitation system is built; (3) Folio never enters Sessions' memory; (4) the admin dashboard shows only counts; (5) no re-consent for the policy update; (6) Come back is offered right after Keep and from the kept thing; (7) distances 0, 1, 3, 7, 15 line-heights; (8) desktop polished first, phone covered by the automated tests; (9) merge the plan docs to `main`, fix CLAUDE.md's "(private)", document Folio in CLAUDE.md | — |
| 16 | The production check's account | **A dedicated test account** with a Folio-only access claim, not an admin. Password in the macOS Keychain | §6 below |

**Not in this build:** the prototype study and the integrated study, the prototypes, invitations, H4 (delayed answers), H5 (the edition), H6 (spatial experiments), H7 (search), and the Journal gap.

---

## 2. Standing authorizations, and their limits

The owner authorized these on 2026-10-15 for this build only.

**Authorized:**
- Creating branches, committing, pushing, opening PRs and merging them once CI is green.
- Deploying to production in the required order (indexes, then rules, then functions, then hosting), with the release evals run first (CLAUDE.md, "Deploying Changes").
- Rolling back a deploy that breaks Sessions (§6).
- Reading the production OpenAI key inline for live evals only: `OPENAI_API_KEY="$(firebase functions:secrets:access OPENAI_API_KEY --project undersurfaceme)" npm run test:<eval>`. Never echo it, write it to a file or pass it to a tool that logs it.
- Creating the test account and setting its claim (§6).
- Writing `appConfig/global` is **not** needed: every new switch is on unless explicitly `false`.

**Not authorized, so stop and ask:**
- Any change to the crisis calibration: L1's regexes in `crisisFloor.ts`, the classifier's prompt or thresholds, or `groundingState.ts`'s behavior.
- Any change to Sessions' behavior beyond the seams listed in draft 4's Appendix B and this file.
- Infrastructure outside the deploy list: preview channels, Storage CORS, TTL policies, IAM, DNS, billing.
- Deleting or rewriting any user data, other than the test account's own Folio pages.
- Disabling, skipping or loosening a test, eval or lint rule to get green.
- Force-pushing to `main`, or merging with red CI.
- Spending on anything but evals.

---

## 3. What to build: deltas from draft 4

Draft 4 is the specification. These are the changes to it.

### 3.1 Switches

New feature keys, added to `GlobalConfig.features`, `FEATURE_KEYS` in `functions/src/admin/configSchema.ts` and the admin Settings UI (a collapsed "Folio" section). Unlike draft 4's `folioEnabled`, each sub-switch is **on unless `=== false`**, so it starts on without a production config write.

| Key | Default | Controls |
|---|---|---|
| `folioEnabled` | off (`=== true` to open) | Folio for everyone. Admins and accounts with the `folio` claim can open it regardless |
| `folioBetween` | on | The between (draft 4 D2a) |
| `folioDistance` | on | Closer and Farther, the five stops (D2b). Off: `gap` is fixed at 1 when the between is on, else 0 |
| `folioLiftToday` | on | Lift into today's page (D5b) |
| `folioAsk` | on | H2 |
| `folioStepInside` | on | H1 |
| `folioStepInsideSound` | on | H1's sound, on the web only |
| `folioReturn` | on | H3 is offered in Folio settings. Each writer still opts in |

A switch turned off hides its controls. **It never hides, changes or deletes writing** that used it: a between written while the switch was on stays, is shown, and stays editable.

### 3.2 Access

`canOpenFolio(features, email, claims) = features?.folioEnabled === true || isAdmin(email) || claims.folio === true`, as in draft 4 §6.4. The claim is set only on the test account (§6). There's no admin action and no invitation UI.

### 3.3 Italic

The schema keeps StarterKit's `italic` mark, with `Mod+I`, and disables `bold`. Italic travels through the clipboard transforms, Keep (the kept snapshot stores the composition as ProseMirror JSON for its between and beneath, or as a minimal marked-text form; choose one and test it), Reading view, Markdown export (`*…*`) and print. The `fold` mark and `italic` coexist on the same text.

### 3.4 Edit here, restored

In addition to draft 4 §5.2's queued lock, a read-only second tab offers **Edit here**:
- It asks the holder over `BroadcastChannel('folio:<uid>:<pageId>')`.
- The holder flushes its save, becomes read-only and releases the page lock.
- The waiting tab is granted the lock and runs draft 4's move-to-editable procedure.
- If the holder doesn't answer within 2 seconds (a frozen or discarded tab), nothing changes, and the notice says "The other tab didn't respond. Close it to write here."
- Copy: `folio.otherTab` "This page is open in another tab." and `folio.editHere` "Edit here".
- S4's outcome 11 adds: **Edit here** hands over without loss, including when the holder has unsent words.

### 3.5 Corrected copies, restored

As specified in draft 4 §3.7 ("Make a corrected copy"), §5.3 and §6.6 (`correctedFromId`), with its strings (`folio.correctedCopy`, `folio.correctedFrom`, `folio.earlierWording`). The trace's checked set applies to the copy's changed units.

### 3.6 Live eval files

They follow the repository's pattern, not draft 4's file names: `src/folio/safety/folioSafety.live.test.ts` (`RUN_FOLIO_SAFETY_EVAL=1`, `npm run test:folio-safety`) and `src/folio/ask/folioAsk.live.test.ts` (`RUN_FOLIO_ASK_EVAL=1`, `npm run test:folio`). Both join `scripts/run-release-evals.mjs`.

---

## 4. Specs for H1, H2 and H3

Draft 4 §9 asks each later idea for a one-page spec. These are those pages. Every contract in draft 4 applies; nothing here may weaken one.

### H1: Step inside

- **Entry.** On an open fold, "Step inside" (`folio.stepInside`), in the underside's controls. Keyboard: `Mod+Alt+Enter` (confirm in S5).
- **The space.** A full-screen modal dialog with the same structure as Room: a portal, `role="dialog"` named "‹line›, inside", a focus trap and an `inert` root (`useModalA11y`). The composition is shown alone, in its authored order, at its authored distance, on the paper of the underside, with soft light from the crease edge.
- **Standing distance.** "Stand closer" and "Stand back" (`folio.standCloser`, `folio.standBack`) scale the space between the viewer and the composition: three steps, a viewing distance only, **stored nowhere** (draft 4 §3.6). Text never drops below the page's size or contrast.
- **Leaving.** "Back to the page" (`Esc`) restores the exact previous selection and scroll. "Back and write" puts the caret at the end of the beneath. Both are always visible.
- **Reading only.** No editing inside. One authoring surface keeps C1 in one place.
- **Shore.** Unavailable in Shore and Quiet. If shore starts while inside, the space closes at once and the page is shown in Shore (draft 4 §5.5's H1 row).
- **Motion.** Entering and leaving are 320 ms fades; with reduced motion, instant. No other motion.
- **Sound** (`folioStepInsideSound`, web only).
  - Tracks: Room's `forest.mp3` and `drone.mp3` from `seed-audio/v1/` (`src/hooks/useRoomSession.ts:32–36`). Never `ocean`: no water near anything that may touch distress.
  - The writer picks forest, drone or silence inside the space (`folio.sound.*`); the last choice is remembered per device. The default is silence: sound starts only on the writer's choice, which also satisfies browsers' autoplay rules.
  - Standing distance maps to Web Audio: a gain and a low-pass filter. Closer is quieter and darker. Without Web Audio, volume only.
  - Stops at once on leaving, on shore and when the tab is hidden.
  - CSP: `media-src` already allows `storage.googleapis.com` (Room). Native builds: no sound control is shown.
- **Accessibility.** Screen readers read the composition in reading order, with the distance announced as in draft 4 §3.10. Every control is a 44 px button.
- **Tests.** Component tests for open, leave, both returns, focus trap, closing on shore, reduced motion and sound's start and stop; Playwright for keyboard-only use.

### H2: Ask (the margin)

- **Entry.** With a selection inside a page, between or beneath, the Lift control adds **Ask** (`folio.ask`). Not on a closed underside, not in Reading view, and not while a request is pending.
- **What's sent.** Only the selected text (at most 1,000 characters), which passage it's in (page, line, between or beneath) and the writer's language. Nothing else from the page, and nothing from Sessions' memory (Law 2, draft 4 §3.2).
- **The voice.** A new kernel channel, `'page'`, in `functions/src/shared/companionKernel.ts`'s `CompanionChannel` and `COMPANION_CHANNEL_CAPABILITIES`: no rich actions, no tracked promises, no risk preamble, plain voice. The note:
  - is at most two sentences
  - responds to the words, and never says who the writer is or what they feel, and never names a mood, a part or the "real" meaning (Law 2)
  - may ask one open question
  - never says it will remember, and never promises to come back
  - uses `SAFETY_RULES` verbatim, and the grounded register under grounding or Recent
- **The contract.** Draft 4 §5.4's Ask contract exactly: L1 on the selection first (a hit grounds and sends nothing), then L2 and the generation race, the display waits for L2, and risk 2 before display discards and regenerates grounded. Grounding is read at call time and before display.
- **The note.** Graphite, in the margin beside its passage on wide screens and below it on narrow ones, labelled "Companion" (`folio.ask.label`), visually distinct from the writer's words. Three actions:
  - **Dismiss** (`folio.ask.dismiss`): gone, never stored.
  - **Keep** (`folio.ask.keep`): stored in the page as a labelled companion note (`notes: { id, pid, text, createdAt }[]` on `FolioPage`, in the rules' `validPage`, at most 50), shown beside its paragraph, deletable, exported under "Companion notes", and never part of a trace. Law 1: it lasts because the writer kept it, and it stays labelled.
  - **Copy** (`folio.ask.copy`).
- **Cost.** The chat function's therapist route, quota-counted like any companion turn.
- **States.** Draft 4 §5.5's Ask row: Shore gives a grounded reply with the shore door, Quiet the normal register, and Recent the grounded register.
- **Eval** (`test:folio`, about 30 cases): contradictions, playful pairs, grief, dark humor, a persona poem, a prompt injection inside the selection ("ignore your instructions and…"), and five non-English selections. Checks: at most two sentences; no claim about the writer's identity, mood, part or "real" meaning; no promise to remember; the injection is ignored; the reply is in the writer's language. Pass bar: every case passes, like the other release evals.
- **Tests.** The contract's ordering with fake timers and a fake classifier (L1 hit sends nothing; risk 2 before display regenerates; unavailable displays); keep, dismiss, copy; export; rules.

### H3: Automatic Return (the tide)

- **Opt-in at two levels.** Folio settings gets "Let kept things come back on their own" (`folio.return.setting`), off by default. Each trace gets "May come back on its own" (`folio.return.trace`), off by default, shown only while the setting is on.
- **Eligibility.** A trace with both switches on, at least 14 days after it was kept, not shown by Return in the last 60 days, and with no come-back date of its own pending. Anniversaries (the same date in a later year) come first, then the oldest-kept.
- **Never** within 72 hours of `lastGroundingAt` (the Recent overlay), never in Shore or Quiet, never for a trace stamped `groundedNearKeep`, and at most once per visit.
- **How it appears.** The same slip position as a come-back, worded so it never claims the app thought of the writer: "From what you kept · 14 October" (`folio.return.slip`), with **Open**, **Not now** and **Don't bring this back on its own** (which turns that trace's switch off). A writer-asked come-back always goes first.
- **No notifications,** ever (Law 6).
- **Storage.** `returnEligible?: boolean` and `lastReturnShownAt?: number` on `FolioTrace`, both in the trace rule's updatable keys. The setting goes in `folioPreferences/current` as `returnEnabled`.
- **Tests.** Eligibility across DST and timezones; holds under Recent, Shore and Quiet; once per visit; precedence after asked come-backs; the switch-off action.

---

## 5. Order of work

Each step is one or more PRs. A step is done when its PRs are merged, its gates are green, and, for deploying steps, the production check in §6 passes. The order is chosen so production changes that touch Sessions land first and alone.

| Step | Content | Deploys |
|---|---|---|
| 0 | Merge `docs/folio-vision` to `main`; fix CLAUDE.md's "(private)" | none |
| 1 | The classifier's own limiter and `rate_limited` (functions, with tests); the additive `checkCrisisRisk` (client, with tests). Release evals, then deploy functions and hosting. Verify Talk end to end with the test account | functions, hosting |
| 2 | Phase 0, without the prototypes: S1 as the real editor core (schema, node views, all four C1 layers, K1–K4, I1–I9) with unit and property tests and the Playwright matrix; S4 as the real save controller, pending store, classification by chain, locks (queued, plus Edit here) and the browser harness, with all thirteen outcomes plus Edit here; S5 the key table; S6 the sampler, the checked set and `test:folio-safety`. Output: `docs/vision/folio-spikes.md` with every exit's evidence. **Gate:** every exit in draft 4 §7 Phase 0, with this file's automated device matrix in place of real devices | none |
| 3 | Phase 1a: the switches, access, routing seams, `useGlobalConfigStatus`, the shell, the pages list, Reading view, the first-visit line | indexes, rules, functions (`FEATURE_KEYS`), hosting |
| 4 | Phase 1b: the editor (from step 2), Apart and the between under their switches, italic, the size guard, export, deletion, local cleanup | rules, hosting |
| 5 | Phase 1c: safety and shore: `FolioSafetyWatch`, late checks (decision 3), the shore presentation, I'm okay, Recent, `CrisisResources`' two props, Talk now and Talk now bringing this | hosting |
| 6 | Phase 1d: the art pass and accessibility acceptance (automated), all copy in 17 locales, and the policy update with its tests | hosting |
| 7 | Phase 2: traces, Keep and undo, Add, Name it, the floor, Come back to this, Lift into today's page, corrected copies, the trace's checked set, the delete-page dialog | rules, hosting |
| 8 | H1 Step inside, with its sound | hosting |
| 9 | H2 Ask: the `'page'` kernel channel, the contract, notes, `test:folio` | functions (kernel), rules, hosting |
| 10 | H3 automatic Return | rules, hosting |
| 11 | CLAUDE.md and `.claude/docs/*` document Folio; the owner checklist (§8) is complete; this file's log closes | none |

**Every PR's gates** (draft 4 §6.12, in order; gate on exit codes, never on piped output):
1. `npx tsc -b --force`
2. `npm run lint`
3. `npm run test`
4. `cd functions && npm test` (when `functions/` changed)
5. `npm run test:indexes` (Java 21: `JAVA_HOME=/opt/homebrew/opt/openjdk@21`)
6. the Playwright suite (from step 2 on)
7. `npm run build`
8. the live evals the change touches: `test:crisis` and `test:folio-safety` for anything in the safety path; `test:folio` for Ask; all release evals before any hosting deploy

---

## 6. Deploying, verifying and rolling back

**Before any hosting deploy:** `OPENAI_API_KEY="$(firebase functions:secrets:access OPENAI_API_KEY --project undersurfaceme)" npm run test:release-evals`, then `npm run build:release`. Never use dummy `VITE_FIREBASE_*` values for a production build.

**Order:** `firebase deploy --only firestore:indexes`, then `--only firestore:rules,storage`, then `--only functions` (`--force` if `minInstances` requires it), then `--only hosting`. Wait for new indexes to finish building before deploying code that queries them.

**After every deploy:**
1. `npm run smoke-test`.
2. **Sessions still works:** sign in as the test account in Playwright against `https://undersurface.me`, open a Session, send one Talk message and see a streamed reply. Clear the service worker and Cache Storage first, or the old bundle may still be served.
3. **Folio works** (from step 3 on): sign in as the test account, open `/folio`, and run the step's scripted check: write, lift, close, reopen, reload, and see "Saved". Later steps add keep, come back, step inside, ask and return.
4. Delete the test account's Folio pages and traces.
5. Record the result in §9.

**The test account** (created once, in step 1):
- Email `folio-test@undersurface.me`, email/password, created through the Firebase Auth REST API with the project's public web API key. The address only needs to be unique; no mail is sent.
- The password is random, stored with `security add-generic-password -s undersurface-folio-test -a folio-test@undersurface.me -w <password>` and read with `security find-generic-password -s undersurface-folio-test -w`. Never printed, logged or committed.
- The claim `{"folio": true}` is set with the Identity Toolkit admin API (`accounts:update`, `customAttributes`), authorized by `gcloud auth print-access-token` (the owner's signed-in `gcloud`).
- It completes onboarding like any writer. It isn't an admin, can't open the dashboard and can't read any other account.

**Before every deploy, record the last good commit** in §9: the commit that's live now.

**Rollback:** if a deploy breaks Sessions (the smoke test or Sessions check fails), restore at once:
- hosting: check out the last good commit in a separate worktree, `npm run build:release`, and `firebase deploy --only hosting` from it. (This CLI has no `hosting:rollback`; the console's rollback button is the owner's fallback.)
- functions: redeploy from the previous commit
- rules: redeploy the previous `firestore.rules`

Then record what happened in §9, fix forward on a branch, and redeploy only when the gates and checks pass. A broken Folio with Sessions intact isn't a rollback case: Folio is behind the flag. Fix it forward.

---

## 7. When the run must stop and ask

- Anything in §2's "not authorized" list.
- A gate or eval that fails twice after a real fix attempt, with the failure understood but not fixable inside the contracts.
- A contract in draft 4 that turns out to be impossible as written. Write up what was found and propose a change; don't silently change the contract.
- A production check that fails for a reason that isn't Folio's.
- Spending or account actions not listed in §2.

Everything else, including choices the plan leaves to the implementer, is decided by the run, recorded in §9 with the reason, and carried on.

---

## 8. The owner's checklist (never blocks)

The run writes this out in full in step 11, with exact steps. The owner runs it on their own devices whenever they like. Findings become fixes.

- **Hidden writing on real devices:** iPhone Safari and Android Chrome, each row of draft 4 §5.1's table, including the empty-paragraph Backspace and native Cut.
- **Input methods:** Japanese and Korean keyboards next to and across folds; Android autocorrect; iOS text replacement; a grammar extension (Grammarly or LanguageTool) with folds closed.
- **Screen readers:** the six scripted tasks in draft 4 §3.10, in VoiceOver (macOS and iOS) and NVDA.
- **Undo:** the browser's Edit menu and iOS shake-to-undo on a closed fold.
- **Translations:** native review of Folio's copy and the policy update.
- **Taste:** the five distances, the crease color, Step inside's light and sound, and the feature switches.

---

## 9. Progress log

The run appends one entry per step: the date, the PRs, the gates' results, the deploys, the production check, and any decision it made with its reason.

**2026-10-15 · Step 0: done.** PR #4 merged the plan docs to `main` (`a6e0cef`) and fixed CLAUDE.md's "(private)". CI green. No deploy.

**2026-10-15 · Step 1: started.** PR #5: the classifier routes' own limiter (20/min, `code: 'rate_limited'`) and the additive `checkCrisisRisk`.
- Gates (local): `tsc -b --force`, lint, `npm run test` (1,659 passed), functions type check and tests (361 passed), `npm run build`, all green. The limiter tests fail 3 of 4 against the old shared limiter.
- **Decision:** deploy functions only. The client change has no new caller yet (`classifyCrisisRisk` behaves identically), so it ships with step 3's hosting deploy, and the release evals run then.
- **Test account:** `folio-test@undersurface.me` created through the Auth REST API; the claim `{"folio":true}` set and confirmed with `accounts:lookup`; the password is only in the Keychain (`undersurface-folio-test`).
- **Production check script:** signs in as the test account (password read from the Keychain at run time), completes onboarding, opens a Session, sends one Talk message and waits for a streamed reply. Baseline before any deploy: sign-in, onboarding, Session, Talk reply 200, `crisis_check` 200.
- **Last good commit for rollback:** functions as deployed from `35f8297`.

**2026-10-15 · Step 1: done.** PR #5 merged (`c67d3ee`); CI green. Deployed `functions:chat` only, from a clean worktree of `main`.
- Smoke test 5/5. Sessions check as the test account: sign-in, Session, Talk reply 200, `crisis_check` 200.
- The new limit in production: with invalid bodies (no model calls), the 20th classifier request in a minute returned 429 `{"code":"rate_limited"}` (one had been used by the Sessions check), while an ordinary request still passed the limiter.
- The client's `checkCrisisRisk` ships with the next hosting deploy (step 3).

**2026-10-16 · Step 2: done (pending CI on PR #6).** Phase 0 as real code; the evidence is in [`folio-spikes.md`](folio-spikes.md).
- S1: the editor core (`src/folio/page/`): 30 jsdom tests plus 4 key tests, mutation-checked; 17 browser scenarios on five projects.
- S4: rules with compare-and-swap, `PageSaveController`, tab locks with Edit here, the move-to-editable procedure: 15 unit tests, 10 emulator tests, 4 browser outcomes. In real browsers, the SDK re-sent landed writes in 13 of 18 network-cut runs, each classified as landed (Fable's B1 and B2, confirmed).
- S5: the key table (`Mod+Shift+Enter`, `Esc`, `Mod+Alt+[ ]`, `Mod+Alt+. ,`, `Mod+Alt+Enter`).
- S6: units, samples, keys, `FolioSafetyWatch`, `test:folio-safety` (added to the release evals). Live: recall 40/40 in two runs.
- **Found and fixed:** a character-count L2 floor skipped short Japanese and Chinese crisis statements; it now counts words. The Journal has the same gap (`partOrchestrator.ts:202`, which also skips L1): reported to the owner, not changed (§2).
- **Found, not changed (calibration):** L1 activated on 3 of 8 non-crisis fixtures, including the historical "Ten years ago I tried to end my life", which its historical guard should have deferred.
- **Decisions:** listed in `folio-spikes.md` §5.
- No deploy. The rules change ships with step 3.

**2026-10-16 · Steps 3, 4 and 5: done, together.** PR #7 merged (`f391ee6`); CI green, including the browser matrix.
- **Decision:** ship steps 3, 4 and 5 in one deploy. The editor can't reach production without the safety watch, because the crisis stack covers Folio from the first word.
- **Deploys, in order, from a clean `main`:**
  1. indexes (the two exemptions)
  2. Firestore rules (the `folioPages` carve-out and compare-and-swap)
  3. `functions:adminApi` (`FEATURE_KEYS`)
  4. the release evals, all seven passing (crisis, signals, parts, intentions, stance, depth, folio-safety), then `build:release` and hosting

  Last good hosting before this: the build from `35f8297`.
- **Checks:**
  - Smoke test 5/5.
  - Sessions, as the test account on a fresh session after the opener finished: the message's `crisis_check` 200 and its reply 200.
  - Folio, as the test account, against a local build on production data before the hosting deploy, and again in production after it: write, "Saved", lift by keyboard, write beneath, close, reload (words kept, fold still closed), open, `crisis_check` calls 200, shore on a line the floor matches, "I'm okay" moves to Quiet, delete the test page. All pass.
- **Found and fixed before merge:** the Talk handoff wasn't bound to an account. It's now bound to its uid and cleared on sign-out and deletion. A background security review had flagged `AuthContext`; this was the risk found on review.
- **The Sessions check** now waits for a new session's opener before sending. Before that, a send during the opener's stream was never tested.
- **Not verified live:** that a signed-in account without the claim is bounced from `/folio`. Covered by unit tests and the access logic; noted for a future check.
