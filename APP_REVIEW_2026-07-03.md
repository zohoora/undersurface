# UnderSurface — Full Review (2026-07-03)

Scope: code review + holistic/product review, plus a "what to build with a frontier model this week" section. Read-only; no source changed. Method: six parallel review agents (prior-findings audit, AI/safety layer, biometrics, backend/security, frontend architecture, repo health), with the highest-severity claims re-verified by hand against source. Builds on `APP_REVIEW_TREE_AND_FOREST_2026-05-21.md` rather than repeating it.

---

## 0. Headline

Two things matter more than the bug list:

1. **The product has quietly become an AI therapy app.** The code now redirects `/` and `/new` straight into a therapist session (`App.tsx:144-154`). The diary-first flow described in `CLAUDE.md` (LivingEditor, EntryChoice, 3-way choice screen) **no longer exists** — those files are gone. The prior review still called it "a diary"; it isn't anymore. This is the single most important finding, because it turns "you use the word therapist" from a copy nit into a positioning/liability question about the *entire default experience*.

2. **The 2026-05-21 trust findings are 12-for-12 still open.** Only two commits landed since that review, both narrow safety-marker fixes. Every P0/P1 the last review raised reproduces against today's code. Nothing regressed, but nothing on the trust list got fixed either.

The codebase quality is genuinely high — 1,105 frontend + 64 functions tests all green, clean typecheck, clean lint, clean build, thoughtful defense-in-depth on safety. The ceiling is not code quality. It's (a) a handful of real correctness bugs on the *primary* flow, (b) trust/data-lifecycle promises that aren't true yet, and (c) a webcam-biometrics subsystem manufacturing precision it doesn't have and feeding it to an AI that talks to people about their emotional state.

---

## 1. Confirmed correctness bugs (fix these first — they bite real users)

### C1 — Sessions permanently break at 50 messages *(verified)*
`buildTherapistMessages` (`therapistPrompts.ts:426-436`) iterates the **entire** message history with no bound and sends `[system, ...allHistory]`. The server rejects any request with >50 messages with HTTP 400 (`chat.ts:53,148-149`). No client code prunes the history (grep clean). So after ~25 exchanges every send 400s → 3 empty-completion retries all 400 → "The therapist couldn't be reached," forever. The session is bricked, not gracefully truncated. This hits your *most engaged* users — exactly the ones you least want to lose. `buildBoundedTranscript` right below it (`:452`) already has the windowing logic; the live send path just doesn't use it.

### C2 — "Delete account" orphans conversation transcripts and API keys *(verified)*
`handleDeleteAccount` (`account.ts:30-49`) runs `deleteCollection` over every collection — including `sessions` — at lines 36-38, then *afterward* (line 40-41) calls `.collection('sessions').get()` to enumerate each session's `messages` subcollection. By then the parent docs are deleted, so the `.get()` snapshot is **empty** and the `sessions/{id}/messages/*` transcripts are never deleted. `apiKeys` isn't in the collection array at all, so MCP key hashes also survive. In a mental-health-adjacent app, "delete all my data" leaving the transcripts behind is the worst possible place to have a data-lifecycle bug.

> ★ Insight — Firestore's "orphaned subcollection" trap
> Deleting a document does **not** delete its subcollections, and a deleted-but-subcollection-bearing document becomes a *missing* document: it shows up in `.listDocuments()` but **not** in a `.get()` collection query. So the only correct order is subcollections-first (or `recursiveDelete`). This is one of the most common Firestore data-retention bugs, and it's invisible in tests that don't assert on residual docs.

### C3 — "Export all data" silently omits every session conversation *(verified)*
`buildMarkdownExport` binds `const sessions = collections.sessionLog` (`dataExport.ts:48`) — the *summary log*, not the real `sessions` collection, and never touches nested `messages`. So the export the UI labels "Export all data" (`en.ts:59`) and the policy calls a full export (`en.ts:232`) contains none of the actual therapist conversations. Also omits `apiKeys` and `diagnostics`.

### C4 — Browser Back → blank shell on the primary flow *(mechanism verified)*
The `/`→session redirect goes through `navigateTo` which uses `pushState` (`App.tsx:114-117`, `:144-154`), leaving `/` in history. Press Back once and you land on `/`, whose main content is gated on `isSessionRoute`, so you get sidebar + background and nothing else; only a reload recovers. Use `replaceState` for the initial route decision (or resolve `/`→session inside the redirect effect).

