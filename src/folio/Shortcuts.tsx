import { useRef } from 'react'
import { useTranslation } from '../i18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { FOLIO_KEYS } from './page/keys'
import { keyLabel } from './page/keyLabels'

// Keyboard shortcuts (docs/vision/2026-10-22-folio-first-moment.md §3.9):
// every key of draft 4 §3.10, findable from the ••• menu without reading
// anything first.

export function Shortcuts({ onClose }: { onClose: () => void }) {
  const tr = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  useModalA11y(ref, onClose)
  const rows: [string, string][] = [
    [tr['folio.shortcuts.writeBeneath'], keyLabel(FOLIO_KEYS.liftOrToggle)],
    [tr['folio.shortcuts.foldAway'], keyLabel(FOLIO_KEYS.closeOrUnlift)],
    [tr['folio.shortcuts.apart'], `${keyLabel(FOLIO_KEYS.farther)} · ${keyLabel(FOLIO_KEYS.closer)}`],
    [tr['folio.shortcuts.nextFold'], `${keyLabel(FOLIO_KEYS.nextFold)} · ${keyLabel(FOLIO_KEYS.previousFold)}`],
    [tr['folio.shortcuts.sitWithIt'], keyLabel(FOLIO_KEYS.stepInside)],
    [tr['folio.shortcuts.marked'], keyLabel('Mod-Alt-L')],
  ]
  return (
    <div className="folio-dialog__backdrop folio-shortcuts-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className="folio-dialog folio-shortcuts" role="dialog" aria-modal="true" aria-label={tr['folio.shortcuts']} tabIndex={-1}>
        <h2 className="folio-shortcuts__title">{tr['folio.shortcuts']}</h2>
        <dl className="folio-shortcuts__list">
          {rows.map(([what, keys]) => (
            <div key={what} className="folio-shortcuts__row">
              <dt>{what}</dt>
              <dd><kbd>{keys}</kbd></dd>
            </div>
          ))}
        </dl>
        <div className="folio-dialog__actions">
          <button type="button" className="folio-button folio-button--strong" onClick={onClose}>{tr['folio.shortcuts.close']}</button>
        </div>
      </div>
    </div>
  )
}
