import { useCallback, useEffect, useRef, useState } from 'react'

interface Ripple {
  id: number
  x: number
  y: number
}

export function usePauseRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const addRipple = useCallback((ripple: Ripple) => {
    setRipples((prev) => [...prev, ripple])
    const timer = setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== ripple.id))
      timersRef.current.delete(ripple.id)
    }, 2500)
    timersRef.current.set(ripple.id, timer)
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  return { ripples, addRipple }
}
