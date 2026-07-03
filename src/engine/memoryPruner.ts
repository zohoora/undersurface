import { db } from '../store/db'

// Bounded pruning for the highest-growth, lowest-value-to-retain collections.
// Runs after session reflection (already an online moment). Deliberately narrow:
// - thoughts: ephemeral diary part-thought UI artifacts; old ones are never read
// - innerWeather: persisted docs are write-only (only the in-memory engine is
//   read back), so the archive can be trimmed hard
// Memories, summaries, letters, facts etc. are the product's longitudinal moat
// and are intentionally NOT pruned here.

const THOUGHTS_KEEP = 500
const WEATHER_KEEP = 200
// Cap deletions per run so a large backlog is worked down incrementally rather
// than in one storm of writes.
const BATCH_LIMIT = 200

interface PrunableCollection {
  count(): Promise<number>
  orderBy(field: string): { limit(n: number): { toArray(): Promise<{ id: string }[]> } }
  delete(id: string): Promise<void>
}

async function pruneCollection(
  collection: PrunableCollection,
  orderField: string,
  keepNewest: number,
  batchLimit: number = BATCH_LIMIT,
): Promise<number> {
  let total: number
  try {
    // count() is a server aggregation and never serves from cache; if the app
    // is offline this throws — skip pruning rather than fail the reflection.
    total = await collection.count()
  } catch {
    return 0
  }
  if (total <= keepNewest) return 0

  const excess = Math.min(total - keepNewest, batchLimit)
  // Ascending order → oldest-first; take exactly the excess to delete.
  const oldest = await collection.orderBy(orderField).limit(excess).toArray()
  await Promise.all(oldest.map(doc => collection.delete(doc.id)))
  return oldest.length
}

/**
 * Trim the unbounded growth collections. Best-effort: any failure is swallowed
 * so it can never break the post-session reflection flow that calls it.
 * Returns how many docs were removed from each, for diagnostics/health.
 */
export async function pruneGrowthCollections(): Promise<{ thoughts: number; innerWeather: number }> {
  try {
    const thoughts = await pruneCollection(
      db.thoughts as unknown as PrunableCollection, 'timestamp', THOUGHTS_KEEP,
    )
    const innerWeather = await pruneCollection(
      db.innerWeather as unknown as PrunableCollection, 'updatedAt', WEATHER_KEEP,
    )
    return { thoughts, innerWeather }
  } catch (error) {
    console.error('pruneGrowthCollections error:', error)
    return { thoughts: 0, innerWeather: 0 }
  }
}
