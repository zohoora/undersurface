export interface SessionTicket {
  epoch: number
  sessionId: string | null
}

export type EnqueueAppend = <T>(fn: () => Promise<T>) => Promise<T>

/**
 * Owns the mutable lifetime primitives that must span every session surface:
 * one epoch, one abort set, one persistence queue, and one synchronous send
 * lock. React owns presentation state; this kernel owns whether asynchronous
 * work still belongs to the active session.
 */
export class SessionRuntime {
  private epoch = 0
  private sessionId: string | null = null
  private controllers = new Set<AbortController>()
  private appendTail: Promise<unknown> = Promise.resolve()
  private sendLocked = false

  begin(sessionId: string | null): SessionTicket {
    this.abortAll()
    this.epoch++
    this.sessionId = sessionId
    this.sendLocked = false
    return this.currentTicket()
  }

  adoptSessionId(sessionId: string, ticket: SessionTicket): boolean {
    if (!this.isCurrent(ticket)) return false
    this.sessionId = sessionId
    return true
  }

  currentTicket(): SessionTicket {
    return { epoch: this.epoch, sessionId: this.sessionId }
  }

  isCurrent(ticket: SessionTicket): boolean {
    return ticket.epoch === this.epoch
      && (ticket.sessionId === null || ticket.sessionId === this.sessionId)
  }

  isSessionActive(sessionId: string): boolean {
    return this.sessionId === sessionId
  }

  end(ticket: SessionTicket): void {
    if (!this.isCurrent(ticket)) return
    this.abortAll()
    this.epoch++
    this.sessionId = null
    this.sendLocked = false
  }

  createAbortController(): AbortController {
    const controller = new AbortController()
    this.controllers.add(controller)
    controller.signal.addEventListener('abort', () => this.controllers.delete(controller), { once: true })
    return controller
  }

  releaseAbortController(controller: AbortController): void {
    this.controllers.delete(controller)
  }

  enqueueAppend<T>(fn: () => Promise<T>): Promise<T> {
    // Persistence that has already begun is intentionally allowed to finish
    // after a view switch; callers fence React writes by active session id.
    const run = this.appendTail.then(fn, fn)
    this.appendTail = run.then(() => {}, () => {})
    return run
  }

  acquireSend(): boolean {
    if (this.sendLocked) return false
    this.sendLocked = true
    return true
  }

  releaseSend(): void {
    this.sendLocked = false
  }

  private abortAll(): void {
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
}
