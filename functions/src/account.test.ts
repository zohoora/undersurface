// Zero-residue + idempotency tests for account deletion. The key invariant:
// after handleDeleteAccount runs, EVERYTHING under users/{uid} (any
// subcollection, any depth), the uid-keyed top-level docs, the Auth user, and
// the Twilio-side copies of the user's SMS/MMS are gone, and re-running
// against the emptied state does not throw.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { USER_SUBCOLLECTIONS } from './shared/collections'

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }))
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn((name: string) => ({ value: () => `secret-${name}` })),
}))

// ── Path-keyed in-memory Firestore modelling the surface account.ts uses ──

type Fields = Record<string, unknown>
let store: Map<string, Fields>
let events: string[]

function segments(path: string): string[] {
  return path.split('/')
}

function docRef(path: string): FakeDocRef {
  return {
    id: segments(path).at(-1)!,
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path), get: (f: string) => store.get(path)?.[f] }),
    set: async (fields: Fields, options?: { merge?: boolean }) => {
      events.push(`set:${path}:${JSON.stringify(fields)}`)
      const existing = store.get(path)
      store.set(path, options?.merge && existing ? { ...existing, ...fields } : { ...fields })
    },
    delete: async () => { store.delete(path) },
    collection: (name: string) => collectionRef(`${path}/${name}`),
    listCollections: async () => {
      const prefix = `${path}/`
      const names = new Set<string>()
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) names.add(segments(key.slice(prefix.length))[0])
      }
      return [...names].map(name => collectionRef(`${path}/${name}`))
    },
  }
}

interface FakeDocRef {
  id: string
  path: string
  get: () => Promise<{ exists: boolean; data: () => Fields | undefined; get: (f: string) => unknown }>
  set: (fields: Fields, options?: { merge?: boolean }) => Promise<void>
  delete: () => Promise<void>
  collection: (name: string) => ReturnType<typeof collectionRef>
  listCollections: () => Promise<ReturnType<typeof collectionRef>[]>
}

function query(collectionPath: string, filters: [string, unknown][] = [], max = Infinity) {
  const depth = segments(collectionPath).length + 1
  const run = () => [...store.entries()]
    .filter(([key]) => key.startsWith(`${collectionPath}/`) && segments(key).length === depth)
    .filter(([, fields]) => filters.every(([f, v]) => fields[f] === v))
    .slice(0, max)
  return {
    where: (field: string, _op: string, value: unknown) => query(collectionPath, [...filters, [field, value]], max),
    limit: (n: number) => query(collectionPath, filters, n),
    select: () => query(collectionPath, filters, max),
    get: async () => ({
      docs: run().map(([key, fields]) => ({
        id: segments(key).at(-1)!,
        ref: docRef(key),
        data: () => fields,
        get: (f: string) => fields[f],
      })),
    }),
  }
}

function collectionRef(path: string) {
  return { path, ...query(path), doc: (id: string) => docRef(`${path}/${id}`) }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const ops: (() => void)[] = []
    return {
      delete: (ref: { path: string }) => { ops.push(() => { store.delete(ref.path) }) },
      set: (ref: { path: string }, fields: Fields) => { ops.push(() => { store.set(ref.path, fields) }) },
      commit: async () => { for (const op of ops) op() },
    }
  },
  recursiveDelete: async (ref: { path: string }) => {
    events.push(`recursiveDelete:${ref.path}`)
    for (const key of [...store.keys()]) {
      if (key === ref.path || key.startsWith(`${ref.path}/`)) store.delete(key)
    }
  },
}

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => firestore }))

let deletedStoragePrefixes: string[]
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      deleteFiles: async ({ prefix }: { prefix: string }) => { deletedStoragePrefixes.push(prefix) },
    }),
  }),
}))

let authUsers: Set<string>
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    revokeRefreshTokens: async (uid: string) => {
      events.push(`revoke:${uid}`)
      if (!authUsers.has(uid)) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' })
    },
    deleteUser: async (uid: string) => {
      events.push(`deleteUser:${uid}`)
      if (!authUsers.has(uid)) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' })
      authUsers.delete(uid)
    },
  }),
}))

