// Folio's page with the app's real styles (index.css and folio.css), for the
// automated accessibility acceptance (build plan step 6): axe on rendered
// pixels in light, dark and shore, and the six scripted keyboard tasks of
// draft 4 §3.10. The markup mirrors FolioApp and FolioPageView; the editor,
// its node views, controls and strings are the real ones. Served by Vite in
// dev; never built or shipped.
import '../../src/index.css'
import '../../src/folio/folio.css'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { folioExtensions, setOrnaments } from '../../src/folio/page/folioCore'
import { getFoldView } from '../../src/folio/page/foldView'
import { undersideControls } from '../../src/folio/page/undersideControls'
import { UNDERSIDE } from '../../src/folio/page/schema'
import { folioStringsFrom } from '../../src/folio/folioStrings'
import { folioEnglish } from '../../src/i18n/translations/folio/copy'
import type { TranslationStrings } from '../../src/i18n/translations/en'

const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const presentation = params.get('presentation') ?? 'normal'
document.documentElement.dataset.theme = theme

const t = folioEnglish as unknown as TranslationStrings
const strings = folioStringsFrom(t)

const app = document.getElementById('app') as HTMLElement
app.innerHTML = `
  <div class="folio-root"${presentation === 'shore' ? ' data-shore="true"' : ''}${presentation === 'quiet' ? ' data-quiet="true"' : ''}${presentation !== 'normal' ? ' data-reduce-motion="true"' : ''}>
    <header class="folio-topbar">
      <div class="folio-topbar__group"><button type="button" class="folio-button">${t['folio.pages']}</button></div>
      <div class="folio-topbar__group">
        <button type="button" class="folio-button">${t['folio.sessions']}</button>
        <button type="button" class="folio-button" aria-haspopup="menu" aria-expanded="false">•••<span class="folio-visually-hidden">${t['folio.menu']}</span></button>
      </div>
    </header>
    <main class="folio-main">
      <h1 class="folio-visually-hidden">Folio</h1>
      ${presentation === 'shore' ? `
      <section class="folio-shore-line" aria-live="polite">
        <div>${t['folio.shore.line']}</div>
        <div class="folio-shore-line__actions">
          <button type="button" class="folio-button">${t['folio.shore.talk']}</button>
          <button type="button" class="folio-button">${t['folio.shore.help']}</button>
          <button type="button" class="folio-button">${t['folio.shore.okay']}</button>
        </div>
      </section>` : ''}
      <div class="folio-page">
        <div id="editor"></div>
        <div class="folio-status">${t['folio.saved']}</div>
        <div id="notice"></div>
      </div>
    </main>
    <div class="folio-visually-hidden" aria-live="polite" role="status" id="announcer"></div>
  </div>`

const element = document.getElementById('editor') as HTMLElement
const announcer = document.getElementById('announcer') as HTMLElement
const notice = document.getElementById('notice') as HTMLElement
const announcements: string[] = []
const announce = (m: string) => { announcements.push(m); announcer.textContent = m }

const controls = undersideControls({
  labels: () => ({
    close: t['folio.close'], unlift: t['folio.unlift'], closer: t['folio.closer'], farther: t['folio.farther'],
    looseTitle: t['folio.loose.title'], looseKeep: t['folio.loose.keep'], looseToPage: t['folio.loose.toPage'], looseRemove: t['folio.loose.remove'],
  }),
  switches: () => ({ between: true, distance: true }),
  onAnnounce: announce,
  announceGap: (dir, gap) => (dir > 0 ? strings.farther(gap) : strings.closer(gap)),
  closerBlocked: () => strings.closerBlocked,
  unlifted: () => strings.unlifted,
  looseAcknowledged: new Set(),
})

// The protection notice, as FolioPageView renders it.
function showProtected() {
  notice.innerHTML = `<div class="folio-notice" role="status"><span>${t['folio.protected']}</span>
    <button type="button" class="folio-button">${t['folio.removeToo']}</button>
    <button type="button" class="folio-button">${t['folio.undo']}</button>
    <button type="button" class="folio-button" aria-label="${t['folio.cancel']}">×</button></div>`
}

function make(content: JSONContent): Editor {
  const ed = new Editor({
    element,
    extensions: folioExtensions({
      strings: () => strings,
      onAnnounce: announce,
      onProtected: () => showProtected(),
      label: t['folio.pageLabel'],
      switches: () => ({ between: true, distance: true }),
      locale: () => 'en',
      controls,
    }),
    content,
    editorProps: { attributes: { class: 'folio-editor', spellcheck: 'true' } },
  })
  setOrnaments(ed, { ink: presentation === 'normal', settle: presentation === 'normal' })
  return ed
}

let editor = make({ type: 'doc', content: [{ type: 'paragraph' }] })

const api = {
  load(content: JSONContent) {
    editor.destroy()
    element.innerHTML = ''
    notice.innerHTML = ''
    announcements.length = 0
    editor = make(content)
    editor.view.focus()
  },
  focusEnd() {
    editor.view.focus()
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
  },
  openIds: () => [...getFoldView(editor.state).open],
  topLevel(): string[] {
    const out: string[] = []
    editor.state.doc.forEach((n) => out.push(n.type.name === 'paragraph' ? `p:${n.textContent}` : `u:${n.attrs.foldId}:${n.attrs.gap}${n.attrs.loose ? ':loose' : ''}`))
    return out
  },
  undersides(): { foldId: string; between: string | null; beneath: string }[] {
    const out: { foldId: string; between: string | null; beneath: string }[] = []
    editor.state.doc.forEach((n) => {
      if (n.type.name !== UNDERSIDE) return
      let between: string | null = null
      let beneath = ''
      n.forEach((c) => { if (c.type.name === 'between') between = c.textContent; else beneath = c.textContent })
      out.push({ foldId: String(n.attrs.foldId), between, beneath })
    })
    return out
  },
  editorFocused: () => editor.view.hasFocus(),
  /** 'all', 'text', 'node' or 'caret', and its range. */
  selection(): string {
    const sel = editor.state.selection
    const kind = sel instanceof AllSelection ? 'all' : sel instanceof NodeSelection ? 'node' : sel.empty ? 'caret' : 'text'
    return `${kind}:${sel.from}-${sel.to}`
  },
  /** The text of the paragraph holding the caret, and where it sits. */
  caretLine(): string {
    const $c = editor.state.selection.$from
    const where = $c.depth > 1 ? $c.node(2).type.name : 'page'
    return `${where}:${$c.parent.textContent}`
  },
  announcements: () => [...announcements],
}

;(window as unknown as { folio: typeof api }).folio = api
document.body.dataset.ready = 'true'
