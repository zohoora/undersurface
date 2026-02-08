import { useState, useEffect, useRef } from 'react'

interface Props {
  text: string
  isStreaming: boolean
  baseDelay?: number
  className?: string
}

export function HandwritingText({
  text,
  isStreaming,
  baseDelay = 30,
  className = '',
}: Props) {
  const [visibleCount, setVisibleCount] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevLengthRef = useRef(0)

  useEffect(() => {
    if (text.length > prevLengthRef.current) {
      const newChars = text.length - prevLengthRef.current
      prevLengthRef.current = text.length

      if (isStreaming) {
        let revealed = 0
        const revealNext = () => {
          revealed++
          setVisibleCount((prev) => prev + 1)
          if (revealed < newChars) {
            const jitter = baseDelay + (Math.random() - 0.5) * baseDelay * 0.6
            timerRef.current = setTimeout(revealNext, jitter)
          }
        }
        const jitter = baseDelay + (Math.random() - 0.5) * baseDelay * 0.6
        timerRef.current = setTimeout(revealNext, jitter)
      } else {
        setVisibleCount(text.length)
      }
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [text, isStreaming, baseDelay])

  useEffect(() => {
    if (!isStreaming && text.length > 0) {
      setVisibleCount(text.length)
    }
  }, [isStreaming, text.length])

  return (
    <span className={className}>
      {text.split('').map((char, i) => (
        <span
          key={i}
          style={{
            display: 'inline',
            opacity: i < visibleCount ? 0.85 : 0,
            transform: i < visibleCount ? 'translateY(0)' : 'translateY(2px)',
            transition: 'opacity 0.15s ease-out, transform 0.15s ease-out',
          }}
        >
          {char}
        </span>
      ))}
    </span>
  )
}
