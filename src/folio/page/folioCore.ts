import { Extension } from '@tiptap/core'
import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { Beneath, Between, Fold, ParagraphId, Underside } from './schema'
import { foldViewPlugin, undersideNodeView } from './foldView'
import { integrityPlugin } from './integrity'
import { hiddenWritingPlugin, historyGuardPlugin, inputGuardPlugin } from './protect'
import type { ProtectOptions } from './protect'
import { ENGLISH_STRINGS } from './strings'
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
    addProseMirrorPlugins() {
      return [
        inputGuardPlugin(protect),
        historyGuardPlugin(protect),
        foldViewPlugin({ strings, onAnnounce: options.onAnnounce }),
        integrityPlugin(),
        hiddenWritingPlugin(protect),
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
    ParagraphId,
    Fold,
    UndersideWithView,
    Between,
    Beneath,
    Core,
  ]
}
