import { useEffect } from 'react'
import { useGlobalConfig } from '../store/globalConfig'

type Season = 'spring' | 'summer' | 'autumn' | 'winter'

interface SeasonalTint {
  r: number
  g: number
  b: number
}

const SEASON_TINTS: Record<Season, SeasonalTint> = {
  spring: { r: 200, g: 225, b: 190 },
  summer: { r: 245, g: 220, b: 170 },
  autumn: { r: 210, g: 170, b: 120 },
  winter: { r: 180, g: 195, b: 215 },
}

const SEASONAL_PROPERTIES = [
  '--seasonal-tint-r',
  '--seasonal-tint-g',
  '--seasonal-tint-b',
] as const

function detectSeason(): Season {
  const month = new Date().getMonth()
  if (month >= 2 && month <= 4) return 'spring'
  if (month >= 5 && month <= 7) return 'summer'
  if (month >= 8 && month <= 10) return 'autumn'
  return 'winter'
}

function applySeasonalTint(season: Season, intensity: number): void {
  const tint = SEASON_TINTS[season]
  const style = document.documentElement.style

  style.setProperty('--seasonal-tint-r', String(Math.round(tint.r * intensity)))
  style.setProperty('--seasonal-tint-g', String(Math.round(tint.g * intensity)))
  style.setProperty('--seasonal-tint-b', String(Math.round(tint.b * intensity)))
}

function clearSeasonalTint(): void {
  const style = document.documentElement.style
  for (const prop of SEASONAL_PROPERTIES) {
    style.removeProperty(prop)
  }
}

export function useSeasonalPalette(): void {
  const config = useGlobalConfig()
  const enabled = config?.features?.seasonalShifts === true

  useEffect(() => {
    if (!enabled) {
      clearSeasonalTint()
      return
    }

    const intensity = config?.atmosphere?.seasonalIntensity ?? 0.3
    const override = config?.atmosphere?.seasonOverride
    const season = override && override !== 'auto' ? override : detectSeason()

    applySeasonalTint(season, intensity)

    return () => {
      clearSeasonalTint()
    }
  }, [
    enabled,
    config?.atmosphere?.seasonalIntensity,
    config?.atmosphere?.seasonOverride,
  ])
}