### C5 — The risk-parser refactor silently degraded diary-mode's signature typewriter effect
Folding `<<RISK:N>>` parsing into the shared `streamChatCompletion` (`openrouter.ts:236-259`) made **every** caller buffer output until either the marker matches or 80 chars accumulate. Diary "inner voice" parts stream through the same function but never emit a preamble and are spec'd at 5-25 words (~25-150 chars, `partPrompts.ts:374`). Result: any part response under 80 chars is withheld and dumped all at once — the "thoughts emerging from the paper" effect is broken across all of diary mode, with no test guarding it. Fix: gate preamble parsing behind an opt-in flag so non-session callers stream immediately.

### C6 — Polar H10 reconnect leaks a `setInterval` and double-emits
`handleUnexpectedDisconnect` (`polarH10Engine.ts:808-817`) calls `openCharacteristic()` with no teardown; `openCharacteristic` does `this.tickHandle = setInterval(...)` (`:598`), overwriting the still-running handle. Every strap slip → reconnect adds another 5s tick loop, so measurements duplicate, calibration-complete fires twice, and the Firestore doc grows 2×. And the intended "single retry → lost" path is dead code (the retry swallows its own error and never re-throws), so on a true disconnect the widget freezes showing a stale reading while claiming "connected."

### C7 — `hrvSessions` doc grows unbounded and silently stops persisting at 1 MB
`db.add('hrvSessions', sessionId, data)` rewrites the *same* doc every 10s with the full measurement history, and `HrvTimeline.events` is never trimmed (`hrvTimeline.ts:15-18`). O(n²) upload over a session, and once it crosses Firestore's 1 MB limit (~1.5-2 hr webcam session) every write throws `INVALID_ARGUMENT`, swallowed by `.catch(console.error)` — so the back half of a long session persists nothing, with no surfaced error.

---

## 2. The webcam-HRV problem (code + safety + product, all at once)

This is the sharpest concern in the review and it's worth stating plainly.

The webcam rPPG path (~1,850 lines) computes SDNN, pNN50, LF/HF ratio, Baevsky Stress Index, and cardiac coherence — and injects them into the therapist system prompt as authoritative labels ("sympathetic dominant," "stress index: high"). Two problems compound:

- **The input is corrupted.** The worker re-detects peaks over the entire ~28s window every 5s and appends the resulting IBIs (`hrvSignalWorker.ts:1187-1198`), so each beat is re-counted ~6× and the series carries duplicate-junction discontinuities. Every derived metric runs on this. Right formulas, wrong input.
- **Webcam HRV is intrinsically unreliable** even with clean detection — the code itself concedes it (`RMSSD > 200ms → 0`). HR-as-ambient-color at ±5-15 bpm is plausible; *heart-rate variability* from a laptop camera is not.

So the system manufactures clinical-sounding precision from a noisy signal and hands it to an emotionally-sensitive LLM as fact. The Polar H10 path, by contrast, ingests true RR intervals and its HRV math is standard and sound — **that's the version of this feature that earns its keep.**

Recommendation (cheap, high-value): gate `hrvTimeline.buildPromptContext`'s derived-metrics block on `source === 'polarH10'`. Keep webcam HR + autonomic-state *trend* only; stop feeding webcam LF/HF/Baevsky/coherence to the prompt. Longer term, either fix the IBI dedup (track absolute beat timestamps) or stop computing HRV from webcam entirely. The 5-channel respiratory fusion (~400 lines) is the most elaborate code in the repo and nobody yet knows whether the extra channels beat a single channel — collapse it until diagnostics prove otherwise.

---

## 3. Trust & security posture

Data isolation is solid: every function derives the uid from a verified token or an API-key-hash lookup; **no cross-user IDOR is reachable** by a normal user through any function parameter. The MCP key scheme is well done (256-bit CSPRNG, only the SHA-256 hash stored, indexed equality lookup, read-only tools hard-scoped to the owner). Secrets are server-only and never reach the bundle. Give the maintainer credit for those.

