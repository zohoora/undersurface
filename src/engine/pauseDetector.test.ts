import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PauseDetector } from './pauseDetector'
import type { PauseEvent, PauseType } from '../types'

describe('PauseDetector', () => {
  let callback: ReturnType<typeof vi.fn<(event: PauseEvent) => void>>
  let detector: PauseDetector

  beforeEach(() => {
    vi.useFakeTimers()
    callback = vi.fn<(event: PauseEvent) => void>()
    detector = new PauseDetector(callback)
  })

  afterEach(() => {
    detector.destroy()
    vi.useRealTimers()
  })

  function typeText(text: string, fullText: string, cursorPos: number) {
    for (const char of text) {
      detector.recordKeystroke(char, fullText, cursorPos)
      vi.advanceTimersByTime(100) // normal typing speed
    }
  }

  function lastPauseType(): PauseType | undefined {
    if (callback.mock.calls.length === 0) return undefined
    const lastCall = callback.mock.calls[callback.mock.calls.length - 1]
    return (lastCall[0] as PauseEvent).type
  }

  // --- classifyPause via callback ---

  describe('classifyPause', () => {
    it('detects ellipsis from "..."', () => {
      const text = 'I was thinking...'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(lastPauseType()).toBe('ellipsis')
    })

    it('detects ellipsis from unicode "…"', () => {
      const text = 'I was thinking\u2026'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(lastPauseType()).toBe('ellipsis')
    })

    it('detects question from "?"', () => {
      const text = 'What does it mean?'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(lastPauseType()).toBe('question')
    })

    it('classifies text ending with newline-after-period as sentence_complete (trimEnd strips newlines)', () => {
      // Note: classifyPause calls trimEnd() which strips trailing \n,
      // so "done.\n" becomes "done." → sentence_complete, not paragraph_break
      const text = 'First paragraph done.\n'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(lastPauseType()).toBe('sentence_complete')
    })

    it('detects sentence_complete from "."', () => {
      const text = 'I finished the thought.'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(lastPauseType()).toBe('sentence_complete')
    })

    it('detects sentence_complete from "!"', () => {
      const text = 'That was surprising!'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(lastPauseType()).toBe('sentence_complete')
    })

    it('detects trailing_off for incomplete sentences', () => {
      const text = 'I was going to say something but then'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(lastPauseType()).toBe('trailing_off')
    })

    it('returns short_pause for single word', () => {
      const text = 'hi'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(lastPauseType()).toBe('short_pause')
    })
  })

  // --- cadence_slowdown ---

  describe('cadence slowdown', () => {
    it('detects when typing slows down significantly', () => {
      const text = 'some text here now'
      // Need at least 20 keystrokes (CADENCE_WINDOW * 2)
      // Fast phase: 20ms intervals
      for (let i = 0; i < 20; i++) {
        detector.recordKeystroke('a', text, text.length)
        vi.advanceTimersByTime(20)
      }
      // Slow phase: 120ms intervals (6x slower > 2.5x threshold)
      for (let i = 0; i < 10; i++) {
        detector.recordKeystroke('b', text, text.length)
        vi.advanceTimersByTime(120)
      }
      // Wait for short pause timer
      vi.advanceTimersByTime(5000)
      expect(lastPauseType()).toBe('cadence_slowdown')
    })
  })

  // --- long_pause ---

  describe('long_pause', () => {
    it('short_pause fires before long_pause threshold', () => {
      // The short_pause timer (4500ms) fires first and sets isPaused=true,
      // which blocks the long_pause timer. This tests that the short timer works.
      const text = 'some text'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(callback).toHaveBeenCalled()
      expect(lastPauseType()).not.toBe('long_pause')
    })
  })

  // --- setSpeedMultiplier ---

  describe('setSpeedMultiplier', () => {
    it('clamps to minimum 0.5', () => {
      detector.setSpeedMultiplier(0.1)
      // At 0.5 multiplier, SHORT_PAUSE = 4500/0.5 = 9000ms
      const text = 'I finished the thought.'
      typeText('a', text, text.length)
      // At 5000ms — would fire at 1x but not at 0.5x (needs 9000ms)
      vi.advanceTimersByTime(5000)
      expect(callback).not.toHaveBeenCalled()
      vi.advanceTimersByTime(5000)
      expect(callback).toHaveBeenCalled()
    })

    it('clamps to maximum 2.0', () => {
      detector.setSpeedMultiplier(10)
      // At 2.0 multiplier, SHORT_PAUSE = 4500/2 = 2250ms
      const text = 'I finished the thought.'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(2500)
      expect(callback).toHaveBeenCalled()
    })

    it('speeds up detection at higher multiplier', () => {
      detector.setSpeedMultiplier(2)
      const text = 'I finished the thought.'
      typeText('a', text, text.length)
      // SHORT_PAUSE = 4500/2 = 2250ms
      vi.advanceTimersByTime(2500)
      expect(callback).toHaveBeenCalled()
    })
  })

  // --- suppress/resume ---

  describe('suppress and resume', () => {
    it('ignores keystrokes when suppressed', () => {
      detector.suppress()
      const text = 'I finished the thought.'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(10000)
      expect(callback).not.toHaveBeenCalled()
    })

    it('resumes detection after resume()', () => {
      detector.suppress()
      detector.resume()
      const text = 'I finished the thought.'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(callback).toHaveBeenCalled()
    })

    it('clears timers on suppress', () => {
      const text = 'I finished the thought.'
      typeText('a', text, text.length)
      detector.suppress()
      vi.advanceTimersByTime(10000)
      expect(callback).not.toHaveBeenCalled()
    })
  })

  // --- MIN_PAUSE_INTERVAL ---

  describe('MIN_PAUSE_INTERVAL', () => {
    it('ignores a second pause within the interval', () => {
      const text = 'I finished the thought.'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000) // first pause fires
      expect(callback).toHaveBeenCalledTimes(1)

      // Type again and pause — within MIN_PAUSE_INTERVAL (12000ms)
      typeText('b', text + ' More.', text.length + 6)
      vi.advanceTimersByTime(5000)
      // Second pause should be suppressed by interval
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('allows a pause after the interval has elapsed', () => {
      const text = 'I finished.'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)
      expect(callback).toHaveBeenCalledTimes(1)

      // Wait past MIN_PAUSE_INTERVAL
      vi.advanceTimersByTime(13000)

      const text2 = 'Another thought.'
      typeText('b', text2, text2.length)
      vi.advanceTimersByTime(5000)
      expect(callback).toHaveBeenCalledTimes(2)
    })
  })

  // --- destroy ---

  describe('destroy', () => {
    it('stops all timers and deactivates', () => {
      const text = 'I finished the thought.'
      typeText('a', text, text.length)
      detector.destroy()
      vi.advanceTimersByTime(20000)
      expect(callback).not.toHaveBeenCalled()
    })

    it('ignores keystrokes after destroy', () => {
      detector.destroy()
      const text = 'New text.'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(10000)
      expect(callback).not.toHaveBeenCalled()
    })
  })

  // --- PauseEvent shape ---

  describe('PauseEvent shape', () => {
    it('includes correct fields', () => {
      const text = 'Hello world.'
      typeText('a', text, text.length)
      vi.advanceTimersByTime(5000)

      expect(callback).toHaveBeenCalled()
      const event = callback.mock.calls[0][0] as PauseEvent
      expect(event).toHaveProperty('type')
      expect(event).toHaveProperty('duration')
      expect(event).toHaveProperty('currentText', text)
      expect(event).toHaveProperty('cursorPosition', text.length)
      expect(event).toHaveProperty('recentText')
      expect(event).toHaveProperty('timestamp')
      expect(typeof event.timestamp).toBe('number')
    })
  })
})
