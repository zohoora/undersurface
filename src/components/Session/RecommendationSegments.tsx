import { memo, useMemo } from 'react'
import { parseRecommendations } from '../../ai/therapistRecommendationParser'

interface Props {
  text: string
  onTap: (target: string) => void
}

export const RecommendationSegments = memo(function RecommendationSegments({ text, onTap }: Props) {
  const segments = useMemo(() => parseRecommendations(text), [text])

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <button
            key={i}
            type="button"
            className="session-recommendation"
            onClick={() => onTap(seg.target)}
          >
            {seg.phrase}
          </button>
        ),
      )}
    </>
  )
})
