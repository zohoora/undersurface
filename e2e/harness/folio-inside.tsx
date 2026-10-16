// Step inside (H1) with the real editor, hook, dialog and the app's CSS, for
// the keyboard-only Playwright check (build plan §4). Served by Vite in dev;
// never built or shipped.
import '../../src/index.css'
import '../../src/folio/folio.css'
import React, { useEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { folioExtensions } from '../../src/folio/page/folioCore'
import { foldViewKey } from '../../src/folio/page/foldView'
import { undersideControls } from '../../src/folio/page/undersideControls'
import { folioStringsFrom } from '../../src/folio/folioStrings'
import { folioEnglish } from '../../src/i18n/translations/folio/copy'
import type { TranslationStrings } from '../../src/i18n/translations/en'
import { ShorePresentation } from '../../src/folio/safety/shorePresentation'
import { useStepInside } from '../../src/folio/inside/useStepInside'
import { StepInside } from '../../src/folio/inside/StepInside'

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const t = folioEnglish as unknown as TranslationStrings
const strings = folioStringsFrom(t)
const shore = new ShorePresentation({ lastActivationAt: null })
const leaves: string[] = []

const p = (text: string, pid: string, fold?: string): JSONContent => ({ type: 'paragraph', attrs: { pid }, content: [{ type: 'text', text, ...(fold ? { marks: [{ type: 'fold', attrs: { foldId: fold } }] } : {}) }] })
const DOC: JSONContent = { type: 'doc', content: [
  p('Before.', 'a'),
  p('It was nice to see everyone.', 'b', 'f1'),
  { type: 'underside', attrs: { foldId: 'f1', gap: 2 }, content: [
    { type: 'between', content: [p('The drive home.', 'c')] },
    { type: 'beneath', content: [p('I felt absent the whole time.', 'd')] },
  ] },
  p('After.', 'e'),
] }

export function App() {
  const openRef = useRef<(id: string) => void>(() => {})
  // As in FolioPageView: these callbacks read the ref only when called.
  // eslint-disable-next-line react-hooks/refs
  const controls = useMemo(() => undersideControls({
    labels: () => ({ close: t['folio.close'], unlift: t['folio.unlift'], closer: t['folio.closer'], farther: t['folio.farther'], looseTitle: '', looseKeep: '', looseToPage: '', looseRemove: '', stepInside: t['folio.stepInside'] }),
    switches: () => ({ between: true, distance: true }),
    looseAcknowledged: new Set(),
    onStepInside: (id) => openRef.current(id),
  }), [])
  const editor = useEditor({
    // eslint-disable-next-line react-hooks/refs
    extensions: folioExtensions({ strings: () => strings, label: t['folio.pageLabel'], controls, onStepInside: (id) => openRef.current(id) }),
    content: DOC,
    onCreate: ({ editor: ed }) => { ed.view.dispatch(ed.state.tr.setMeta(foldViewKey, { type: 'open', ids: ['f1'] }).setMeta('addToHistory', false)) },
    immediatelyRender: true,
  }, [controls])
  const { inside, open, leave } = useStepInside({ editor, shore, enabled: true, reduceMotion: false, strings: () => strings })
  useEffect(() => { openRef.current = open }, [open])
  useEffect(() => { (window as unknown as { folio: unknown }).folio = {
    selection: () => (editor ? { from: editor.state.selection.from, to: editor.state.selection.to, where: editor.state.selection.$from.depth > 1 ? editor.state.selection.$from.node(2).type.name : 'page' } : null),
    setSelection: (from: number, to: number) => { editor?.commands.setTextSelection({ from, to }); editor?.view.focus() },
    posOf: (needle: string) => { let found = -1; editor?.state.doc.descendants((n, pos) => { if (found < 0 && n.isText && n.text?.includes(needle)) found = pos + n.text.indexOf(needle); return found < 0 }); return found },
    beneathText: () => { let out = ''; editor?.state.doc.forEach((n) => { if (n.type.name === 'underside') out = n.lastChild?.textContent ?? '' }); return out },
    leaves: () => [...leaves],
    shore: () => shore.groundingChanged(true),
    editorFocused: () => editor?.view.hasFocus() ?? false,
  } }, [editor])
  return (
    <div className="folio-root">
      <main>
        <h1 className="folio-visually-hidden">Folio</h1>
        <div className="folio-page"><EditorContent editor={editor} /></div>
      </main>
      {inside && (
        <StepInside uid="harness" composition={inside.composition} line={inside.line} undersideLabel={inside.label} soundAvailable={params.get('sound') === '1'} reduceMotion={false}
          onLeave={(mode) => { leaves.push(mode); leave(mode) }} />
      )}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<React.StrictMode><App /></React.StrictMode>)
document.body.dataset.ready = 'true'
