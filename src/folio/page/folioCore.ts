import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { AnyExtension, Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { Beneath, Between, Fold, ParagraphId, Underside } from './schema'
import { foldViewPlugin, undersideNodeView } from './foldView'
import { integrityPlugin } from './integrity'
import { hiddenWritingPlugin, historyGuardPlugin, inputGuardPlugin } from './protect'
import type { ProtectOptions } from './protect'
import { ENGLISH_STRINGS } from './strings'
import { folioKeyHandlers } from './keys'
import { placeholderPlugin } from './placeholder'
import { InkWeight } from '../../extensions/inkWeight'
import { ParagraphSettle } from '../../extensions/paragraphSettle'
import { FolioDocument, notesPlugin } from '../ask/notes'
import type { NoteRender } from '../ask/notes'
import type { FolioStrings } from './strings'

// The Folio editor core: schema, the four C1 layers, integrity and the
// underside node view. Hosts (FolioPage, tests, the Playwright harness) build
// an editor with `folioExtensions(options)`.

export interface FolioCoreOptions {
  strings?: () => FolioStrings
  onAnnounce?: (message: string) => void
  onProtected?: (foldIds: string[]) => void
  onDiagnostic?: ProtectOptions['onDiagnostic']
  now?: () => number
  /** The page's accessible name (the editable region is a multi-line textbox). */
  label?: string
  /** The blank page's hint, shown while the page is one empty paragraph (absent: none). */
  placeholder?: string
  /** The admin switches that shape Apart (build plan §3.1). */
  switches?: () => { between: boolean; distance: boolean }
  onStepInside?: (foldId: string) => void
  /** H2: how companion notes are drawn beside their paragraphs (absent: not drawn). */
  notes?: () => NoteRender | null
  locale?: () => string | undefined
  /** Builds the open underside's controls (Close/Unlift, Closer, Farther, Keep). */
  controls?: (args: { view: EditorView; getPos: () => number | undefined; node: PMNode }) => HTMLElement | null
}

export function folioExtensions(options: FolioCoreOptions = {}): AnyExtension[] {
  const strings = options.strings ?? (() => ENGLISH_STRINGS)
  const protect: ProtectOptions = {
    strings,
    onAnnounce: options.onAnnounce,
    onProtected: options.onProtected,
    onDiagnostic: options.onDiagnostic,
    now: options.now,
  }

  const Core = Extension.create({
    name: 'folioCore',
    priority: 1000, // input guards run before the default keymaps
    addKeyboardShortcuts() {
      const handlers = folioKeyHandlers({
        strings,
        onAnnounce: options.onAnnounce,
        switches: options.switches ?? (() => ({ between: true, distance: true })),
        onStepInside: options.onStepInside,
        locale: options.locale,
      })
      return Object.fromEntries(Object.entries(handlers).map(([key, run]) => [key, () => run(this.editor.view)]))
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({ key: new PluginKey('folioA11y'), props: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': options.label ?? 'Page' } } }),
        inputGuardPlugin(protect),
        historyGuardPlugin(protect),
        foldViewPlugin({ strings, onAnnounce: options.onAnnounce }),
        integrityPlugin(),
        hiddenWritingPlugin(protect),
        notesPlugin(options.notes ?? (() => null)),
        placeholderPlugin(options.placeholder),
      ]
    },
  })

  const UndersideWithView = Underside.extend({
    addNodeView() {
      const factory = undersideNodeView({ strings, controls: options.controls })
      return ({ node, view, getPos, decorations }) => factory(node, view, getPos as () => number | undefined, decorations)
    },
  })

  return [
    StarterKit.configure({
      document: false,
      heading: false,
      codeBlock: false,
      code: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      horizontalRule: false,
      bold: false,
      strike: false,
      underline: false,
      link: false,
    }),
    FolioDocument,
    ParagraphId,
    Fold,
    UndersideWithView,
    Between,
    Beneath,
    InkWeight,
    ParagraphSettle.configure({ descend: true }),
    Core,
  ]
}

/**
 * Turn the Journal's ink weight and paragraph settle on or off. As in the
 * Journal, the extensions read `disabled` from their storage; an empty
 * transaction redraws the decorations.
 */
export function setOrnaments(editor: Editor, on: { ink: boolean; settle: boolean }): void {
  const ink = editor.storage.inkWeight
  const settle = editor.storage.paragraphSettle
  if (!ink || !settle) return
  if (ink.disabled === !on.ink && settle.disabled === !on.settle) return
  ink.disabled = !on.ink
  settle.disabled = !on.settle
  editor.view.dispatch(editor.state.tr)
}
