import { getFirestore } from 'firebase-admin/firestore'

// Durable, admin-configurable per-user token quota. The quota unit is
// COMPLETION tokens (model output, including reasoning) — the expensive,
// model-generated part of a request and exactly what max_completion_tokens
// bounds, so a reservation of max_completion_tokens is always an upper bound on
// what a request can spend. Config lives in appConfig/global under `quota` and
// is read (cached) by the chat function. Default disabled: an unset or
// malformed config never blocks anyone.
//
// PROMPT tokens are metered SEPARATELY (`promptTokensUsed`, same monthly
// period) and do NOT count toward the cap. Decision (TECH_ISSUES_2026-10-14
// #16): folding input tokens into `tokensUsed` would silently shrink every
// admin-configured cap (system prompts are 5-10k tokens per turn), changing
// the meaning of an existing setting. Separate metering keeps the cap's unit
// backward compatible while making input spend visible; per-request input
// size is bounded by the chat function's request-byte cap instead.
//
// The same server-owned doc also holds small per-day budgets (`daily.<bucket>`)
// for cost paths that are not token-shaped, such as Realtime voice mints.

export type Role = 'admin' | 'standard'

export interface QuotaConfig {
  enabled: boolean
  // Base monthly cap in completion tokens. 0 / negative = unlimited.
  monthlyTokenCap: number
  // Optional per-role overrides. A missing role falls back to monthlyTokenCap.
  perRoleCaps?: Partial<Record<Role, number>>
}

export interface QuotaDecision {
  allowed: boolean
  used: number
  cap: number
  reserved: number
}

interface DailyBudgetEntry {
  day: string
  count: number
}

// quotas/{uid}. Fields beyond period/tokensUsed/requestCount are optional so
// docs written before 2026-10-14 remain valid.
interface QuotaDoc {
  period: string
  tokensUsed: number
  requestCount: number
  // Input tokens for `period`. Metered, not capped (see header).
  promptTokensUsed?: number
  daily?: Partial<Record<DailyBudgetBucket, DailyBudgetEntry>>
}

// Per-day budget buckets. Add a bucket name here to give another cost path a
// durable daily ceiling in the same server-owned doc.
export type DailyBudgetBucket = 'voiceMints'

// Top-level, NOT under users/{uid}. The users/{uid}/{document=**} rule grants
// the owner write access to everything nested there, and Firestore unions
// `allow` rules — so a nested deny can't override it. A tamper-proof cost cap
// must live outside that wildcard, with a client read-only / server-write rule.
function quotaRef(uid: string) {
  return getFirestore().collection('quotas').doc(uid)
}

// Pure: which cap applies to this role. A cap of 0 or below is treated as
// unlimited so an admin typo (e.g. leaving the field at 0) can never hard-lock
// the entire userbase out of the app.
export function resolveCap(config: QuotaConfig, role: Role): number {
  const roleCap = config.perRoleCaps?.[role]
  const cap = typeof roleCap === 'number' ? roleCap : config.monthlyTokenCap
  return cap > 0 ? cap : Infinity
}

// Pure: UTC year-month key ('2026-07'). The monthly reset boundary. UTC (not
// the user's timezone) keeps the boundary unambiguous and server-authoritative.
export function periodKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// Pure: the decision the reserve-transaction makes given the current doc state.
// Extracted so the (concurrency-sensitive) admit/reject logic is unit-testable
// without a live Firestore transaction.
export function decideReservation(
  existing: { period?: string; tokensUsed?: number } | undefined,
  key: string,
  cap: number,
  reserveTokens: number,
): { allowed: boolean; used: number } {
  const used = existing && existing.period === key ? (existing.tokensUsed ?? 0) : 0
  return { allowed: used + reserveTokens <= cap, used }
}

// Atomically check the user's monthly usage and, if under cap, RESERVE
// reserveTokens up front. Reserving the request's maximum possible spend (not
// its eventual actual spend) is what makes the cap a hard ceiling under
// concurrency: without a reservation, N requests racing the pre-check all read
// the same under-cap total and collectively blow past it. reconcile() later
// refunds the unused part of the reservation. Rolls the period over when the
// UTC month changes. Returns allowed=false WITHOUT reserving when the request
// would cross the cap.
export async function checkAndReserve(opts: {
  uid: string
  role: Role
  config: QuotaConfig
  reserveTokens: number
  now: Date
}): Promise<QuotaDecision> {
  const { uid, role, config, reserveTokens, now } = opts
  const cap = resolveCap(config, role)
  if (cap === Infinity) return { allowed: true, used: 0, cap, reserved: 0 }

  const ref = quotaRef(uid)
  const key = periodKey(now)

  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? (snap.data() as QuotaDoc) : undefined
    const { allowed, used } = decideReservation(data, key, cap, reserveTokens)
    if (!allowed) return { allowed, used, cap, reserved: 0 }

    const samePeriod = !!data && data.period === key
    const requestCount = samePeriod ? (data.requestCount ?? 0) : 0
    tx.set(ref, {
      period: key,
      tokensUsed: used + reserveTokens,
      requestCount: requestCount + 1,
      // A new month starts input metering from zero too.
      ...(samePeriod ? {} : { promptTokensUsed: 0 }),
    }, { merge: true })
    return { allowed: true, used, cap, reserved: reserveTokens }
  })
}

