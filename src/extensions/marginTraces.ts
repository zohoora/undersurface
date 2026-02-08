import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface Trace {
  pos: number
  color: string
}

export const marginTracesKey = new PluginKey('marginTraces')

export const MarginTraces = Extension.create({
  name: 'marginTraces',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: marginTracesKey,
        state: {
          init() {
            return [] as Trace[]
          },
          apply(tr, traces: Trace[]) {
            const meta = tr.getMeta(marginTracesKey)

            // Map existing positions through the transaction
            let mapped = traces
              .map((t) => ({ ...t, pos: tr.mapping.map(t.pos) }))
              .filter((t) => t.pos >= 0 && t.pos <= tr.doc.content.size)

            if (meta?.action === 'add') {
              mapped = [...mapped, { pos: meta.pos, color: meta.color }]
            }

            return mapped
          },
        },
        props: {
          decorations(state) {
            const traces: Trace[] = marginTracesKey.getState(state)
            if (!traces || traces.length === 0) return DecorationSet.empty

            const decos: Decoration[] = []

            for (const trace of traces) {
              try {
                const resolved = state.doc.resolve(trace.pos)
                const blockStart = resolved.start(resolved.depth)

                decos.push(
                  Decoration.widget(
                    blockStart,
                    () => {
                      const dot = document.createElement('span')
                      dot.className = 'margin-trace-dot'
                      dot.style.backgroundColor = trace.color
                      return dot
                    },
                    { side: -1, key: `trace-${trace.pos}-${trace.color}` },
                  ),
                )
              } catch {
                // Position became invalid, skip
              }
            }

            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
