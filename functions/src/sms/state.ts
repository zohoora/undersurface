import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore'

/**
 * Server-owned SMS state. Everything here lives either in Admin-SDK-only
 * documents (`users/{uid}/smsSettings/*`, which client rules make read-only)
 * or is read from client-writable docs and treated as untrusted input.
 */

/** A crisis within this window suppresses proactive SMS and grounds replies. */
export const RECENT_CRISIS_WINDOW_MS = 72 * 60 * 60_000
/** Generated SMS companion turns per writer per UTC day. Crisis turns are exempt. */
export const SMS_DAILY_TURN_LIMIT = 40

export interface ServerSmsState {
  lastRiskAt: number | null
  optedOutAt: number | null
}

function smsSettingsDoc(db: Firestore, uid: string, id: string) {
  return db.collection('users').doc(uid).collection('smsSettings').doc(id)
}

function companionPreferencesDoc(db: Firestore, uid: string) {
  return db.collection('users').doc(uid).collection('companionPreferences').doc('current')
}

/** Epoch ms from a number or Firestore Timestamp-like value. */
export function timestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis
    if (typeof toMillis === 'function') {
      const ms = toMillis.call(value) as unknown
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : null
    }
  }
  return null
}

/** `lastGroundingAt` written by the web client when grounding activates. */
export function lastGroundingAtFromPreferences(preferences: DocumentData | null | undefined): number | null {
  return preferences ? timestampMs(preferences.lastGroundingAt) : null
}

/**
 * A crisis is "recent" when the later of the server's SMS risk record and the
 * web client's grounding timestamp is inside the window. A future timestamp
 * (clock skew) counts as recent: suppression is the safe direction.
 */
export function isRecentCrisis(
  input: { lastRiskAt: number | null; lastGroundingAt: number | null },
  now: number,
): boolean {
  const latest = Math.max(input.lastRiskAt ?? -Infinity, input.lastGroundingAt ?? -Infinity)
  return Number.isFinite(latest) && now - latest < RECENT_CRISIS_WINDOW_MS
}

export async function readServerSmsState(uid: string, db: Firestore = getFirestore()): Promise<ServerSmsState> {
  const [riskSnap, optOutSnap] = await db.getAll(
    smsSettingsDoc(db, uid, 'riskState'),
    smsSettingsDoc(db, uid, 'optOut'),
  )
  return {
    lastRiskAt: riskSnap.exists ? timestampMs(riskSnap.data()?.lastRiskAt) : null,
    optedOutAt: optOutSnap.exists ? timestampMs(optOutSnap.data()?.optedOutAt) : null,
  }
}

/** Server state plus the client grounding timestamp, for one SMS turn. */
export async function readRecentCrisis(
  uid: string,
  now: number,
  db: Firestore = getFirestore(),
): Promise<boolean> {
  const [riskSnap, preferencesSnap] = await db.getAll(
    smsSettingsDoc(db, uid, 'riskState'),
    companionPreferencesDoc(db, uid),
  )
  return isRecentCrisis({
    lastRiskAt: riskSnap.exists ? timestampMs(riskSnap.data()?.lastRiskAt) : null,
    lastGroundingAt: preferencesSnap.exists ? lastGroundingAtFromPreferences(preferencesSnap.data()) : null,
  }, now)
}

/** Record SMS risk >= 1 so later replies and proactive windows can see it. */
export async function recordSmsRisk(
  uid: string,
  risk: 0 | 1 | 2,
  now: number,
  db: Firestore = getFirestore(),
): Promise<void> {
  if (risk < 1) return
  await smsSettingsDoc(db, uid, 'riskState').set({
    lastRiskAt: now,
    lastRiskLevel: risk,
    updatedAt: now,
  }, { merge: true })
}

/**
 * STOP/UNLINK revoke proactive-SMS consent server-side. The opt-out timestamp
 * lives in a server-owned doc so a stale client write of old consent cannot
 * resume field windows after re-linking.
 */