// ── Twilio fake ──
let twilioMessages: Map<string, string[]> // message sid → media sids
let twilioFailSids: Set<string>
let twilioConstructed: unknown[][]
function twilioNotFound() {
  return Object.assign(new Error('The requested resource was not found'), { status: 404, code: 20404 })
}
vi.mock('twilio', () => ({
  default: (...args: unknown[]) => {
    twilioConstructed.push(args)
    return {
      messages: (sid: string) => ({
        remove: async () => {
          events.push(`twilio-remove:${sid}`)
          if (twilioFailSids.has(sid)) throw Object.assign(new Error('server error'), { status: 500 })
          if (!twilioMessages.has(sid)) throw twilioNotFound()
          twilioMessages.delete(sid)
          return true
        },
        media: Object.assign(
          (mediaSid: string) => ({
            remove: async () => {
              const media = twilioMessages.get(sid)
              if (!media?.includes(mediaSid)) throw twilioNotFound()
              twilioMessages.set(sid, media.filter(m => m !== mediaSid))
              return true
            },
          }),
          {
            list: async () => {
              if (!twilioMessages.has(sid)) throw twilioNotFound()
              return (twilioMessages.get(sid) ?? []).map(mediaSid => ({ sid: mediaSid }))
            },
          },
        ),
      }),
    }
  },
}))

const revokeFieldWindowConsent = vi.fn(async () => undefined)
vi.mock('./sms/state.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sms/state.js')>()),
  revokeFieldWindowConsent,
}))

const { handleDeleteAccount, handleUnlinkSms, deleteTwilioMessages, ACCOUNT_DELETION_STATUS } = await import('./account')

const SID_IN = 'SM' + 'a'.repeat(32)
const SID_MMS = 'MM' + 'b'.repeat(32)
const SID_OUT = 'SM' + 'c'.repeat(32)
const MEDIA_1 = 'ME' + 'd'.repeat(32)

function seedFullAccount(uid: string) {
  store.set(`users/${uid}`, { email: 'a@b.c' })
  for (const coll of USER_SUBCOLLECTIONS) {
    store.set(`users/${uid}/${coll}/${coll}-1`, { x: 1 })
    store.set(`users/${uid}/${coll}/${coll}-2`, { x: 2 })
  }
  // Nested + unregistered collections are covered by recursiveDelete.
  store.set(`users/${uid}/sessions/sessions-1/messages/m1`, { t: 'hi' })
  store.set(`users/${uid}/sessions/sessions-1/messages/m2`, { t: 'yo' })
  store.set(`users/${uid}/companionPreferences/current`, { lastGroundingAt: 123 })
  store.set(`users/${uid}/someFutureCollection/doc`, { y: 1 })
  // SMS records keyed by Twilio SID, plus one malformed client-planted id.
  store.set(`users/${uid}/smsMessages/${SID_IN}`, { direction: 'inbound', mediaCount: 0, body: 'private' })
  store.set(`users/${uid}/smsMessages/${SID_MMS}`, { direction: 'inbound', mediaCount: 1, body: 'photo' })
  store.set(`users/${uid}/smsMessages/${SID_OUT}`, { direction: 'outbound', body: 'reply' })
  store.set(`users/${uid}/smsMessages/not-a-sid`, { direction: 'inbound' })

  store.set('contactMessages/c1', { uid })
  store.set('contactMessages/c2', { uid: 'someone-else' })
  store.set(`quotas/${uid}`, { period: '2026-07', tokensUsed: 500 })
  store.set(`smsPhoneLinks/phone-${uid}`, { uid })
  store.set(`smsLinkCodes/code-${uid}`, { uid })
  store.set(`smsInbound/inbound-${uid}`, { uid })
  store.set(`fieldWindowDispatches/dispatch-${uid}`, { uid })

  twilioMessages.set(SID_IN, [])
  twilioMessages.set(SID_MMS, [MEDIA_1])
  twilioMessages.set(SID_OUT, [])
  authUsers.add(uid)
}

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as import('express').Response
}

function keysFor(uid: string): string[] {
  return [...store.keys()].filter(key => key === `users/${uid}` || key.startsWith(`users/${uid}/`))
}

beforeEach(() => {
  store = new Map()
  events = []
  authUsers = new Set()
  deletedStoragePrefixes = []
  twilioMessages = new Map()
  twilioFailSids = new Set()
  twilioConstructed = []
})

