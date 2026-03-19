import type {
  HrvMeasurement, HrvTimelineEvent, HrvShift,
  HrvConversationEventType, AutonomicState,
} from '../types/hrv'

export class HrvTimeline {
  events: HrvTimelineEvent[] = []
  shifts: HrvShift[] = []
  baselineRmssd: number | null = null

  setBaseline(rmssd: number): void {
    this.baselineRmssd = rmssd
  }

  addMeasurement(m: HrvMeasurement): void {
    this.events.push({ timestamp: m.timestamp, type: 'measurement', measurement: m })
    this.detectShift(m)
  }

  addConversationEvent(type: HrvConversationEventType, messageIndex: number): void {
    this.events.push({ timestamp: Date.now(), type, messageIndex })
  }

  getRecentShifts(windowSeconds = 120): HrvShift[] {
    const cutoff = Date.now() - windowSeconds * 1000
    return this.shifts.filter(s => s.timestamp > cutoff)
  }

  getMeasurements(): HrvMeasurement[] {
    return this.events
      .filter(e => e.type === 'measurement' && e.measurement)
      .map(e => e.measurement!)
  }

  buildPromptContext(): string {
    const measurements = this.getMeasurements()
    const latest = measurements.filter(m => m.confidence >= 0.3).at(-1)
    if (!latest) return ''

    const lines: string[] = ['[Biometric context]']

    const trendDuration = this.getTrendDuration(latest.trend)
    lines.push(`Current autonomic state: ${latest.autonomicState} (trend: ${latest.trend}${trendDuration ? `, ${trendDuration}` : ''})`)
    lines.push(`Heart rate: ${latest.hr} bpm`)
    if (latest.respiratoryRate) {
      lines.push(`Respiratory rate: ${latest.respiratoryRate} breaths/min`)
    }
    if (latest.derived) {
      const d = latest.derived
      if (d.stressIndex > 0) lines.push(`Stress index: ${d.stressIndex} (${d.stressIndex < 100 ? 'low' : d.stressIndex < 200 ? 'moderate' : 'high'})`)
      if (d.lfHfRatio != null) lines.push(`Autonomic balance (LF/HF): ${d.lfHfRatio} (${d.lfHfRatio < 1 ? 'parasympathetic dominant' : d.lfHfRatio < 2 ? 'balanced' : 'sympathetic dominant'})`)
      if (d.coherence > 0) lines.push(`Cardiac coherence: ${d.coherence} (${d.coherence > 0.5 ? 'high' : d.coherence > 0.3 ? 'moderate' : 'low'})`)
    }
    if (this.baselineRmssd) {
      const baselineState = latest.rmssd > this.baselineRmssd * 1.2 ? 'calm'
        : latest.rmssd < this.baselineRmssd * 0.7 ? 'activated' : 'near baseline'
      lines.push(`Session baseline: ${baselineState}`)
    }

    const recentShifts = this.getRecentShifts(300)
    if (recentShifts.length > 0) {
      lines.push('Notable shifts:')
      for (const shift of recentShifts.slice(-5)) {
        const ago = Math.round((Date.now() - shift.timestamp) / 1000)
        const agoStr = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}min ago`
        const triggerStr = shift.trigger === 'unknown' ? ''
          : shift.trigger === 'user_message' ? ` after user message #${shift.triggerMessageIndex}`
          : ` during therapist response #${shift.triggerMessageIndex}`
        lines.push(`- Shifted from ${shift.fromState} → ${shift.toState}${triggerStr} (${agoStr})`)
      }
    }

    // Behavioral correlations
    const behavioral = this.computeBehavioralCorrelations()
    if (behavioral.length > 0) {
      lines.push('Behavioral correlations:')
      for (const b of behavioral) lines.push(`- ${b}`)
    }

    const confLabel = latest.confidence >= 0.7 ? 'high'
      : latest.confidence >= 0.4 ? 'medium' : 'low'
    lines.push(`Signal confidence: ${confLabel}`)

