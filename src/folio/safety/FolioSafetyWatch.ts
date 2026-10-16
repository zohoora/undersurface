import type { CrisisCheck } from '../../ai/openrouter'
import { checkKey, checkKeys } from './checkedSet'
import { belowFloor, l1Inputs, samplesFor } from './samples'
import type { SafetyUnit } from './samples'

// C4's scheduler (draft 4 §5.4, §6.7). L1 runs synchronously on the unit and
// its adjacent pairs; L2 samples wait in one slot per unit (a new revision of
// a unit replaces its slot; different units never replace each other), one
// call in flight, oldest first. A result counts only for the key it was sent
// with; a unit enters the checked set once every window is classified; an
// unavailable check never enters it. Only the tab holding the page's lock
// checks anything.

export const SETTLE_SPACING_MS = 6_000
export const SWEEP_SPACING_MS = 10_000
export const RETRY_MS = [30_000, 120_000, 600_000]
export const BACKLOG_WARN = 30
export const LATE_AFTER_MS = 72 * 60 * 60 * 1000

type Origin = 'settle' | 'paste' | 'sweep'

interface Slot {
  pid: string
  key: string
  samples: string[]
  done: Set<number>
  risk2: boolean
  origin: Origin
  queuedAt: number
  attempts: number
  notBefore: number
  late: boolean
}

export interface SafetyWatchDeps {
  l1: (text: string) => boolean
  check: (sample: string, language: string) => Promise<CrisisCheck>
  /** A risk on recent writing: shore (activateGrounding), with its trigger. */
  activate: (trigger: string) => void
  /** A risk found late, on a page not edited for 72 h: the card only (§5.4). */
  lateRisk: (trigger: string) => void
  units: () => SafetyUnit[]
  /** The page's checked set; the host saves it with ordinary saves. */
  checked: Set<string>
  onCheckedChange?: () => void
  /** Each classified window's risk, by unit (companion involvement writes only beside risk 0). */
  onClassified?: (pid: string, risk: number) => void
  isLockHolder: () => boolean
  language: () => string
  /** The page's `updatedAt` when it was opened. */
  pageUpdatedAt: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  onDiagnostic?: (code: string) => void
}

export class FolioSafetyWatch {
  private readonly d: Required<Omit<SafetyWatchDeps, 'onCheckedChange' | 'onDiagnostic' | 'onClassified'>> & Pick<SafetyWatchDeps, 'onCheckedChange' | 'onDiagnostic' | 'onClassified'>
  private readonly slots = new Map<string, Slot>()
  private readonly dirty = new Set<string>()
  private inflight: { pid: string; key: string; window: number } | null = null
  private lastStart = -Infinity
  private timer: unknown = null
  private disposed = false
  private readonly onOnline = () => {
    for (const slot of this.slots.values()) slot.notBefore = 0
    this.pump()
  }

