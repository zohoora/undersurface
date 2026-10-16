import { freshBudget } from './conductor'
import type { VisitBudget } from './conductor'

// A visit (C5): it ends on a reload, or after 30 minutes with Folio hidden.
// The companion's limits are per visit, per account.

const HIDDEN_ENDS_VISIT_MS = 30 * 60_000
let current: { uid: string; budget: VisitBudget } | null = null
let hiddenAt: number | null = null

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
    if (hiddenAt !== null && Date.now() - hiddenAt >= HIDDEN_ENDS_VISIT_MS) current = null
    hiddenAt = null
  })
}

export function visitBudget(uid: string): VisitBudget {
  if (!current || current.uid !== uid) current = { uid, budget: freshBudget() }
  return current.budget
}

/** Tests only. */
export function resetVisit(): void {
  current = null
  hiddenAt = null
}
