import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldMoment } from '../types'

const newest = vi.hoisted(() => vi.fn<(field: string, n: number) => Promise<FieldMoment[]>>())
const equals = vi.hoisted(() => vi.fn(() => ({ newest })))
const where = vi.hoisted(() => vi.fn(() => ({ equals })))
const recent = vi.hoisted(() => ({ rows: [] as FieldMoment[] }))
const limit = vi.hoisted(() => vi.fn(() => ({ toArray: async () => recent.rows })))

vi.mock('./db', () => ({
  db: {
    fieldMoments: {
      where,
      orderBy: () => ({ reverse: () => ({ limit }) }),
    },
  },
}))

const { FIELD_MOSAIC_LIMIT, loadUnreviewedFieldMoments } = await import('./fieldMoments')

const moment = (id: string, status: FieldMoment['status'], createdAt: number): FieldMoment => ({
  id, source: 'sms', sourceId: id, text: id, createdAt, status,
})

describe('loadUnreviewedFieldMoments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recent.rows = []
  })

  it('queries unreviewed moments directly, newest first, so older ones are not hidden behind reviewed ones', async () => {
    const older = moment('older-unreviewed', 'unreviewed', 1)
    newest.mockResolvedValue([older])
    await expect(loadUnreviewedFieldMoments()).resolves.toEqual([older])
    expect(where).toHaveBeenCalledWith('status')
    expect(equals).toHaveBeenCalledWith('unreviewed')
    expect(newest).toHaveBeenCalledWith('createdAt', FIELD_MOSAIC_LIMIT)
  })

  it('falls back to a wide recent scan while the composite index is unavailable', async () => {
    newest.mockRejectedValue(Object.assign(new Error('The query requires an index'), { code: 'failed-precondition' }))
    recent.rows = [
      ...Array.from({ length: 8 }, (_, index) => moment(`kept-${index}`, 'kept', 100 - index)),
      moment('older-unreviewed', 'unreviewed', 2),
    ]
    const result = await loadUnreviewedFieldMoments()
    expect(result.map(item => item.id)).toEqual(['older-unreviewed'])
    expect(limit).toHaveBeenCalledWith(expect.any(Number))
    expect((limit.mock.calls[0] as unknown as [number])[0]).toBeGreaterThan(FIELD_MOSAIC_LIMIT)
  })
})
