// The native app's viewport meta blocks pinch zoom (index.html), and the web
// keeps `maximum-scale=1` on iPhone and iPad (src/utils/viewport.ts). Folio
// allows zoom fully while it's open (WCAG 1.4.4, resize text) and restores the
// meta on leaving.
// Folio's editor text is 19 px, so iOS never zooms on focus.

/** The viewport content without `maximum-scale` and `user-scalable`. */
export function allowZoom(content: string): string {
  return content
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !/^(maximum-scale|user-scalable)\s*=/i.test(part))
    .join(', ')
}

/** Allow zoom now; the returned function puts the original meta back. */
export function allowZoomWhileOpen(doc: Document = document): () => void {
  const meta = doc.querySelector('meta[name="viewport"]')
  if (!meta) return () => {}
  const before = meta.getAttribute('content') ?? ''
  meta.setAttribute('content', allowZoom(before))
  return () => meta.setAttribute('content', before)
}
