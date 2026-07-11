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
  memoryApertureLocked?: boolean
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
  memoryApertureLocked = false,
  onMemoryApertureChange,
}: Props) {
  const handleSurfaceClick = (surface: SessionSurface) => {
    if (surface === activeSurface) return
    onSurfaceChange(surface)
  }

  return (
    <div className="session-bottom-bar" role="toolbar" aria-label="Session controls">
      <div className="session-bottom-bar__surfaces" aria-label={t('session.bottomBar.surfaces')}>
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
            className="session-bottom-bar__pill session-bottom-bar__optional-surface session-bottom-bar__relax"
            aria-pressed={activeSurface === 'relax'}
            onClick={() => handleSurfaceClick('relax')}
          >
            {t('session.bottomBar.relax')}
          </button>
        )}
        {showDriftSurface === true && (
          <button
            type="button"
            className="session-bottom-bar__pill session-bottom-bar__optional-surface session-bottom-bar__drift"
            aria-pressed={activeSurface === 'drift'}
            onClick={() => handleSurfaceClick('drift')}
          >
            {t('session.bottomBar.drift')}
          </button>
        )}
      </div>
      <details className="session-options">
        <summary className="session-bottom-bar__options" aria-label={t('session.bottomBar.options')}>
          <span className="session-options-desktop">•••</span>
          <span className="session-options-mobile">{t('session.bottomBar.more')}</span>
        </summary>
        <div className="session-options-menu" role="menu" aria-label={t('session.bottomBar.options')}>
          <div className="session-options-menu__surfaces">
            {showRelaxSurface && (
              <button type="button" aria-pressed={activeSurface === 'relax'} onClick={() => handleSurfaceClick('relax')}>
                {t('session.bottomBar.relax')}
              </button>
            )}
            {showDriftSurface === true && (
              <button className="session-options-menu__drift" type="button" aria-pressed={activeSurface === 'drift'} onClick={() => handleSurfaceClick('drift')}>
                {t('session.bottomBar.drift')}
              </button>
            )}
          </div>
          {onMemoryApertureChange && (
          <button
            type="button"
            role="switch"
            className="session-bottom-bar__fresh-eyes"
            aria-checked={memoryAperture === 'fresh'}
            aria-label={`${t('session.bottomBar.freshEyes')} — ${t('session.bottomBar.freshEyesExplainer')}`}
            title={t('session.bottomBar.freshEyesExplainer')}
            disabled={memoryApertureLocked}
            onClick={() => onMemoryApertureChange(memoryAperture === 'fresh' ? 'pattern' : 'fresh')}
          >
            <span>◌ {t('session.bottomBar.freshEyes')}</span>
            <span className="session-option-state">{memoryAperture === 'fresh' ? t('common.on') : t('common.off')}</span>
          </button>
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
            <span>◉ {t('session.bottomBar.parts')}</span>
            <span className="session-option-state">{journalPartsOn ? t('common.on') : t('common.off')}</span>
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
          <span>◇ {t('session.bottomBar.realTalk')}</span>
          <span className="session-option-state">{realTalkOn ? t('common.on') : t('common.off')}</span>
        </button>
      </div>
      </details>
    </div>
  )
}

export default SessionBottomBar
