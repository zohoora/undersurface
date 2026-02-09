import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HandwritingText } from '../Editor/HandwritingText'
import { useTheme } from '../../hooks/useTheme'

interface Props {
  partName: string
  partColor: string
  colorLight: string
  initialThought: string
  isOpen: boolean
  onSubmitResponse: (response: string) => void
  partReply: string | null
  isReplyStreaming: boolean
  onClose: () => void
}

function boostAlpha(colorLight: string, isDark: boolean): string {
  if (!isDark || colorLight.length < 8) return colorLight
  return colorLight.slice(0, -2) + '30'
}

export function ThinkingSpace({
  partName,
  partColor,
  colorLight,
  initialThought,
  isOpen,
  onSubmitResponse,
  partReply,
  isReplyStreaming,
  onClose,
}: Props) {
  const theme = useTheme()
  const bg = boostAlpha(colorLight, theme === 'dark')
  const [userInput, setUserInput] = useState('')
  const [hasResponded, setHasResponded] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isOpen && inputRef.current && !hasResponded) {
      setTimeout(() => inputRef.current?.focus(), 400)
    }
  }, [isOpen, hasResponded])

  const handleSubmit = useCallback(() => {
    if (userInput.trim() && !hasResponded) {
      setHasResponded(true)
      onSubmitResponse(userInput.trim())
    }
  }, [userInput, hasResponded, onSubmitResponse])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [handleSubmit, onClose],
  )

  // Auto-close after reply is done streaming
  useEffect(() => {
    if (partReply && !isReplyStreaming) {
      const timer = setTimeout(onClose, 15000)
      return () => clearTimeout(timer)
    }
  }, [partReply, isReplyStreaming, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="thinking-space"
          style={{
            borderColor: partColor,
            backgroundColor: bg,
          }}
          initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
          animate={{ height: 'auto', opacity: 1, marginTop: 4, marginBottom: 16 }}
          exit={{
            height: 0,
            opacity: 0,
            marginTop: 0,
            marginBottom: 0,
            transition: { duration: 2, ease: [0.4, 0, 0.2, 1] },
          }}
          transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* The part's original thought (context) */}
          <div className="part-name" style={{ color: partColor, fontSize: 10, marginBottom: 8, opacity: 0.5 }}>
            {partName}
          </div>
          <div style={{ color: partColor, opacity: 0.6, fontSize: 14, fontFamily: "'Inter', sans-serif" }}>
            {initialThought}
          </div>

          {/* User's response area */}
          {!hasResponded && (
            <textarea
              ref={inputRef}
              className="thinking-input"
              placeholder="respond..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              style={{
                overflow: 'hidden',
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = target.scrollHeight + 'px'
              }}
            />
          )}

          {/* User's response (after submitting) */}
          {hasResponded && (
            <div style={{
              fontFamily: "'Spectral', Georgia, serif",
              fontSize: 16,
              lineHeight: 1.7,
              color: 'var(--text-primary)',
              padding: '8px 0',
            }}>
              {userInput}
            </div>
          )}

          {/* Part's reply */}
          {(partReply || isReplyStreaming) && (
            <div className="thinking-reply">
              <div className="part-name" style={{ color: partColor, fontSize: 10, marginBottom: 4, opacity: 0.5 }}>
                {partName}
              </div>
              <div style={{ color: partColor, opacity: 0.85, fontSize: 14, fontFamily: "'Inter', sans-serif" }}>
                <HandwritingText
                  text={partReply || ''}
                  isStreaming={isReplyStreaming}
                  baseDelay={40}
                />
              </div>
            </div>
          )}

          {/* Close hint */}
          {partReply && !isReplyStreaming && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              transition={{ delay: 1, duration: 1 }}
              style={{
                fontSize: 11,
                fontFamily: "'Inter', sans-serif",
                color: 'var(--text-ghost)',
                marginTop: 12,
                cursor: 'pointer',
              }}
              onClick={onClose}
            >
              press esc or click to close
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
