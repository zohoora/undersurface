import { useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { useTranslation, getLanguageCode } from '../../i18n'
import type { FolioTrace } from '../../types/folio'
import { folioExtensions } from '../page/folioCore'
import { foldViewKey } from '../page/foldView'
import type { FoldViewMeta } from '../page/foldView'
import { undersideControls } from '../page/undersideControls'
import { UNDERSIDE, newId } from '../page/schema'
import { folioStringsFrom } from '../folioStrings'
import { snapshotFold } from './keep'
import type { Composition } from './keep'
import type { Kept } from './useKept'

// Make a corrected copy (draft 4 §3.7, build plan §3.5): the kept composition
// opens in an editor; saving creates a new trace marked "Corrected from
// ‹date›" (correctedFromId). The original stays unless the writer deletes it.

const FOLD_ID = 'correction'

function asDoc(c: Composition, surface: string): JSONContent {
  const fold = { type: 'fold', attrs: { foldId: FOLD_ID } }
  const line = c.line.map((n) => (n.type === 'text' ? { ...n, marks: [...(n.marks ?? []), fold] } : n))
  const para = (p: JSONContent): JSONContent => ({ ...p, attrs: { pid: newId() } })
  const underside: JSONContent = {
    type: UNDERSIDE,
    attrs: { foldId: FOLD_ID, gap: c.gap, loose: false, surfaceSnapshot: surface },
    content: [
      ...(c.between ? [{ type: 'between', content: c.between.map(para) }] : []),
      { type: 'beneath', content: (c.beneath.length > 0 ? c.beneath : [{ type: 'paragraph' }]).map(para) },
    ],
  }
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: newId() }, content: line }, underside] }
}

export function CorrectedCopy({ original, composition, kept, onDone }: {
  uid: string
  original: FolioTrace
  composition: Composition
  kept: Kept
  onDone: (copyId: string | null) => void
}) {
  const tr = useTranslation()
  const strings = useMemo(() => folioStringsFrom(tr), [tr])
  const [saving, setSaving] = useState(false)
  const announceRef = useRef<(m: string) => void>(() => {})

  // eslint-disable-next-line react-hooks/refs
  const controls = useMemo(() => undersideControls({
    labels: () => ({
      close: tr['folio.close'], unlift: tr['folio.unlift'], closer: tr['folio.closer'], farther: tr['folio.farther'],
      looseTitle: tr['folio.loose.title'], looseKeep: tr['folio.loose.keep'], looseToPage: tr['folio.loose.toPage'], looseRemove: tr['folio.loose.remove'],
    }),
    switches: () => ({ between: true, distance: true }),
    onAnnounce: (m) => announceRef.current(m),
    announceGap: (dir, gap) => (dir > 0 ? strings.farther(gap) : strings.closer(gap)),
    closerBlocked: () => strings.closerBlocked,
    unlifted: () => strings.unlifted,
    looseAcknowledged: new Set(),
  }), [tr, strings])

  const editor = useEditor({
    extensions: folioExtensions({
      strings: () => strings,
      label: tr['folio.correctedCopy'],
      switches: () => ({ between: true, distance: true }),
      locale: () => getLanguageCode(),
      controls,
    }),
    content: asDoc(composition, original.surface),
    editorProps: { attributes: { class: 'folio-editor', spellcheck: 'true' } },
    immediatelyRender: true,
    onCreate: ({ editor: ed }) => {
      ed.view.dispatch(ed.state.tr.setMeta(foldViewKey, { type: 'open', ids: [FOLD_ID] } satisfies FoldViewMeta).setMeta('addToHistory', false))
    },
  }, [controls])

  const save = async () => {
    if (!editor || saving) return
    const snapshot = snapshotFold(editor.state.doc, FOLD_ID)
    // Nothing left to keep (the line or every passage was emptied): stay here.
    if (!snapshot || snapshot.empty || snapshot.surface.trim() === '') return
    setSaving(true)
    const copy = await kept.keepCorrection(original, snapshot)
    onDone(copy.id)
  }

  return (
    <div className="folio-correction">
      <div className="folio-page folio-correction__page">
        <EditorContent editor={editor} />
      </div>
      <div className="folio-trace__actions">
        <button type="button" className="folio-button" onClick={() => onDone(null)}>{tr['folio.cancel']}</button>
        <button type="button" className="folio-button folio-button--strong" disabled={saving} onClick={() => void save()}>{tr['folio.correctedCopy.save']}</button>
      </div>
    </div>
  )
}
