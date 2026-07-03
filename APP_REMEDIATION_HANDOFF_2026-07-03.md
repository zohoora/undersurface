# UnderSurface — Remediation Handoff

**Date:** 2026-07-03
**Scope:** Full execution of `APP_REVIEW_FABLE5_2026-07-03.md` — every fix plus the Fable-5 feature recommendations.
**Result:** 54 commits on `main`, shipped in 8 verified, deployed stages. All frontend + functions tests green; lint clean; post-deploy smoke test 5/5 on each deploy.

This document is the record of what changed, what's now live, how to operate the new capabilities, and what was deliberately deferred.

---

## How the work was staged

Each stage was self-contained: small coherent commits, `npx tsc -b --force` + full test suite + lint before every commit, deploy at the stage boundary, then `npm run smoke-test` against the live site. Pushes to `main` trigger CI. Nothing was committed on a red build.

| Stage | Theme | Deploy |
|---|---|---|
| 0 | Docs truth-up (CLAUDE.md + README to session-first reality) | — |
| 1 | Production-breakage fixes + quick wins | hosting |
| 2 | Cross-channel crisis safety + multilingual eval | functions + hosting |
| 3 | Session runtime kernel (streaming, append serialization, voice) | hosting |
| 4 | Memory system overhaul (packing, pruning, echoes, dedup) | hosting |
| 5 | Webcam HRV gate + fix + hedge | hosting |
| 6 | Data-lifecycle unification (deletion, export) | functions + hosting |
| 7 | Cost hardening + **durable token quotas** | functions + hosting + rules + indexes |
| 8 | UX / a11y / i18n backfill | hosting |

---

## Load-bearing invariants (do not regress)

