import { useEffect, useRef } from 'react'
import type { EmotionalTone } from '../../types'
import { isGroundingActive } from '../../hooks/useGroundingMode'

const EMOTION_SPEED: Record<EmotionalTone, number> = {
  neutral: 4.5,
  contemplative: 4.5,
  tender: 3.5,
  hopeful: 3.5,
  joyful: 3.5,
  sad: 3.0,
  conflicted: 2.5,
  anxious: 2.0,
  fearful: 2.0,
  angry: 1.8,
}

interface Props {
  emotion: EmotionalTone
  enabled?: boolean
}

export function BilateralPulse({ emotion, enabled = true }: Props) {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const currentSpeed = useRef(4.5)
  const startTime = useRef(0)

  useEffect(() => {
    if (!enabled) return

    startTime.current = performance.now()

    const animate = (now: number) => {
      // Smooth speed interpolation toward target
      const targetSpeed = isGroundingActive() ? 4.5 : (EMOTION_SPEED[emotion] || 4.5)
      const lerp = 0.02
      currentSpeed.current += (targetSpeed - currentSpeed.current) * lerp

      const elapsed = (now - startTime.current) / 1000
      const phase = (elapsed / currentSpeed.current) * Math.PI * 2
      // Sine wave: 0 to 1 for left, inverted for right
      const leftOpacity = 0.05 + 0.35 * ((Math.sin(phase) + 1) / 2)
      const rightOpacity = 0.05 + 0.35 * ((Math.sin(phase + Math.PI) + 1) / 2)

      if (leftRef.current) leftRef.current.style.opacity = String(leftOpacity)
      if (rightRef.current) rightRef.current.style.opacity = String(rightOpacity)

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => cancelAnimationFrame(rafRef.current)
  }, [emotion, enabled])

  if (!enabled) return null

  return (
    <>
      <div ref={leftRef} className="bilateral-pulse bilateral-pulse-left" />
      <div ref={rightRef} className="bilateral-pulse bilateral-pulse-right" />
    </>
  )
}