    return lines.join('\n')
  }

  /** Analyze physiological responses to conversation events */
  private computeBehavioralCorrelations(): string[] {
    const results: string[] = []
    const measurements = this.getMeasurements()
    if (measurements.length < 4) return results

    // 1. Post-response reaction: compare HR in 30s after AI response vs 30s before
    const aiResponses = this.events.filter(e => e.type === 'ai_response_complete' && e.messageIndex != null)
    for (const resp of aiResponses.slice(-3)) { // last 3 responses
      const respTime = resp.timestamp
      const before = measurements.filter(m => m.timestamp >= respTime - 30000 && m.timestamp < respTime)
      const after = measurements.filter(m => m.timestamp > respTime && m.timestamp <= respTime + 30000)

      if (before.length >= 2 && after.length >= 2) {
        const hrBefore = before.reduce((s, m) => s + m.hr, 0) / before.length
        const hrAfter = after.reduce((s, m) => s + m.hr, 0) / after.length
        const delta = hrAfter - hrBefore

        if (Math.abs(delta) >= 5) {
          const direction = delta > 0 ? 'increased' : 'decreased'
          results.push(`Heart rate ${direction} by ${Math.abs(Math.round(delta))} bpm after therapist response #${resp.messageIndex}`)
        }
      }
    }

    // 2. User message physiological state: what was HR when they sent each message
    const userMessages = this.events.filter(e => e.type === 'user_message' && e.messageIndex != null)
    const messageHrs: Array<{ index: number; hr: number }> = []
    for (const msg of userMessages.slice(-5)) {
      // Find nearest measurement to message timestamp
      const nearest = measurements.reduce((best, m) =>
        Math.abs(m.timestamp - msg.timestamp) < Math.abs(best.timestamp - msg.timestamp) ? m : best
      )
      if (Math.abs(nearest.timestamp - msg.timestamp) < 15000) {
        messageHrs.push({ index: msg.messageIndex!, hr: nearest.hr })
      }
    }

    if (messageHrs.length >= 2) {
      const hrValues = messageHrs.map(m => m.hr)
      const minHr = Math.min(...hrValues)
      const maxHr = Math.max(...hrValues)
      if (maxHr - minHr >= 8) {
        const peakMsg = messageHrs.find(m => m.hr === maxHr)
        results.push(`Highest activation while writing message #${peakMsg?.index} (HR ${Math.round(maxHr)} bpm)`)
      }
    }

    // 3. Session trajectory: is the user calming down or escalating over time?
    if (measurements.length >= 6) {
      const firstThird = measurements.slice(0, Math.floor(measurements.length / 3))
      const lastThird = measurements.slice(-Math.floor(measurements.length / 3))
      const earlyHr = firstThird.reduce((s, m) => s + m.hr, 0) / firstThird.length
      const lateHr = lastThird.reduce((s, m) => s + m.hr, 0) / lastThird.length
      const sessionDelta = lateHr - earlyHr

      if (Math.abs(sessionDelta) >= 5) {
        if (sessionDelta > 0) {
          results.push(`Session trajectory: activation increasing (+${Math.round(sessionDelta)} bpm over session)`)
        } else {
          results.push(`Session trajectory: settling down (${Math.round(sessionDelta)} bpm over session)`)
        }
      }
    }

    return results
  }

  private getTrendDuration(currentTrend: string): string {
    const measurements = this.getMeasurements()
    if (measurements.length < 2) return ''

    let count = 0
    for (let i = measurements.length - 1; i >= 0; i--) {
      if (measurements[i].trend === currentTrend) count++
      else break
    }
    const seconds = count * 5
    if (seconds < 15) return ''
    return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}min`
  }

  private detectShift(current: HrvMeasurement): void {
    const measurements = this.getMeasurements()
    if (measurements.length < 3) return

    const recent = measurements.slice(-6, -1)
    if (recent.length < 2) return

    const stateCounts: Record<AutonomicState, number> = { calm: 0, activated: 0, transitioning: 0 }
    for (const m of recent) stateCounts[m.autonomicState]++

    const prevState = (Object.entries(stateCounts) as [AutonomicState, number][])
      .sort((a, b) => b[1] - a[1])[0][0]

    if (current.autonomicState === prevState || current.autonomicState === 'transitioning') return

    let trigger: 'user_message' | 'ai_response' | 'unknown' = 'unknown'
    let triggerMessageIndex: number | null = null

    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]
      if (e.type === 'user_message') {
        trigger = 'user_message'
        triggerMessageIndex = e.messageIndex ?? null
        break
      }
      if (e.type === 'ai_response_start' || e.type === 'ai_response_complete') {
        trigger = 'ai_response'
        triggerMessageIndex = e.messageIndex ?? null
        break
      }
    }

    const avgRmssd = recent.reduce((s, m) => s + m.rmssd, 0) / recent.length
    const magnitude = Math.abs(current.rmssd - avgRmssd) / avgRmssd

    this.shifts.push({
      timestamp: current.timestamp,
      fromState: prevState,
      toState: current.autonomicState,
      trigger,
      triggerMessageIndex,
      magnitude: Math.round(magnitude * 100) / 100,
    })
  }
}
