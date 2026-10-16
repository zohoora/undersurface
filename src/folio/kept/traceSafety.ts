import type { CrisisCheck } from '../../ai/openrouter'
import { FolioSafetyWatch } from '../safety/FolioSafetyWatch'
import { checkKeys, pruneChecked } from '../safety/checkedSet'
import type { FolioTrace, FolioTraceEntry } from '../../types/folio'
import { traceUnits } from './keep'

// C4 for kept things (draft 4 §5.4, "Traces too"). Each trace carries its own
// checked set. Its units are its between, its beneath and each added entry.
// New text (Keep, Add, a corrected copy) is checked at once; unchecked units
// are swept when the trace or the Kept view opens. Traces are checked one at
// a time, each with only its own units, so a trace never reads another's
// words as context. A risk on writing older than 72 hours shows the card only.

export const TRACE_JOB_MAX_MS = 2 * 60 * 1000
const POLL_MS = 250

export interface TraceSafetyDeps {
  l1: (text: string) => boolean
  check: (sample: string, language: string) => Promise<CrisisCheck>
  activate: (trigger: string) => void
  lateRisk: (trigger: string) => void
  language: () => string
  /** Write the trace's checked set (the rules allow only this field to change). */
  persist: (traceId: string, checked: string[]) => Promise<void> | void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Test seams, passed to each trace's watch. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

interface Job {
  trace: FolioTrace
  entries: FolioTraceEntry[]
  /** New text to check at once; absent for a sweep. */
  pids?: string[]
}

export class TraceSafety {
  private readonly queue: Job[] = []
  private running = false
  private disposed = false
  private current: FolioSafetyWatch | null = null
  private readonly d: Required<Omit<TraceSafetyDeps, 'now' | 'sleep' | 'setTimer' | 'clearTimer'>> & Pick<TraceSafetyDeps, 'setTimer' | 'clearTimer'> & { now: () => number; sleep: (ms: number) => Promise<void> }

  constructor(deps: TraceSafetyDeps) {
    this.d = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), ...deps }
  }

  /** Check every unit of this trace not yet in its checked set. */
  sweep(trace: FolioTrace, entries: FolioTraceEntry[]): void {
    if (this.queue.some((j) => j.trace.id === trace.id && !j.pids)) return
    this.enqueue({ trace, entries })
  }

  /** New text on this trace (Keep, Add, a corrected copy), checked now. */
  checkNew(trace: FolioTrace, entries: FolioTraceEntry[], pids: string[]): void {
    this.enqueue({ trace, entries, pids })
  }

  dispose(): void {
    this.disposed = true
    this.queue.length = 0
    this.current?.dispose()
  }

  private enqueue(job: Job): void {
    if (this.disposed) return
    // New text goes first: it's what the writer is looking at.
    if (job.pids) this.queue.unshift(job)
    else this.queue.push(job)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (!this.disposed && this.queue.length > 0) {
        const job = this.queue.shift() as Job
        await this.run(job)
      }
    } finally {
      this.running = false
    }
  }

  private async run({ trace, entries, pids }: Job): Promise<void> {
    const units = traceUnits(trace, entries)
    if (units.length === 0) return
    const checked = new Set(trace.safety?.checked ?? [])
    const lastActivity = Math.max(trace.keptAt, ...entries.map((e) => e.addedAt))
    let changed = false
    const watch = new FolioSafetyWatch({
      l1: this.d.l1,
      check: this.d.check,
      activate: this.d.activate,
      lateRisk: this.d.lateRisk,
      units: () => units,
      checked,
      onCheckedChange: () => { changed = true },
      isLockHolder: () => true,
      language: this.d.language,
      pageUpdatedAt: lastActivity,
      now: this.d.now,
      ...(this.d.setTimer ? { setTimer: this.d.setTimer } : {}),
      ...(this.d.clearTimer ? { clearTimer: this.d.clearTimer } : {}),
    })
    this.current = watch
    try {
      if (pids) await watch.paste(pids.filter((pid) => units.some((u) => u.pid === pid)))
      else await watch.sweep('open')
      const started = this.d.now()
      while (!this.disposed && watch.pendingCount > 0 && this.d.now() - started < TRACE_JOB_MAX_MS) await this.d.sleep(POLL_MS)
      if (changed && !this.disposed) {
        const live = await checkKeys(units)
        await this.d.persist(trace.id, pruneChecked(checked, live))
      }
    } catch {
      // Best effort: whatever is still unchecked is swept on the next open.
    } finally {
      watch.dispose()
      this.current = null
    }
  }
}
