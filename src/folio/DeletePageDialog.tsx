import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../i18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { tracesFromPage } from './kept/traceStore'

// Deleting a page (draft 4 §3.7). With kept things from it, the dialog says
// how many and offers two choices: the page only (kept things are copies and
// stay), or the page and what was kept from it.

export function DeletePageDialog({ uid, pageId, onDelete, onCancel }: {
  uid: string
  pageId: string
  onDelete: (withTraces: string[] | null) => void
  onCancel: () => void
}) {
  const tr = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [traceIds, setTraceIds] = useState<string[] | null>(null)
  useModalA11y(ref, onCancel)
  useEffect(() => {
    let live = true
    tracesFromPage(uid, pageId).then((t) => { if (live) setTraceIds(t.map((x) => x.id)) }).catch(() => { if (live) setTraceIds([]) })
    return () => { live = false }
  }, [uid, pageId])

  const n = traceIds?.length ?? 0
  return (
    <div className="folio-dialog__backdrop">
      <div ref={ref} className="folio-dialog" role="dialog" aria-modal="true" aria-label={tr['folio.deletePage']} tabIndex={-1}>
        <p>{tr['folio.deletePage.confirm']}</p>
        {n > 0 && <p>{tr['folio.deletePage.traces'].replace('{n}', String(n))}</p>}
        <div className="folio-dialog__actions">
          <button type="button" className="folio-button" onClick={onCancel}>{tr['folio.cancel']}</button>
          {n > 0 ? (
            <>
              <button type="button" className="folio-button folio-button--strong" onClick={() => onDelete(null)}>{tr['folio.deletePage.justPage']}</button>
              <button type="button" className="folio-button folio-button--strong" onClick={() => onDelete(traceIds)}>{tr['folio.deletePage.withTraces']}</button>
            </>
          ) : (
            <button type="button" className="folio-button folio-button--strong" disabled={traceIds === null} onClick={() => onDelete(null)}>{tr['folio.delete']}</button>
          )}
        </div>
      </div>
    </div>
  )
}
