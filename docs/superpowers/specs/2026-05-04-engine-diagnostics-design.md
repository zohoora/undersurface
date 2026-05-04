# Engine Diagnostics (`engineLog`) — Design

## Problem

UnderSurface's engines fail silently in places where the user (and the engineer) would benefit from visibility:

- `partOrchestrator.ts:176` — empty active parts → silent `return`
- `openrouter.ts:153` — repetition loop → `console.warn` only, no user/admin signal
- `sessionReflectionEngine.ts` — `buildBoundedTranscript` truncates long sessions; the 2000-token output cap can also clip JSON output, parsed-as-failure
- `hrvSignalWorker.ts` — sustained low confidence (often skin-color filter on darker skin tones in low light) reports a low `confidence` value but emits nothing actionable

Sentry covers thrown exceptions. None of the above throw. They're *deliberate silences* the system chose.

## Scope

A behavioral-observability log layer for `src/engine/` and `src/ai/`:

- A single `engineLog(severity, code, msg, ctx?)` API
- A typed `DiagnosticCode` union (no free-form strings)
- Per-`(code, sessionId)` dedup with cooldown to prevent HRV-style flooding
- Persistence to `users/{uid}/diagnostics/{logId}` for per-user repro in admin
- A new `Diagnostics` tab in `AdminUserDetail`
- Wirings at the four sites above

Out of scope (v1): batching, sampling, client-side reader UI, retention/TTL, log aggregation by code across users.

## Non-goals

- **Not a replacement for Sentry.** Anything inside a `catch` block stays Sentry. `engineLog` is for *deliberate silent paths*.
- **Not a user-facing surface.** Client writes only by convention; admin reads via `adminApi`.

## API

```ts
type Severity = 'info' | 'warn' | 'error'

type DiagnosticCode =
  | 'parts.empty_active_set'
  | 'stream.loop_detected'
  | 'reflect.transcript_truncated'
  | 'reflect.output_truncated'
  | 'hrv.skin_filter_low_confidence'

interface EngineLogContext {
  sessionId?: string
  entryId?: string
  /** Whitelisted shallow record. Per-code expected keys. No user-typed text. */
  extra?: Record<string, string | number | boolean>
}

function engineLog(severity: Severity, code: DiagnosticCode, msg: string, ctx?: EngineLogContext): void
```

- `msg` ≤ 200 chars. Dev-mode runtime warn if violated. **Never user content or model output.** Describes system state ("active parts list empty after loadParts"), not content.
- `ctx.extra` is a small whitelist of primitive values per code (e.g. for `hrv.skin_filter_low_confidence`: `{confidence, skinPixelRatio, lighting}`).

## Storage

`users/{uid}/diagnostics/{id}` documents:

```ts
interface DiagnosticEvent {
  id: string
  timestamp: number  // ms epoch
  severity: Severity
  code: DiagnosticCode
  msg: string
  sessionId?: string
  entryId?: string
  /** Set when ≥ 2 events were absorbed by dedup before flushing. */
  repeatCount?: number
  context?: Record<string, string | number | boolean>
}
```

Existing wildcard rule `users/{userId}/{document=**}` covers reads/writes under the user. We do not carve a more specific rule for v1 — "client never reads diagnostics" is a convention, not a rule.

## Dedup

In-memory map: `(code + sessionId) → { firstTs, count, last }`.

- On `engineLog` call: compute key, check map.
- If absent: write doc immediately, store entry with `firstTs = now`, `count = 1`.
- If present and `now - firstTs < cooldownMs`: bump `count`, retain `last`. **No write.**
- On cooldown expiry: if `count > 1`, flush a single doc with `repeatCount = count` and the last `msg`/`context`. If `count == 1`, do nothing (the original write already landed).
- Flush also on `visibilitychange: hidden` and `beforeunload`.
- Cooldowns per code (defined in a single `DEDUP_RULES` table — first-class user contribution point):

| Code | Cooldown | Notes |
|---|---|---|
| `parts.empty_active_set` | 5s | tight — indicates a possibly-stuck pause loop |
| `stream.loop_detected` | 0 (no dedup) | rare; each occurrence is independently interesting |
| `reflect.transcript_truncated` | 0 | once per session by definition |
| `reflect.output_truncated` | 0 | once per session by definition |
| `hrv.skin_filter_low_confidence` | 60s | high-frequency (5s tick); collapse to 1/min |

## Web Worker bridge

`hrvSignalWorker.ts` cannot import `db.ts` or call `engineLog` directly. Instead:

