import { Fragment } from 'react'
import type { ReactNode } from 'react'

// The translated copy marks emphasis with <strong>…</strong>. Render those
// segments as real elements (never via innerHTML) instead of literal tags.
export function renderStrong(text: string): ReactNode {
  return text.split(/(<strong>[\s\S]*?<\/strong>)/).map((part, index) => {
    const match = /^<strong>([\s\S]*?)<\/strong>$/.exec(part)
    return match ? <strong key={index}>{match[1]}</strong> : <Fragment key={index}>{part}</Fragment>
  })
}
