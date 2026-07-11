import { memo, useMemo } from 'react'
import { parseRecommendations } from '../../ai/therapistRecommendationParser'
import { useTranslation } from '../../i18n'

interface Props {
  text: string
  onTap: (target: string) => void
}

type SurfaceKey =
  | 'session.bottomBar.journal'
  | 'session.bottomBar.speak'
  | 'session.bottomBar.relax'
  | 'session.bottomBar.drift'
  | 'session.bottomBar.realTalk'

function destinationKey(target: string): SurfaceKey | null {
  switch (target) {
    case 'journal':
    case 'journal-arc':
      return 'session.bottomBar.journal'
    case 'speak':
    case 'speak-arc':
      return 'session.bottomBar.speak'
    case 'relax':
    case 'relax-arc':
      return 'session.bottomBar.relax'
    case 'drift-arc':
      return 'session.bottomBar.drift'
    case 'real-talk-on':
      return 'session.bottomBar.realTalk'
    default:
      return null
  }
}

export const RecommendationSegments = memo(function RecommendationSegments({ text, onTap }: Props) {
  const segments = useMemo(() => parseRecommendations(text), [text])
  const copy = useTranslation()

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.text}</span>
        ) : (() => {
          const key = destinationKey(seg.target)
          const destination = key ? copy[key] : null
          const needsDestinationCue = destination != null
            && !seg.phrase.toLocaleLowerCase().includes(destination.toLocaleLowerCase())

          return (
            <button
              key={i}
              type="button"
              className="session-recommendation"
              aria-label={destination ? `${seg.phrase} — ${destination}` : seg.phrase}
              onClick={() => onTap(seg.target)}
            >
              <span className="session-recommendation__phrase">{seg.phrase}</span>
              {needsDestinationCue && (
                <span className="session-recommendation__destination" aria-hidden="true">
                  {destination}<span className="session-recommendation__arrow">→</span>
                </span>
              )}
            </button>
          )
        })(),
      )}
    </>
  )
})
