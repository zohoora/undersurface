import { t } from '../../i18n'

export type SessionSurface = 'talk' | 'journal' | 'speak'

interface Props {
  activeSurface: SessionSurface
  realTalkOn: boolean
  onSurfaceChange: (surface: SessionSurface) => void
  onRealTalkToggle: (next: boolean) => void
}

export function SessionBottomBar({ activeSurface, realTalkOn, onSurfaceChange, onRealTalkToggle }: Props) {
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
          disabled
          title={t('session.bottomBar.journalDisabled')}
        >
          {t('session.bottomBar.journal')}
        </button>
        <button
          type="button"
          className="session-bottom-bar__pill"
          aria-pressed={activeSurface === 'speak'}
          disabled
          title={t('session.bottomBar.speakDisabled')}
        >
          {t('session.bottomBar.speak')}
        </button>
      </div>
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
  )
}

export default SessionBottomBar
