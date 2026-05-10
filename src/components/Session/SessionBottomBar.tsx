import { t } from '../../i18n'

export type SessionSurface = 'talk' | 'journal' | 'speak' | 'relax'

interface Props {
  activeSurface: SessionSurface
  realTalkOn: boolean
  journalPartsOn: boolean
  // When the corresponding admin feature flag is off, hide the surface/toggle
  // entirely rather than showing a no-op control.
  showJournalPartsToggle: boolean
  showSpeakSurface: boolean
  showRelaxSurface: boolean
  onSurfaceChange: (surface: SessionSurface) => void
  onRealTalkToggle: (next: boolean) => void
  onJournalPartsToggle: (next: boolean) => void
}

export function SessionBottomBar({
  activeSurface,
  realTalkOn,
  journalPartsOn,
  showJournalPartsToggle,
  showSpeakSurface,
  showRelaxSurface,
  onSurfaceChange,
  onRealTalkToggle,
  onJournalPartsToggle,
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
      </div>
      <div className="session-bottom-bar__toggles">
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
          aria-label={t('session.bottomBar.realTalk')}
          onClick={() => onRealTalkToggle(!realTalkOn)}
        >
          ◇ {t('session.bottomBar.realTalk')}
        </button>
      </div>
    </div>
  )
}

export default SessionBottomBar
