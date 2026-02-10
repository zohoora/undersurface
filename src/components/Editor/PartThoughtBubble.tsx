import { motion, AnimatePresence } from 'framer-motion'
import { HandwritingText } from './HandwritingText'
import { useTheme } from '../../hooks/useTheme'

interface Props {
  partName: string
  partColor: string
  colorLight: string
  content: string
  isStreaming: boolean
  isEmerging: boolean
  isVisible: boolean
  exitInstant?: boolean
  onClick: () => void
  isEcho?: boolean
  isSilence?: boolean
  isBlankPage?: boolean
  isQuote?: boolean
  isDisagreement?: boolean
  quotedText?: string
  echoDate?: number
  isReturning?: boolean
}

function boostAlpha(colorLight: string, isDark: boolean): string {
  if (!isDark || colorLight.length < 8) return colorLight
  // Replace last 2 hex chars (alpha) with higher value
  return colorLight.slice(0, -2) + '30'
}

export function PartThoughtBubble({
  partName,
  partColor,
  colorLight,
  content,
  isStreaming,
  isEmerging,
  isVisible,
  exitInstant,
  onClick,
  isEcho,
  isSilence,
  isBlankPage,
  isQuote,
  isDisagreement,
  quotedText,
  echoDate,
  isReturning,
}: Props) {
  const theme = useTheme()
  const bg = boostAlpha(colorLight, theme === 'dark')

  const className = [
    'part-thought',
    isEmerging && 'emerging',
    isEcho && 'echo-thought',
    isSilence && 'silence-thought',
    isBlankPage && 'blank-page-thought',
    isQuote && 'quote-thought',
    isDisagreement && 'disagreement-thought',
    isReturning && 'returning-thought',
  ].filter(Boolean).join(' ')

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className={className}
          style={{
            backgroundColor: bg,
            borderLeft: `2px solid ${partColor}`,
            '--bloom-color': bg,
          } as React.CSSProperties}
          initial={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
          animate={{
            opacity: 1,
            height: 'auto',
            marginTop: 8,
            marginBottom: 16,
            paddingTop: 12,
            paddingBottom: 12,
          }}
          exit={{
            opacity: 0,
            height: 0,
            marginTop: 0,
            marginBottom: 0,
            paddingTop: 0,
            paddingBottom: 0,
            transition: exitInstant
              ? { duration: 0.15 }
              : { duration: 1.8, ease: [0.4, 0, 0.2, 1] },
          }}
          transition={{
            duration: isEmerging ? 1.2 : isEcho ? 1.2 : isSilence ? 0.4 : isReturning ? 1.5 : 0.8,
            ease: [0.4, 0, 0.2, 1],
          }}
          onClick={onClick}
        >
          <div
            className="part-name"
            style={{ color: partColor }}
          >
            {partName}
          </div>
          {isSilence ? (
            <div className="part-content" style={{ color: partColor }}>
              <span className="silence-dot" style={{ backgroundColor: partColor }} />
            </div>
          ) : (
            <>
              {isQuote && quotedText && (
                <div className="quoted-text">&ldquo;{quotedText}&rdquo;</div>
              )}
              <div className="part-content" style={{ color: partColor }}>
                <HandwritingText
                  text={content}
                  isStreaming={isStreaming}
                  baseDelay={isEmerging ? 60 : 35}
                />
              </div>
              {isEcho && quotedText && (
                <div className="echo-date">
                  {echoDate ? new Date(echoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
