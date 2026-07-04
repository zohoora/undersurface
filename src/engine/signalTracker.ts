// Hysteresis + cooldown state machine for the per-turn signal classifier.
// Pure and session-scoped: reset() on session change; nothing persists.
//
// Pivot (rumination) is ONE-SHOT: it fires on the arming turn only — a single
// register shift, then a cooldown so the companion doesn't pivot repeatedly.
// Soften (withdrawal) is a HELD state: the stance stays soft while withdrawal
// persists and releases only after two consecutive clear turns.
// Spec: docs/superpowers/specs/2026-07-03-rupture-rumination-design.md

export interface SignalLevels {
  withdrawal: 0 | 1 | 2
  rumination: 0 | 1 | 2
}

export interface SignalState {
  pivotActive: boolean
  softenActive: boolean
}

const ARM_STREAK = 2
const PIVOT_COOLDOWN_TURNS = 6
const SOFTEN_RELEASE_STREAK = 2

// Cross-session watch (companionSignals.ruminationWatch): consumers treat the
// reflection-pass streak as armed at this many consecutive loop sessions.
export const RUMINATION_WATCH_ARM_STREAK = 3

export class SignalTracker {
  private ruminationStreak = 0
  private pivotCooldown = 0
  private withdrawalStreak = 0
  private withdrawalClearStreak = 0
  private soft = false

  record(levels: SignalLevels): SignalState {
    // — pivot —
    this.ruminationStreak = levels.rumination === 2 ? this.ruminationStreak + 1 : 0
    let pivotActive = false
    if (this.pivotCooldown > 0) {
      this.pivotCooldown--
    } else if (this.ruminationStreak >= ARM_STREAK) {
      pivotActive = true
      this.pivotCooldown = PIVOT_COOLDOWN_TURNS
    }

    // — soften —
    if (levels.withdrawal === 2) {
      this.withdrawalStreak++
      this.withdrawalClearStreak = 0
    } else if (levels.withdrawal === 0) {
      this.withdrawalStreak = 0
      this.withdrawalClearStreak++
    } else {
      // Level 1: neither builds the arm streak nor counts toward release.
      this.withdrawalStreak = 0
      this.withdrawalClearStreak = 0
    }
    if (this.withdrawalStreak >= ARM_STREAK) this.soft = true
    if (this.withdrawalClearStreak >= SOFTEN_RELEASE_STREAK) this.soft = false

    return { pivotActive, softenActive: this.soft }
  }

  reset(): void {
    this.ruminationStreak = 0
    this.pivotCooldown = 0
    this.withdrawalStreak = 0
    this.withdrawalClearStreak = 0
    this.soft = false
  }
}
