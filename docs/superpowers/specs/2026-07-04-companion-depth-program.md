# Companion Depth Program — Values, Interiority, Presence, Humor, Story

**Date:** 2026-07-04
**Status:** Approved ("Let's do all of that" + 4 AskUserQuestion decisions, all recommended options)
**Build order:** A → B → C → D → E, each with the house discipline: default-off flag, precision rails, grounding suppression, consume-once semantics, one-special-thing-per-build exclusivity, i18n ×17 for UI strings, unit tests + live eval before deploy, commit/push/CI per stage.

## Locked decisions

| Question | Decision |
|---|---|
| Process disclosure | **Rare, evidence-backed only** — ≤1/session, grounded in recorded stance data; never invented feelings |
| Companion promises | **Companion-initiated, max 2 active**, date-aware delivery, misses acknowledged never silently dropped; user-directed "remember this" deferred |
| Presence UX | **One line + breathing indicator**, composer stays open |
| Humor bootstrap | **Mild by default under flag, stance-suppressed** when observations read it as hindered |

---

## Stage A — Values Map (flag `userValues`)

Mirror of the userParts grammar end-to-end:
- **`userValues` collection** (registration checklist): `{ id, name (writer's words), description, status: 'candidate'|'active'|'retired', evidence[{sessionId,quote,observedAt}] cap 8 (quotes ≤15 words), sessionsSeen, dismissedCount, proposedAt?, confirmedAt?, retiredAt?, lastActiveAt, createdAt, updatedAt }`. Caps: 6 active / 4 candidates.
- **`SessionIntention.valueId?: string`** — intentions link to the value they serve.
- **Reflection extension** (`valueObservations`, gated on option like userParts): match-by-id or `{tentativeName, description, quote}`. Rails: values are the writer's OWN stated cares ("what matters to me is being there for the girls"), never inferred morality, never extracted from distress, recurrence from the writer (≥2 sessions for proposal eligibility), lowercase non-clinical names, ≤2 observations, bias to omit. Also `statedIntention` gains optional `servesValueId` (only ids listed).
- **`userValueTracker.ts`** — copy of userPartTracker semantics (apply/select, same suppression: 1 dismissal cooling, 2 = retired).
- **Proposal**: marker `[phrase](#propose-value:<id>)` + `ValueProposalCard` (clone of PartProposalCard; new key `values.card.hint` ×17, reuse `parts.card.keep`/`notQuite`). Shares the single proposal slot per session with part proposals (part proposal wins if both armed); same exclusivity vs pivot/soften; `proposedAt` stamped only when the marker landed.
- **Prompt blocks**: `activeValues` ("What matters to this writer, in their words" — untrusted-wrapped, never moralize with them, never invent values); intentions block lines append "— in service of <value>" when linked; the 3-not-yet pattern nudge, when the intention links a value, may name that tension ("it sits right on something you said matters").
- **UI**: `UserValuesSection` in Settings (rename/retire), mirroring UserPartsSection.
- **Eval**: extend `partObservations.live.test.ts` harness style — new `test:values` file: distress→nothing, inferred-morality→nothing, writer-stated care ≥2 signals→extracts, matches existing id.

## Stage B — Interiority Bundle (flag `companionInteriority`)

Three behaviors, one flag:
1. **Process disclosure**: prompt block receives the stance entries + the most recent 'hindered' observation (if any) and permits AT MOST one disclosure per session, ONLY grounded in that data — naming its own pull ("I notice I keep reaching for reassurance") or an update ("I used to read your quietness as withdrawal; I think I was wrong"). Never invented feelings, never neediness, never makes the session about itself. Counts in the one-special-thing exclusivity chain (a build carrying pivot/soften/proposal/nudge omits it).
2. **Companion promises**: `companionPromises` collection `{ id, text, dueKind: 'next_session'|'date', dueDate?, status: 'active'|'kept'|'acknowledged_missed', sessionId, createdAt, keptAt?, updatedAt }`, cap 2 active. Companion commits via `[phrase](#promise)` or `[phrase](#promise:YYYY-MM-DD)` in its reply (closing-phase-agnostic); client records from the marker on finalize (no consent card — it's the companion's own commitment), text = phrase. Loader surfaces due promises (next_session: always due next session; dated: due within 3 days of dueDate). Prompt block instructs delivery, marking with `[...](#kept-promise:<id>)` when actually delivered → client marks kept. A dated promise >7 days past due arms an acknowledge-miss instruction ("I said I'd bring this back and I let it slip — I'm sorry") → status acknowledged_missed. Never silently dropped.
3. **Carrying**: reflection output `carriedNoticing: { present, text }` — ONE genuine noticing from the writer's material worth carrying (not advice, not summary; omit when nothing真 stands out — precision rails). Stored on `companionSignals.carriedNoticing { text, fromSessionId, createdAt }`; the NEXT opener gets a block ("share early, briefly, as something that stayed with you"); consume-once on opener finalize (same mechanics as pendingRepair).
- **Eval** (`test:interiority`): disclosure with no stance data → none; with data → grounded; carrying from a rich session → real material quote-anchored; from a thin session → present=false.

## Stage C — Presence (flag `companionPresence`)

Prompt block: when stillness serves better than words (grief landing, a heavy disclosure just made, the writer asking for quiet) the companion MAY reply with exactly one short line wrapped `[line](#presence)` and nothing else. Client: marker renders the line + a `PresenceIndicator` (soft breathing dot, CSS animation — global reduced-motion rule already covers it) below the message until the next user input; live-session-only (same active-session gating as cards); history renders the line alone. **Never during grounding** (crisis protocol owns those moments; suppression at prompt layer). No i18n needed (the line is model-generated in the session language).

## Stage D — Earned Humor (flag `earnedHumor`)

Prompt block: rare, mild levity permitted when the emotional weather is light — a callback to shared language (lexicon) or history, never at the writer's expense, never during heaviness/grounding/repair/pivot, at most once per session, dropped instantly if it lands flat. Cross-reference: "if the learned tendencies indicate playfulness does not serve this writer, use none." (Stance loop closes it: observations judge levity; consolidation can produce a suppressing entry.) **Eval** (`test:humor`): heavy transcript → no levity instruction violated; light + lexicon → callback permitted; mockery framing → never.

## Stage E — Story So Far (flag `storyArcs`)

- **Trigger at session open** (loader, flag-gated): long-gap return (reuse `detectAtypicalGap`) OR an anniversary within ±2 days (personalFacts.dates), AND ≥30 days since `companionSignals.lastArcAt`.
- **Arc generation**: at open, a dedicated LLM call (`buildStoryArcPrompt` over entrySummaries themes/arcs + weather history, backfill-style): 2–4 sentences, the writer's arc in their own material ("two winters ago you couldn't name this; last spring you named it"), no advice, decline (empty) when history is too thin (<8 summaries).
- **Delivery**: stored as pending arc; opener block offers it early as a gift, not a report; consume-once; stamp `lastArcAt`.
- **Eval** (`test:arcs`): thin history → declines; rich fixture → references actual themes, no invented events, no advice.

## Cross-cutting

- Exclusivity chain per build (one special thing): repair > pivot > soften > part/value proposal > pattern nudge > disclosure > (offer). Presence/humor/carrying/arc are opener- or register-level and coexist by design but never during grounding.
- New collections registered in db proxy + types + dataExport + functions USER_SUBCOLLECTIONS: `userValues`, `companionPromises`.
- CLAUDE.md + feature-flags.md updated per stage; collections/flags counts bumped.
