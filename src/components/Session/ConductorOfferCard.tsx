import { useState } from 'react'
import { markResearchOverridden } from '../../store/personalScience'
import { useTranslation } from '../../i18n'
import { CARD_FONT, cardQuietButtonStyle } from './cardControls'

export function ConductorOfferCard({ eventId }: { eventId: string }) {
  const tr = useTranslation()
  const [declined, setDeclined] = useState(false)
  const [saving, setSaving] = useState(false)

  const decline = async () => {
    if (declined || saving) return
    setSaving(true)
    try {
      await markResearchOverridden(eventId, 'continue_talk')
      setDeclined(true)
    } finally {
      setSaving(false)
    }
  }

  // The decline reads as a quiet text link but keeps a full 44px target; the
  // negative inline margin keeps its text aligned with the message above.
  return (
    <div style={{ marginTop: 6, fontFamily: CARD_FONT, fontSize: 12, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
      {declined ? (
        <span role="status">{tr['conductor.offer.declined']}</span>
      ) : (
        <button
          type="button"
          disabled={saving}
          onClick={() => { void decline() }}
          style={{ ...cardQuietButtonStyle, marginLeft: -10, color: 'var(--text-tertiary)', cursor: saving ? 'default' : 'pointer' }}
        >
          {tr['conductor.offer.decline']}
        </button>
      )}
    </div>
  )
}
