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
  // Ref indirection for the self-recursive reveal: setTimeout calls a stable
  // wrapper, which forwards to the impl that effect installs once on mount.
  // Avoids allocating a fresh closure per tick (~one per 25-55ms during streaming).
  const revealNextCharRef = useRef<() => void>(() => {})
  const tickRef = useRef<() => void>(() => revealNextCharRef.current())
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
        typingTimerRef.current = setTimeout(tickRef.current, delay)
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

  // `flush`: when the stream has already completed (onComplete is pending) but
  // the reveal is still animating, invoke the completion with the full received
  // buffer before tearing down — otherwise a session switch / unmount during
  // the reveal window drops a fully-received (paid) message and strands the
  // streaming state. No-op flush when nothing completed (still mid-stream).
  const cleanup = useCallback((flush = false) => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }
    if (flush && onStreamCompleteRef.current) {
      const cb = onStreamCompleteRef.current
      onStreamCompleteRef.current = null
      cb(streamBufferRef.current)
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
