import { useSyncExternalStore } from 'react'
import type { User } from 'firebase/auth'
import { isAdmin } from '../admin/isAdmin'
import type { GlobalConfig } from '../admin/adminTypes'

// Who can open Folio (draft 4 §6.4; build plan §3.2): everyone once
// `folioEnabled` is true; until then admins, and accounts carrying the
// private `folio` claim (the production test account).

type Features = GlobalConfig['features'] | undefined | null

export function canOpenFolio(features: Features, email: string | null | undefined, claims: { folio?: boolean } | null): boolean {
  return features?.folioEnabled === true || isAdmin(email ?? undefined) || claims?.folio === true
}

export interface FolioSwitches {
  between: boolean
  distance: boolean
  liftToday: boolean
  ask: boolean
  stepInside: boolean
  stepInsideSound: boolean
  returnOn: boolean
}

/** Every sub-switch is on unless explicitly false (build plan §3.1). */
export function folioSwitches(features: Features): FolioSwitches {
  const on = (v: boolean | undefined) => v !== false
  return {
    between: on(features?.folioBetween),
    distance: on(features?.folioDistance),
    liftToday: on(features?.folioLiftToday),
    ask: on(features?.folioAsk),
    stepInside: on(features?.folioStepInside),
    stepInsideSound: on(features?.folioStepInsideSound),
    returnOn: on(features?.folioReturn),
  }
}

// ---------------------------------------------------------------- the claim

let claim: { uid: string; folio: boolean; forced: boolean } | null = null
const listeners = new Set<() => void>()
const notify = () => { for (const fn of listeners) fn() }

/** Read the `folio` claim from the ID token. `force` refreshes the token once per user. */
export async function loadFolioClaim(user: User | null, force = false): Promise<boolean> {
  if (!user) { claim = null; notify(); return false }
  if (claim?.uid === user.uid && (claim.forced || !force)) return claim.folio
  try {
    const result = await user.getIdTokenResult(force)
    claim = { uid: user.uid, folio: result.claims.folio === true, forced: force || claim?.forced === true }
  } catch {
    claim = { uid: user.uid, folio: false, forced: false }
  }
  notify()
  return claim.folio
}

export function resetFolioClaim(): void {
  claim = null
  notify()
}

export function useFolioClaim(uid: string | undefined): { folio?: boolean } | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => (claim && claim.uid === uid ? (claim.folio ? FOLIO_TRUE : FOLIO_FALSE) : null),
  )
}

const FOLIO_TRUE = { folio: true }
const FOLIO_FALSE = { folio: false }
