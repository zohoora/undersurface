// Per-device view state for a page (draft 4 §3.5): which folds are open, the
// scroll position and the caret. Never part of the document, never saved to
// the account, cleared on sign-out (clearFolioLocalForUser).

export interface PageViewState {
  open: string[]
  scroll: number
  caret: number
}

const key = (uid: string, pageId: string) => `us.folioView.${uid}.${pageId}`

export function readViewState(uid: string, pageId: string): PageViewState | null {
  try {
    const raw = localStorage.getItem(key(uid, pageId))
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<PageViewState>
    return {
      open: Array.isArray(v.open) ? v.open.filter((x): x is string => typeof x === 'string') : [],
      scroll: typeof v.scroll === 'number' ? v.scroll : 0,
      caret: typeof v.caret === 'number' ? v.caret : 0,
    }
  } catch {
    return null
  }
}

export function writeViewState(uid: string, pageId: string, state: PageViewState): void {
  try {
    localStorage.setItem(key(uid, pageId), JSON.stringify(state))
  } catch {
    // view state is a convenience
  }
}
