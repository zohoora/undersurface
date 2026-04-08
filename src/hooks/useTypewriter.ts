import { useState, useCallback, useRef } from 'react'

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

  const revealNextChar = useCallback(() => {
    if (displayedLengthRef.current < streamBufferRef.current.length) {
      const remaining = streamBufferRef.current.length - displayedLengthRef.current
      const burst = remaining > 20 ? 3 : remaining > 5 ? 2 : 1
      displayedLengthRef.current = Math.min(
        displayedLengthRef.current + burst,
        streamBufferRef.current.length,
      )
      setDisplayedContent(streamBufferRef.current.slice(0, displayedLengthRef.current))
      const delay = 25 + Math.random() * 30
      typingTimerRef.current = setTimeout(revealNextChar, delay)
    } else if (onStreamCompleteRef.current) {
      const cb = onStreamCompleteRef.current
      onStreamCompleteRef.current = null
      cb(streamBufferRef.current)
    } else {
      typingTimerRef.current = null
    }
  }, [])

  const appendToken = useCallback((token: string) => {
    streamBufferRef.current += token
    if (!typingTimerRef.current) {
      revealNextChar()
    }
  }, [revealNextChar])

  const setOnComplete = useCallback((cb: (fullText: string) => void) => {
    onStreamCompleteRef.current = cb
    // If buffer is already fully revealed, fire immediately
    if (!typingTimerRef.current) {
      revealNextChar()
    }
  }, [revealNextChar])

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
