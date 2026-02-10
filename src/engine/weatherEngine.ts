import { getGlobalConfig } from '../store/globalConfig'
import { db, generateId } from '../store/db'
import type { InnerWeather, EmotionalTone } from '../types'

export class WeatherEngine {
  private lastUpdate: number = 0
  private recentEmotions: EmotionalTone[] = []

  recordEmotion(emotion: EmotionalTone): void {
    this.recentEmotions.push(emotion)
    if (this.recentEmotions.length > 20) {
      this.recentEmotions = this.recentEmotions.slice(-20)
    }
  }

  getWeather(): InnerWeather | null {
    const config = getGlobalConfig()
    if (config?.features.innerWeather !== true) return null
    if (this.recentEmotions.length < 2) return null

    // Count occurrences of each emotion
    const counts = new Map<EmotionalTone, number>()
    for (const emotion of this.recentEmotions) {
      counts.set(emotion, (counts.get(emotion) ?? 0) + 1)
    }

    // Find dominant emotion (most frequent)
    let dominant: EmotionalTone = this.recentEmotions[0]
    let dominantCount = 0
    for (const [emotion, count] of counts) {
      if (count > dominantCount) {
        dominant = emotion
        dominantCount = count
      }
    }

    // Find secondary emotion (second most frequent, if different)
    let secondary: EmotionalTone | undefined
    let secondaryCount = 0
    for (const [emotion, count] of counts) {
      if (emotion !== dominant && count > secondaryCount) {
        secondary = emotion
        secondaryCount = count
      }
    }

    // Intensity: ratio of dominant count to total
    const intensity = dominantCount / this.recentEmotions.length

    // Trend: compare first half vs second half
    const mid = Math.floor(this.recentEmotions.length / 2)
    const firstHalf = this.recentEmotions.slice(0, mid)
    const secondHalf = this.recentEmotions.slice(mid)

    const firstDominantCount = firstHalf.filter((e) => e === dominant).length
    const secondDominantCount = secondHalf.filter((e) => e === dominant).length

    const firstRatio = firstHalf.length > 0 ? firstDominantCount / firstHalf.length : 0
    const secondRatio = secondHalf.length > 0 ? secondDominantCount / secondHalf.length : 0

    let trend: 'rising' | 'falling' | 'steady'
    const trendDelta = secondRatio - firstRatio
    if (trendDelta > 0.15) {
      trend = 'rising'
    } else if (trendDelta < -0.15) {
      trend = 'falling'
    } else {
      trend = 'steady'
    }

    return {
      id: generateId(),
      dominantEmotion: dominant,
      secondaryEmotion: secondary,
      intensity,
      trend,
      updatedAt: Date.now(),
    }
  }

  shouldPersist(): boolean {
    const config = getGlobalConfig()
    const intervalMinutes = config?.engagement?.weatherUpdateInterval ?? 5
    const intervalMs = intervalMinutes * 60 * 1000
    return Date.now() - this.lastUpdate >= intervalMs
  }

  async persist(): Promise<void> {
    const weather = this.getWeather()
    if (!weather) return

    await db.innerWeather.add(weather)
    this.lastUpdate = Date.now()
  }
}
