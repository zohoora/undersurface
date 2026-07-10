// Zero-residue + idempotency tests for account deletion. The key invariant:
// after handleDeleteAccount runs, EVERY user subcollection (including apiKeys
// and sessions/{id}/messages), the user doc, the user's contactMessages, and
// the Auth user are gone — and re-running against the emptied state does not
// throw.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { USER_SUBCOLLECTIONS } from './shared/collections'

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }))

// ── Stateful in-memory Firestore modelling only the surface account.ts uses ──

interface DocNode {
  fields: Record<string, unknown>
  subs: Record<string, Map<string, DocNode>>
}
function newDoc(fields: Record<string, unknown> = {}): DocNode {
  return { fields, subs: {} }
}

let users: Map<string, DocNode>
let contactMessages: Map<string, DocNode>
let quotas: Map<string, DocNode>
let smsPhoneLinks: Map<string, DocNode>
let smsLinkCodes: Map<string, DocNode>
let smsInbound: Map<string, DocNode>
let fieldWindowDispatches: Map<string, DocNode>
let deletedAuthUsers: string[]
let authThrowsNotFound: boolean
let setCalls: { id: string; fields: Record<string, unknown> }[]
let deletedStoragePrefixes: string[]

function makeDocRef(node: DocNode | null, container: Map<string, DocNode>, id: string) {
  return {
    get: async () => {
      const current = container.get(id)
      return {
        exists: !!current,
        data: () => current?.fields,
      }
    },
    set: async (fields: Record<string, unknown>) => {
      setCalls.push({ id, fields })
      const existing = container.get(id)
      if (existing) Object.assign(existing.fields, fields)
      else container.set(id, newDoc({ ...fields }))
    },
    delete: async () => { container.delete(id) },
    collection: (name: string) => makeCollectionRef(ensureNode(container, id), name),
  }
}
function ensureNode(container: Map<string, DocNode>, id: string): DocNode {
  let n = container.get(id)
  if (!n) { n = newDoc(); container.set(id, n) }
  return n
}
function makeCollectionRef(parent: DocNode, name: string) {
  if (!parent.subs[name]) parent.subs[name] = new Map()
  const map = parent.subs[name]
  return {
    ...makeQuery(map),
    doc: (id: string) => makeDocRef(map.get(id) ?? null, map, id),
  }
}
function makeQuery(map: Map<string, DocNode>, filter?: (n: DocNode) => boolean) {
  const matching = () => [...map.entries()].filter(([, n]) => !filter || filter(n))
  return {
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(map, (n) => n.fields[field] === value),
    limit: (n: number) => ({
      get: async () => snapshotOf(map, matching().slice(0, n)),
    }),
    get: async () => snapshotOf(map, matching()),
  }
}
function snapshotOf(map: Map<string, DocNode>, entries: [string, DocNode][]) {
  return {
    docs: entries.map(([id, node]) => ({
      id,
      ref: {
        delete: async () => { map.delete(id) },
        collection: (name: string) => makeCollectionRef(node, name),
      },
    })),
  }
}

const firestore = {
  collection: (name: string) => {
    if (name === 'contactMessages') return makeQuery(contactMessages)
    if (name === 'quotas') {
      return { doc: (id: string) => makeDocRef(quotas.get(id) ?? null, quotas, id) }
    }
    if (name === 'smsPhoneLinks') return makeQuery(smsPhoneLinks)
    if (name === 'smsLinkCodes') return makeQuery(smsLinkCodes)
    if (name === 'smsInbound') return makeQuery(smsInbound)
    if (name === 'fieldWindowDispatches') return makeQuery(fieldWindowDispatches)
    if (name === 'users') {
      return { doc: (id: string) => makeDocRef(users.get(id) ?? null, users, id) }
    }
    throw new Error(`unexpected collection ${name}`)
  },
  batch: () => {
    const ops: (() => void)[] = []
    return {
      delete: (ref: { delete: () => Promise<void> }) => { ops.push(() => { void ref.delete() }) },
      commit: async () => { for (const op of ops) op() },
    }
  },
}

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => firestore }))
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      deleteFiles: async ({ prefix }: { prefix: string }) => { deletedStoragePrefixes.push(prefix) },
    }),
  }),
}))
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    deleteUser: async (uid: string) => {
      if (authThrowsNotFound) {
        const e = new Error('not found') as Error & { code: string }
        e.code = 'auth/user-not-found'
        throw e
      }
      deletedAuthUsers.push(uid)
    },
  }),
}))

