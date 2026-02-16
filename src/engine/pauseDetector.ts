import type { PauseEvent, PauseType } from '../types'

interface KeystrokeRecord {
  timestamp: number
  char: string
}

type PauseCallback = (event: PauseEvent) => void

export class PauseDetector {
  private keystrokes: KeystrokeRecord[] = []
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private longPauseTimer: ReturnType<typeof setTimeout> | null = null
  private callback: PauseCallback
  private currentText: string = ''
  private cursorPosition: number = 0
  private isPaused: boolean = false
  private isActive: boolean = true
  private lastPauseTime: number = 0
  private speedMultiplier: number = 1

  // Base timing thresholds (ms) — scaled by 1/speedMultiplier
  private readonly BASE_SHORT_PAUSE = 4500
  private readonly BASE_LONG_PAUSE = 15000
  private readonly BASE_MIN_PAUSE_INTERVAL = 12000
  private readonly CADENCE_WINDOW = 10
  private readonly CADENCE_SLOWDOWN_RATIO = 2.5

  private get SHORT_PAUSE() { return this.BASE_SHORT_PAUSE / this.speedMultiplier }
  private get LONG_PAUSE() { return this.BASE_LONG_PAUSE / this.speedMultiplier }
  private get MIN_PAUSE_INTERVAL() { return this.BASE_MIN_PAUSE_INTERVAL / this.speedMultiplier }

  constructor(callback: PauseCallback) {
    this.callback = callback
  }

  setSpeedMultiplier(multiplier: number) {
    this.speedMultiplier = Math.max(0.5, Math.min(2, multiplier))
  }

  recordKeystroke(char: string, fullText: string, cursorPos: number) {
    if (!this.isActive) return

    this.currentText = fullText
    this.cursorPosition = cursorPos
    this.isPaused = false

    this.keystrokes.push({ timestamp: Date.now(), char })
    if (this.keystrokes.length > 50) {
      this.keystrokes = this.keystrokes.slice(-50)
    }

    this.clearTimers()
    this.startPauseDetection()
  }

  updateText(fullText: string, cursorPos: number) {
    this.currentText = fullText
    this.cursorPosition = cursorPos
  }

  suppress() {
    this.isActive = false
    this.clearTimers()
  }

  resume() {
    this.isActive = true
  }

  destroy() {
    this.clearTimers()
    this.isActive = false
  }

  private clearTimers() {
    if (this.pauseTimer) clearTimeout(this.pauseTimer)
    if (this.longPauseTimer) clearTimeout(this.longPauseTimer)
    this.pauseTimer = null
    this.longPauseTimer = null
  }

  private startPauseDetection() {
    const now = Date.now()

    this.pauseTimer = setTimeout(() => {
      if (now - this.lastPauseTime < this.MIN_PAUSE_INTERVAL) return
      this.detectAndEmitPause()
    }, this.SHORT_PAUSE)

    this.longPauseTimer = setTimeout(() => {
      if (this.isPaused) return
      if (now - this.lastPauseTime < this.MIN_PAUSE_INTERVAL) return
      this.emitPause('long_pause', this.LONG_PAUSE)
    }, this.LONG_PAUSE)
  }

  private detectAndEmitPause() {
    if (this.isPaused) return

    const recentText = this.getRecentText()
    const pauseType = this.classifyPause(recentText)
    const duration = this.getTimeSinceLastKeystroke()

    this.emitPause(pauseType, duration)
  }

  private classifyPause(recentText: string): PauseType {
    const trimmed = recentText.trimEnd()

    if (trimmed.endsWith('...') || trimmed.endsWith('…')) {
      return 'ellipsis'
    }

    if (trimmed.endsWith('?')) {
      return 'question'
    }

    if (trimmed.endsWith('\n\n') || trimmed.endsWith('\n')) {
      return 'paragraph_break'
    }

    if (trimmed.endsWith('.') || trimmed.endsWith('!')) {
      return 'sentence_complete'
    }

    if (this.detectCadenceSlowdown()) {
      return 'cadence_slowdown'
    }

    if (this.endsWithIncompleteThought(trimmed)) {
      return 'trailing_off'
    }

    return 'short_pause'
  }

  private detectCadenceSlowdown(): boolean {
    if (this.keystrokes.length < this.CADENCE_WINDOW * 2) return false

    const recent = this.keystrokes.slice(-this.CADENCE_WINDOW)
    const earlier = this.keystrokes.slice(
      -this.CADENCE_WINDOW * 2,
      -this.CADENCE_WINDOW,
    )

    const recentAvg = this.averageInterval(recent)
    const earlierAvg = this.averageInterval(earlier)

    return recentAvg > earlierAvg * this.CADENCE_SLOWDOWN_RATIO
  }

  private averageInterval(records: KeystrokeRecord[]): number {
    if (records.length < 2) return 0
    const intervals: number[] = []
    for (let i = 1; i < records.length; i++) {
      intervals.push(records[i].timestamp - records[i - 1].timestamp)
    }
    return intervals.reduce((a, b) => a + b, 0) / intervals.length
  }

  private endsWithIncompleteThought(text: string): boolean {
    const lastSentence = text.split(/[.!?]\s/).pop() || ''
    const words = lastSentence.trim().split(/\s+/)
    return (
      words.length >= 2 &&
      !text.endsWith('.') &&
      !text.endsWith('!') &&
      !text.endsWith('?') &&
      !text.endsWith(',')
    )
  }

  private getRecentText(): string {
    const text = this.currentText
    const cursor = this.cursorPosition
    const start = Math.max(0, cursor - 200)
    return text.slice(start, cursor)
  }

  private getTimeSinceLastKeystroke(): number {
    if (this.keystrokes.length === 0) return 0
    return Date.now() - this.keystrokes[this.keystrokes.length - 1].timestamp
  }

  private emitPause(type: PauseType, duration: number) {
    this.isPaused = true
    this.lastPauseTime = Date.now()

    const event: PauseEvent = {
      type,
      duration,
      currentText: this.currentText,
      cursorPosition: this.cursorPosition,
      recentText: this.getRecentText(),
      timestamp: Date.now(),
    }

    this.callback(event)
  }
}