```ts
// in worker
function postEngineLog(severity: Severity, code: DiagnosticCode, msg: string, ctx?: EngineLogContext) {
  ;(self as DedicatedWorkerGlobalScope).postMessage({ type: 'engine-log', payload: { severity, code, msg, ctx } })
}
```

`hrvEngine.ts` (already owns the worker `onmessage`) adds a discriminator branch:

```ts
if (e.data.type === 'engine-log') {
  const { severity, code, msg, ctx } = e.data.payload
  engineLog(severity, code, msg, { sessionId: this.sessionId, ...ctx })
  return
}
```

Single direction. No worker-side state. Worker file remains focused on signal processing.

## Wirings

| Site | Code | Severity | Trigger |
|---|---|---|---|
| `partOrchestrator.ts:176` (`if (this.parts.length === 0) return`) | `parts.empty_active_set` | `warn` | When pause fires but no parts available |
| `openrouter.ts:153` (loop-detected branch) | `stream.loop_detected` | `warn` | Replaces `console.warn` |
| `therapistPrompts.ts:buildBoundedTranscript` | `reflect.transcript_truncated` | `info` | When return value is shorter than input by some threshold |
| `sessionReflectionEngine.ts:66` (parse-failed branch, when output length ≈ token cap) | `reflect.output_truncated` | `info` | Heuristic: parse failed AND `response.length > X` chars |
| `hrvSignalWorker.ts` (sustained low-confidence emission path) | `hrv.skin_filter_low_confidence` | `info` | When N consecutive measurements emit `confidence < threshold` |

## Sentry split

Code-review rule: **if you're inside a `catch` block, you almost certainly want Sentry, not engineLog.** `engineLog` answers "did the system *choose* to do nothing?" Sentry answers "did the code throw?"

## Admin read path

- New `adminApi` action: `getDiagnostics(uid, limit=100)` — returns time-desc.
- New `Diagnostics` tab in `AdminUserDetail` (becomes 9th tab).
- Renders: time, severity badge (info=neutral, warn=amber, error=red), code, msg, `repeatCount` chip if present, expandable `context`.

## Lifecycle

- `'diagnostics'` added to `collectionNames` in `db.ts` `exportAllData`.
- `'diagnostics'` added to `deleteAccount` collections array in `functions/src/index.ts`.

## Testing

`src/engine/__tests__/diagnostics.test.ts`:

- Single call writes a doc.
- Repeat call within cooldown window does *not* write a second doc.
- After cooldown expires with `count > 1`, a flush doc is written with `repeatCount`.
- Codes with cooldown 0 always write immediately.
- `msg` length > 200 emits a dev-mode console warning.
- `visibilitychange: hidden` flushes pending dedup buffers.

No live Firestore tests — `db.ts` is mocked at the proxy boundary, matching existing patterns.

## Files

**New**
- `src/engine/diagnostics.ts`
- `src/engine/__tests__/diagnostics.test.ts`
- `src/admin/AdminUserDetail` Diagnostics tab content (inline component, ~80 LOC)

**Modified**
- `src/types/index.ts` — `DiagnosticEvent`, `DiagnosticCode`
- `src/store/db.ts` — `diagnostics` proxy + `collectionNames` entry
- `src/engine/partOrchestrator.ts` — wire `parts.empty_active_set`
- `src/ai/openrouter.ts` — wire `stream.loop_detected`
- `src/ai/therapistPrompts.ts` — wire `reflect.transcript_truncated` from `buildBoundedTranscript`
- `src/engine/sessionReflectionEngine.ts` — wire `reflect.output_truncated`
- `src/engine/hrvSignalWorker.ts` — `postEngineLog` helper + emit on sustained low confidence
- `src/engine/hrvEngine.ts` — handle `engine-log` worker messages
- `src/admin/AdminUserDetail.tsx` — add Diagnostics tab
- `src/admin/adminApi.ts` — add `getDiagnostics` client wrapper
- `functions/src/index.ts` — add `getDiagnostics` admin action; add `'diagnostics'` to `deleteAccount` collections

## Risks

- **Quota.** Worst case is HRV firing every measurement for the full session. With 60s dedup, that's ≤ 60 docs/hour/user — well below quota even at scale.
- **PII leak.** `msg` could accidentally include user content. Mitigated by 200-char cap + dev-mode warn + code review rule. Not enforced at runtime in production.
- **Code rot.** Adding a new diagnostic code requires editing the union *and* `DEDUP_RULES`. TS compiler enforces both.
