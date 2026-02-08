import Dexie, { type EntityTable } from 'dexie'
import { SEEDED_PARTS } from '../ai/partPrompts'

interface DBEntry {
  id: string
  content: string
  plainText: string
  createdAt: number
  updatedAt: number
}

interface DBPart {
  id: string
  name: string
  color: string
  colorLight: string
  ifsRole: string
  voiceDescription: string
  concern: string
  systemPrompt: string
  isSeeded: boolean
  createdAt: number
}

interface DBMemory {
  id: string
  partId: string
  entryId: string
  content: string
  timestamp: number
}

interface DBThought {
  id: string
  partId: string
  entryId: string
  content: string
  anchorText: string
  anchorOffset: number
  timestamp: number
}

interface DBInteraction {
  id: string
  thoughtId: string
  partId: string
  entryId: string
  partOpening: string
  userResponse: string | null
  partReply: string | null
  status: string
  timestamp: number
}

class UndersurfaceDB extends Dexie {
  entries!: EntityTable<DBEntry, 'id'>
  parts!: EntityTable<DBPart, 'id'>
  memories!: EntityTable<DBMemory, 'id'>
  thoughts!: EntityTable<DBThought, 'id'>
  interactions!: EntityTable<DBInteraction, 'id'>

  constructor() {
    super('undersurface')
    this.version(1).stores({
      entries: 'id, createdAt, updatedAt',
      parts: 'id, isSeeded',
      memories: 'id, partId, entryId, timestamp',
      thoughts: 'id, partId, entryId, timestamp',
      interactions: 'id, thoughtId, partId, entryId, status',
    })
  }
}

export const db = new UndersurfaceDB()

export async function initializeDB() {
  const existingParts = await db.parts.count()
  if (existingParts === 0) {
    await db.parts.bulkPut(
      SEEDED_PARTS.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        colorLight: p.colorLight,
        ifsRole: p.ifsRole,
        voiceDescription: p.voiceDescription,
        concern: p.concern,
        systemPrompt: p.systemPrompt,
        isSeeded: p.isSeeded,
        createdAt: p.createdAt,
      })),
    )
  }
}

export function generateId(): string {
  return crypto.randomUUID()
}
