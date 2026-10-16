import { trimAnchor } from './samples'
import type { SafetyUnit } from './samples'

// C4's coverage is defined by content (draft 4 §5.4). A unit's check key is a
// hash of its pid, its lifted line (trimmed, as sent) and its own text, so
// the same words in a new place are checked again and any edit re-arms the
// check. Context is not part of the key.

const encoder = new TextEncoder()

export async function checkKey(unit: Pick<SafetyUnit, 'pid' | 'text' | 'line'>): Promise<string> {
  const material = `${unit.pid}\u0000${unit.line ? trimAnchor(unit.line) : ''}\u0000${unit.text}`
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(material))
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Keys for every unit, in order. */
export async function checkKeys(units: SafetyUnit[]): Promise<string[]> {
  return Promise.all(units.map(checkKey))
}

/** The checked set pruned to the keys of units that still exist. */
export function pruneChecked(checked: Iterable<string>, liveKeys: Iterable<string>): string[] {
  const live = new Set(liveKeys)
  return [...new Set(checked)].filter((k) => live.has(k))
}
