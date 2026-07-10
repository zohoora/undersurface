import { t } from '../../i18n'
import type { MemoryAperture } from '../../types'

export type SessionSurface = 'talk' | 'journal' | 'speak' | 'relax' | 'drift'

interface Props {
  activeSurface: SessionSurface
  realTalkOn: boolean
  journalPartsOn: boolean
  // When the corresponding admin feature flag is off, hide the surface/toggle
  // entirely rather than showing a no-op control.
  showJournalPartsToggle: boolean
  showSpeakSurface: boolean
  showRelaxSurface: boolean
  // Drift's own first-class entry (v2, 2026-07-09 — no longer inside Relax).
  // The caller also folds grounding in: the entry hides while grounding is active.
  showDriftSurface?: boolean
  onSurfaceChange: (surface: SessionSurface) => void
  onRealTalkToggle: (next: boolean) => void
  onJournalPartsToggle: (next: boolean) => void
  memoryAperture?: MemoryAperture
  onMemoryApertureChange?: (next: MemoryAperture) => void
}

export function SessionBottomBar({
  activeSurface,
  realTalkOn,
  journalPartsOn,
  showJournalPartsToggle,
  showSpeakSurface,
  showRelaxSurface,
  showDriftSurface,
  onSurfaceChange,
  onRealTalkToggle,
  onJournalPartsToggle,
  memoryAperture = 'pattern',
  onMemoryApertureChange,
}: Props) {
  const handleSurfaceClick = (surface: SessionSurface) => {
    if (surface === activeSurface) return
    onSurfaceChange(surface)
  }

  return (
    <div className="session-bottom-bar" role="toolbar" aria-label="Session controls">
      <div className="session-bottom-bar__surfaces">
        <button
          type="button"
          className="session-bottom-bar__pill"
          aria-pressed={activeSurface === 'talk'}
          onClick={() => handleSurfaceClick('talk')}
        >
          {t('session.bottomBar.talk')}
        </button>
        <button
          type="button"
          className="session-bottom-bar__pill"
          aria-pressed={activeSurface === 'journal'}
          onClick={() => handleSurfaceClick('journal')}
        >
          {t('session.bottomBar.journal')}
        </button>
        {showSpeakSurface && (
          <button
            type="button"
            className="session-bottom-bar__pill"
            aria-pressed={activeSurface === 'speak'}
            onClick={() => handleSurfaceClick('speak')}
          >
            {t('session.bottomBar.speak')}
          </button>
        )}
        {showRelaxSurface && (
          <button
            type="button"
            className="session-bottom-bar__pill"
            aria-pressed={activeSurface === 'relax'}
            onClick={() => handleSurfaceClick('relax')}
          >
            {t('session.bottomBar.relax')}
          </button>
        )}
        {showDriftSurface === true && (
          <button
            type="button"
            className="session-bottom-bar__pill"
            aria-pressed={activeSurface === 'drift'}
            onClick={() => handleSurfaceClick('drift')}
          >
            {t('session.bottomBar.drift')}
          </button>
        )}
      </div>
      <div className="session-bottom-bar__toggles">
        {onMemoryApertureChange && (
          <select
            aria-label="Memory aperture"
            title="How much past context the companion may use in this session"
            value={memoryAperture}
            onChange={event => onMemoryApertureChange(event.target.value as MemoryAperture)}
            style={{ border: 0, background: 'transparent', color: 'var(--text-secondary)', fontSize: 10, cursor: 'pointer' }}
          >
            <option value="fresh">fresh eyes</option>
            <option value="light">light memory</option>
            <option value="pattern">patterns</option>
            <option value="counterstory">counterstory</option>
          </select>
        )}
        {activeSurface === 'journal' && showJournalPartsToggle && (
          <button
            type="button"
            role="switch"
            className="session-bottom-bar__parts"
            aria-checked={journalPartsOn}
            aria-label={t('session.bottomBar.parts')}
            onClick={() => onJournalPartsToggle(!journalPartsOn)}
          >
            ◉ {t('session.bottomBar.parts')}
          </button>
        )}
        <button
          type="button"
          role="switch"
          className="session-bottom-bar__realtalk"
          aria-checked={realTalkOn}
          aria-label={`${t('session.bottomBar.realTalk')} — ${t('session.bottomBar.realTalkExplainer')}`}
          title={t('session.bottomBar.realTalkExplainer')}
          onClick={() => onRealTalkToggle(!realTalkOn)}
        >
          ◇ {t('session.bottomBar.realTalk')}
        </button>
      </div>
    </div>
  )
}

export default SessionBottomBar
