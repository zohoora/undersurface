import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let idCounter = 0
vi.mock('../store/db', () => ({
  db: {
    diagnostics: { add: vi.fn(async () => undefined) },
  },
  generateId: vi.fn(() => `id-${++idCounter}`),
}))

import { engineLog, flushDiagnostics, __resetDiagnosticsForTest } from './diagnostics'
import { db } from '../store/db'

const addSpy = vi.mocked(db.diagnostics.add)

describe('engineLog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    addSpy.mockClear()
    idCounter = 0
    __resetDiagnosticsForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes a doc on first call (codes with no dedup)', async () => {
    engineLog('warn', 'stream.loop_detected', 'tail repeat at 100 chars')
    await vi.runAllTimersAsync()
    expect(addSpy).toHaveBeenCalledTimes(1)
    const event = addSpy.mock.calls[0]![0]
    expect(event.severity).toBe('warn')
    expect(event.code).toBe('stream.loop_detected')
    expect(event.msg).toBe('tail repeat at 100 chars')
    expect(event.repeatCount).toBeUndefined()
  })

  it('writes every call when cooldownMs is 0', async () => {
    engineLog('info', 'reflect.transcript_truncated', 'first')
    engineLog('info', 'reflect.transcript_truncated', 'second')
    engineLog('info', 'reflect.transcript_truncated', 'third')
    await vi.runAllTimersAsync()
    expect(addSpy).toHaveBeenCalledTimes(3)
  })

  it('dedups within cooldown — only the first call writes', () => {
    engineLog('info', 'hrv.skin_filter_low_confidence', 'low conf', { sessionId: 's1' })
    engineLog('info', 'hrv.skin_filter_low_confidence', 'low conf', { sessionId: 's1' })
    engineLog('info', 'hrv.skin_filter_low_confidence', 'low conf', { sessionId: 's1' })
    // Only assert before cooldown expires — flushing summary is covered by another test.
    expect(addSpy).toHaveBeenCalledTimes(1)
  })

  it('flushes a summary with repeatCount when cooldown expires after dedupes', async () => {
    engineLog('info', 'hrv.skin_filter_low_confidence', 'msg-1', {
      sessionId: 's1',
      extra: { confidence: 0.1 },
    })
    engineLog('info', 'hrv.skin_filter_low_confidence', 'msg-2', {
      sessionId: 's1',
      extra: { confidence: 0.05 },
    })
    engineLog('info', 'hrv.skin_filter_low_confidence', 'msg-3', {
      sessionId: 's1',
      extra: { confidence: 0.02 },
    })
    expect(addSpy).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_001)

    expect(addSpy).toHaveBeenCalledTimes(2)
    const summary = addSpy.mock.calls[1]![0]
    expect(summary.repeatCount).toBe(3)
    expect(summary.msg).toBe('msg-3')
    expect(summary.context).toEqual({ confidence: 0.02 })
  })

  it('does not flush a summary when only one event landed in the window', async () => {
    engineLog('warn', 'parts.empty_active_set', 'no parts', { sessionId: 's1' })
    expect(addSpy).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_001)
    expect(addSpy).toHaveBeenCalledTimes(1)
  })

  it('keys dedup by (code, sessionId) — different sessions do not collapse', async () => {
    engineLog('info', 'hrv.skin_filter_low_confidence', 'a', { sessionId: 's1' })
    engineLog('info', 'hrv.skin_filter_low_confidence', 'b', { sessionId: 's2' })
    await vi.runAllTimersAsync()
    expect(addSpy).toHaveBeenCalledTimes(2)
  })

  it('truncates msg to 200 chars', async () => {
    const long = 'x'.repeat(500)
    engineLog('warn', 'stream.loop_detected', long)
    await vi.runAllTimersAsync()
    const event = addSpy.mock.calls[0]![0]
    expect(event.msg.length).toBe(200)
  })

  it('flushDiagnostics() emits pending summaries immediately', async () => {
    engineLog('info', 'hrv.skin_filter_low_confidence', 'first', { sessionId: 's1' })
    engineLog('info', 'hrv.skin_filter_low_confidence', 'second', { sessionId: 's1' })
    expect(addSpy).toHaveBeenCalledTimes(1)

    flushDiagnostics()
    await vi.runAllTimersAsync()

    expect(addSpy).toHaveBeenCalledTimes(2)
    expect(addSpy.mock.calls[1]![0].repeatCount).toBe(2)
  })

  it('write failures do not throw to the caller', () => {
    addSpy.mockRejectedValueOnce(new Error('firestore down'))
    expect(() => engineLog('warn', 'stream.loop_detected', 'msg')).not.toThrow()
  })
})
