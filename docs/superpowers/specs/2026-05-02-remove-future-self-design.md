# Remove Future Self Mode — Design

**Status:** Draft
**Date:** 2026-05-02
**Scope:** Full removal of Future Self conversational mode. Therapist mode and journal mode unchanged.

## Problem

Future Self mode — a third conversational mode where the AI plays the user's future self in their own voice — is not pulling its weight relative to the surface area it occupies. It carries:

- A voice-mimicry context loader (`loadFutureSelfContext`) that scores and samples user entries.
- An unlock gate (`useFutureSelfUnlock`) with two admin-tunable thresholds.
- A persona prompt with crisis-handling override.
- A locked-state UI on the entry choice screen.
- A separate route (`/future-self/:id`) and sidebar icon variant.
- 9 i18n keys × 17 languages = ~150 translation entries.
- An admin settings section with three knobs.
- A `mode?: 'therapist' | 'futureSelf'` field on `Session`.

The decision is to remove it entirely rather than iterate on it.

## Goals

- Delete Future Self code, prompts, types, routes, UI, i18n, admin settings, styles, and tests.
- Preserve existing Firestore session data — users keep their conversation history, just rendered as therapist sessions.
- Leave therapist mode untouched. Leave the `SAFETY_RULES` export from `therapistPrompts.ts` intact (it was shared but is therapist-owned).
- Leave the MCP server response shape unchanged for clients.

## Non-goals

- Firestore migration. Existing `mode: 'futureSelf'` documents stay on disk; the field becomes ignored noise.
- Removing the `Session.mode` field through a versioned migration. We delete the field from the type and let old documents carry an unread property.
- Cleaning up old design docs in `docs/superpowers/specs/` or `docs/plans/`. Historical record stays.

## Decisions (locked during brainstorming)

| # | Decision |
|---|---|
| 1 | **Existing Firestore data: leave as-is.** Sessions with `mode: 'futureSelf'` continue to load — they will simply route through `/session/:id` as therapist sessions. The `mode` field becomes ignored. Zero migration risk, no data loss for users. |
| 2 | **`isTherapistSession` on Cloud Function responses: hardcode to `true`.** Three call sites in `functions/src/index.ts` currently compute it from `mode`. Hardcoding preserves the response shape so MCP clients and the admin UI don't break. |
| 3 | **`SessionMode` type and `Session.mode` field: delete both.** No future re-introduction is planned; YAGNI. |
| 4 | **i18n: remove all `choice.futureSelf.*` and `futureSelf.*` keys from all 17 languages.** No deprecation period. |
| 5 | **Admin settings: remove the entire Future Self section** (feature flag + `futureSelf.minEntries` + `futureSelf.minSessions` + `futureSelf.voiceExcerptCount`). The `futureSelfEnabled` feature flag and the `futureSelf` config block in `adminTypes.ts` are deleted. |

## Removal inventory

### Files deleted entirely
- `src/ai/futureSelfPrompts.ts`
- `src/ai/futureSelfPrompts.test.ts`
- `src/hooks/useFutureSelfUnlock.ts`
- `src/hooks/useFutureSelfUnlock.test.ts`

### Files modified
- `src/types/index.ts` — drop `SessionMode` type, drop `mode?` field on `Session`.
- `src/App.tsx` — remove `/future-self/*` route handling, `handleChoiceFutureSelf`, `isFutureSelfRoute`, `mode="futureSelf"` prop on `SessionView`.
- `src/components/Session/SessionView.tsx` — remove `mode` prop, `isFutureSelf` branch, Future Self header text, Future Self context loading.
- `src/components/EntryChoice.tsx` — remove the third (Future Self) card, lock-state UI, `onFutureSelfChosen` prop, the locked-modal.
- `src/components/Sidebar/EntriesList.tsx` — remove `mode === 'futureSelf'` branches, the concentric-circle icon variant, the `future-self-session` className path. All sessions render with the existing therapist styling.
- `src/engine/sessionContextLoader.ts` — delete `loadFutureSelfContext` and the voice-excerpt helpers it owns. Keep `loadTherapistContext`.
- `src/ai/therapistPrompts.ts` — update the comment on line 6 (`// Shared across therapist and futureSelf prompts...`) to reflect therapist-only ownership. `SAFETY_RULES` stays exported (used by therapist + tests). No code changes.
- `src/admin/AdminSettings.tsx` — delete the Future Self collapsible section.
- `src/admin/adminTypes.ts` — remove `futureSelfEnabled` from feature flags, remove the `futureSelf` config block.
- `functions/src/index.ts` — three call sites: replace `c.isTherapistSession ?? (c.mode !== 'futureSelf')` with `c.isTherapistSession ?? true`.
- `src/components/Session/SessionView.test.ts` — remove tests covering `mode="futureSelf"` rendering.
- `src/i18n/translations/{en,de,es,fr,hi,id,it,ja,ko,nl,pl,pt,ru,th,tr,vi,zh}.ts` — delete the 9 Future Self keys per file.
- `src/styles/atmosphere.css` — remove `future-glow`, `future-self-session` rules.
- `CLAUDE.md` — delete the "Future Self Mode (third session mode)" section. Update the "Core entry points" line that names `futureSelfPrompts.ts`, `useFutureSelfUnlock.ts`, `loadFutureSelfContext`, and the `mode?: 'therapist' | 'futureSelf'` field. Update the testing list to drop `futureSelfPrompts` and `useFutureSelfUnlock`.

### Files NOT modified
- `docs/superpowers/specs/2026-05-02-register-matching-design.md` — historical reference; non-goal mention of Future Self stays.
- `docs/plans/*` — historical record.
- Firestore data — left untouched per Decision 1.
- `appConfig/global` document in production — admin can leave the stale `futureSelf` block; it will simply be unread by the new code. No deploy-time migration.

## Verification

After removal:
1. `git grep -i "futureSelf\|future-self\|FutureSelf"` returns hits only in `CLAUDE.md` (none expected after edit), `docs/`, and possibly `node_modules`.
2. `npm run lint` clean.
3. `npm run test` — full suite green; the test count drops by however many tests lived in the two deleted test files plus the SessionView Future Self cases.
4. `npm run build` succeeds.
5. `cd functions && npx tsc` succeeds.
6. Manual: visit `/new` — only two cards (Journal + Conversation). Visit `/future-self/<id>` for an existing Future Self session — the route should fall through to `/`. Open a previously-Future-Self session from the sidebar — it loads via `/session/:id` and renders as a therapist session.

## Risk

The only real risk is **users with active Future Self sessions opening the app and finding their conversation re-themed**. Decision 1 mitigates: the conversation history is preserved, message-for-message. The persona shift (Future Self → Therapist) is the cost. Given the user has decided the feature isn't pulling its weight, this cost is accepted.
