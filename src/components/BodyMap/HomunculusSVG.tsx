import { motion } from 'framer-motion'
import type { BodyRegion, HomunculusState } from '../../types'

interface Props {
  state: HomunculusState
  onRegionTap: (region: BodyRegion) => void
  selectedRegion: BodyRegion | null
}

const regionPaths: Record<BodyRegion, string> = {
  head: 'M85 30 C85 12 115 12 115 30 L118 55 C118 70 82 70 82 55 Z',
  eyes: 'M90 35 C90 32 98 32 98 35 C98 38 90 38 90 35 Z M102 35 C102 32 110 32 110 35 C110 38 102 38 102 35 Z',
  throat: 'M92 70 L108 70 L106 90 L94 90 Z',
  chest: 'M72 95 C68 95 65 100 65 110 L65 155 C65 160 70 162 80 162 L120 162 C130 162 135 160 135 155 L135 110 C135 100 132 95 128 95 Z',
  stomach: 'M75 165 C70 165 68 170 70 180 L72 210 C74 220 80 225 100 225 C120 225 126 220 128 210 L130 180 C132 170 130 165 125 165 Z',
  shoulders: 'M45 95 C35 95 30 105 32 115 L38 130 L65 120 L65 100 C62 95 55 95 45 95 Z M155 95 C165 95 170 105 168 115 L162 130 L135 120 L135 100 C138 95 145 95 155 95 Z',
  hands: 'M20 200 C15 200 12 205 14 215 L20 240 C22 248 28 248 30 240 L32 230 L34 242 C35 248 40 248 41 242 L42 228 C44 210 38 200 30 200 Z M180 200 C185 200 188 205 186 215 L180 240 C178 248 172 248 170 240 L168 230 L166 242 C165 248 160 248 159 242 L158 228 C156 210 162 200 170 200 Z',
  back: 'M82 130 L80 160 L120 160 L118 130 Z',
  hips: 'M72 228 C68 228 65 235 68 250 L75 270 C80 278 85 280 100 280 C115 280 120 278 125 270 L132 250 C135 235 132 228 128 228 Z',
  legs: 'M78 283 C75 283 73 290 74 300 L76 370 C76 380 78 400 80 420 C82 435 84 440 90 440 L95 440 C98 440 99 435 98 420 L94 370 L92 300 Z M122 283 C125 283 127 290 126 300 L124 370 C124 380 122 400 120 420 C118 435 116 440 110 440 L105 440 C102 440 101 435 102 420 L106 370 L108 300 Z',
}

const regionCenters: Record<BodyRegion, { x: number; y: number }> = {
  head: { x: 100, y: 42 },
  eyes: { x: 100, y: 35 },
  throat: { x: 100, y: 80 },
  chest: { x: 100, y: 128 },
  stomach: { x: 100, y: 195 },
  shoulders: { x: 100, y: 110 },
  hands: { x: 100, y: 225 },
  back: { x: 100, y: 145 },
  hips: { x: 100, y: 254 },
  legs: { x: 100, y: 365 },
}

const RENDER_ORDER: BodyRegion[] = [
  'back', 'shoulders', 'legs', 'hips', 'stomach',
  'chest', 'throat', 'hands', 'head', 'eyes',
]

export function HomunculusSVG({ state, onRegionTap, selectedRegion }: Props) {
  return (
    <svg
      viewBox="0 0 200 460"
      style={{ width: '100%', maxHeight: '58vh' }}
      aria-label="Body map"
    >
      {RENDER_ORDER.map(region => {
        const regionState = state[region]
        const center = regionCenters[region]
        const isSelected = selectedRegion === region
        const isChest = region === 'chest'

        return (
          <motion.g
            key={region}
            animate={{
              scale: regionState.sizeFactor,
              ...(isChest ? {
                scale: [
                  regionState.sizeFactor,
                  regionState.sizeFactor * 1.02,
                  regionState.sizeFactor,
                ],
              } : {}),
            }}
            transition={isChest ? {
              scale: {
                duration: 5,
                ease: 'easeInOut',
                repeat: Infinity,
              },
            } : {
              duration: 0.8,
              ease: 'easeInOut',
            }}
            style={{
              transformOrigin: `${center.x}px ${center.y}px`,
              cursor: 'pointer',
            }}
            onClick={() => onRegionTap(region)}
          >
            <path
              d={regionPaths[region]}
              fill={regionState.fillColor}
              stroke="var(--text-ghost)"
              strokeWidth={isSelected ? 1.2 : 0.5}
              opacity={regionState.signalCount > 0 ? 0.85 : 0.4}
              style={{
                transition: 'fill 0.6s ease, opacity 0.6s ease',
                filter: isSelected ? 'brightness(1.15)' : 'none',
              }}
            />
          </motion.g>
        )
      })}
    </svg>
  )
}
