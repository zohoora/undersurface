import { useState } from 'react'
import { markResearchOverridden } from '../../store/personalScience'
import { useTranslation } from '../../i18n'

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

  return (
    <div style={{ marginTop: 9, font: "10px/1.45 'Inter', sans-serif", color: 'var(--text-tertiary)' }}>
      {declined ? (
        <span role="status">{tr['conductor.offer.declined']}</span>
      ) : (
        <button
          type="button"
          disabled={saving}
          onClick={() => { void decline() }}
          style={{ border: 0, background: 'transparent', padding: 0, color: 'var(--text-tertiary)', cursor: saving ? 'default' : 'pointer', font: 'inherit' }}
        >
          {tr['conductor.offer.decline']}
        </button>
      )}
    </div>
  )
}
