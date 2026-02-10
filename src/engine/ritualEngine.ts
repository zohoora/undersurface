import { getGlobalConfig } from '../store/globalConfig'
import { db, generateId } from '../store/db'
import type { SessionLog, SessionRitual } from '../types'

type TimeOfDay = 'early-morning' | 'morning' | 'afternoon' | 'evening' | 'night'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const TIME_LABELS: Record<TimeOfDay, string> = {
  'early-morning': 'early morning',
  'morning': 'morning',
  'afternoon': 'afternoon',
  'evening': 'evening',
  'night': 'night',
}

function categorizeHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 8) return 'early-morning'
  if (hour >= 8 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

export class RitualEngine {
  async logSession(wordCount: number): Promise<void> {
    const now = new Date()
    const sessionLog: SessionLog = {
      id: generateId(),
      startedAt: Date.now(),
      wordCount,
      timeOfDay: categorizeHour(now.getHours()),
      dayOfWeek: now.getDay(),
    }

    await db.sessionLog.add(sessionLog)
  }

  async detectRituals(): Promise<SessionRitual[]> {
    const config = getGlobalConfig()
    if (config?.features.ritualsNotStreaks !== true) return []

    const ritualDetectionWindow = config.engagement?.ritualDetectionWindow ?? 14
    const windowStart = Date.now() - ritualDetectionWindow * 24 * 60 * 60 * 1000

    const allLogs = await db.sessionLog.toArray() as SessionLog[]
    const recentLogs = allLogs.filter((log) => log.startedAt >= windowStart)

    if (recentLogs.length < 3) return []

    const rituals: SessionRitual[] = []
    const threshold = 0.6
    const totalSessions = recentLogs.length

    // Analyze time-of-day patterns
    const timeCounts: Record<string, number> = {}
    for (const log of recentLogs) {
      timeCounts[log.timeOfDay] = (timeCounts[log.timeOfDay] ?? 0) + 1
    }

    for (const [time, count] of Object.entries(timeCounts)) {
      if (count / totalSessions > threshold) {
        rituals.push({
          id: generateId(),
          pattern: `time:${time}`,
          description: `${TIME_LABELS[time as TimeOfDay] ?? time} writing has become a pattern`,
          detectedAt: Date.now(),
          sessionCount: count,
        })
      }
    }

    // Analyze day-of-week patterns
    const dayCounts: Record<number, number> = {}
    for (const log of recentLogs) {
      dayCounts[log.dayOfWeek] = (dayCounts[log.dayOfWeek] ?? 0) + 1
    }

    for (const [day, count] of Object.entries(dayCounts)) {
      const dayNum = Number(day)
      if (count / totalSessions > threshold) {
        rituals.push({
          id: generateId(),
          pattern: `day:${dayNum}`,
          description: `You write most on ${DAY_NAMES[dayNum]}s`,
          detectedAt: Date.now(),
          sessionCount: count,
        })
      }
    }

    // Analyze combined day + time patterns
    const combinedCounts: Record<string, number> = {}
    for (const log of recentLogs) {
      const key = `${log.dayOfWeek}:${log.timeOfDay}`
      combinedCounts[key] = (combinedCounts[key] ?? 0) + 1
    }

    for (const [combo, count] of Object.entries(combinedCounts)) {
      if (count / totalSessions > threshold) {
        const [dayStr, time] = combo.split(':')
        const dayNum = Number(dayStr)
        rituals.push({
          id: generateId(),
          pattern: `combo:${combo}`,
          description: `You write most on ${DAY_NAMES[dayNum]} ${TIME_LABELS[time as TimeOfDay] ?? time}s`,
          detectedAt: Date.now(),
          sessionCount: count,
        })
      }
    }

    // Analyze word count by time — find longest sessions
    const wordsByTime: Record<string, number[]> = {}
    for (const log of recentLogs) {
      if (!wordsByTime[log.timeOfDay]) wordsByTime[log.timeOfDay] = []
      wordsByTime[log.timeOfDay].push(log.wordCount)
    }

    const avgByTime: Record<string, number> = {}
    for (const [time, words] of Object.entries(wordsByTime)) {
      avgByTime[time] = words.reduce((sum, w) => sum + w, 0) / words.length
    }

    const times = Object.keys(avgByTime)
    if (times.length > 1) {
      const maxTime = times.reduce((a, b) => (avgByTime[a] > avgByTime[b] ? a : b))
      const maxAvg = avgByTime[maxTime]
      const otherAvg = times
        .filter((t) => t !== maxTime)
        .reduce((sum, t) => sum + avgByTime[t], 0) / (times.length - 1)

      // If the longest sessions are 50%+ more than other times
      if (maxAvg > otherAvg * 1.5) {
        rituals.push({
          id: generateId(),
          pattern: `length:${maxTime}`,
          description: `Your ${TIME_LABELS[maxTime as TimeOfDay] ?? maxTime} sessions tend to be longest`,
          detectedAt: Date.now(),
          sessionCount: wordsByTime[maxTime].length,
        })
      }
    }

    return rituals
  }
}