// Pure: the field update reconcile() applies, or null when nothing changes.
// Completion tokens adjust `tokensUsed` by (actual - reserved); prompt tokens
// are added to the separately metered `promptTokensUsed`. Returns null when the
// stored period differs (a rollover happened between reserve and reconcile).
export function computeReconcileUpdate(
  existing: { period?: string; tokensUsed?: number; promptTokensUsed?: number },
  key: string,
  reservedTokens: number,
  actualTokens: number,
  promptTokens: number,
): { tokensUsed?: number; promptTokensUsed?: number } | null {
  if (existing.period !== key) return null
  const update: { tokensUsed?: number; promptTokensUsed?: number } = {}
  const delta = actualTokens - reservedTokens
  if (delta !== 0) update.tokensUsed = Math.max(0, (existing.tokensUsed ?? 0) + delta)
  if (promptTokens > 0) update.promptTokensUsed = (existing.promptTokensUsed ?? 0) + promptTokens
  return Object.keys(update).length > 0 ? update : null
}

// Settle a reservation once the response finishes: adjust tokensUsed by
// (actual - reserved) and meter the request's prompt tokens. Actual is almost
// always < reserved (a request rarely emits its full max_completion_tokens),
// so this refunds the difference. Guards the period so a rollover between
// reserve and reconcile doesn't corrupt the new month's count. Best-effort —
// never throws into the request path. A request that never reserved (quota
// disabled) writes nothing.
export async function reconcile(opts: {
  uid: string
  reservedTokens: number
  actualTokens: number
  promptTokens?: number | null
  now: Date
}): Promise<void> {
  const { uid, reservedTokens, actualTokens, now } = opts
  const promptTokens = typeof opts.promptTokens === 'number' && opts.promptTokens > 0 ? opts.promptTokens : 0
  if (reservedTokens === 0) return
  if (actualTokens === reservedTokens && promptTokens === 0) return

  const ref = quotaRef(uid)
  const key = periodKey(now)
  try {
    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const update = computeReconcileUpdate(
        snap.data() as QuotaDoc, key, reservedTokens, actualTokens, promptTokens,
      )
      if (update) tx.update(ref, update)
    })
  } catch {
    // Accounting is best-effort; a failed reconcile just leaves the (safe)
    // over-reservation in place until the monthly reset.
  }
}

// Pure: UTC calendar-day key ('2026-10-14') for per-day budgets.
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Pure: admit one more unit of a daily budget? A stored entry from an earlier
// day counts as zero.
export function decideDailyBudget(
  existing: { day?: string; count?: number } | undefined,
  key: string,
  limit: number,
): { allowed: boolean; used: number } {
  const used = existing && existing.day === key ? (existing.count ?? 0) : 0
  return { allowed: used < limit, used }
}

// Atomically consume one unit of a per-user daily budget in quotas/{uid}
// (`daily.<bucket>`). Server-owned doc: clients can read it but never write
// it. Returns allowed=false without consuming when the budget is spent.
export async function consumeDailyBudget(opts: {
  uid: string
  bucket: DailyBudgetBucket
  limit: number
  now: Date
}): Promise<{ allowed: boolean; used: number; limit: number }> {
  const { uid, bucket, limit, now } = opts
  const ref = quotaRef(uid)
  const key = dayKey(now)
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? (snap.data() as QuotaDoc) : undefined
    const { allowed, used } = decideDailyBudget(data?.daily?.[bucket], key, limit)
    if (!allowed) return { allowed, used, limit }
    // merge:true merges nested maps, so sibling buckets and the monthly token
    // fields are preserved.
    tx.set(ref, { daily: { [bucket]: { day: key, count: used + 1 } } }, { merge: true })
    return { allowed: true, used: used + 1, limit }
  })
}

// Give back one unit consumed earlier the same UTC day (e.g. the upstream call
// it paid for failed). Best-effort; never throws into the request path.
export async function refundDailyBudget(opts: {
  uid: string
  bucket: DailyBudgetBucket
  now: Date
}): Promise<void> {
  const { uid, bucket, now } = opts
  const ref = quotaRef(uid)
  const key = dayKey(now)
  try {
    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const entry = (snap.data() as QuotaDoc).daily?.[bucket]
      if (!entry || entry.day !== key || (entry.count ?? 0) <= 0) return
      tx.set(ref, { daily: { [bucket]: { day: key, count: entry.count - 1 } } }, { merge: true })
    })
  } catch {
    // A missed refund only costs the user one unit until tomorrow.
  }
}
