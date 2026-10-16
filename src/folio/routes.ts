// Folio's routes (draft 4 §3.3). Unknown /folio paths go to /folio.

export type FolioRoute =
  | { kind: 'home' }
  | { kind: 'new' }
  | { kind: 'page'; pageId: string }
  | { kind: 'pages' }
  | { kind: 'kept' }
  | { kind: 'trace'; traceId: string }

export function parseFolioRoute(path: string): FolioRoute | null {
  if (path === '/folio' || path === '/folio/') return { kind: 'home' }
  if (path === '/folio/new') return { kind: 'new' }
  if (path === '/folio/pages') return { kind: 'pages' }
  if (path === '/folio/kept') return { kind: 'kept' }
  const k = path.match(/^\/folio\/kept\/([A-Za-z0-9_-]{4,64})$/)
  if (k) return { kind: 'trace', traceId: k[1] }
  const m = path.match(/^\/folio\/p\/([A-Za-z0-9_-]{4,64})$/)
  if (m) return { kind: 'page', pageId: m[1] }
  return null
}
