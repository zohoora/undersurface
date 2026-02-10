import { useGlobalConfig } from '../store/globalConfig'
import type { InnerWeather as InnerWeatherType } from '../types'

const EMOTION_COLORS: Record<string, string> = {
  tender: '#B58548',
  anxious: '#8A7F9C',
  sad: '#5A7F94',
  angry: '#A06A7A',
  joyful: '#B08E60',
  contemplative: '#628E66',
  fearful: '#7E6BA0',
  hopeful: '#8FB893',
  neutral: '#A09A94',
  conflicted: '#9A8070',
}

const TREND_ARROWS: Record<string, string> = {
  rising: String.fromCharCode(0x2191),
  falling: String.fromCharCode(0x2193),
  steady: String.fromCharCode(0x2192),
}

interface InnerWeatherProps {
  weather: InnerWeatherType | null
}

export function InnerWeather({ weather }: InnerWeatherProps) {
  const config = useGlobalConfig()

  if (config?.features.innerWeather !== true) return null
  if (!weather) return null

  const color = EMOTION_COLORS[weather.dominantEmotion] ?? EMOTION_COLORS.neutral
  const secondaryColor = weather.secondaryEmotion
    ? EMOTION_COLORS[weather.secondaryEmotion] ?? color
    : color
  const trendArrow = TREND_ARROWS[weather.trend] ?? TREND_ARROWS.steady

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Gradient blob */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: `radial-gradient(circle at 40% 40%, ${color}, ${secondaryColor})`,
          opacity: 0.3 + weather.intensity * 0.7,
          flexShrink: 0,
          transition: 'opacity 0.6s ease, background 0.6s ease',
        }}
      />

      {/* Labels */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-secondary, #A09A94)',
            textTransform: 'capitalize',
            lineHeight: 1.2,
          }}
        >
          {weather.dominantEmotion}
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-tertiary, #C4BEB8)',
            lineHeight: 1.2,
          }}
        >
          {trendArrow} {weather.trend}
          {weather.secondaryEmotion && (
            <span style={{ marginLeft: 4 }}>
              / {weather.secondaryEmotion}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