export async function revokeFieldWindowConsent(
  uid: string,
  now: number,
  db: Firestore = getFirestore(),
): Promise<void> {
  await smsSettingsDoc(db, uid, 'optOut').set({ optedOutAt: now, updatedAt: now }, { merge: true })
  const preferencesRef = companionPreferencesDoc(db, uid)
  const snap = await preferencesRef.get()
  const fieldWindows = snap.exists ? snap.data()?.fieldWindows : null
  if (!fieldWindows || typeof fieldWindows !== 'object') return
  await preferencesRef.update({
    'fieldWindows.enabled': false,
    'fieldWindows.consentAt': FieldValue.delete(),
    'fieldWindows.updatedAt': now,
    updatedAt: now,
  })
}

/** `appConfig/global.features.smsEnabled`: enabled unless explicitly false. */
export function smsEnabledFromConfig(config: DocumentData | null | undefined): boolean {
  const features = config?.features
  if (!features || typeof features !== 'object') return true
  return (features as Record<string, unknown>).smsEnabled !== false
}

/**
 * The kill switch fails open on a config read error: an unreadable config doc
 * should not take the channel (and its crisis replies) offline.
 */
export async function isSmsEnabled(db: Firestore = getFirestore()): Promise<boolean> {
  try {
    const snap = await db.collection('appConfig').doc('global').get()
    return smsEnabledFromConfig(snap.exists ? snap.data() : null)
  } catch (error) {
    console.error(`[sms] config unavailable category=${stateErrorCategory(error)}`)
    return true
  }
}

/**
 * Account deletion (functions/src/account.ts) writes `{ status: 'deleting' }`
 * to `users/{uid}` first and removes that tombstone last, after the Auth user
 * is gone. Checking both signals covers every point of the deletion flow.
 */
export async function isAccountDeleting(uid: string, db: Firestore = getFirestore()): Promise<boolean> {
  const snap = await db.collection('users').doc(uid).get()
  if (snap.exists) {
    const data = snap.data()
    if (data?.status === 'deleting' || timestampMs(data?.deletedAt) !== null) return true
  }
  try {
    await getAuth().getUser(uid)
    return false
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'auth/user-not-found') return true
    // An Auth outage must not stop the channel; the tombstone check above
    // already covers the deletion window up to the Auth delete.
    console.error(`[sms] auth lookup failed category=${stateErrorCategory(error)}`)
    return false
  }
}

export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * Reserve one generated SMS turn against the writer's daily budget. The
 * reservation is recorded on the queue doc in the same transaction, so a
 * retried delivery of the same message never counts twice.
 */
export async function reserveDailySmsTurn(
  uid: string,
  queueRef: FirebaseFirestore.DocumentReference,
  now: number,
  db: Firestore = getFirestore(),
  limit = SMS_DAILY_TURN_LIMIT,
): Promise<boolean> {
  const usageRef = smsSettingsDoc(db, uid, 'usage')
  const dayKey = utcDayKey(now)
  return db.runTransaction(async transaction => {
    const [usageSnap, queueSnap] = await Promise.all([
      transaction.get(usageRef),
      transaction.get(queueRef),
    ])
    if (queueSnap.exists && queueSnap.data()?.budgetReservedAt) return true
    const usage = usageSnap.exists ? usageSnap.data() : null
    const turns = usage?.dayKey === dayKey && typeof usage.turns === 'number' ? usage.turns : 0
    if (turns >= limit) return false
    transaction.set(usageRef, { dayKey, turns: turns + 1, updatedAt: now })
    if (queueSnap.exists) transaction.update(queueRef, { budgetReservedAt: now })
    return true
  })
}

function stateErrorCategory(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'number' || typeof code === 'string') return `provider_${String(code).slice(0, 40)}`
  return error instanceof Error ? error.name.slice(0, 40) : 'unknown'
}
