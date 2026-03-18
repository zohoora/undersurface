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

    const confLabel = latest.confidence >= 0.7 ? 'high'
      : latest.confidence >= 0.4 ? 'medium' : 'low'
    lines.push(`Signal confidence: ${confLabel}`)

    return lines.join('\n')
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
