import { describe, it, expect } from 'vitest'
import {
  BODY_REGIONS,
  DORMANT_THRESHOLD,
  EMOTION_FAMILIES,
  mapEmotionToColor,
  computeHomunculusState,
} from './bodyMapEngine'

// --- Constants ---

describe('BODY_REGIONS', () => {
  it('contains exactly 10 regions', () => {
    expect(BODY_REGIONS).toHaveLength(10)
  })

  it('includes all expected regions', () => {
    const expected = ['head', 'eyes', 'throat', 'chest', 'stomach', 'shoulders', 'hands', 'back', 'hips', 'legs']
    expect(BODY_REGIONS).toEqual(expected)
  })
})

describe('DORMANT_THRESHOLD', () => {
  it('is 5', () => {
    expect(DORMANT_THRESHOLD).toBe(5)
  })
})

// --- mapEmotionToColor ---

describe('mapEmotionToColor', () => {
  describe('love family', () => {
    it.each(['love', 'grief', 'loss', 'miss', 'longing', 'connection'])(
      'maps "%s" to love color',
      (keyword) => {
        expect(mapEmotionToColor(keyword)).toBe(EMOTION_FAMILIES.love.color)
      },
    )
  })

  describe('anger family', () => {
    it.each(['anger', 'frustration', 'rage', 'irritation', 'resentment', 'furious'])(
      'maps "%s" to anger color',
      (keyword) => {
        expect(mapEmotionToColor(keyword)).toBe(EMOTION_FAMILIES.anger.color)
      },
    )
  })

  describe('anxiety family', () => {
    it.each(['anxiety', 'fear', 'worry', 'panic', 'dread', 'nervous'])(
      'maps "%s" to anxiety color',
      (keyword) => {
        expect(mapEmotionToColor(keyword)).toBe(EMOTION_FAMILIES.anxiety.color)
      },
    )
  })

  describe('sadness family', () => {
    it.each(['sad', 'lonely', 'empty', 'hollow', 'despair', 'melancholy'])(
      'maps "%s" to sadness color',
      (keyword) => {
        expect(mapEmotionToColor(keyword)).toBe(EMOTION_FAMILIES.sadness.color)
      },
    )
  })

  describe('hope family', () => {
    it.each(['hope', 'growth', 'healing', 'possibility'])(
      'maps "%s" to hope color',
      (keyword) => {
        expect(mapEmotionToColor(keyword)).toBe(EMOTION_FAMILIES.hope.color)
      },
    )

    it('maps "courage" to anger (substring "rage" matches anger family first)', () => {
      // "courage" contains "rage", and anger is checked before hope
      expect(mapEmotionToColor('courage')).toBe(EMOTION_FAMILIES.anger.color)
    })
  })

  describe('joy family', () => {
    it.each(['joy', 'happy', 'warmth', 'gratitude', 'peace', 'comfort'])(
      'maps "%s" to joy color',
      (keyword) => {
        expect(mapEmotionToColor(keyword)).toBe(EMOTION_FAMILIES.joy.color)
      },
    )
  })

  describe('shame family', () => {
    it.each(['shame', 'guilt', 'guarded', 'hidden', 'small'])(
      'maps "%s" to shame color',
      (keyword) => {
        expect(mapEmotionToColor(keyword)).toBe(EMOTION_FAMILIES.shame.color)
      },
    )
  })

  it('returns neutral color for unknown emotions', () => {
    expect(mapEmotionToColor('confused')).toBe('#D4CFC8')
    expect(mapEmotionToColor('bored')).toBe('#D4CFC8')
    expect(mapEmotionToColor('xyz')).toBe('#D4CFC8')
  })

  it('is case insensitive', () => {
    expect(mapEmotionToColor('LOVE')).toBe(EMOTION_FAMILIES.love.color)
    expect(mapEmotionToColor('Grief')).toBe(EMOTION_FAMILIES.love.color)
    expect(mapEmotionToColor('ANXIETY')).toBe(EMOTION_FAMILIES.anxiety.color)
    expect(mapEmotionToColor('Shame')).toBe(EMOTION_FAMILIES.shame.color)
  })

  it('matches substring keywords within longer strings', () => {
    // "sad" matches inside "sadness"
    expect(mapEmotionToColor('sadness')).toBe(EMOTION_FAMILIES.sadness.color)
    // "anger" matches inside "deep anger"
    expect(mapEmotionToColor('deep anger')).toBe(EMOTION_FAMILIES.anger.color)
    // "joy" matches inside "joyful"
    expect(mapEmotionToColor('joyful')).toBe(EMOTION_FAMILIES.joy.color)
  })
})