- **Crisis safety is layered and never quota-gated.** L1 sync regex (`checkCrisisKeywords`) runs before generation; L2a in-band `<<RISK:N>>` preamble aborts + retries grounded pre-first-token; L2b standalone `classifyCrisisRisk` backstops grounding. Crisis-check LLM calls are explicitly **exempt** from the new quota. `classifyCrisisRisk` returns `{ risk: 0|1|2, reason? }` — not a bare number (a comparison bug there shipped dead code once; see `0e1f737`).
- **Real Talk grounding override:** `useRealTalk = mode === 'real_talk' && !isGrounding`. Distress disables Real Talk, no exceptions.
- **Type-check with `npx tsc -b --force`.** `tsc --noEmit -p tsconfig.json` checks **zero** files (it's a solution config) — a false green that let a real bug ship. This is now in CLAUDE.md and memory.
- **Webcam HRV metrics are hedged out of the prompt.** Only HR + trend (hedged) reach the model from the camera source; SDNN/pNN50/LF-HF/Baevsky/coherence are computed + stored for offline analysis but not fed to the AI. Polar H10 keeps full metrics.

---

## New capability: durable per-user token quota (Feat E)

The chat proxy (`functions/src/chat.ts`) is the single LLM-billing egress. It now enforces an **optional, admin-configurable monthly cap** on completion (output) tokens per user.

**It is OFF by default.** Nothing changes until an admin enables it.

### How to enable / configure

Set a `quota` object on `appConfig/global` (via the admin config editor — `quota` is now in the allowlist):

```json
{
  "quota": {
    "enabled": true,
    "monthlyTokenCap": 2000000,
    "perRoleCaps": { "admin": 0, "standard": 2000000 }
  }
}
```

- `monthlyTokenCap` — base cap in **completion tokens** (model output, incl. reasoning). This is what `max_completion_tokens` bounds, so it's a clean cost proxy.
- `perRoleCaps` — optional overrides. A missing role falls back to the base cap.
- **A cap of `0` (or negative) means unlimited** — so an admin typo can never lock the whole userbase out. In the example above, admins are unlimited.
- Config is cached in the chat instance for 60s; changes propagate within a minute.

### Design (why it's a hard ceiling, not a soft one)

Pre-checking usage alone races under concurrency (N requests all read the same under-cap total and blow past it); post-charging alone can overrun. The implementation uses **reserve-then-reconcile**: `checkAndReserve()` atomically reserves the request's *maximum* possible spend up front; `reconcile()` refunds the unused portion once actual usage is known. The cap holds regardless of concurrency. Period resets by UTC month.

### Tamper-proofing

The usage doc is **top-level `quotas/{uid}`**, not under `users/{uid}` — because the `users/{uid}/{document=**}` rule grants the owner write access and Firestore *unions* `allow` rules, so a nested deny can't override it. The rule makes `quotas/{uid}` client-**read-only** / server-write-only. Account deletion removes it.

When a user is over cap, the proxy returns HTTP 429 with a friendly message that the client now surfaces verbatim (see `friendlyApiError`).

---

## What changed, by area

### Safety (Stage 2)
- Grounding now reaches **live voice sessions**, not just text.
- L1 crisis regex recalibrated for **precision** (defers euphemism/metaphor to L2) — consistent with the documented over-calling scar tissue.
- Standalone L2 classifier backstops the session stream.
- Multilingual crisis eval (16 languages) + prompt-injection red-team tests added. Run the live LLM eval manually: `RUN_CRISIS_EVAL=1 npm run test:crisis`.

### Session runtime (Stage 3)
- **Dropped-message-on-navigate P0 fixed** — typewriter cleanup flushes the buffered stream.
- **Cross-session stream bleed fixed** — Firestore writes always run; React-state writes are gated to the current session.
- **Message appends serialized** through a shared promise-chain queue (`useAppendQueue`) so concurrent appends can't clobber each other.
- Streaming: **idle-based timeout** (30s of silence) replaced the 30s wall-clock cap; short non-session responses stream immediately (preamble opt-in).
- Voice `start()` is epoch-fenced so stop/unmount mid-handshake cancels cleanly.

### Memory (Stage 4)
- **Token-budgeted memory packing** (`contextPacker`) replaced fixed-count slices.
- **Unbounded growth collections pruned** after reflection (`memoryPruner` — thoughts/innerWeather only; the memory "moat" is never touched).
- Echoes and part-quoting revived from `keyMoments` (no extra entry fetch).
- Cross-entry patterns stored once; memories de-duplicated on read.
- Quiet-return marking wired so dormant parts can resurface.

### Biometrics (Stage 5)
- **Webcam IBI double-count across overlapping CHROM windows fixed** (dedup by peak timestamp).
- Webcam HRV metrics hedged/gated out of the prompt (see invariants).
- Polar reconnect no longer stacks tick intervals.

### Data lifecycle (Stage 6)
- Account deletion: **tombstone-first, registry-driven, idempotent, zero-residue** (incl. `apiKeys`, sessions/messages, contactMessages, and now `quotas`).
- Data export now includes **full conversation transcripts, personalFacts, session notes, and consent records** — not just a summary table.

### Cost hardening (Stage 7)
- **SSE upstream abort on client disconnect** — an abandoned tab (or a client-side crisis abort) no longer bills the model to completion. Truncation is signalled to the client as a real failure, not a clean finish.
- **MCP**: capped `list-entries` offset (was an unbounded skip = unbounded reads), bounded `get-conversation` message reads, added the missing `(status, startedAt desc)` composite index.
- **Sidebar** switched from a 60s full-collection poll to an `onSnapshot` subscription.
- **Soundscape** cache-miss stampede deduped via a transactional generation claim (loser waits instead of double-billing ElevenLabs).
- **Admin user-list** uses `count()` + most-recent-session instead of scanning every session doc per user.
- **Offline boot** fixed (initialize from a cached read, not a `count()` aggregation that never serves from cache).
- **Cross-account bleed** fixed — per-user state + the singleton WeatherEngine reset on auth-identity change.
- **Settings** persist only true overrides, not baked-in admin/default values (which had frozen out later admin/language changes).

### UX / a11y / i18n (Stage 8)
- **Biometric startup errors are now visible** — a failed camera/BT connect that never enabled a source previously showed nothing; now a dismissible `role=alert` banner.
- **`prefers-reduced-motion`** honored across the ambient animations.
- **Modal a11y**: reusable `useModalA11y` (Escape, focus trap, focus restore) wired into both consent dialogs, with `role=dialog` / `aria-modal` / `aria-labelledby` + backdrop-click-to-decline.
- **Real Talk explainer** — tooltip + aria describing what the mode does.
- **Friendly, localized voice-session errors** (mic-blocked / no-mic / service-down / generic) replaced raw technical strings.
- All new user-facing strings added across **all 17 locales**; i18n key-parity tests stay green.

---

## Live verification (2026-07-03)

Tested against the live site in the logged-in Chrome after the Stage 7 deploy:
- Session **opener generates fully and personalized** — this exercises the full changed chat path (role-aware auth, quota gate, streaming, `<<RISK:N>>` preamble, upstream fetch). Healthy.
- A user turn fired `POST /api/chat → 200`, no console/CSP/streaming errors.
- **Note for future testers:** the companion does *not* reply to every pause — the orchestrator scores whether to interject; a finished sentence often draws no reply (by design). A working opener already proves the chat + render path. The app emits no `[chat]` diagnostics to the browser console in prod, so use the Network panel, not console logs. (Recorded in memory: `project_session_response_by_design`.)

---

## Deferred / recommended follow-ups

These were scoped out deliberately — either lower-value polish or larger net-new artifacts better done as their own project. None block the shipped work.

1. **Full hardcoded-string i18n audit.** Every *new* string this remediation added is localized in all 17 locales. But pre-existing hardcoded English remains in some places — notably the two consent dialogs' body prose, and the admin panel (admin is single-user, English-only by design, so lowest priority). Estimate: ~70–85 strings. Mechanical; do it with the same per-locale insertion script pattern used here.
2. **Admin quota UI panel.** Quotas are configurable today via the raw `appConfig/global` config editor. A dedicated admin panel (enable toggle, per-role cap inputs, live "top spenders this month" from the `quotas` collection) would make it operable without hand-editing JSON.
3. **Client-side encryption + longitudinal insights** — design docs. Both are substantial features; recommend a dedicated brainstorming + plan pass rather than folding into a remediation.
4. **Simulated-user eval harness.** The crisis eval (`RUN_CRISIS_EVAL=1 npm run test:crisis`) exists; a broader multi-turn simulated-user harness (does the companion stay in-persona, respect grounding, avoid over-interjecting across a full session) is a worthwhile net-new addition.
5. **Admin feature-health counters** — per-feature adoption/error counters on the admin overview.
6. **Run the live crisis eval manually** before the next release and eyeball the precision/recall on the 16-language set.

---

## Operational quick reference

```bash
npm run build && firebase deploy --only hosting            # frontend
cd functions && npx tsc && cd .. && firebase deploy --only functions   # functions (add --force for chat minInstances)
firebase deploy --only firestore:rules,firestore:indexes   # rules + indexes
npm run smoke-test                                         # post-deploy live check
npx tsc -b --force && npm run test && npm run lint          # the pre-commit gate
```

To enable quotas: admin dashboard → config → set the `quota` object shown above. To disable: set `quota.enabled = false` (or remove it).
