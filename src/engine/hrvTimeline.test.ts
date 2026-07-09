import { describe, it, expect, beforeEach } from 'vitest'
import { HrvTimeline, MAX_HRV_TIMELINE_EVENTS } from './hrvTimeline'
import type { HrvMeasurement } from '../types/hrv'

function makeMeasurement(overrides: Partial<HrvMeasurement> = {}): HrvMeasurement {
  return {
    timestamp: Date.now(),
    hr: 72,
    rmssd: 55,
    autonomicState: 'calm',
    trend: 'steady',
    confidence: 0.8,
    respiratoryRate: null,
    derived: null,
    ...overrides,
  }
}

describe('HrvTimeline', () => {
  let timeline: HrvTimeline

  beforeEach(() => {
    timeline = new HrvTimeline()
  })

  describe('addMeasurement', () => {
    it('stores measurements in events array', () => {
      const m = makeMeasurement()
      timeline.addMeasurement(m)
      expect(timeline.events).toHaveLength(1)
      expect(timeline.events[0].type).toBe('measurement')
      expect(timeline.events[0].measurement).toBe(m)
    })
  })

  describe('addConversationEvent', () => {
    it('stores conversation events with message index', () => {
      timeline.addConversationEvent('user_message', 3)
      expect(timeline.events).toHaveLength(1)
      expect(timeline.events[0].type).toBe('user_message')
      expect(timeline.events[0].messageIndex).toBe(3)
    })
  })

  describe('shift detection', () => {
    it('detects shift when autonomic state changes', () => {
      const now = Date.now()
      for (let i = 0; i < 12; i++) {
        timeline.addMeasurement(makeMeasurement({
          timestamp: now - (60 - i * 5) * 1000,
          rmssd: 60,
          autonomicState: 'calm',
        }))
      }
      timeline.addConversationEvent('user_message', 4)
      timeline.addMeasurement(makeMeasurement({
        timestamp: now,
        rmssd: 25,
        autonomicState: 'activated',
      }))

      const shifts = timeline.getRecentShifts(300)
      expect(shifts.length).toBeGreaterThanOrEqual(1)
      expect(shifts[0].fromState).toBe('calm')
      expect(shifts[0].toState).toBe('activated')
      expect(shifts[0].trigger).toBe('user_message')
      expect(shifts[0].triggerMessageIndex).toBe(4)
    })

    it('returns empty shifts when state is stable', () => {
      for (let i = 0; i < 5; i++) {
        timeline.addMeasurement(makeMeasurement({ autonomicState: 'calm', rmssd: 60 }))
      }
      expect(timeline.getRecentShifts()).toHaveLength(0)
    })
  })

  describe('buildPromptContext', () => {
    it('returns empty string when no measurements', () => {
      expect(timeline.buildPromptContext()).toBe('')
    })

    it('includes current state and heart rate', () => {
      timeline.setBaseline(55)
      timeline.addMeasurement(makeMeasurement({ hr: 78, autonomicState: 'calm', trend: 'steady', confidence: 0.9 }))
      const context = timeline.buildPromptContext()
      expect(context).toContain('calm')
      expect(context).toContain('78')
    })

    it('excludes low-confidence measurements', () => {
      timeline.setBaseline(55)
      timeline.addMeasurement(makeMeasurement({ confidence: 0.2 }))
      const context = timeline.buildPromptContext()
      expect(context).toBe('')
    })

    it('includes notable shifts', () => {
      const now = Date.now()
      timeline.setBaseline(55)
      for (let i = 0; i < 12; i++) {
        timeline.addMeasurement(makeMeasurement({
          timestamp: now - (60 - i * 5) * 1000,
          rmssd: 60,
          autonomicState: 'calm',
        }))
      }
      timeline.addConversationEvent('user_message', 2)
      timeline.addMeasurement(makeMeasurement({
        timestamp: now,
        rmssd: 25,
        autonomicState: 'activated',
        confidence: 0.8,
      }))

      const context = timeline.buildPromptContext()
      expect(context).toContain('Notable shifts')
      expect(context).toContain('activated')
    })

    describe('source gating (webcam vs polar)', () => {
      const richMeasurement = () => makeMeasurement({
        hr: 78,
        autonomicState: 'activated',
        trend: 'rising',
        confidence: 0.9,
        respiratoryRate: 14,
        derived: {
          sdnn: 45, pnn50: 12, lfHfRatio: 2.4, stressIndex: 180, coherence: 0.6,
        } as HrvMeasurement['derived'],
      })

      it('camera source hedges HR and OMITS all HRV-derived metrics + autonomic state', () => {
        timeline.setBaseline(55)
        timeline.addMeasurement(richMeasurement())
        const ctx = timeline.buildPromptContext('camera')

        expect(ctx).toContain('webcam')
        expect(ctx).toContain('~78')
        expect(ctx).toContain('rising')
        // None of the IBI-derived metrics or the RMSSD-classified state leak.
        expect(ctx).not.toContain('LF/HF')
        expect(ctx).not.toContain('Stress index')
        expect(ctx).not.toContain('Cardiac coherence')
        expect(ctx).not.toContain('autonomic state')
        expect(ctx).not.toContain('Session baseline')
      })

      it('polar source surfaces the full HRV-derived block', () => {
        timeline.setBaseline(55)
        timeline.addMeasurement(richMeasurement())
        const ctx = timeline.buildPromptContext('polarH10')

        expect(ctx).toContain('autonomic state')
        expect(ctx).toContain('LF/HF')
        expect(ctx).toContain('Stress index')
        expect(ctx).toContain('Cardiac coherence')
      })
    })
  })

  describe('getMeasurements', () => {
    it('returns all measurement events', () => {
      timeline.addMeasurement(makeMeasurement())
      timeline.addConversationEvent('user_message', 0)
      timeline.addMeasurement(makeMeasurement())
      expect(timeline.getMeasurements()).toHaveLength(2)
    })

    it('bounds in-memory history while keeping lifetime summary totals', () => {
      const total = MAX_HRV_TIMELINE_EVENTS + 80
      for (let i = 0; i < total; i++) {
        timeline.addMeasurement(makeMeasurement({ timestamp: i, hr: 60 + (i % 10) }))
      }

      expect(timeline.events).toHaveLength(MAX_HRV_TIMELINE_EVENTS)
      expect(timeline.getMeasurements()).toHaveLength(MAX_HRV_TIMELINE_EVENTS)
      expect(timeline.getSummary()?.measurementCount).toBe(total)
    })
  })
})
