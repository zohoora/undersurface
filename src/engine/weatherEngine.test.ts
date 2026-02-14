import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing WeatherEngine
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: vi.fn(),
}))

vi.mock('../store/db', () => ({
  db: { innerWeather: { add: vi.fn() } },
  generateId: vi.fn(() => 'test-id'),
}))

import { WeatherEngine } from './weatherEngine'
import { getGlobalConfig } from '../store/globalConfig'

const mockGetGlobalConfig = vi.mocked(getGlobalConfig)

function enableWeatherFeature() {
  mockGetGlobalConfig.mockReturnValue({
    features: { innerWeather: true },
  } as ReturnType<typeof getGlobalConfig>)
}

function disableWeatherFeature() {
  mockGetGlobalConfig.mockReturnValue({
    features: { innerWeather: false },
  } as ReturnType<typeof getGlobalConfig>)
}

describe('WeatherEngine', () => {
  let engine: WeatherEngine

  beforeEach(() => {
    engine = new WeatherEngine()
    vi.clearAllMocks()
  })

  // --- recordEmotion ---

  describe('recordEmotion', () => {
    it('records emotions up to 20', () => {
      enableWeatherFeature()
      for (let i = 0; i < 20; i++) {
        engine.recordEmotion('sad')
      }
      const weather = engine.getWeather()
      expect(weather).not.toBeNull()
      expect(weather!.dominantEmotion).toBe('sad')
    })

    it('trims to last 20 when exceeding', () => {
      enableWeatherFeature()
      // Add 18 sad + 5 joyful = 23 total, trimmed to last 20 = 15 sad + 5 joyful
      for (let i = 0; i < 18; i++) engine.recordEmotion('sad')
      for (let i = 0; i < 5; i++) engine.recordEmotion('joyful')

      const weather = engine.getWeather()
      expect(weather).not.toBeNull()
      // After trimming: 15 sad + 5 joyful → sad is dominant
      expect(weather!.dominantEmotion).toBe('sad')
    })
  })

  // --- getWeather null cases ---

  describe('getWeather returns null', () => {
    it('returns null with fewer than 2 emotions', () => {
      enableWeatherFeature()
      engine.recordEmotion('sad')
      expect(engine.getWeather()).toBeNull()
    })

    it('returns null with 0 emotions', () => {
      enableWeatherFeature()
      expect(engine.getWeather()).toBeNull()
    })

    it('returns null when feature is disabled', () => {
      disableWeatherFeature()
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      expect(engine.getWeather()).toBeNull()
    })

    it('returns null when config is null', () => {
      mockGetGlobalConfig.mockReturnValue(null)
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      expect(engine.getWeather()).toBeNull()
    })
  })

  // --- dominant/secondary emotion ---

  describe('dominant and secondary emotion', () => {
    it('identifies the most frequent emotion as dominant', () => {
      enableWeatherFeature()
      engine.recordEmotion('angry')
      engine.recordEmotion('angry')
      engine.recordEmotion('angry')
      engine.recordEmotion('sad')
      engine.recordEmotion('joyful')

      const weather = engine.getWeather()!
      expect(weather.dominantEmotion).toBe('angry')
    })

    it('identifies secondary emotion', () => {
      enableWeatherFeature()
      engine.recordEmotion('angry')
      engine.recordEmotion('angry')
      engine.recordEmotion('angry')
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      engine.recordEmotion('joyful')

      const weather = engine.getWeather()!
      expect(weather.secondaryEmotion).toBe('sad')
    })

    it('has no secondary when all emotions are the same', () => {
      enableWeatherFeature()
      engine.recordEmotion('tender')
      engine.recordEmotion('tender')
      engine.recordEmotion('tender')

      const weather = engine.getWeather()!
      expect(weather.dominantEmotion).toBe('tender')
      expect(weather.secondaryEmotion).toBeUndefined()
    })
  })

  // --- intensity ---

  describe('intensity', () => {
    it('is 1.0 when all emotions are the same', () => {
      enableWeatherFeature()
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')

      expect(engine.getWeather()!.intensity).toBe(1)
    })

    it('is 0.5 when evenly split between two emotions', () => {
      enableWeatherFeature()
      engine.recordEmotion('sad')
      engine.recordEmotion('joyful')
      engine.recordEmotion('sad')
      engine.recordEmotion('joyful')

      expect(engine.getWeather()!.intensity).toBe(0.5)
    })
  })

  // --- trend ---

  describe('trend', () => {
    it('is steady when uniform', () => {
      enableWeatherFeature()
      for (let i = 0; i < 6; i++) engine.recordEmotion('sad')

      expect(engine.getWeather()!.trend).toBe('steady')
    })

    it('is rising when dominant grows in second half', () => {
      enableWeatherFeature()
      // First half: mixed
      engine.recordEmotion('joyful')
      engine.recordEmotion('joyful')
      engine.recordEmotion('sad')
      engine.recordEmotion('joyful')
      // Second half: all sad
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')

      const weather = engine.getWeather()!
      // sad is dominant (5 total), first half has 1/4 sad, second half has 4/4 sad
      // secondRatio - firstRatio = 1.0 - 0.25 = 0.75 > 0.15 → rising
      expect(weather.trend).toBe('rising')
    })

    it('is falling when dominant decreases in second half', () => {
      enableWeatherFeature()
      // First half: all sad
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      engine.recordEmotion('sad')
      // Second half: mixed
      engine.recordEmotion('joyful')
      engine.recordEmotion('joyful')
      engine.recordEmotion('joyful')
      engine.recordEmotion('sad')

      const weather = engine.getWeather()!
      // sad is dominant (5 total), first half has 4/4, second half has 1/4
      // secondRatio - firstRatio = 0.25 - 1.0 = -0.75 < -0.15 → falling
      expect(weather.trend).toBe('falling')
    })
  })
})
