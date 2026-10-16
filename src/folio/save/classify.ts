// Classifying a rejected chain, and resolving a pending entry on load
// (draft 4 §5.2). Pure functions: the controller reads the server and acts.

export interface Chain {
  baseRevId: string | null
  sentRevIds: string[]
  /** The server has acknowledged this page's creation at least once. */
  created: boolean
}

export type ServerCopy = { exists: false } | { exists: true; revId: string; doc: string }

export type ChainVerdict =
  /** The page is gone: the remote-delete prompt. */
  | { kind: 'remoteDeleted' }
  /** The page was never created, and creating it was rejected: not a conflict. */
  | { kind: 'notCreated' }
  /** Another device or tab wrote: one conflict copy. */
  | { kind: 'conflict' }
  /** No one else wrote; everything up to `revId` landed, acknowledged or not. */
  | { kind: 'inChain'; revId: string; doc: string }

export function inChain(chain: Chain, revId: string): boolean {
  return revId === chain.baseRevId || chain.sentRevIds.includes(revId)
}

/** One verdict for the whole chain, from one read of the server. */
export function classifyChain(server: ServerCopy, chain: Chain): ChainVerdict {
  if (!server.exists) return chain.created ? { kind: 'remoteDeleted' } : { kind: 'notCreated' }
  if (inChain(chain, server.revId)) return { kind: 'inChain', revId: server.revId, doc: server.doc }
  return { kind: 'conflict' }
}

export type EntryResolution =
  | { kind: 'clear' }
  | { kind: 'commit'; parentRevId: string }
  | { kind: 'conflictCopy' }
  | { kind: 'remoteDeleted' }
  /** The entry's page was never created on the server: create it. */
  | { kind: 'create' }

/** On load, once server state is confirmed: what to do with one orphaned entry. */
export function resolveEntry(server: ServerCopy, entry: Chain & { doc: string }): EntryResolution {
  if (!server.exists) {
    // Never acknowledged as created (a new page written offline): create it.
    // Created and then deleted elsewhere: the prompt, never a silent
    // re-creation. (If a create landed, its acknowledgement was lost and the
    // page was then deleted elsewhere before this load, it is re-created:
    // the one case the device can't tell apart.)
    return entry.created ? { kind: 'remoteDeleted' } : { kind: 'create' }
  }
  if (!inChain(entry, server.revId)) return { kind: 'conflictCopy' }
  if (server.doc === entry.doc) return { kind: 'clear' }
  return { kind: 'commit', parentRevId: server.revId }
}
