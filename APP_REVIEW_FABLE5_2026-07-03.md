# UnderSurface — Fable 5 Review (2026-07-03, second pass)

Scope: full code review + holistic review + "what to spend the Fable 5 window on." Read-only; no source changed.
Method: this review deliberately does **not** repeat `APP_REVIEW_2026-05-21` or `APP_REVIEW_2026-07-03` (same-day, earlier). Instead it (1) independently re-verified the prior reviews' load-bearing claims against current source, (2) ran six fresh-eyes agents over territory those reviews covered thinly — the streaming/voice hook layer, memory/reflection engines, store layer & app shell, backend corners, UX/i18n/a11y — with prior findings explicitly excluded, and (3) synthesizes. Repo health re-confirmed first-hand: clean `tsc --noEmit`, 1,105/1,107 tests green, lint clean.

---

## 0. Headline

1. **The prior review is trustworthy — act on it.** 8 of its 10 highest-stakes claims verified CONFIRMED against source, 2 confirmed-with-corrections (Polar reconnect failure ends in `error` status, not fake `connected`; the HRV 1 MB doc ceiling needs multi-hour sessions since signal dumps are trimmed). Nothing has been fixed since; zero commits landed.

2. **This pass found a second, distinct layer of bugs the prior reviews missed**, concentrated in three places:
   - **The session hook layer has no cancellation discipline** — streams bleed across sessions, fully-received (paid) messages get dropped, double-sends duplicate LLM calls, voice sessions survive their own teardown with a hot mic.
   - **The "living organism" features are silently rotting** — letters can fire after *every* session close, echoes/part-quoting are permanently dead, "recent memories" are actually random or oldest-first, patterns are stored in triplicate.
   - **One safety invariant is violated on the voice channel**: grounding never reaches a live realtime session, so a Real Talk voice conversation keeps its confrontational persona during a detected crisis.

3. **Two one-line production breakages**: the meta-CSP blocks all Relax soundscape audio (dual-CSP intersection), and on mobile the back button covers the sidebar hamburger — the app's only navigation.

---

## 1. Verification of prior findings (all against current source)

