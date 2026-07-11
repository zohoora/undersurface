import { useEffect, useState } from 'react'
import type { ClosureReason } from '../../../engine/driftEngine'
import { t } from '../../../i18n'

// Fixed, scripted closure copy — never LLM output. A normal close walks the
// three landing lines; a crisis close shows only the grounding handoff.
const STEPS = ['drift.closure.anchor', 'drift.closure.container', 'drift.closure.orient'] as const
const STEP_MS = 6000

interface Props {
  reason: ClosureReason
  // v2 felt-contrast: did any check-in report softer this session? Drives a
  // scripted template line — engine counters in, fixed copy out, never a score.
  softened?: boolean
  onDone: () => void
  onSpeak?: (line: string) => void
}

export function DriftClosing({ reason, softened, onDone, onSpeak }: Props) {
  const isCrisis = reason === 'crisis'
  const [step, setStep] = useState(0)
  const lastStep = STEPS.length - 1

  // Auto-advance each landing line; crisis has no sequence.
  useEffect(() => {
    if (isCrisis || step >= lastStep) return
    const id = setTimeout(() => setStep((s) => Math.min(s + 1, lastStep)), STEP_MS)
    return () => clearTimeout(id)
  }, [isCrisis, step, lastStep])

  const advance = () => { if (!isCrisis) setStep((s) => Math.min(s + 1, lastStep)) }
  const line = isCrisis ? t('drift.abort.handoff') : t(STEPS[step])
  const atEnd = isCrisis || step >= lastStep

  useEffect(() => { onSpeak?.(line) }, [line, onSpeak])

  return (
    <div
      onClick={advance}
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 28, cursor: isCrisis ? 'default' : 'pointer', width: '100%', maxWidth: 440, textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 17, lineHeight: 1.7, color: 'var(--text-primary)' }}>{line}</div>
      {atEnd && !isCrisis && (
        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
          {t(softened ? 'drift.closing.softened' : 'drift.closing.steady')}
        </div>
      )}
      {!atEnd && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('drift.closure.continue')}</div>}
      {atEnd && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDone() }}
          style={{
            padding: '10px 24px',
            borderRadius: 999,
            border: '1px solid var(--border-light)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: 14,
            cursor: 'pointer',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {t('drift.closure.done')}
        </button>
      )}
    </div>
  )
}

export default DriftClosing
