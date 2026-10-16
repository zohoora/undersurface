import { useEffect, useMemo, useState } from 'react'
import { getLanguageCode, useTranslation } from '../../i18n'
import type { FolioTrace } from '../../types/folio'
import { shortDate } from './dates'
import { floorGroups } from './floor'
import { traceName } from './keep'
import { subscribeEntries } from './traceStore'
import type { Kept } from './useKept'

// The floor (draft 4 §3.7): newest at the top, so scrolling down goes back in
// time. Each trace shows its name, its date and its come-back date; it grows
// thicker with each later entry (returns, never mood or length). A quiet
// "Waiting" group holds come-backs that are due but held by Recent (§5.5).
// No counts, totals or streaks.

const MAX_THICKNESS = 8

function useEntryThickness(uid: string, ids: string[]): Map<string, number> {
  const [counts, setCounts] = useState(() => new Map<string, number>())
  const key = ids.join(',')
  useEffect(() => {
    const unsubs = key.split(',').filter(Boolean).map((id) => subscribeEntries(uid, id, (entries) => {
      setCounts((prev) => (prev.get(id) === entries.length ? prev : new Map(prev).set(id, entries.length)))
    }))
    return () => { for (const u of unsubs) u() }
  }, [uid, key])
  return counts
}

export function KeptView({ uid, kept, onOpen }: { uid: string; kept: Kept; onOpen: (traceId: string) => void }) {
  const tr = useTranslation()
  const lang = getLanguageCode()
  const groups = useMemo(() => floorGroups(kept.traces), [kept.traces])
  const thickness = useEntryThickness(uid, groups.map((g) => g.head.id))

  // Opening the floor sweeps every trace's unchecked units (§5.4).
  const { traces, safety } = kept
  useEffect(() => {
    for (const t of traces) safety.sweep(t, [])
  }, [traces, safety])

  const date = (ms: number) => shortDate(ms, lang, kept.tz)
  const row = (t: FolioTrace, earlier = false) => (
    <li key={t.id} className={earlier ? 'folio-floor__earlier' : 'folio-floor__trace'} style={earlier ? undefined : { borderBottomWidth: 1 + Math.min(thickness.get(t.id) ?? 0, MAX_THICKNESS) }}>
      <button type="button" className="folio-floor__open" onClick={() => onOpen(t.id)}>
        <span className="folio-floor__name">{traceName(t)}</span>
        <span className="folio-floor__meta">
          {tr['folio.keptOn'].replace('{date}', date(t.keptAt))}
          {typeof t.comeBackAt === 'number' && <> · {tr['folio.comeBack.on'].replace('{date}', date(t.comeBackAt))}</>}
          {t.keptBy === 'companion' && <> · {tr['folio.companion.keptBy']}</>}
        </span>
      </button>
    </li>
  )

  return (
    <section className="folio-floor">
      <h1>{tr['folio.kept.title']}</h1>
      <p className="folio-floor__promise">{tr['folio.keptPromise']}</p>

      {kept.waiting.length > 0 && (
        <section className="folio-floor__waiting" aria-labelledby="folio-waiting">
          <h2 id="folio-waiting">{tr['folio.comeBack.waiting']}</h2>
          <ul>
            {kept.waiting.map((t) => (
              <li key={t.id}>
                <span className="folio-floor__name">{traceName(t)}</span>
                <button type="button" className="folio-button" onClick={() => { kept.clearComeBack(t.id); onOpen(t.id) }}>{tr['folio.open']}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {kept.loaded && groups.length === 0 && <p className="folio-line">{tr['folio.kept.empty']}</p>}
      <ul className="folio-floor__list">
        {groups.map((g) => (
          <li key={g.head.id} className="folio-floor__group">
            <ul>{row(g.head)}</ul>
            {g.earlier.length > 0 && (
              <ul className="folio-floor__lineage" aria-label={tr['folio.versions']}>
                {g.earlier.map((t) => row(t, true))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
