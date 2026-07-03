import { getFirestore } from 'firebase-admin/firestore'

// Durable, admin-configurable per-user token quota. The quota unit is
// COMPLETION tokens (model output, including reasoning) — the expensive,
// model-generated part of a request and exactly what max_completion_tokens
// bounds, so a reservation of max_completion_tokens is always an upper bound on
// what a request can spend. Config lives in appConfig/global under `quota` and
// is read (cached) by the chat function. Default disabled: an unset or
// malformed config never blocks anyone.

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

interface QuotaDoc {
  period: string
  tokensUsed: number
  requestCount: number
}

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

    const requestCount = data && data.period === key ? (data.requestCount ?? 0) : 0
    tx.set(ref, {
      period: key,
      tokensUsed: used + reserveTokens,
      requestCount: requestCount + 1,
    }, { merge: true })
    return { allowed: true, used, cap, reserved: reserveTokens }
  })
}

// Settle a reservation once the response finishes: adjust tokensUsed by
// (actual - reserved). Actual is almost always < reserved (a request rarely
// emits its full max_completion_tokens), so this refunds the difference. Guards
// the period so a rollover between reserve and reconcile doesn't corrupt the new
// month's count. Best-effort — never throws into the request path.
export async function reconcile(opts: {
  uid: string
  reservedTokens: number
  actualTokens: number
  now: Date
}): Promise<void> {
  const { uid, reservedTokens, actualTokens, now } = opts
  const delta = actualTokens - reservedTokens
  if (delta === 0 || reservedTokens === 0) return

  const ref = quotaRef(uid)
  const key = periodKey(now)
  try {
    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const data = snap.data() as QuotaDoc
      if (data.period !== key) return // rolled over since reserve; leave it alone
      const next = Math.max(0, (data.tokensUsed ?? 0) + delta)
      tx.update(ref, { tokensUsed: next })
    })
  } catch {
    // Accounting is best-effort; a failed reconcile just leaves the (safe)
    // over-reservation in place until the monthly reset.
  }
}
