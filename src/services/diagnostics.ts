import { db, generateId } from '../store/db'

export type Severity = 'info' | 'warn' | 'error'

export type DiagnosticCode =
  | 'parts.empty_active_set'
  | 'stream.loop_detected'
  | 'reflect.transcript_truncated'
  | 'reflect.output_truncated'
  | 'hrv.skin_filter_low_confidence'

export interface EngineLogContext {
  sessionId?: string
  entryId?: string
  /** Whitelisted shallow record. No user-typed text or model output. */
  extra?: Record<string, string | number | boolean>
}

export interface DiagnosticEvent {
  id: string
  timestamp: number
  severity: Severity
  code: DiagnosticCode
  msg: string
  sessionId?: string
  entryId?: string
  /** Set on the summary doc when ≥ 2 events were absorbed by dedup. */
  repeatCount?: number
  context?: Record<string, string | number | boolean>
}

interface DedupRule {
  /** Cooldown in ms. 0 means no dedup — every call writes. */
  cooldownMs: number
}

// One source of truth for per-code dedup behavior. Edit this when adding codes.
const DEDUP_RULES: Record<DiagnosticCode, DedupRule> = {
  'parts.empty_active_set': { cooldownMs: 5_000 },
  'stream.loop_detected': { cooldownMs: 0 },
  'reflect.transcript_truncated': { cooldownMs: 0 },
  'reflect.output_truncated': { cooldownMs: 0 },
  'hrv.skin_filter_low_confidence': { cooldownMs: 60_000 },
}

const MAX_MSG_CHARS = 200

interface DedupEntry {
  firstTs: number
  count: number
  lastSeverity: Severity
  lastMsg: string
  lastCtx?: Record<string, string | number | boolean>
  lastSessionId?: string
  lastEntryId?: string
  flushTimer: ReturnType<typeof setTimeout> | null
}

const dedupBuffer = new Map<string, DedupEntry>()

function dedupKey(code: DiagnosticCode, sessionId: string | undefined): string {
  return `${code}::${sessionId ?? ''}`
}

function makeEvent(
  severity: Severity,
  code: DiagnosticCode,
  msg: string,
  ctx: EngineLogContext | undefined,
  repeatCount?: number,
): DiagnosticEvent {
  const event: DiagnosticEvent = {
    id: generateId(),
    timestamp: Date.now(),
    severity,
    code,
    msg: msg.slice(0, MAX_MSG_CHARS),
  }
  if (ctx?.sessionId) event.sessionId = ctx.sessionId
  if (ctx?.entryId) event.entryId = ctx.entryId
  if (ctx?.extra) event.context = ctx.extra
  if (repeatCount && repeatCount > 1) event.repeatCount = repeatCount
  return event
}

async function writeDoc(event: DiagnosticEvent): Promise<void> {
  try {
    await db.diagnostics.add(event)
  } catch {
    // engineLog is best-effort. A diagnostic write failing must not cascade.
  }
}

function flushEntry(key: string): void {
  const entry = dedupBuffer.get(key)
  if (!entry) return
  dedupBuffer.delete(key)
  if (entry.flushTimer) clearTimeout(entry.flushTimer)
  if (entry.count <= 1) return
  const code = key.split('::')[0] as DiagnosticCode
  const summary = makeEvent(
    entry.lastSeverity,
    code,
    entry.lastMsg,
    { sessionId: entry.lastSessionId, entryId: entry.lastEntryId, extra: entry.lastCtx },
    entry.count,
  )
  void writeDoc(summary)
}

export function engineLog(
  severity: Severity,
  code: DiagnosticCode,
  msg: string,
  ctx?: EngineLogContext,
): void {
  if (import.meta.env?.DEV && msg.length > MAX_MSG_CHARS) {
    console.warn(`[engineLog] msg over ${MAX_MSG_CHARS} chars (will be truncated): ${code}`)
  }

  const rule = DEDUP_RULES[code]
  if (!rule || rule.cooldownMs === 0) {
    void writeDoc(makeEvent(severity, code, msg, ctx))
    return
  }

  const key = dedupKey(code, ctx?.sessionId)
  const existing = dedupBuffer.get(key)

  if (!existing) {
    void writeDoc(makeEvent(severity, code, msg, ctx))
    dedupBuffer.set(key, {
      firstTs: Date.now(),
      count: 1,
      lastSeverity: severity,
      lastMsg: msg.slice(0, MAX_MSG_CHARS),
      lastCtx: ctx?.extra,
      lastSessionId: ctx?.sessionId,
      lastEntryId: ctx?.entryId,
      flushTimer: setTimeout(() => flushEntry(key), rule.cooldownMs),
    })
    return
  }

  existing.count += 1
  existing.lastSeverity = severity
  existing.lastMsg = msg.slice(0, MAX_MSG_CHARS)
  existing.lastCtx = ctx?.extra
  existing.lastSessionId = ctx?.sessionId
  existing.lastEntryId = ctx?.entryId
}

/** Flush all pending dedup buffers. Wired to visibilitychange/beforeunload. */
export function flushDiagnostics(): void {
  for (const key of Array.from(dedupBuffer.keys())) flushEntry(key)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDiagnostics()
  })
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => flushDiagnostics())
}

/** Test-only: clear in-memory state between tests. */
export function __resetDiagnosticsForTest(): void {
  for (const entry of dedupBuffer.values()) {
    if (entry.flushTimer) clearTimeout(entry.flushTimer)
  }
  dedupBuffer.clear()
}