Still-open from 2026-05-21:
- **Rate limits are per-instance memory only** (`rateLimit.ts`) — reset on cold start, multiply across instances, provide no real budget protection. `soundscapeApi`/`accountApi` also have gaps (contact form has no limiter → inbox spam).
- **Firestore rules are a schema-free owner wildcard** (`firestore.rules:4-5`) — users can forge their own `consent`, `apiKeys`, `diagnostics`, `memories`, `entrySummaries` records; function-owned collections should be `allow write: if false`.
- **Admin auth is a hardcoded email list** with no MFA and zero audit logging — a single account guards raw read access to every user's entries, transcripts, memories, and diagnostics.
- **Admin settings save silently drops 5 of 9 config sections** (`ALLOWED_CONFIG_KEYS` = `{features, tuning, grounding, announcement}` vs a 9-section `GlobalConfig`). The "Signal Update" feature only mutates `buildVersion`, which is stripped — so **it can never fire**. Save returns HTTP success while discarding the change.

New this pass:
- **Admin auth doesn't check `email_verified`** (`auth.ts:15-24`) — one-line fix (`decoded.email_verified === true &&`), meaningful takeover-surface reduction on the highest-value target.
- **Chat proxy length-caps only `role === 'user'` messages** and trusts client-supplied roles (`chat.ts:153-164`); a caller can send 50 uncapped `assistant`-labeled messages and pass through `reasoning_effort: 'xhigh'` → cost amplification, especially combined with the bypassable rate limiter.
- **The realtime `client_secret` is a directly-usable 10-minute OpenAI credential** with client-controlled instructions (`realtime.ts:61-119`) — a metered pass to your OpenAI account on the priciest model, gated only by the per-instance limiter.
- **Admin insights concatenate user-writable free-text into a prompt with no injection wrapping** (`admin/handlers.ts:346-382`), unlike the chat path.
- **Sentry doesn't scrub diary content** from exception strings (`main.tsx:30-59`); confirm replay masking (`maskAllText`).

Model-cost context (unchanged): `gpt-5.5` ($5/$30 per 1M) and `gpt-realtime-2` (up to $64/1M audio-out) make durable per-user quotas a prerequisite for any public growth, not a nice-to-have.

---

## 4. Holistic / product

Everything the 2026-05-21 review said about positioning still holds, so I won't repeat it. The one thing that's *changed* and matters:

**The app is now a therapy-session app by default, and "therapist" reaches users in the UI.** Three rendered strings present a therapist persona: the Journal presence label "Therapist is listening" (`SessionJournalSurface.tsx:150`), the editor placeholder "The therapist is here, quiet…" (`:70`), and the error banner "The therapist couldn't be reached." (`SessionView.tsx:603`). Combined with a default flow that *is* a therapy session, this is no longer a wording nit — under the FTC's 2025 companion-chatbot inquiry and the APA's 2025 advisory, a product that both calls itself a therapist and defaults every user into a therapist conversation is evaluated by that stronger claim. The differentiated, defensible thing here was always "a private reflective writing space where inner perspectives help you notice patterns." The drift toward "AI therapist" trades the moat for the liability.

Concrete asks:
- Rename user-facing "therapist" → "companion"/"guide"/"listener" (3 strings + persona concept), and put the disclaimer near voice/Real Talk/Relax, not just onboarding.
- Decide the age gate (13+/16+/18+) and design youth safety to match — the FTC inquiry is specifically about this.
- **i18n regression**: the whole app is now Session, but Session ships hardcoded English — both biometric **consent dialogs** are 100% untranslated (legally significant prose), plus ~10 SessionView strings. 16 of 17 locales get English on the primary screen and, worse, on the consent screens. Key *parity* is test-enforced and intact; the gap is un-`t()`'d literals.

---

## 5. What to build with a frontier model this week

You have a Mythos-class coding model for a few days. Spend it on the things where model capability is the bottleneck — coordinated multi-file reasoning, subtle safety/DSP judgment, and eval design — not on mechanical work a cheaper model or a script does fine. In rough priority:

### Feat 1 — A real multilingual crisis-safety layer + eval harness *(highest value, genuinely model-hungry)*
This is the one task here that a lesser model will do *worse*, because it's a precision/recall judgment problem with real scar tissue (your prior classifier over-called grief/metaphor/hyperbole). Build:
- A standalone, schema-enforced L2 classifier that runs **in parallel** in session mode too — today session mode relies on the *same* model self-labeling risk in an in-band `<<RISK:N>>` preamble that fails open to 0 on any malformation, with no independent backstop (the diary path already has the enum-strict version — session mode abandoned it).
- A curated multilingual eval set across all 17 languages (grief, IFS metaphor, gallows humor, coded ideation, non-English idiom) with asymmetric gates (negatives→0, explicit→2). Your `crisisClassifier.eval.ts` is a great start but is English-heavy.
- Calibrate the L1 regex: several patterns (`/with jesus/`, `/can't do this anymore/`, `/rest forever/`) fire on the eval's own negatives and force full grounding episodes on common non-crisis text.
This is safety-critical, judgment-dense, multilingual — exactly a frontier-model job, and the deliverable (an eval set + calibrated thresholds) keeps paying off after the model downgrades.

