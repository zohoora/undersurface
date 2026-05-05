import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Manages the typewriter reveal effect for streaming AI tokens.
 * Accumulates raw tokens in a buffer and reveals them character-by-character
 * with variable timing (burst logic: 3/2/1 chars based on remaining).
 */
export function useTypewriter() {
  const [displayedContent, setDisplayedContent] = useState('')

  const streamBufferRef = useRef('')
  const displayedLengthRef = useRef(0)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onStreamCompleteRef = useRef<((fullText: string) => void) | null>(null)
  // Ref indirection for the self-recursive reveal — lets setTimeout call back
  // into the impl without forward-referencing a not-yet-declared callback.
  // Closes over refs only, so the impl is stable for the hook's lifetime.
  const revealNextCharRef = useRef<() => void>(() => {})
  useEffect(() => {
    revealNextCharRef.current = () => {
      if (displayedLengthRef.current < streamBufferRef.current.length) {
        const remaining = streamBufferRef.current.length - displayedLengthRef.current
        const burst = remaining > 20 ? 3 : remaining > 5 ? 2 : 1
        displayedLengthRef.current = Math.min(
          displayedLengthRef.current + burst,
          streamBufferRef.current.length,
        )
        setDisplayedContent(streamBufferRef.current.slice(0, displayedLengthRef.current))
        const delay = 25 + Math.random() * 30
        typingTimerRef.current = setTimeout(() => revealNextCharRef.current(), delay)
      } else if (onStreamCompleteRef.current) {
        const cb = onStreamCompleteRef.current
        onStreamCompleteRef.current = null
        cb(streamBufferRef.current)
      } else {
        typingTimerRef.current = null
      }
    }
  }, [])

  const appendToken = useCallback((token: string) => {
    streamBufferRef.current += token
    if (!typingTimerRef.current) {
      revealNextCharRef.current()
    }
  }, [])

  const setOnComplete = useCallback((cb: (fullText: string) => void) => {
    onStreamCompleteRef.current = cb
    if (!typingTimerRef.current) {
      revealNextCharRef.current()
    }
  }, [])

  const reset = useCallback(() => {
    streamBufferRef.current = ''
    displayedLengthRef.current = 0
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }
    onStreamCompleteRef.current = null
    setDisplayedContent('')
  }, [])

  const cleanup = useCallback(() => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }
  }, [])

  return {
    displayedContent,
    appendToken,
    setOnComplete,
    reset,
    cleanup,
  }
}
