import { newId } from '../page/schema'
import type { FolioPage } from '../../types/folio'
import { resolveEntry } from './classify'
import type { ServerCopy } from './classify'
import type { PageContent, PageStoreAdapter, SaveStart } from './PageSaveController'
import type { PendingEntry } from './pendingStore'

// The move-to-editable procedure (draft 4 §5.2, B9): run on first load and
// whenever a waiting tab is granted the page's lock. It adopts the newest
// orphaned pending entry (the editor that wrote it is gone), sends nothing
// until the server's state is confirmed, then resolves the adopted entry
// (through the controller's confirm()) and every other orphan, newest first.

export interface EditableDeps {
  uid: string
  pageId: string
  editorId: string
  listPending: (uid: string, pageId: string) => PendingEntry[]
  removePending: (uid: string, pageId: string, editorId: string) => void
  writePending: (uid: string, entry: PendingEntry) => boolean
  liveEditorIds: () => Promise<Set<string>>
}

export interface EditableStart {
  start: SaveStart
  /** Orphans other than the adopted one, newest first: resolve after confirm(). */
  others: PendingEntry[]
  adopted: boolean
}

function contentOf(e: PendingEntry): PageContent {
  return { doc: e.doc, checked: e.checked, preview: e.preview, foldCount: e.foldCount }
}

/**
 * Decide how the editor starts. `page` is the snapshot the editor has (server
 * or cache); `emptyDoc` is the serialized empty document for a new page.
 */
export async function prepareEditable(deps: EditableDeps, page: FolioPage | null, emptyDoc: string, now: number): Promise<EditableStart> {
  const live = await deps.liveEditorIds()
  const orphans = deps.listPending(deps.uid, deps.pageId)
    .filter((e) => e.editorId !== deps.editorId && !live.has(e.editorId))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  if (orphans.length === 0) {
    return {
      start: page
        ? { baseRevId: page.revId, created: true, rev: page.rev, createdAt: page.createdAt, content: { doc: page.doc, checked: page.safety?.checked ?? [], preview: page.preview, foldCount: page.foldCount }, serverDoc: page.doc }
        : { baseRevId: null, created: false, rev: 0, createdAt: now, content: { doc: emptyDoc, checked: [], preview: '', foldCount: 0 }, serverDoc: emptyDoc },
      others: [],
      adopted: false,
    }
  }

  const [newest, ...others] = orphans
  // Move the adopted entry under this editor before removing the orphan, so
  // the words are always held somewhere on the device.
  deps.writePending(deps.uid, { ...newest, editorId: deps.editorId, updatedAt: now })
  deps.removePending(deps.uid, deps.pageId, newest.editorId)
  return {
    start: {
      baseRevId: newest.baseRevId,
      sentRevIds: newest.sentRevIds,
      created: newest.created,
      rev: page?.rev ?? 0,
      createdAt: newest.createdAt,
      content: contentOf(newest),
      serverDoc: null,
      awaitingConfirmation: true,
    },
    others,
    adopted: true,
  }
}

export interface OrphanOutcome {
  editorId: string
  kind: 'cleared' | 'committed' | 'copied'
  /** The new page a copy went to. */
  pageId?: string
}

/**
 * Resolve the other orphans after the adopted one, newest first, re-reading
 * the server before each. A conflict or a deleted page becomes a new page;
 * nothing is merged, and nothing is lost.
 */
export async function resolveOtherOrphans(
  deps: Pick<EditableDeps, 'uid' | 'pageId' | 'removePending' | 'writePending'>,
  adapter: PageStoreAdapter,
  others: PendingEntry[],
  now: () => number,
  copyPreview: (preview: string, at: number) => string,
): Promise<OrphanOutcome[]> {
  const out: OrphanOutcome[] = []
  for (const entry of others) {
    let server: ServerCopy
    try {
      server = await adapter.readServer(deps.pageId)
    } catch {
      break // offline: try again on the next move to editable
    }
    const r = resolveEntry(server, entry)
    if (r.kind === 'clear') {
      deps.removePending(deps.uid, deps.pageId, entry.editorId)
      out.push({ editorId: entry.editorId, kind: 'cleared' })
      continue
    }
    if (r.kind === 'commit') {
      try {
        await adapter.write(pageFrom(deps.pageId, entry, r.parentRevId, now()))
        deps.removePending(deps.uid, deps.pageId, entry.editorId)
        out.push({ editorId: entry.editorId, kind: 'committed' })
        continue
      } catch {
        // Someone moved the page on between the read and the write: copy it.
      }
    }
    if (r.kind === 'create') {
      try {
        await adapter.write(pageFrom(deps.pageId, entry, null, now()))
        deps.removePending(deps.uid, deps.pageId, entry.editorId)
        out.push({ editorId: entry.editorId, kind: 'committed' })
        continue
      } catch {
        // Created meanwhile by someone else: copy it.
      }
    }
    // conflictCopy, remoteDeleted, or a failed commit: a new page.
    const copyId = newId()
    const at = now()
    const copy: PendingEntry = { ...entry, pageId: copyId, baseRevId: null, sentRevIds: [], created: false, preview: copyPreview(entry.preview, at), updatedAt: at }
    deps.writePending(deps.uid, copy)
    deps.removePending(deps.uid, deps.pageId, entry.editorId)
    try {
      await adapter.write(pageFrom(copyId, copy, null, at))
      deps.removePending(deps.uid, copyId, copy.editorId)
    } catch {
      // Stays pending on the device under the copy's id; the pages list offers it.
    }
    out.push({ editorId: entry.editorId, kind: 'copied', pageId: copyId })
  }
  return out
}

function pageFrom(pageId: string, e: PendingEntry, parentRevId: string | null, at: number): FolioPage {
  return {
    id: pageId,
    createdAt: e.createdAt,
    updatedAt: at,
    doc: e.doc,
    schemaVersion: 2,
    revId: newId(),
    parentRevId,
    rev: 1,
    editorId: e.editorId,
    preview: e.preview,
    foldCount: e.foldCount,
    safety: { checked: e.checked },
  }
}
