import { useEffect, useRef } from 'react'

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

interface Props {
  partTint?: string | null
}

export function CursorGlow({ partTint }: Props) {
  const glowRef = useRef<HTMLDivElement>(null)
  const tintRef = useRef<HTMLDivElement>(null)
  const isActive = useRef(false)
  const rafId = useRef<number>(0)
  const targetX = useRef(0)
  const targetY = useRef(0)
  const currentX = useRef(0)
  const currentY = useRef(0)

  // Update tint when active part changes
  useEffect(() => {
    if (!tintRef.current) return
    if (partTint) {
      tintRef.current.style.background = `radial-gradient(
        ellipse at center,
        ${partTint}30 0%,
        ${partTint}12 40%,
        transparent 70%
      )`
      tintRef.current.style.opacity = '1'
    } else {
      tintRef.current.style.opacity = '0'
    }
  }, [partTint])

  useEffect(() => {
    if (isTouchDevice()) return

    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return

      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      if (rect.x === 0 && rect.y === 0) return

      targetX.current = rect.x + rect.width / 2
      targetY.current = rect.y + rect.height / 2

      if (!isActive.current) {
        isActive.current = true
        currentX.current = targetX.current
        currentY.current = targetY.current
        glowRef.current?.classList.add('active')
      }
    }

    const animate = () => {
      const lerp = 0.06
      currentX.current += (targetX.current - currentX.current) * lerp
      currentY.current += (targetY.current - currentY.current) * lerp

      const x = `${currentX.current}px`
      const y = `${currentY.current}px`

      if (glowRef.current) {
        glowRef.current.style.left = x
        glowRef.current.style.top = y
      }
      if (tintRef.current) {
        tintRef.current.style.left = x
        tintRef.current.style.top = y
      }

      rafId.current = requestAnimationFrame(animate)
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    rafId.current = requestAnimationFrame(animate)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      cancelAnimationFrame(rafId.current)
    }
  }, [])

  return (
    <>
      <div ref={glowRef} className="cursor-glow" />
      <div ref={tintRef} className="cursor-glow-tint" />
    </>
  )
}
