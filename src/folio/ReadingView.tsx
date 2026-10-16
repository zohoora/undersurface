import { useEffect, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { useTranslation } from '../i18n'
import { pageAdapter } from './store'
import { listPending } from './save/pendingStore'
import { GAP_LINE_HEIGHTS } from './page/schema'
import type { Gap } from './page/schema'

// Reading view (draft 4 §3.4, §3.6): every fold expanded, the distance as real
// empty space, no motion. For reading, printing and screen readers; the
// editor itself is the authoring path.

/** `companion` labels the companion's own words (involvement level 5) for screen readers; they're graphite on screen. */
function inlineText(node: JSONContent, companion: string): React.ReactNode[] {
  return (node.content ?? []).map((child, i) => {
    if (child.type === 'hardBreak') return <br key={i} />
    const text = child.text ?? ''
    const theirs = child.marks?.some((m) => m.type === 'companionText')
    const body = theirs ? <><span className="folio-visually-hidden">{companion}: </span>{text}</> : text
    const cls = theirs ? 'folio-companion-text' : undefined
    return child.marks?.some((m) => m.type === 'italic') ? <em key={i} className={cls}>{body}</em> : <span key={i} className={cls}>{body}</span>
  })
}

function paragraphs(node: JSONContent | undefined, keyPrefix: string, companion: string): React.ReactNode[] {
  return (node?.content ?? []).map((p, i) => <p key={`${keyPrefix}-${i}`}>{inlineText(p, companion)}</p>)
}

export function ReadingView({ uid, pageId }: { uid: string; pageId: string }) {
  const tr = useTranslation()
  const [doc, setDoc] = useState<JSONContent | null>(() => {
    const local = listPending(uid, pageId)[0]
    return local ? (JSON.parse(local.doc) as JSONContent) : null
  })

  useEffect(() => {
    return pageAdapter(uid).subscribe(pageId, (snap) => {
      const pending = listPending(uid, pageId)[0]
      if (pending && (!snap.page || pending.updatedAt > snap.page.updatedAt)) setDoc(JSON.parse(pending.doc) as JSONContent)
      else if (snap.page) setDoc(JSON.parse(snap.page.doc) as JSONContent)
    })
  }, [uid, pageId])

  if (!doc) return <div className="folio-line">{tr['folio.opening']}</div>

  return (
    <article className="folio-reading">
      {(doc.content ?? []).map((node, i) => {
        if (node.type === 'paragraph') return <p key={i}>{inlineText(node, tr['folio.ask.label'])}</p>
        if (node.type !== 'underside') return null
        const gap = (Number(node.attrs?.gap) || 0) as Gap
        const between = node.content?.find((c) => c.type === 'between')
        const beneath = node.content?.find((c) => c.type === 'beneath')
        const lines = GAP_LINE_HEIGHTS[gap] ?? 0
        const half = between ? Math.ceil(lines / 2) : lines
        const space = (n: number) => (n > 0 ? <div aria-hidden="true" style={{ height: `${n * 1.65}em` }} /> : null)
        return (
          <section key={i} className="folio-reading__underside" aria-label={tr['folio.beneath']}>
            {gap > 0 && <div className="folio-visually-hidden">{tr[`folio.distance.${gap}` as const]}</div>}
            {space(half)}
            {between && (
              <>
                <div className="folio-reading__label">{tr['folio.between']}</div>
                {paragraphs(between, `b${i}`, tr['folio.ask.label'])}
                {space(half)}
              </>
            )}
            <div className="folio-reading__label">{tr['folio.beneath']}</div>
            {paragraphs(beneath, `n${i}`, tr['folio.ask.label'])}
          </section>
        )
      })}
    </article>
  )
}
