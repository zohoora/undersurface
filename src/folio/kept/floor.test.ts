import { describe, expect, it } from 'vitest'
import type { FolioTrace } from '../../types/folio'
import { floorGroups, lineageOf } from './floor'

const t = (id: string, keptAt: number, links: Partial<Pick<FolioTrace, 'previousTraceId' | 'correctedFromId'>> = {}): FolioTrace => ({
  id, keptAt, source: { pageId: 'p', foldId: 'f', revId: null }, surface: id, gap: 0, composition: '{}', author: 'writer', groundedNearKeep: false, safety: { checked: [] }, schemaVersion: 2, ...links,
})

describe('the floor', () => {
  it('stacks newest first; versions and corrected copies sit with their lineage', () => {
    const traces = [t('a', 1), t('b', 2), t('a2', 5, { previousTraceId: 'a' }), t('a2c', 6, { correctedFromId: 'a2' }), t('c', 4)]
    const groups = floorGroups(traces)
    expect(groups.map((g) => g.head.id)).toEqual(['a2c', 'c', 'b'])
    expect(groups[0].earlier.map((x) => x.id)).toEqual(['a2', 'a'])
    expect(lineageOf(traces[0], traces).map((x) => x.id)).toEqual(['a2c', 'a2'])
  })

  it('a link to a deleted trace starts its own group; cycles never loop', () => {
    const groups = floorGroups([t('x', 3, { previousTraceId: 'gone' }), t('y', 1, { previousTraceId: 'z' }), t('z', 2, { previousTraceId: 'y' })])
    expect(groups.map((g) => g.head.id).sort()).toEqual(['x', 'z'].sort())
  })
})