  constructor(deps: SafetyWatchDeps) {
    this.d = {
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...deps,
    }
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline)
  }

  /** The editor changed this unit; L1 runs on it if the page is hidden before it settles. */
  markDirty(pid: string): void {
    this.dirty.add(pid)
  }

  /** 2 s without typing in a unit, or the caret left it. */
  settle(pid: string): Promise<void> {
    this.dirty.delete(pid)
    return this.examine([pid], 'settle', false)
  }

  paste(pids: string[]): Promise<void> {
    for (const pid of pids) this.dirty.delete(pid)
    return this.examine(pids, 'paste', false)
  }

  /** pagehide / hidden / route change: L1 synchronously on units changed since they last settled. */
  hidden(): void {
    if (!this.d.isLockHolder() || this.dirty.size === 0) return
    const units = this.d.units()
    for (const pid of this.dirty) {
      const i = units.findIndex((u) => u.pid === pid)
      if (i >= 0) this.runL1(units, i, false)
    }
    this.dirty.clear()
  }

  /**
   * Open, hydrate or a remote revision: every unchecked unit is examined.
   * On open and hydrate of a page not edited for 72 hours, results are late.
   */
  async sweep(origin: 'open' | 'hydrate' | 'remote'): Promise<void> {
    if (!this.d.isLockHolder()) return
    const units = this.d.units()
    const keys = await checkKeys(units)
    const late = origin !== 'remote' && this.d.now() - this.d.pageUpdatedAt > LATE_AFTER_MS
    const pids = units.filter((_, i) => !this.d.checked.has(keys[i])).map((u) => u.pid)
    await this.examine(pids, 'sweep', late)
  }

  forget(pid: string): void {
    this.slots.delete(pid)
    this.dirty.delete(pid)
  }

  get pendingCount(): number { return this.slots.size }

  dispose(): void {
    this.disposed = true
    if (this.timer) this.d.clearTimer(this.timer)
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline)
  }

  // ------------------------------------------------------------ internals

  private runL1(units: SafetyUnit[], i: number, late: boolean): boolean {
    for (const input of l1Inputs(units, i)) {
      if (this.d.l1(input.text)) {
        if (late) this.d.lateRisk(input.trigger)
        else this.d.activate(input.trigger)
        return true
      }
    }
    return false
  }

  private async examine(pids: string[], origin: Origin, late: boolean): Promise<void> {
    if (this.disposed || !this.d.isLockHolder()) return
    const units = this.d.units()
    for (const pid of pids) {
      const i = units.findIndex((u) => u.pid === pid)
      if (i < 0) { this.forget(pid); continue }
      this.runL1(units, i, late)
      const key = await checkKey(units[i])
      if (this.d.checked.has(key)) { this.slots.delete(pid); continue }
      const samples = samplesFor(units, i)
      if (samples.every(belowFloor)) {
        // Too short for L2, even with its context: L1 has run, and that's the check.
        this.d.checked.add(key)
        this.d.onCheckedChange?.()
        this.slots.delete(pid)
        continue
      }
      const existing = this.slots.get(pid)
      this.slots.set(pid, {
        pid, key, samples, done: new Set(), risk2: false, origin,
        queuedAt: existing?.queuedAt ?? this.d.now(), attempts: 0, notBefore: 0,
        late: late && (existing?.late ?? true),
      })
    }
    if (this.slots.size > BACKLOG_WARN) this.d.onDiagnostic?.('folio.l2.backlog')
    this.pump()
  }

  private pump(): void {
    if (this.disposed || this.inflight) return
    if (this.timer) { this.d.clearTimer(this.timer); this.timer = null }
    const now = this.d.now()
    const ready = [...this.slots.values()].filter((s) => s.notBefore <= now).sort((a, b) => a.queuedAt - b.queuedAt)
    const next = ready[0]
    if (!next) {
      const waits = [...this.slots.values()].map((s) => s.notBefore - now).filter((w) => w > 0)
      if (waits.length > 0) this.timer = this.d.setTimer(() => { this.timer = null; this.pump() }, Math.min(...waits))
      return
    }
    const spacing = next.origin === 'settle' ? SETTLE_SPACING_MS : SWEEP_SPACING_MS
    const wait = this.lastStart + spacing - now
    if (wait > 0) {
      this.timer = this.d.setTimer(() => { this.timer = null; this.pump() }, wait)
      return
    }
    const window = [...next.samples.keys()].find((w) => !next.done.has(w)) ?? 0
    this.inflight = { pid: next.pid, key: next.key, window }
    this.lastStart = now
    this.d.check(next.samples[window], this.d.language()).then(
      (result) => this.onResult(next.pid, next.key, window, result),
      () => this.onResult(next.pid, next.key, window, { status: 'unavailable', cause: 'network' }),
    )
  }

  private onResult(pid: string, key: string, window: number, result: CrisisCheck): void {
    this.inflight = null
    if (this.disposed) return
    const slot = this.slots.get(pid)
    if (!slot || slot.key !== key) {
      // The text changed while the call was in flight: the result is stale.
      this.d.onDiagnostic?.('folio.l2.stale')
      this.pump()
      return
    }
    if (result.status === 'classified') {
      slot.done.add(window)
      slot.attempts = 0
      this.d.onClassified?.(pid, result.risk)
      if (result.risk === 2 && !slot.risk2) {
        slot.risk2 = true
        if (slot.late) this.d.lateRisk(pid)
        else this.d.activate(pid)
        if (slot.late) this.d.onDiagnostic?.('folio.l2.lateRisk')
      }
      if (slot.done.size >= slot.samples.length) {
        this.d.checked.add(key)
        this.slots.delete(pid)
        this.d.onCheckedChange?.()
      }
    } else {
      this.d.onDiagnostic?.(result.cause === 'rate_limited' ? 'folio.l2.rateLimited' : 'folio.l2.unavailable')
      const base = RETRY_MS[Math.min(slot.attempts, RETRY_MS.length - 1)]
      slot.notBefore = this.d.now() + (result.cause === 'rate_limited' ? base * 2 : base)
      slot.attempts++
    }
    this.pump()
  }
}