// --- computeHomunculusState ---

describe('computeHomunculusState', () => {
  describe('with empty memories', () => {
    it('returns state for all 10 body regions', () => {
      const state = computeHomunculusState([])
      expect(Object.keys(state)).toHaveLength(10)
      for (const region of BODY_REGIONS) {
        expect(state[region]).toBeDefined()
      }
    })

    it('every region has signalCount 0', () => {
      const state = computeHomunculusState([])
      for (const region of BODY_REGIONS) {
        expect(state[region].signalCount).toBe(0)
      }
    })

    it('every region has sizeFactor 1.0 (neutral)', () => {
      const state = computeHomunculusState([])
      for (const region of BODY_REGIONS) {
        expect(state[region].sizeFactor).toBe(1.0)
      }
    })

    it('every region has neutral fill color', () => {
      const state = computeHomunculusState([])
      for (const region of BODY_REGIONS) {
        expect(state[region].fillColor).toBe('#D4CFC8')
      }
    })

    it('every region has no dominant emotions', () => {
      const state = computeHomunculusState([])
      for (const region of BODY_REGIONS) {
        expect(state[region].dominantEmotions).toEqual([])
      }
    })

    it('every region has no quotes', () => {
      const state = computeHomunculusState([])
      for (const region of BODY_REGIONS) {
        expect(state[region].quotes).toEqual([])
      }
    })
  })

  describe('with a single region', () => {
    it('populates only the targeted region', () => {
      const memories = [
        { bodyRegion: 'chest', emotion: 'grief', quote: 'I feel it here', entryId: 'e1', timestamp: 1000 },
      ]
      const state = computeHomunculusState(memories)

      expect(state.chest.signalCount).toBe(1)
      expect(state.chest.dominantEmotions).toHaveLength(1)
      expect(state.chest.dominantEmotions[0].emotion).toBe('grief')
      expect(state.chest.dominantEmotions[0].count).toBe(1)
      expect(state.chest.dominantEmotions[0].color).toBe(EMOTION_FAMILIES.love.color)
      expect(state.chest.quotes).toHaveLength(1)
      expect(state.chest.quotes[0].text).toBe('I feel it here')

      // Other regions untouched
      expect(state.head.signalCount).toBe(0)
      expect(state.stomach.signalCount).toBe(0)
    })

    it('has sizeFactor ~1.8 when it is the only region with signals (max normalization)', () => {
      const memories = [
        { bodyRegion: 'chest', emotion: 'grief' },
      ]
      const state = computeHomunculusState(memories)
      // signalCount = 1, maxSignals = 1, so 0.6 + (1/1) * 1.2 = 1.8
      expect(state.chest.sizeFactor).toBeCloseTo(1.8)
    })
  })

  describe('with multiple regions', () => {
    it('correctly distributes signals across regions', () => {
      const memories = [
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'love' },
        { bodyRegion: 'chest', emotion: 'longing' },
        { bodyRegion: 'stomach', emotion: 'anxiety' },
        { bodyRegion: 'throat', emotion: 'shame' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.chest.signalCount).toBe(3)
      expect(state.stomach.signalCount).toBe(1)
      expect(state.throat.signalCount).toBe(1)
      expect(state.head.signalCount).toBe(0)
    })

    it('tracks dominant emotions sorted by count descending', () => {
      const memories = [
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'anxiety' },
        { bodyRegion: 'chest', emotion: 'anxiety' },
        { bodyRegion: 'chest', emotion: 'joy' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.chest.dominantEmotions).toHaveLength(3)
      expect(state.chest.dominantEmotions[0].emotion).toBe('grief')
      expect(state.chest.dominantEmotions[0].count).toBe(3)
      expect(state.chest.dominantEmotions[1].emotion).toBe('anxiety')
      expect(state.chest.dominantEmotions[1].count).toBe(2)
      expect(state.chest.dominantEmotions[2].emotion).toBe('joy')
      expect(state.chest.dominantEmotions[2].count).toBe(1)
    })

    it('limits dominant emotions to top 3', () => {
      const memories = [
        { bodyRegion: 'hands', emotion: 'grief' },
        { bodyRegion: 'hands', emotion: 'anxiety' },
        { bodyRegion: 'hands', emotion: 'joy' },
        { bodyRegion: 'hands', emotion: 'shame' },
        { bodyRegion: 'hands', emotion: 'anger' },
      ]
      const state = computeHomunculusState(memories)

      // 5 unique emotions, but only top 3 kept (all count=1, so first 3 by insertion order)
      expect(state.hands.dominantEmotions).toHaveLength(3)
    })

    it('uses fill color from the most dominant emotion', () => {
      const memories = [
        { bodyRegion: 'head', emotion: 'anxiety' },
        { bodyRegion: 'head', emotion: 'anxiety' },
        { bodyRegion: 'head', emotion: 'grief' },
      ]
      const state = computeHomunculusState(memories)

      // anxiety is dominant
      expect(state.head.fillColor).toBe(EMOTION_FAMILIES.anxiety.color)
    })
  })

  describe('invalid regions', () => {
    it('skips memories with invalid bodyRegion', () => {
      const memories = [
        { bodyRegion: 'elbow', emotion: 'anxiety' },
        { bodyRegion: 'nonexistent', emotion: 'grief' },
      ]
      const state = computeHomunculusState(memories)

      // All regions should be empty since 'elbow' and 'nonexistent' are not valid
      for (const region of BODY_REGIONS) {
        expect(state[region].signalCount).toBe(0)
      }
    })

    it('processes valid memories and skips invalid ones', () => {
      const memories = [
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'elbow', emotion: 'anxiety' },
        { bodyRegion: 'stomach', emotion: 'fear' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.chest.signalCount).toBe(1)
      expect(state.stomach.signalCount).toBe(1)
    })

    it('skips memories with undefined bodyRegion', () => {
      const memories = [
        { emotion: 'anxiety' },
        { bodyRegion: 'chest', emotion: 'grief' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.chest.signalCount).toBe(1)
      for (const region of BODY_REGIONS) {
        if (region !== 'chest') {
          expect(state[region].signalCount).toBe(0)
        }
      }
    })
  })

  describe('sizeFactor normalization', () => {
    it('is 1.0 for regions with zero signals', () => {
      const memories = [
        { bodyRegion: 'chest', emotion: 'grief' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.head.sizeFactor).toBe(1.0)
      expect(state.stomach.sizeFactor).toBe(1.0)
    })

    it('normalizes between 0.6 and 1.8 based on max signals', () => {
      const memories = [
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'stomach', emotion: 'anxiety' },
        { bodyRegion: 'stomach', emotion: 'anxiety' },
      ]
      const state = computeHomunculusState(memories)

      // maxSignals = 4 (chest)
      // chest: 0.6 + (4/4) * 1.2 = 1.8
      expect(state.chest.sizeFactor).toBeCloseTo(1.8)
      // stomach: 0.6 + (2/4) * 1.2 = 0.6 + 0.6 = 1.2
      expect(state.stomach.sizeFactor).toBeCloseTo(1.2)
      // head (0 signals): 1.0
      expect(state.head.sizeFactor).toBe(1.0)
    })

    it('the region with the most signals always has sizeFactor 1.8', () => {
      const memories = [
        { bodyRegion: 'legs', emotion: 'grief' },
        { bodyRegion: 'legs', emotion: 'grief' },
        { bodyRegion: 'legs', emotion: 'grief' },
        { bodyRegion: 'legs', emotion: 'grief' },
        { bodyRegion: 'legs', emotion: 'grief' },
        { bodyRegion: 'legs', emotion: 'grief' },
        { bodyRegion: 'legs', emotion: 'grief' },
        { bodyRegion: 'legs', emotion: 'grief' },
        { bodyRegion: 'legs', emotion: 'grief' },
        { bodyRegion: 'legs', emotion: 'grief' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.legs.sizeFactor).toBeCloseTo(1.8)
    })

    it('the region with the fewest non-zero signals has sizeFactor closest to 0.6', () => {
      const memories = [
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'stomach', emotion: 'anxiety' },
      ]
      const state = computeHomunculusState(memories)

      // maxSignals = 10, stomach has 1
      // stomach: 0.6 + (1/10) * 1.2 = 0.6 + 0.12 = 0.72
      expect(state.stomach.sizeFactor).toBeCloseTo(0.72)
    })
  })

  describe('quotes extraction', () => {
    it('extracts quotes with text, date, and entryId', () => {
      const ts = new Date('2025-06-15T12:00:00Z').getTime()
      const memories = [
        { bodyRegion: 'chest', emotion: 'grief', quote: 'It aches here', entryId: 'e1', timestamp: ts },
      ]
      const state = computeHomunculusState(memories)

      expect(state.chest.quotes).toHaveLength(1)
      expect(state.chest.quotes[0].text).toBe('It aches here')
      expect(state.chest.quotes[0].entryId).toBe('e1')
      expect(state.chest.quotes[0].date).toBeTruthy()
    })

    it('keeps at most 5 quotes', () => {
      const memories = Array.from({ length: 8 }, (_, i) => ({
        bodyRegion: 'throat' as const,
        emotion: 'grief',
        quote: `quote ${i + 1}`,
        entryId: `e${i + 1}`,
        timestamp: 1000 * (i + 1),
      }))
      const state = computeHomunculusState(memories)

      expect(state.throat.quotes).toHaveLength(5)
    })

    it('takes the last 5 (most recent) from chronological order and reverses them', () => {
      const memories = Array.from({ length: 7 }, (_, i) => ({
        bodyRegion: 'back' as const,
        emotion: 'sadness',
        quote: `quote ${i + 1}`,
        entryId: `e${i + 1}`,
        timestamp: 1000 * (i + 1),
      }))
      const state = computeHomunculusState(memories)

      // memories in order: quote 1..7
      // slice(-5) gets quotes 3,4,5,6,7
      // reverse() gives 7,6,5,4,3
      expect(state.back.quotes).toHaveLength(5)
      expect(state.back.quotes[0].text).toBe('quote 7')
      expect(state.back.quotes[1].text).toBe('quote 6')
      expect(state.back.quotes[2].text).toBe('quote 5')
      expect(state.back.quotes[3].text).toBe('quote 4')
      expect(state.back.quotes[4].text).toBe('quote 3')
    })

    it('returns quotes in most-recent-first order', () => {
      const memories = [
        { bodyRegion: 'hips', emotion: 'grief', quote: 'oldest', entryId: 'e1', timestamp: 1000 },
        { bodyRegion: 'hips', emotion: 'grief', quote: 'middle', entryId: 'e2', timestamp: 2000 },
        { bodyRegion: 'hips', emotion: 'grief', quote: 'newest', entryId: 'e3', timestamp: 3000 },
      ]
      const state = computeHomunculusState(memories)

      expect(state.hips.quotes[0].text).toBe('newest')
      expect(state.hips.quotes[1].text).toBe('middle')
      expect(state.hips.quotes[2].text).toBe('oldest')
    })

    it('handles missing quote field gracefully (no quote added)', () => {
      const memories = [
        { bodyRegion: 'eyes', emotion: 'anxiety' },
        { bodyRegion: 'eyes', emotion: 'anxiety', quote: 'I cannot look' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.eyes.signalCount).toBe(2)
      expect(state.eyes.quotes).toHaveLength(1)
      expect(state.eyes.quotes[0].text).toBe('I cannot look')
    })

    it('handles missing timestamp with empty date string', () => {
      const memories = [
        { bodyRegion: 'shoulders', emotion: 'grief', quote: 'heavy' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.shoulders.quotes[0].date).toBe('')
    })

    it('handles missing entryId with empty string', () => {
      const memories = [
        { bodyRegion: 'shoulders', emotion: 'grief', quote: 'heavy', timestamp: 1000 },
      ]
      const state = computeHomunculusState(memories)

      expect(state.shoulders.quotes[0].entryId).toBe('')
    })
  })

  describe('emotion counting is case insensitive', () => {
    it('groups same emotion with different cases together', () => {
      const memories = [
        { bodyRegion: 'chest', emotion: 'Grief' },
        { bodyRegion: 'chest', emotion: 'grief' },
        { bodyRegion: 'chest', emotion: 'GRIEF' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.chest.dominantEmotions).toHaveLength(1)
      expect(state.chest.dominantEmotions[0].count).toBe(3)
    })
  })

  describe('memories without emotion field', () => {
    it('does not count signalCount for entries without emotion', () => {
      const memories = [
        { bodyRegion: 'chest', quote: 'something here' },
      ]
      const state = computeHomunculusState(memories)

      expect(state.chest.signalCount).toBe(0)
      expect(state.chest.quotes).toHaveLength(1)
    })
  })
})
