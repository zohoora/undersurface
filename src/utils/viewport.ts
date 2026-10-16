// Pinch zoom on the web (WCAG 1.4.4, resize text; owner decision,
// folio-build-plan §8.G). index.html ships the native app's locked viewport
// (`maximum-scale=1.0, user-scalable=no`), and the web build relaxes it at
// boot: every limit goes, except that iPhone and iPad keep `maximum-scale=1`.
// Safari ignores that for pinch, but it stops Safari zooming into a focused
// text field smaller than 16px. Native builds keep the lock until the app ships.

type NavigatorLike = Pick<Navigator, 'userAgent' | 'maxTouchPoints'>

/** iPhone, iPad, or an iPad asking for desktop sites (a Mac user agent with touch). */
export function isAppleTouch(nav: NavigatorLike): boolean {
  if (/\b(?:iPhone|iPad|iPod)\b/.test(nav.userAgent)) return true
  return /\bMacintosh\b/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1
}

/** The web's viewport content, from index.html's. */
export function webViewportContent(content: string, appleTouch: boolean): string {
  const parts = content
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:maximum-scale|user-scalable)\s*=/i.test(part))
  if (appleTouch) parts.push('maximum-scale=1.0')
  return parts.join(', ')
}

export function applyWebViewport(doc: Document = document, nav: NavigatorLike = navigator): void {
  const meta = doc.querySelector('meta[name="viewport"]')
  const content = meta?.getAttribute('content')
  if (!meta || !content) return
  meta.setAttribute('content', webViewportContent(content, isAppleTouch(nav)))
}
