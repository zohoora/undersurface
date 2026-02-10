import { useEffect } from 'react'
import { useGlobalConfig } from '../store/globalConfig'

type TimePeriod = 'morning' | 'afternoon' | 'evening' | 'night'

interface ColorShift {
  '--bg-primary': string
  '--bg-warm': string
  '--bg-secondary': string
}

const LIGHT_SHIFTS: Record<TimePeriod, ColorShift> = {
  morning: {
    '--bg-primary': '#FBF7F0',
    '--bg-warm': '#F8F0E3',
    '--bg-secondary': '#F5EDE0',
  },
  afternoon: {
    '--bg-primary': '',
    '--bg-warm': '',
    '--bg-secondary': '',
  },
  evening: {
    '--bg-primary': '#FAF4EB',
    '--bg-warm': '#F5ECE0',
    '--bg-secondary': '#F0E6D8',
  },
  night: {
    '--bg-primary': '#F5F2EE',
    '--bg-warm': '#EDE9E3',
    '--bg-secondary': '#E8E4DE',
  },
}

const DARK_SHIFTS: Record<TimePeriod, ColorShift> = {
  morning: {
    '--bg-primary': '#1E1C19',
    '--bg-warm': '#232019',
    '--bg-secondary': '#28241C',
  },
  afternoon: {
    '--bg-primary': '',
    '--bg-warm': '',
    '--bg-secondary': '',
  },
  evening: {
    '--bg-primary': '#1D1A17',
    '--bg-warm': '#221E18',
    '--bg-secondary': '#27221A',
  },
  night: {
    '--bg-primary': '#18181A',
    '--bg-warm': '#1C1C1F',
    '--bg-secondary': '#202024',
  },
}

const CSS_PROPERTIES: (keyof ColorShift)[] = [
  '--bg-primary',
  '--bg-warm',
  '--bg-secondary',
]

function getTimePeriod(): TimePeriod {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

function blendColor(original: string, target: string, intensity: number): string {
  if (!target) return ''
  const parse = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  })
  const o = parse(original)
  const t = parse(target)
  const r = Math.round(o.r + (t.r - o.r) * intensity)
  const g = Math.round(o.g + (t.g - o.g) * intensity)
  const b = Math.round(o.b + (t.b - o.b) * intensity)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

const LIGHT_BASE: ColorShift = {
  '--bg-primary': '#FAF8F5',
  '--bg-warm': '#F5F0EA',
  '--bg-secondary': '#F0EBE3',
}

const DARK_BASE: ColorShift = {
  '--bg-primary': '#1A1917',
  '--bg-warm': '#1F1D1A',
  '--bg-secondary': '#24221E',
}

function applyShifts(period: TimePeriod, intensity: number, isDark: boolean): void {
  const shifts = isDark ? DARK_SHIFTS : LIGHT_SHIFTS
  const base = isDark ? DARK_BASE : LIGHT_BASE
  const shift = shifts[period]
  const style = document.documentElement.style

  for (const prop of CSS_PROPERTIES) {
    const target = shift[prop]
    if (!target) {
      style.removeProperty(prop)
      continue
    }
    // Dark mode shifts are subtler — halve the intensity
    const effectiveIntensity = isDark ? intensity * 0.5 : intensity
    const blended = blendColor(base[prop], target, effectiveIntensity)
    if (blended) {
      style.setProperty(prop, blended)
    }
  }
}

function clearShifts(): void {
  const style = document.documentElement.style
  for (const prop of CSS_PROPERTIES) {
    style.removeProperty(prop)
  }
}

export function useTimeAwarePalette(): void {
  const config = useGlobalConfig()
  const enabled = config?.features?.timeAwareAtmosphere === true

  useEffect(() => {
    if (!enabled) {
      clearShifts()
      return
    }

    const intensity = config?.atmosphere?.timeShiftIntensity ?? 0.3

    const update = () => {
      const currentDark = document.documentElement.getAttribute('data-theme') === 'dark'
      const period = getTimePeriod()
      applyShifts(period, intensity, currentDark)
    }

    update()
    const interval = setInterval(update, 15 * 60 * 1000)

    return () => {
      clearInterval(interval)
      clearShifts()
    }
  }, [enabled, config?.atmosphere?.timeShiftIntensity])
}
