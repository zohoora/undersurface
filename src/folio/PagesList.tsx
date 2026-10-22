import { useEffect, useState } from 'react'
import { useTranslation, getLanguageCode } from '../i18n'
import { subscribePages } from './store'
import { listPendingForUser } from './save/pendingStore'
import type { FolioPage } from '../types/folio'

// All pages, newest first (draft 4 §3.4), with New page beside the title. Pages held only on this device
// (a conflict copy or a new page written offline) are listed too.

export function PagesList({ uid, onOpen, onNew }: { uid: string; onOpen: (pageId: string) => void; onNew: () => void }) {
  const tr = useTranslation()
  const [pages, setPages] = useState<FolioPage[] | null>(null)
  useEffect(() => subscribePages(uid, setPages, () => setPages([])), [uid])
  const local = listPendingForUser(uid).filter((e) => !(pages ?? []).some((p) => p.id === e.pageId))
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(getLanguageCode(), { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <section className="folio-list">
      {/* New page where the pages are (two fresh-eyes testers looked for it here). */}
      <div className="folio-list__head">
        <h1>{tr['folio.pages.title']}</h1>
        <button type="button" className="folio-button folio-button--strong" data-folio-new-page="" onClick={onNew}>{tr['folio.newPage']}</button>
      </div>
      {pages !== null && pages.length === 0 && local.length === 0 && <p>{tr['folio.pages.empty']}</p>}
      <ul>
        {local.map((e) => (
          <li key={`local-${e.pageId}`}>
            <button type="button" className="folio-list__open" onClick={() => onOpen(e.pageId)}>
              {e.preview.trim() || tr['folio.pages.emptyPage']}
              <span className="folio-list__date">{tr['folio.pages.onDevice']} · {fmt(e.updatedAt)}</span>
            </button>
          </li>
        ))}
        {(pages ?? []).map((p) => (
          <li key={p.id}>
            <button type="button" className="folio-list__open" onClick={() => onOpen(p.id)}>
              {p.preview.trim() || tr['folio.pages.emptyPage']}
              <span className="folio-list__date">{fmt(p.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
