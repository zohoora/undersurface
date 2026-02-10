import { getGlobalConfig } from '../store/globalConfig'
import { db } from '../store/db'
import type { Part } from '../types'

export class QuietTracker {
  async updateLastActive(partId: string): Promise<void> {
    try {
      await db.parts.update(partId, {
        lastActiveAt: Date.now(),
        quietSince: undefined,
      })
    } catch (error) {
      console.error('QuietTracker updateLastActive error:', error)
    }
  }

  getQuietParts(parts: Part[]): Part[] {
    const config = getGlobalConfig()
    if (config?.features.partQuietReturn !== true) return []

    const quietThresholdDays = config.partIntelligence?.quietThresholdDays ?? 5
    const thresholdMs = quietThresholdDays * 24 * 60 * 60 * 1000
    const cutoff = Date.now() - thresholdMs

    return parts.filter((p) => {
      if (!p.lastActiveAt) return true
      return p.lastActiveAt < cutoff
    })
  }

  isReturning(part: Part): boolean {
    return part.quietSince != null
  }

  async markQuiet(part: Part): Promise<void> {
    try {
      await db.parts.update(part.id, { quietSince: Date.now() })
    } catch (error) {
      console.error('QuietTracker markQuiet error:', error)
    }
  }

  getReturnBonus(): number {
    const config = getGlobalConfig()
    return config?.partIntelligence?.returnBonusMultiplier ?? 2.0
  }
}
