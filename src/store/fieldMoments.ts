import { db } from './db'
import type { FieldMoment } from '../types'

export const FIELD_MOSAIC_LIMIT = 6
// Only for the fallback below: a wide recent window, filtered client-side.
const FALLBACK_SCAN = 50

/**
 * The newest unreviewed field moments, queried directly. Loading the newest
 * six moments and THEN filtering hid older unreviewed ones behind reviewed
 * ones. The indexed query (status ASC, createdAt DESC) can fail while its
 * index is still building after a deploy; a wide recent scan covers that.
 */
export async function loadUnreviewedFieldMoments(max = FIELD_MOSAIC_LIMIT): Promise<FieldMoment[]> {
  try {
    return await db.fieldMoments.where('status').equals('unreviewed').newest('createdAt', max)
  } catch {
    const recent = await db.fieldMoments.orderBy('createdAt').reverse().limit(FALLBACK_SCAN).toArray()
    return recent.filter(moment => moment.status === 'unreviewed').slice(0, max)
  }
}