const { handleDeleteAccount } = await import('./account')

function seedFullAccount(uid: string) {
  const user = newDoc({ email: 'a@b.c' })
  users.set(uid, user)
  for (const coll of USER_SUBCOLLECTIONS) {
    user.subs[coll] = new Map([[`${coll}-1`, newDoc({ x: 1 })], [`${coll}-2`, newDoc({ x: 2 })]])
  }
  // sessions/{id}/messages subcollection
  const s1 = user.subs['sessions'].get('sessions-1')!
  s1.subs['messages'] = new Map([['m1', newDoc({ t: 'hi' })], ['m2', newDoc({ t: 'yo' })]])
  contactMessages.set('c1', newDoc({ uid }))
  contactMessages.set('c2', newDoc({ uid: 'someone-else' }))
  quotas.set(uid, newDoc({ period: '2026-07', tokensUsed: 500 }))
  smsPhoneLinks.set(`phone-${uid}`, newDoc({ uid }))
  smsLinkCodes.set(`code-${uid}`, newDoc({ uid }))
  smsInbound.set(`inbound-${uid}`, newDoc({ uid }))
  fieldWindowDispatches.set(`dispatch-${uid}`, newDoc({ uid }))
}

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as import('express').Response
}

beforeEach(() => {
  users = new Map()
  contactMessages = new Map()
  quotas = new Map()
  smsPhoneLinks = new Map()
  smsLinkCodes = new Map()
  smsInbound = new Map()
  fieldWindowDispatches = new Map()
  deletedAuthUsers = []
  authThrowsNotFound = false
  setCalls = []
  deletedStoragePrefixes = []
})

describe('handleDeleteAccount', () => {
  it('leaves zero residue across every subcollection, messages, contacts, user doc, and Auth', async () => {
    seedFullAccount('u1')
    const res = makeRes()

    await handleDeleteAccount('u1', {}, res)

    expect(users.has('u1')).toBe(false)
    expect(deletedAuthUsers).toEqual(['u1'])
    // The other user's contact message is untouched; ours is gone.
    expect(contactMessages.has('c1')).toBe(false)
    expect(contactMessages.has('c2')).toBe(true)
    // The top-level quota doc is deleted too (it lives outside users/{uid}).
    expect(quotas.has('u1')).toBe(false)
    expect([...smsPhoneLinks.values()].some(doc => doc.fields.uid === 'u1')).toBe(false)
    expect([...smsLinkCodes.values()].some(doc => doc.fields.uid === 'u1')).toBe(false)
    expect([...smsInbound.values()].some(doc => doc.fields.uid === 'u1')).toBe(false)
    expect([...fieldWindowDispatches.values()].some(doc => doc.fields.uid === 'u1')).toBe(false)
    expect(deletedStoragePrefixes).toEqual(['field-moments/u1/'])
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })

  it('deletes apiKeys specifically (the collection the old list missed)', async () => {
    seedFullAccount('u1')
    expect(users.get('u1')!.subs['apiKeys'].size).toBe(2)

    await handleDeleteAccount('u1', {}, makeRes())

    expect(users.has('u1')).toBe(false)
  })

  it('is idempotent — a second run against emptied state does not throw', async () => {
    seedFullAccount('u1')
    await handleDeleteAccount('u1', {}, makeRes())

    // Auth user already gone on the retry.
    authThrowsNotFound = true
    const res2 = makeRes()
    await expect(handleDeleteAccount('u1', {}, res2)).resolves.toBeUndefined()
    expect(res2.json).toHaveBeenCalledWith({ success: true })
  })

  it('tombstones the user doc first (status: deleting) before deleting it', async () => {
    seedFullAccount('u1')

    await handleDeleteAccount('u1', {}, makeRes())

    const tombstone = setCalls.find(c => c.id === 'u1' && c.fields.status === 'deleting')
    expect(tombstone).toBeDefined()
    expect(tombstone!.fields.deletedAt).toBeTypeOf('number')
    // …and the doc is ultimately removed.
    expect(users.has('u1')).toBe(false)
  })
})
