// How a Folio page looks around grounding (draft 4 §3.9, §5.5). Pure
// presentation: it never activates or ends the shared grounding state.
//
//   normal → shore   when grounding is active in this tab
//   shore  → quiet   on "I'm okay" (grounding may still be active), or when
//                    grounding ends and the visit continues
//   quiet  → shore   only for an activation whose trigger hasn't already
//                    started shore in this visit
//   quiet  → normal  when the visit ends (hidden for 30 minutes)
//   load   → quiet   when an activation happened on this device in the last
//                    30 minutes (a reload ends grounding; motion stays off)

export type Presentation = 'normal' | 'shore' | 'quiet'

export const VISIT_IDLE_MS = 30 * 60 * 1000
export const RELOAD_QUIET_MS = 30 * 60 * 1000

export interface ShoreSnapshot {
  presentation: Presentation
  /** The crisis resources card: shore, a late risk, or Find help. */
  card: boolean
  /** Bumped when Find help asks to re-show a dismissed card. */
  cardToken: number
  /** Words that may be brought to Talk, and only after the writer sees them. */
  bring: { text: string } | null
}

export class ShorePresentation {
  private presentation: Presentation = 'normal'
  private okayPressed = false
  private readonly shown = new Set<string>()
  private card = false
  private cardToken = 0
  private bring: { text: string } | null = null
  private hiddenAt: number | null = null
  private readonly listeners = new Set<() => void>()
  private snapshot: ShoreSnapshot

  constructor(opts: { lastActivationAt: number | null; now?: number }) {
    const now = opts.now ?? Date.now()
    if (opts.lastActivationAt !== null && now - opts.lastActivationAt < RELOAD_QUIET_MS) this.presentation = 'quiet'
    this.snapshot = this.build()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  getSnapshot = (): ShoreSnapshot => this.snapshot

  private emit() {
    this.snapshot = this.build()
    for (const fn of this.listeners) fn()
  }

  private build(): ShoreSnapshot {
    return { presentation: this.presentation, card: this.card || this.presentation === 'shore', cardToken: this.cardToken, bring: this.bring }
  }

  /** The shared grounding state changed (any surface, this tab). */
  groundingChanged(active: boolean): void {
    if (active && this.presentation === 'normal') {
      this.presentation = 'shore'
      this.okayPressed = false
    } else if (!active && this.presentation === 'shore') {
      this.presentation = 'quiet'
      this.card = false
    }
    this.emit()
  }

  /**
   * Folio's own checks found risk in recent writing. `trigger` is the unit
   * or pair (§5.4); `text` is what "Talk now, bringing this" may offer.
   */
  activation(trigger: string, text: string | null): void {
    const seen = this.shown.has(trigger)
    this.shown.add(trigger)
    // In Quiet, text that already brought shore this visit doesn't bring the
    // line back; the shared state was still re-activated by the caller.
    if (this.presentation === 'quiet' && seen) return
    this.presentation = 'shore'
    this.okayPressed = false
    this.bring = text ? { text } : this.bring
    this.emit()
  }

  /** A late risk on an older page: the card only, nothing else changes. */
  lateRisk(): void {
    this.card = true
    this.cardToken++
    this.emit()
  }

  okay(): void {
    if (this.presentation !== 'shore') return
    this.presentation = 'quiet'
    this.okayPressed = true
    this.card = false
    this.emit()
  }

  findHelp(): void {
    this.card = true
    this.cardToken++
    this.emit()
  }

  cardDismissed(): void {
    if (this.presentation === 'shore') this.okay()
    else { this.card = false; this.emit() }
  }

  clearBring(): void {
    this.bring = null
    this.emit()
  }

  visibility(hidden: boolean, now: number): void {
    if (hidden) { this.hiddenAt = now; return }
    if (this.hiddenAt !== null && now - this.hiddenAt >= VISIT_IDLE_MS && this.presentation === 'quiet') {
      this.presentation = 'normal'
      this.okayPressed = false
      this.shown.clear()
      this.emit()
    }
    this.hiddenAt = null
  }
}

// ---------------------------------------------------------------- the activation mirror

const mirrorKey = (uid: string) => `us.folioActivation.${uid}`

export function writeActivationMirror(uid: string, at: number): void {
  try { localStorage.setItem(mirrorKey(uid), String(at)) } catch { /* convenience */ }
}

export function readActivationMirror(uid: string): number | null {
  try {
    const v = Number(localStorage.getItem(mirrorKey(uid)))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
