import type { BodyRegion, HomunculusState, HomunculusRegionState } from '../types'

export const BODY_REGIONS: BodyRegion[] = [
  'head', 'eyes', 'throat', 'chest', 'stomach',
  'shoulders', 'hands', 'back', 'hips', 'legs',
]

export const DORMANT_THRESHOLD = 5

interface EmotionFamily {
  keywords: string[]
  color: string
}

export const EMOTION_FAMILIES: Record<string, EmotionFamily> = {
  love: {
    keywords: ['love', 'grief', 'loss', 'miss', 'longing', 'connection'],
    color: '#C45C5C',
  },
  anger: {
    keywords: ['anger', 'frustration', 'rage', 'irritation', 'resentment', 'furious'],
    color: '#C4785C',
  },
  anxiety: {
    keywords: ['anxiety', 'fear', 'worry', 'panic', 'dread', 'nervous'],
    color: '#5C7C8B',
  },
  sadness: {
    keywords: ['sad', 'lonely', 'empty', 'hollow', 'despair', 'melancholy'],
    color: '#5C5C8B',
  },
  hope: {
    keywords: ['hope', 'growth', 'healing', 'possibility', 'courage'],
    color: '#5C8B6B',
  },
  joy: {
    keywords: ['joy', 'happy', 'warmth', 'gratitude', 'peace', 'comfort'],
    color: '#C4A85C',
  },
  shame: {
    keywords: ['shame', 'guilt', 'guarded', 'hidden', 'small'],
    color: '#7C5C8B',
  },
}

const NEUTRAL_COLOR = '#D4CFC8'

export function mapEmotionToColor(emotion: string): string {
  const lower = emotion.toLowerCase()
  for (const family of Object.values(EMOTION_FAMILIES)) {
    if (family.keywords.some(kw => lower.includes(kw))) {
      return family.color
    }
  }
  return NEUTRAL_COLOR
}

interface SomaticMemoryDoc {
  bodyRegion?: string
  quote?: string
  emotion?: string
  intensity?: string
  entryId?: string
  timestamp?: number
}

export function computeHomunculusState(memories: SomaticMemoryDoc[]): HomunculusState {
  const regionData: Record<BodyRegion, {
    emotions: string[]
    quotes: Array<{ text: string; date: string; entryId: string }>
  }> = {} as Record<BodyRegion, { emotions: string[]; quotes: Array<{ text: string; date: string; entryId: string }> }>

  for (const region of BODY_REGIONS) {
    regionData[region] = { emotions: [], quotes: [] }
  }

  for (const mem of memories) {
    const region = mem.bodyRegion as BodyRegion
    if (!BODY_REGIONS.includes(region)) continue

    if (mem.emotion) {
      regionData[region].emotions.push(mem.emotion)
    }
    if (mem.quote) {
      regionData[region].quotes.push({
        text: mem.quote,
        date: mem.timestamp ? new Date(mem.timestamp).toLocaleDateString() : '',
        entryId: mem.entryId || '',
      })
    }
  }

  // Find max signal count for normalization
  const signalCounts = BODY_REGIONS.map(r => regionData[r].emotions.length)
  const maxSignals = Math.max(...signalCounts, 1)

  const state = {} as HomunculusState

  for (const region of BODY_REGIONS) {
    const data = regionData[region]
    const signalCount = data.emotions.length

    // Count emotion frequencies and map to colors
    const emotionCounts: Record<string, { count: number; color: string }> = {}
    for (const emotion of data.emotions) {
      const key = emotion.toLowerCase()
      if (!emotionCounts[key]) {
        emotionCounts[key] = { count: 0, color: mapEmotionToColor(emotion) }
      }
      emotionCounts[key].count++
    }

    const dominantEmotions = Object.entries(emotionCounts)
      .map(([emotion, { count, color }]) => ({ emotion, count, color }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)

    // Size: normalize to 0.6 - 1.8 range
    const sizeFactor = signalCount === 0
      ? 1.0
      : 0.6 + (signalCount / maxSignals) * 1.2

    // Color: use dominant emotion's family color, fallback to neutral
    const fillColor = dominantEmotions.length > 0
      ? dominantEmotions[0].color
      : NEUTRAL_COLOR

    // Keep most recent 5 quotes (already in chronological order from memories)
    const quotes = data.quotes.slice(-5).reverse()

    const regionState: HomunculusRegionState = {
      signalCount,
      dominantEmotions,
      sizeFactor,
      fillColor,
      quotes,
    }

    state[region] = regionState
  }

  return state
}