### Feat 2 — The trust-hardening sprint, done as one coherent pass
The 12 open findings are individually small but *interrelated* — deletion, export, and rules all revolve around one question: "what is the canonical set of user-owned collections and who may write each?" A capable model can hold the whole graph at once and do it right: a single collection registry driving export + deletion + rules + a lifecycle test that seeds every collection and asserts zero residual docs after deletion. Plus the one-line `email_verified` fix, durable Firestore-backed quotas, the admin-config allowlist reconciliation, and per-role message-size caps. This is coordination-heavy, not idea-heavy — the sweet spot for a strong model working across ~15 files without dropping a thread.

### Feat 3 — Decompose SessionView + fix the session state machine
`SessionView.tsx` (805 lines) is the coordination hub for chat, journal, voice, relax, HRV, Polar, consent, persistence, and layout — and it has a genuinely broken surface state machine (Speak pill never activates; `useRef(new X())` reallocates every render). Splitting it into a shell + surface controllers + a session-lifecycle hook + a biometrics-source adapter is the kind of large, careful, behavior-preserving refactor that benefits from a model that can keep the whole call graph in context and not break the 1,105 passing tests. Fold C1 (history windowing) and C5 (streaming flag) into this pass.

### Feat 4 — An honest uncertainty layer for biometrics → prompt
Rather than delete the webcam work, use the model to design a confidence-propagation layer: every metric carries a quality score, the prompt-context builder emits *hedged* language ("resting HR appears steady" not "stress index: high") and drops low-confidence derived metrics entirely, and the therapist prompt is taught to treat biometrics as weak priors. This is a nuanced signal-quality + prompt-design problem that rewards a capable model. Pair it with the missing tests for `computeDerivedMetrics` and the compute handler (currently 0 coverage on the exact math you assert to the LLM).

### Feat 5 — Documentation + CLAUDE.md truth-up (do this first, cheaply)
`README.md` and `CLAUDE.md` describe a product that no longer exists (OpenRouter/Gemini, LivingEditor, EntryChoice, diary-first flow). Every future session — including your frontier-model sessions this week — starts from a false map. Have the model regenerate both from the actual code before doing Feats 1-4, so the expensive work runs on accurate context. ~2 hours, force-multiplies everything after it.

### Ambitious features worth a capable *runtime* model (separate question)
If the question is also "what product features justify a frontier model in production": (a) a genuinely good longitudinal reflection engine that reads across months of entries to surface patterns a person can't see themselves — the actual promise of the product; (b) client-side-encrypted, local-first storage with on-device small-model suggestions for the low-risk path, reserving the frontier model (with explicit consent) for deep reflection — this is the privacy moat that beats Apple Journal/Day One expectations; (c) practitioner-safe session summaries, but only *after* the trust-hardening sprint closes the deletion/export/rules gaps.

---

## 6. Quick wins (< 1 day each)
- `email_verified` check in `verifyAdmin` (1 line).
- Window `buildTherapistMessages` history (fixes C1 — the worst user-facing bug).
- `replaceState` on the initial route (fixes C4 back dead-end).
- Gate webcam derived-metrics out of the prompt (`source === 'polarH10'`).
- Add `apiKeys` to the deletion array + reorder subcollection deletion (fixes C2's key half immediately).
- Rename the 3 user-facing "therapist" strings.
- Add the 64 functions tests to CI (currently type-checked but never run).
- `npm overrides` for the critical `protobufjs` advisory (it's pulled in as a *prod* dep via `@sentry/vite-plugin`).

---

## 7. Repo health (all green)
lint 0/0 · clean `tsc --noEmit` (frontend + functions) pass · 1,105 frontend tests pass (2 skip) · 64 functions tests pass · clean build 4.3s. Bundle: `engines` chunk 627 kB (>500 kB warning) + 6 static/dynamic import conflicts (incl. `hrvSignalWorker`, `i18n`). CI gaps: functions unit tests not run; uses cache-maskable `tsc -b`; no audit step (expected per override policy). Audit: 1 critical (`protobufjs`, prod via Sentry plugin) + firebase-admin transitive cluster (fixable only by deferred major bumps).
