import type { JSONContent } from '@tiptap/core'
import { GAP_LINE_HEIGHTS } from '../page/schema'
import type { Composition } from './keep'

// A kept composition, read-only, exactly as it was kept: the line, the
// between at its distance, the beneath (draft 4 §3.7).

function Inline({ content }: { content: JSONContent[] | undefined }) {
  return (
    <>
      {(content ?? []).map((n, i) => {
        if (n.type === 'hardBreak') return <br key={i} />
        const text = n.text ?? ''
        return n.marks?.some((m) => m.type === 'italic') ? <em key={i}>{text}</em> : <span key={i}>{text}</span>
      })}
    </>
  )
}

function Paragraphs({ paragraphs }: { paragraphs: JSONContent[] }) {
  return <>{paragraphs.map((p, i) => <p key={i}><Inline content={p.content} /></p>)}</>
}

export function CompositionView({ composition, labels }: { composition: Composition; labels: { line: string; between: string; beneath: string } }) {
  const gapLines = GAP_LINE_HEIGHTS[composition.gap] ?? 0
  return (
    <div className="folio-composition" style={{ ['--folio-gap-lines' as string]: String(gapLines) }}>
      <p className="folio-composition__line" aria-label={labels.line}><Inline content={composition.line} /></p>
      <div className="folio-composition__under">
        {composition.between && (
          <div className="folio-composition__between" role="group" aria-label={labels.between}>
            <Paragraphs paragraphs={composition.between} />
          </div>
        )}
        <div className="folio-composition__beneath" role="group" aria-label={labels.beneath}>
          <Paragraphs paragraphs={composition.beneath} />
        </div>
      </div>
    </div>
  )
}
