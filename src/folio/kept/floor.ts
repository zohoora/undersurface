import type { FolioTrace } from '../../types/folio'

// The floor (draft 4 §3.7): traces stacked like sediment, newest at the top.
// Versions (kept again) and corrected copies sit together: each group shows
// its newest trace, with the earlier ones beneath it. No counts anywhere.

export interface FloorGroup {
  head: FolioTrace
  /** Earlier traces in the same lineage, newest first. */
  earlier: FolioTrace[]
}

function parentOf(t: FolioTrace): string | undefined {
  return t.correctedFromId ?? t.previousTraceId
}

export function floorGroups(traces: FolioTrace[]): FloorGroup[] {
  const byId = new Map(traces.map((t) => [t.id, t]))
  const rootOf = (t: FolioTrace): string => {
    let cur = t
    const path = [cur.id]
    for (let p = parentOf(cur); p && byId.has(p); p = parentOf(cur)) {
      const loop = path.indexOf(p)
      // A cycle can't come from the app (ids are new and links point back),
      // but if one exists its smallest id stands for it, from any entry.
      if (loop >= 0) return [...path.slice(loop)].sort()[0]
      cur = byId.get(p) as FolioTrace
      path.push(cur.id)
    }
    return cur.id
  }
  const groups = new Map<string, FolioTrace[]>()
  for (const t of traces) {
    const root = rootOf(t)
    const list = groups.get(root)
    if (list) list.push(t)
    else groups.set(root, [t])
  }
  return [...groups.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => b.keptAt - a.keptAt)
      return { head: sorted[0], earlier: sorted.slice(1) }
    })
    .sort((a, b) => b.head.keptAt - a.head.keptAt)
}

/** The other traces in this trace's lineage, newest first. */
export function lineageOf(trace: FolioTrace, traces: FolioTrace[]): FolioTrace[] {
  const group = floorGroups(traces).find((g) => g.head.id === trace.id || g.earlier.some((t) => t.id === trace.id))
  if (!group) return []
  return [group.head, ...group.earlier].filter((t) => t.id !== trace.id)
}