describe('handleDeleteAccount', () => {
  it('leaves zero residue under users/{uid}, in uid-keyed top-level docs, and in Auth', async () => {
    seedFullAccount('u1')
    const res = makeRes()

    await handleDeleteAccount('u1', {}, res)

    expect(keysFor('u1')).toEqual([])
    expect(authUsers.has('u1')).toBe(false)
    // The other user's contact message is untouched; ours is gone.
    expect(store.has('contactMessages/c1')).toBe(false)
    expect(store.has('contactMessages/c2')).toBe(true)
    expect(store.has('quotas/u1')).toBe(false)
    for (const coll of ['smsPhoneLinks', 'smsLinkCodes', 'smsInbound', 'fieldWindowDispatches']) {
      expect([...store.entries()].some(([key, f]) => key.startsWith(`${coll}/`) && f.uid === 'u1'), coll).toBe(false)
    }
    expect(deletedStoragePrefixes).toEqual(['field-moments/u1/'])
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })

  it('uses recursiveDelete, so unregistered and nested collections cannot be missed', async () => {
    seedFullAccount('u1')
    await handleDeleteAccount('u1', {}, makeRes())
    expect(store.has('users/u1/someFutureCollection/doc')).toBe(false)
    expect(store.has('users/u1/sessions/sessions-1/messages/m1')).toBe(false)
    expect(store.has('users/u1/companionPreferences/current')).toBe(false)
    expect(events).toContain('recursiveDelete:users/u1')
  })

  it('tombstones first, revokes refresh tokens, and removes the tombstone only after the Auth user', async () => {
    seedFullAccount('u1')
    await handleDeleteAccount('u1', {}, makeRes())

    const tombstone = events.findIndex(e => e.startsWith('set:users/u1:') && e.includes(`"status":"${ACCOUNT_DELETION_STATUS}"`))
    const revoke = events.indexOf('revoke:u1')
    const firstSubtreeDelete = events.findIndex(e => e.startsWith('recursiveDelete:users/u1/'))
    const deleteUser = events.indexOf('deleteUser:u1')
    const finalSweep = events.indexOf('recursiveDelete:users/u1')

    expect(tombstone).toBe(0)
    expect(revoke).toBeGreaterThan(tombstone)
    expect(firstSubtreeDelete).toBeGreaterThan(revoke)
    expect(deleteUser).toBeGreaterThan(firstSubtreeDelete)
    expect(finalSweep).toBeGreaterThan(deleteUser)
    expect(ACCOUNT_DELETION_STATUS).toBe('deleting')
  })

  it('keeps the tombstone in place while the subtree is deleted', async () => {
    seedFullAccount('u1')
    const original = firestore.recursiveDelete
    let tombstoneSeenDuringSubtreeDelete = false
    firestore.recursiveDelete = async (ref: { path: string }) => {
      if (ref.path.startsWith('users/u1/')) {
        tombstoneSeenDuringSubtreeDelete = store.get('users/u1')?.status === 'deleting'
      }
      await original(ref)
    }
    try {
      await handleDeleteAccount('u1', {}, makeRes())
    } finally {
      firestore.recursiveDelete = original
    }
    expect(tombstoneSeenDuringSubtreeDelete).toBe(true)
  })

  it('deletes the Twilio-side messages and MMS media, read before the tree is gone', async () => {
    seedFullAccount('u1')
    await handleDeleteAccount('u1', {}, makeRes())

    expect(twilioMessages.size).toBe(0)
    expect(twilioConstructed).toEqual([['secret-TWILIO_ACCOUNT_SID', 'secret-TWILIO_AUTH_TOKEN']])
    // The malformed, client-plantable id never reaches Twilio.
    expect(events.some(e => e.includes('not-a-sid'))).toBe(false)
    const lastTwilio = events.map((e, i) => (e.startsWith('twilio-remove:') ? i : -1)).filter(i => i >= 0).at(-1)!
    expect(lastTwilio).toBeLessThan(events.findIndex(e => e.startsWith('recursiveDelete:users/u1/')))
  })

  it('still erases Firestore and Auth when Twilio fails, and logs counts only', async () => {
    seedFullAccount('u1')
    twilioFailSids.add(SID_OUT)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = makeRes()
    await handleDeleteAccount('u1', {}, res)

    expect(keysFor('u1')).toEqual([])
    expect(authUsers.has('u1')).toBe(false)
    expect(res.json).toHaveBeenCalledWith({ success: true })
    const logged = warn.mock.calls.map(call => call.join(' ')).join('\n')
    expect(logged).toContain('twilio-cleanup incomplete deleted=2 failed=1 skipped=0')
    expect(logged).not.toContain('u1')
    expect(logged).not.toContain(SID_OUT)
    warn.mockRestore()
  })

  it('is idempotent — a second run against emptied state does not throw', async () => {
    seedFullAccount('u1')
    await handleDeleteAccount('u1', {}, makeRes())

    // Auth user already gone on the retry: revoke and delete both 404.
    const res2 = makeRes()
    await expect(handleDeleteAccount('u1', {}, res2)).resolves.toBeUndefined()
    expect(res2.json).toHaveBeenCalledWith({ success: true })
    expect(keysFor('u1')).toEqual([])
  })
})

