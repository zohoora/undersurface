import type { EmotionalTone } from '../../types'

interface Props {
  emotion: EmotionalTone
  enabled?: boolean
}

export function BreathingBackground({ emotion, enabled = true }: Props) {
  return (
    <div
      className="atmosphere"
      data-emotion={emotion}
      style={enabled ? undefined : { animation: 'none' }}
    >
      <div className="typing-breath" />
    </div>
  )
}