| # | Prior claim | Verdict |
|---|---|---|
| C1 | Sessions brick at 50 messages (unbounded history vs server cap; retries can't distinguish 400) | **CONFIRMED** (`therapistPrompts.ts:429`, `chat.ts:148`, `useSessionStream.ts:93-247`) |
| C2 | Deletion orphans session transcripts; `apiKeys` never deleted | **CONFIRMED** (verified by hand, `account.ts:30-49`) |
| C5 | 80-char risk-preamble buffer breaks diary-part streaming for all sub-80-char responses | **CONFIRMED** (`openrouter.ts:49,256-310`; no opt-out; diary parts spec 5-25 words) |
| C6 | Polar reconnect stacks `setInterval`s | **CONFIRMED**; correction: failed reconnect surfaces `error` status, not stale `connected` |
| C7 | hrvSessions doc grows unbounded, writes fail silently | **CONFIRMED** on mechanism; 1 MB ceiling needs multi-hour sessions |
| — | Webcam IBI double-count corrupts all derived HRV metrics | **CONFIRMED** (`hrvSignalWorker.ts:1190-1197`; ~2 overlapping copies at a time, not 6) |
| — | Admin config allowlist strips sections; Signal Update can never fire | **CONFIRMED and worse**: frontend `GlobalConfig` has **no `tuning` key at all** — `defaultResponseSpeed`, `atmosphere`, `partIntelligence`, `engagement`, `voice`, `buildVersion` are all top-level and all silently stripped on save |
| — | `verifyAdmin` skips `email_verified` | **CONFIRMED** (`shared/auth.ts:15-24`) |
| — | Session-mode L2 risk is preamble-only, fail-open; no standalone classifier (diary mode has one) | **CONFIRMED** (`openrouter.ts:220-258`, `sessionOrchestrator.ts:96-98`) |
| — | Functions' 64 tests never run in CI | **CONFIRMED** (ci.yml only type-checks functions) |
| — | Both biometric consent dialogs hardcoded English | **CONFIRMED** (no i18n import in either file) |

Also re-verified by hand: `/` redirects into a session via `pushState` (`App.tsx:153`); `LivingEditor`/`EntryChoice` no longer exist — **CLAUDE.md and README describe a product that is gone.**

---

## 2. New findings (this pass)

### A. Session runtime correctness (streaming/voice hooks) — the systemic cluster

**A1. [P0] Cross-session stream bleed.** SessionView isn't keyed by sessionId (`App.tsx:364`) and the init cleanup only clears the typewriter timer — an in-flight therapist stream is never aborted on session switch, and `finalizeMessage` has no session guard (`SessionView.tsx:103-135`, `useSessionStream.ts:167-177`). Switching A→B mid-stream renders A's tokens in B, then finalize **replaces B's message list with A's** and stamps A-derived `messageCount` into B's Firestore doc. Back-navigation mid-stream interleaves two live streams into one shared typewriter and persists garbage into both sessions.

**A2. [P0] Paid responses silently dropped; UI bricked.** The typewriter reveal lags the network stream; navigating away in that window clears the timer, so the already-complete response's `finalizeMessage` never runs: the message is never persisted (paid tokens lost) and `isStreaming` stays `true` forever — input row hidden, send blocked, until remount (`useTypewriter.ts:67-72`, `useSessionStream.ts:208-213`).

**A3. [P1] Double-send race.** `handleSend`'s only guard is stale render state; the editor isn't cleared until after a full Firestore server ack. Double-Enter duplicates the user message and launches two concurrent LLM streams into one typewriter (`SessionView.tsx:218-232`).

**A4. [P1] Voice `start()` has no cancellation.** Stop/unmount during the connect phase still establishes the full session: hot microphone, live RTCPeerConnection, billed OpenAI realtime session with no owning UI (`useVoiceSession.ts:139-262`).

**A5. [P1 — safety] Grounding never reaches a live voice session.** Instructions are built once at start with `isGrounding` frozen (`useSessionVoice.ts:88-113`, verified by hand). Crisis keywords mid-voice activate grounding UI, but the realtime model keeps the Real Talk persona for the rest of the voice session. The text path enforces the "distress disables Real Talk, no exceptions" invariant per prompt; the voice channel silently violates it. `sendSessionUpdate` already exists (used only for speech speed) — push rebuilt grounded instructions or stop the voice session.

**A6. [P1] Unserialized read-modify-write on `messagesRef`.** Four writers (user append, stream finalize, voice user transcript, voice assistant transcript) race across awaits; last-writer-wins loses messages from UI and understates `messageCount` (`useSessionStream.ts:272-302`, `useSessionVoice.ts:50-77`).

**A7. [P1] Relax sessions are never recorded as completed.** `end()` captures a one-tick-stale `elapsedMs`, so `reachedPlanned` is structurally false on every natural completion (`useRelaxSession.ts:189`). Completion analytics are all zero.

**A8. [P2] Retry loop conflates errors with empty completions** — every failure (400, network drop, timeout) is retried 3× at full prompt cost with the wrong user-facing message; mid-stream failure also wipes the partial text the user was reading (`useSessionStream.ts:214-252`). The 30s stream timeout is fixed wall-clock, not inactivity-based, so slow reasoning + long replies abort healthy streams and re-bill (`openrouter.ts:123`). Repetition-loop trimming is dead on the session path (persisted text is the untrimmed typewriter buffer).

*Root cause, stated once: nothing in the hook layer can be aborted or epoch-fenced, and message appends aren't serialized. One shared "session runtime" (AbortController/epoch per session lifetime + a promise-queue for appends + flush-on-exit typewriter) fixes A1-A8.*

### B. The living-memory layer — the product's moat is silently broken

**B1. [P1] Letters can fire after every session close.** `checkForLetter(totalEntries)` gates on `entryCount % letterTriggerEntries === 0`, but nothing writes `entries` anymore (diary flow removed) — count is 0 forever and `0 % 10 === 0` (`sessionReflectionEngine.ts:234`, `letterEngine.ts:18`). With `lettersFromParts` on: one letter LLM call + doc per close.

**B2. [P1] Echoes and part-quoting are permanently dead.** Summaries store `entryId: sessionId`; both engines look that id up in `entries` — always undefined, after a full `entrySummaries` collection scan (`echoEngine.ts:59`, `quoteEngine.ts:48`).

**B3. [P1] Pattern memories stored in triplicate** (once per manager/self part), then merged from exactly those three parts — the same string can fill 3 of the 4 pattern slots in every therapist prompt (`sessionReflectionEngine.ts:124-141`, `sessionContextLoader.ts:36-40`).

**B4. [P2] "Recent" is wrong twice.** Therapist prompt slices the tail of a newest-first array — the **oldest** items in the window, dropping the latest session's insights (`therapistPrompts.ts:337-341`). Part memories are fetched with no `orderBy` — document-ID (random) order labeled "Recent observations" (`partOrchestrator.ts:155`, `partPrompts.ts:302`).

**B5. [P2] Quiet-return is penalty-only.** `markQuiet` is never called, so the return bonus/prompt/animation are unreachable while the −40 quiet penalty runs — quiet parts get quieter forever (`quietTracker.ts:35`, `partOrchestrator.ts:294`).

**B6. [P2] Second-order injection hole.** Entry summaries reach part prompts unsanitized (`partPrompts.ts:329-334`) — the only consumer of these LLM-derived, user-influenced fields that skips `sanitizeForPrompt`.

**B7. [P2] One extra LLM call per session user message** — `analyzeEmotionAndDistress` fires unthrottled every turn (journal mode throttles the identical check to 30s), feeding `innerWeather`, which is write-only unbounded growth nothing ever reads back (`useSessionStream.ts:309`, `weatherEngine.ts:109`).

**Prompt budget, measured:** a fully-populated therapist system prompt is ~4,700-5,000 tokens (personalFacts ≈1,050 the largest block; RISK+core+recommendation boilerplate ≈2,000 fixed every turn), plus unbounded resent history → **6,500-9,000 input tokens per turn** for a heavy user. Pruning exists only for part memories and profile arrays; entrySummaries, sessions/sessionNotes, innerWeather, sessionLog, thoughts, letters, and `part.learnedKeywords` grow forever (learnedKeywords also saturates `contentRelevance` at its 30-point cap, flattening part selection).

### C. Store layer, app shell, cost

**C-1. [P0] Dual-CSP intersection blocks all Relax soundscape audio in production.** Header CSP allows `media-src https://storage.googleapis.com`; the meta CSP in `index.html:6` still says `media-src 'self' blob: capacitor:` — browsers enforce the intersection; `el.play().catch(console.warn)` swallows it. (Meta CSP also lacks `api.elevenlabs.io` in connect-src and still allowlists `openrouter.ai` — it's stale wholesale.) Fix: single source of truth, inject at build time.

**C-2. [P1] Cross-account bleed on sign-out/sign-in (one tab).** `isReady`/`hasConsent`/`initError`/route never reset on auth change (`App.tsx:94-164`): new user B can get a session doc created and an LLM opener fired **before accepting terms**; B can land on A's `/session/:id` (dead view); the WeatherEngine singleton carries A's last-20 emotions into B's context and can write A-derived docs into B's collection; diagnostics dedup timers can flush A's summaries into B's collection (`weatherStore.ts:5`, `diagnostics.ts:110-156`).

**C-3. [P1] The app cannot boot offline** — `initializeDB` calls a `count()` aggregation, which never serves from cache; boot dies at "Failed to initialize" despite full offline persistence (`db.ts:72,194`, `App.tsx:130`).

**C-4. [P1] Unbounded `sessions` scans.** Sidebar polls the full collection every 60s (`EntriesList.tsx:59`); session open scans it again to keep 5 notes (`sessionContextLoader.ts:19`). Boot for a 6-month daily user ≈550-600 reads; the poll ≈10,800 reads/hour/tab. Also unbounded on hot paths: entrySummaries (5+ sites), sessionLog per part-thought (`ritualEngine.ts:45`).

**C-5. [P1] Admin global-config overrides get baked into localStorage as user choices** — once a device saves any setting, later admin changes can never reach it; browser-detected language freezes at first save (`settings.ts:104-112`).

**C-6. [P2] Crisis events flow to Google Analytics keyed to uid.** `grounding_activated` + per-event detected `emotion`, on the same GA property wired to Google Ads conversions, with `setAnalyticsUser(uid)` (`groundingState.ts:36`, `AuthContext.tsx:52`). Sensitive-category health signal attached to an advertising identifier — drop the params or unlink the uid.

**C-7. [P2] Default timezone is hardcoded `America/New_York`** — defines "today's session" boundaries for every user who never opens that setting (`settings.ts:50`). Use `Intl.DateTimeFormat().resolvedOptions().timeZone`.

**C-8. [P2] Export also drops `personalFacts`, session notes, innerWeather, consent** from the rendered output while paying to read them (incl. multi-MB hrvSessions with signalDumps) (`dataExport.ts:234-249`).

### D. Backend (new, beyond prior findings)

**D1. [P1] The chat SSE proxy never aborts the upstream OpenAI request on client disconnect** — no AbortSignal, no `res.on('close')`; every abandoned tab bills gpt-5.5 to completion (`chat.ts:178,228-252`). Also: no backpressure handling; a mid-stream upstream error is swallowed by `finally { res.end() }` with no error frame — truncation looks like clean completion.

**D2. [P2] MCP `list-entries` accepts unbounded `offset`** — Firestore bills every skipped doc; one call with `offset: 5_000_000` ≈ 5M billed reads, 60×/min per key (`mcp.ts:101,116`). Cap it or use cursors. `get-conversation` also reads entire message subcollections unbounded.

**D3. [P2] MCP `list-conversations` with `status` requires a composite index that doesn't exist** (`firestore.indexes.json` has none) — throws at runtime, returns JSON-RPC 500.

**D4. [P2] `handleGetUserList` full-scans every user's entries+sessions serially on every dashboard load** — O(total docs), unbounded concurrency-wise worse than the known `refreshAnalytics` issue (`admin/handlers.ts:96-139`). Use `count()` aggregations.

**D5. [P2] Soundscape cache-miss stampede** — no lock/claim; concurrent misses for the same prompt double-bill ElevenLabs (`soundscapeApi.ts:52-66`, `soundscape/cache.ts:66-113`).

**D6. [P2] `deleteAccount` is non-atomic and non-idempotent** — mid-way failure leaves a half-deleted account with the Auth user still live; retries re-run against missing data. Tombstone-first, subcollections-before-parents, safely re-runnable.

### E. UX / accessibility / i18n

**E1. [P0] Mobile: the session back button covers the sidebar hamburger** — both 36×36 fixed top-left; back button z-40 over hamburger z-11 (`SessionView.tsx:424-441`, `EntriesList.tsx:123-130`). Every route is a session, so mobile users lose access to history, settings, language, theme, and sign-out. With biometrics on, the biometrics bar (z-50) covers it instead.

**E2. [P1] Camera-denied / Bluetooth-failure states are invisible.** Errors render only inside `BiometricsBar`, which mounts only when `enabled === true` — which never happens on denial. User consents → denial → *nothing happens* (`useHrvSession.ts:111-119`, `usePolarH10Session.ts:114-122`, `SessionView.tsx:449`).

**E3. [P1] Zero `prefers-reduced-motion` handling in the codebase** (grep: 0 hits). Worst case: `BilateralPulse` — EMDR-style alternating left/right flashes that **accelerate to a 1.8s period when the user is detected angry/anxious** (`BilateralPulse.tsx:5-16`). Unrequested bilateral stimulation ignoring the OS vestibular-safety setting, in a mental-health app.

**E4. [P1] Consent dialogs have no dialog semantics** — no `role="dialog"`, no `aria-modal`, no focus trap/restore, no Escape, on legal consent surfaces. Session history items are click-only `<div>`s invisible to keyboard/screen readers (`EntriesList.tsx:211-234`).

**E5. [P1] ~85 hardcoded English strings render in UI paths** (~64 beyond the known set). The entire biometrics surface (~42 strings) has no i18n keys at all; VoiceField overlay ≈11 more; mic-denial shows raw exception text ("SDP exchange failed: 401…") at 12px/50%-alpha with no retry.

**E6. [P2]** Toggling Real Talk silently persists as the default opener for all future sessions (`SessionView.tsx:296-301`); invalid `/session/:id` renders a silent dead composer; the only session-close affordance is an 11px button at opacity 0.5/0.2; ThinkingSpace auto-closes a part's reply after 15s with no way to reopen.

---

## 3. Holistic review — five themes

**Theme 1 — The pivot left phantom limbs.** The diary→session pivot amputated the `entries` collection but not the organs wired to it: the letter trigger counts it (fires always), echo/quote engines look up into it (dead forever), export reads it, CLAUDE.md/README still describe it. **When you remove a subsystem, grep for its consumers.** The product's differentiator — the living, remembering organism — is precisely where silent breakage concentrated, because these features fail soft: no error, just absence. Nobody notices a letter that doesn't arrive or an echo that never surfaces. The fix isn't just repairing each engine; it's adding *feature-health telemetry* (a counter per living-feature firing, visible in admin) so the organism's vital signs are observable.

**Theme 2 — No cancellation discipline in the hook layer.** ~10 confirmed bugs are one missing abstraction: an epoch-fenced, abortable session lifetime plus a serialized append queue. This is also why SessionView (805 lines) resists safe modification — every new feature wires into shared mutable refs with no fences.

**Theme 3 — Safety is enforced per-prompt, not per-channel.** The Real Talk grounding override is genuinely load-bearing and well-tested — on the text path. The voice channel violates it (A5); session-mode L2 remains fail-open in-band; grounding events leak to ad-linked analytics (C-6). The invariant needs to move up a level: *any* channel that renders persona output must re-derive persona from current grounding state.

**Theme 4 — Costs leak at every layer and compound.** Unbounded history resent per turn (6.5-9k tokens) × retry-on-400 ×3 × per-turn emotion calls × SSE-no-abort × fixed 30s timeout re-bills × double-send races × 10k reads/hour sidebar poll × MCP offset lever. Individually tolerable; multiplied, they set your unit economics. A durable per-user quota (the May review's ask) is still the missing backstop.

**Theme 5 — Trust debt is now the oldest open item.** Deletion/export/rules/admin-audit findings are 6+ weeks old, confirmed twice, and this pass added consent-before-LLM-call bleed (C-2) and GA crisis events (C-6). For a product whose only durable moat is "this is the private place," these are the difference between a moat and a liability. The positioning analysis in the two prior reviews stands; I won't repeat it — but note every new finding here (voice grounding, bilateral stimulation, untranslated consent) lands on the same side of the scale: the app's ambition is currently ahead of its duty of care.

**What's genuinely good** (credit where due): the streaming parser's invariant comments, the promptSafety design (preserve-but-label user content), the L1 crisis normalization (zero-width/fullwidth evasion), the Polar H10 protocol work, the test discipline (1,105 green, i18n parity enforced), and the uid-derivation posture across all functions (no reachable IDOR). The craft is real; the gaps are discipline patterns and product focus, not skill.

---

## 4. Roadmap (ordered)

**Now (breaks users today / one-liners):**
1. Meta CSP `media-src` += `storage.googleapis.com` — restores Relax audio.
2. Mobile back-button offset (`left: 60px` or hide near hamburger).
3. Window therapist history client-side (fixes the 50-message brick).
4. `email_verified` in `verifyAdmin`.
5. `.limit(50)` both sessions scans; swap sidebar poll for one `onSnapshot`.
6. Letter trigger: gate on closed-session count with "crossed a multiple" semantics.
7. Strip `grounding_activated` params / unlink GA uid.
8. Synchronous `sendInFlightRef` in `handleSend`; clear editor immediately.
9. `replaceState` for the initial route redirect.
10. Run functions tests in CI.
11. `slice(0, n)` + `orderBy('timestamp')` memory fixes; sanitize summaries in partPrompts.

**This week (the Fable 5 window):** see §5.

**Next cycle:** durable quotas + entitlements; data-lifecycle unification (if not done in window); a11y pass (dialog semantics, reduced-motion, keyboard nav); i18n backfill (~85 strings, consent dialogs first); admin config allowlist reconciliation; MCP offset cap + composite index; SSE abort propagation; deleteAccount idempotency.

**Strategic (unchanged from prior reviews, still right):** pick the wedge (privacy-first dialogic journal), rename user-facing "therapist," decide the age gate, client-side encryption exploration.

---

## 5. What to spend the Fable 5 window on

Principles: spend frontier capability where *judgment density* and *coordination breadth* are the bottleneck — interleaved-async reasoning, safety calibration, architecture that must hold 15 files in head at once. Have Fable 5 write executable specs for the mechanical work so cheaper models can finish it after the window closes.

**Feat 0 — Truth-up CLAUDE.md + README first (~2h).** Every session this week starts from a false map (diary flow, OpenRouter, LivingEditor all gone). Regenerate from actual code. Force-multiplies everything below.

**Feat A — The Session Runtime Kernel** *(highest engineering leverage — fixes ~10 confirmed bugs as one design)*. Build a small, testable session runtime: epoch-fenced lifecycle (one AbortController per session lifetime, checked after every await), a serialized message-append queue, flush-on-exit typewriter, and a send lock — then decompose SessionView into shell + surface controllers around it. Fold in the prior review's C1 (history windowing), C4 (replaceState), C5 (preamble opt-out flag). Write interleaving regression tests (vitest fake timers: switch-mid-stream, back-mid-stream, double-Enter, voice-connect-then-leave). This is exactly the class of work where a frontier model outperforms: the bugs live in the *interleavings*, not the lines, and the refactor must stay behavior-preserving across 1,105 tests.

**Feat B — Cross-channel crisis safety + multilingual eval harness** *(highest judgment density)*. (1) Fix A5: grounding pushes rebuilt instructions into live voice sessions via `session.update`, or ends them. (2) Standalone schema-enforced L2 classifier in session mode (parallel to the in-band preamble; preamble absence becomes a diagnostic, not a silent risk-0). (3) Calibrate the L1 regex against known over-callers. (4) Build the 17-language eval set (grief/metaphor/gallows-humor/coded-ideation negatives and positives, asymmetric gates) — your scar tissue about over-calling is precisely why this needs a top model's precision/recall judgment. (5) Red-team the second-order injection path (B6) with adversarial memory contents. The eval set keeps paying after the model downgrades.

**Feat C — Memory system overhaul** *(the moat repair — my top differentiated recommendation)*. The product's promise is longitudinal memory, and today it feeds prompts random/oldest/triplicated data while its features rot silently. Design once: a single MemoryStore with (a) recency+relevance scoring and content dedup, (b) a *token-budgeted* context packer (give the prompt builder a budget, let it allocate across facts/memories/notes rather than fixed slices), (c) repaired living features keyed to sessions not entries (letters, echoes, quotes, quiet-return), (d) a pruning/TTL policy for the seven never-pruned collections, (e) bounded reads (`limit` + `where` everywhere), and (f) feature-health counters surfaced in admin. This is simultaneously data architecture + prompt design + product judgment — frontier-model territory — and it's the work that makes the app *feel* alive again.

**Feat D — Data-lifecycle unification** *(trust; coordination-heavy)*. One canonical collection registry driving deletion (tombstone-first, recursive, idempotent), export (complete `data.json` + readable `journal.md`, including session messages), per-collection write rules, and a lifecycle test that seeds every collection and asserts zero residue after deletion. ~15 files, no hard ideas — the failure mode is dropping a thread, which is what a strong model prevents.

**Feat E — Cost-hardening spec (write with Fable 5, execute with anything).** SSE abort propagation, durable Firestore-backed per-user token quotas, inactivity-based stream timeout, error-taxonomy retry loop, per-turn emotion-call throttle, MCP offset caps + composite index, soundscape claim-based dedup, admin count() aggregations. Have Fable 5 produce the spec + the two subtle parts (quota transaction design, SSE abort semantics); the rest is mechanical.

**Suggested allocation for "a few days":** Day 1 — Feat 0 + the §4 quick wins + start Feat A. Day 2 — finish A, then B. Day 3 — C (and D if time); close by having Fable 5 write the Feat E spec and a prioritized handoff doc.

**Ambitious *runtime* features worth designing in the window** (build the architecture now even if shipped later):
- **A simulated-user eval harness**: synthetic personas (grief, crisis, resistance, each in several languages) run full scripted sessions against the real prompt stack with mocked transport; an LLM judge scores safety, register, pattern-naming quality, non-clinical framing against a rubric. This becomes the regression suite for every future prompt change — the single most durable artifact a frontier model can leave behind.
- **Client-side encryption / local-first architecture** — the privacy moat that out-positions Apple Journal/Day One expectations; needs a real key-management design (this is a design doc + spike, not a weekend ship).
- **The longitudinal insight engine** — "here's what changed in you over three months," reading across the repaired MemoryStore. This is the product's actual promise, and it's only worth building *after* Feat C gives it clean inputs.

---

## 6. Repo health

Clean `tsc --noEmit` (verified this pass) · 1,105/1,107 tests green in 2.9s · lint clean · functions tests exist (64) but not in CI · bundle: `engines` chunk >500 kB warning + static/dynamic import conflicts (known) · `protobufjs` critical advisory via `@sentry/vite-plugin` (known; use `npm overrides` per your policy, don't bump firebase-tools).