describe('handleUnlinkSms', () => {
  it('revokes field-window consent like SMS STOP, so a re-link never resumes proactive texts', async () => {
    revokeFieldWindowConsent.mockClear()
    store.set('users/u-unlink/smsSettings/current', { phoneHash: 'hash-1' })
    store.set('smsPhoneLinks/hash-1', { uid: 'u-unlink' })
    const res = makeRes()
    await handleUnlinkSms('u-unlink', {}, res)
    expect(store.has('smsPhoneLinks/hash-1')).toBe(false)
    expect(revokeFieldWindowConsent).toHaveBeenCalledWith('u-unlink', expect.any(Number))
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })

  it('does not revoke consent during account deletion (the whole tree is erased instead)', async () => {
    revokeFieldWindowConsent.mockClear()
    seedFullAccount('u-del')
    await handleDeleteAccount('u-del', {}, makeRes())
    expect(revokeFieldWindowConsent).not.toHaveBeenCalled()
  })
})

describe('deleteTwilioMessages', () => {
  function fakeClient(opts: { failMessages?: Set<string> } = {}) {
    const removed: string[] = []
    return {
      removed,
      client: {
        listMediaSids: vi.fn(async () => [MEDIA_1]),
        removeMedia: vi.fn(async () => {}),
        removeMessage: vi.fn(async (sid: string) => {
          if (opts.failMessages?.has(sid)) throw Object.assign(new Error('boom'), { status: 503 })
          removed.push(sid)
        }),
      },
    }
  }

  it('lists and deletes media only for messages that carried media', async () => {
    const { client, removed } = fakeClient()
    const result = await deleteTwilioMessages(
      [{ sid: SID_IN, hasMedia: false }, { sid: SID_MMS, hasMedia: true }],
      client,
    )
    expect(result).toEqual({ deleted: 2, failed: 0, skipped: 0 })
    expect(client.listMediaSids).toHaveBeenCalledTimes(1)
    expect(client.removeMedia).toHaveBeenCalledWith(SID_MMS, MEDIA_1)
    expect(removed.sort()).toEqual([SID_IN, SID_MMS].sort())
  })

  it('treats already-deleted resources as deleted', async () => {
    const client = {
      listMediaSids: vi.fn(async () => { throw twilioNotFound() }),
      removeMedia: vi.fn(async () => {}),
      removeMessage: vi.fn(async () => { throw twilioNotFound() }),
    }
    expect(await deleteTwilioMessages([{ sid: SID_MMS, hasMedia: true }], client))
      .toEqual({ deleted: 1, failed: 0, skipped: 0 })
  })

  it('stops at the time budget and reports the remainder as skipped', async () => {
    const { client } = fakeClient()
    let clock = 0
    const targets = Array.from({ length: 5 }, (_, i) => ({ sid: `SM${String(i).padStart(32, '0')}`, hasMedia: false }))
    client.removeMessage.mockImplementation(async () => { clock += 60 })
    const result = await deleteTwilioMessages(targets, client, { budgetMs: 100, concurrency: 1, now: () => clock })
    expect(result.deleted).toBe(2)
    expect(result.skipped).toBe(3)
  })
})
