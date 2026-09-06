// Integration regression test for the production failure mode where a cloud
// pull writes pulled objects into IndexedDB via the REAL repository but the
// mounted UI ref is never told to reload, so the pulled link only appears on a
// manual page refresh.
//
// The mock-based unit tests in coordinator.test.js cannot catch this: they stub
// the repo (local arrays) and the protocol (empty pull), so they never exercise
// the real repository -> pullAndReconcile -> notifyDataChanged -> useLinks reload
// chain. This test wires that EXACT chain with real modules (fake-indexeddb
// stands in for the browser's IndexedDB) and asserts the mounted ref updates.
//
// In production the deploys shipped a build without this chain; the deployed
// client pulled into IndexedDB but the useLinks/useFolders refs never reloaded.
// Guard: if the notify/reload wiring regresses, the mounted ref stays stale and
// this test fails, even though all mock unit tests still pass.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick, effectScope } from 'vue'
import 'fake-indexeddb/auto'
import { defaultDBName } from '../storage/indexeddb.js'

const DB_NAME = defaultDBName()
function deleteDB() {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

// Let the fire-and-forget notifier's async reload (await repository.getAllLinks)
// and Vue's scheduler settle before asserting.
async function settle(times = 3) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

// Make the app-singleton session appear authenticated so pullAndReconcile's
// accountId gate resolves to acc-1. We mock only the http-adapter (session's
// dependency), never the session module itself.
vi.mock('../auth/http-adapter.js', () => ({
  createHttpAdapter: () => ({
    init: vi.fn(async () => null),
    login: vi.fn(async () => ({ id: 'acc-1', name: 'T', email: null })),
    logout: vi.fn(async () => {}),
    getToken: vi.fn(() => 'tok'),
  }),
}))

const SERVER_LINK = {
  object_id: 'server-link-1',
  object_type: 'link',
  revision: 1,
  deleted: false,
  deleted_at: null,
  payload: {
    id: 'server-link-1', object_id: 'server-link-1', revision: 1,
    url: 'https://pulled.example', normalizedUrl: 'https://pulled.example',
    originalUrl: 'https://pulled.example', title: 'Pulled Title',
    description: '', image: '', domain: 'pulled.example', category: 'Other',
    tags: [], important: false, mustHave: false, favorite: false,
    folderId: null, status: null, createdAt: '2026-01-01T00:00:00.000Z',
    savedFrom: 'Cloud',
  },
  created_at: 1,
  updated_at: 1,
}

beforeEach(async () => { await deleteDB() })
afterEach(async () => { await deleteDB() })

describe('coordinator -> real repository -> notifyDataChanged -> mounted useLinks reload (integration)', () => {
  it('a pulled link applied by the real syncNow appears in the mounted UI ref without a refresh', async () => {
    const { syncNow } = await import('./coordinator.js')
    const { useLinks } = await import('../composables/useLinks.js')
    const { session } = await import('../auth/session.js')
    await session.login()

    // Mount like App.vue mounts useLinks: within a live scope so the reload
    // subscriber is registered and stays alive for the sync.
    let linksRef
    const scope = effectScope()
    scope.run(() => { linksRef = useLinks().links })

    // Real syncNow with a real pull of one server object; the push phase is
    // irrelevant here (return unavailable so nothing else churns the store).
    const summary = await syncNow({
      pullFn: async () => ({ kind: 'ok', objects: [SERVER_LINK] }),
      pushFn: async () => [{ kind: 'unavailable', status: 503, reason: 'x' }],
    })
    await settle()

    expect(summary.applied).toBe(1)
    // REGRESSION GUARD: the ref rendered by the app MUST reflect the pulled link.
    expect(linksRef.value.length).toBe(1)
    expect(linksRef.value[0].id).toBe('server-link-1')
    expect(linksRef.value[0].revision).toBe(1)
    scope.stop()
  })

  it('a pulled folder also appears in the mounted folders ref without a refresh', async () => {
    const { syncNow } = await import('./coordinator.js')
    const { useFolders } = await import('../composables/useFolders.js')
    const { session } = await import('../auth/session.js')
    await session.login()

    let foldersRef
    const scope = effectScope()
    scope.run(() => { foldersRef = useFolders().folders })

    const serverFolder = {
      object_id: 'server-folder-1', object_type: 'folder', revision: 1,
      deleted: false, deleted_at: null,
      payload: { id: 'server-folder-1', name: 'Pulled Folder', revision: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      created_at: 1, updated_at: 1,
    }
    const summary = await syncNow({
      pullFn: async () => ({ kind: 'ok', objects: [serverFolder] }),
      pushFn: async () => [{ kind: 'unavailable', status: 503, reason: 'x' }],
    })
    await settle()

    expect(summary.applied).toBe(1)
    expect(foldersRef.value.length).toBe(1)
    expect(foldersRef.value[0].id).toBe('server-folder-1')
    expect(foldersRef.value[0].revision).toBe(1)
    scope.stop()
  })
})

describe('outbox coalescing end-to-end (real repository + coordinator, injected transports)', () => {
  async function bootAuthenticatedRepo() {
    const { syncNow } = await import('./coordinator.js')
    const { repository } = await import('../storage/repository.js')
    const { session } = await import('../auth/session.js')
    await session.login()
    return { syncNow, repository }
  }

  async function pendingFor(repository, objectId) {
    const all = await repository.getPendingMutations()
    return all.filter(m => m.object_id === objectId)
  }

  it('three consecutive updates are pushed exactly ONCE with the latest payload', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    const id = 'coalesce-push-once'

    await repository.addPendingMutation('create', id, 'link', { id, title: 'v1' }, 'acc-1', 0)
    await repository.addPendingMutation('update', id, 'link', { id, title: 'v2' }, 'acc-1', 0)
    await repository.addPendingMutation('update', id, 'link', { id, title: 'v3' }, 'acc-1', 0)

    const pushFn = vi.fn(async () => [{ kind: 'accepted', resultRevision: 1 }])
    await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })

    expect(pushFn).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(pushFn.mock.calls[0][0][0].payload)
    expect(sent.title).toBe('v3')
    expect(await pendingFor(repository, id)).toEqual([])
  })

  it('a single accepted mutation uses exactly 7 IndexedDB transactions (per-mutation ack path: 3)', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    const id = 'tx-count-accepted'

    await repository.addPendingMutation('create', id, 'link', { id, title: 'v1' }, 'acc-1', 0)

    const calls = []
    const originalTransaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      calls.push(args)
      return originalTransaction.apply(this, args)
    }
    let summary
    try {
      summary = await syncNow({
        pushFn: async () => [{ kind: 'accepted', resultRevision: 1 }],
        pullFn: async () => ({ kind: 'ok', objects: [] }),
      })
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction
    }

    expect(summary.succeeded).toBe(1)
    expect(await pendingFor(repository, id)).toEqual([])
    // 3 pull reads (getAllLinks, getAllFolders, getPendingMutations)
    // + 1 drain read (getPendingMutations)
    // + markMutationPushed + updateObjectRevision + markMutationSucceeded (ONE tx each)
    // = 7. The previous get-then-put mark pattern cost 10 for this same path.
    expect(calls.length).toBe(7)
  })

  it('a conflict rebase uses exactly 6 IndexedDB transactions (markPushed + one atomic rebase)', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    const id = 'tx-count-conflict'

    await repository.addPendingMutation('create', id, 'link', { id, title: 'v1' }, 'acc-1', 0)

    const calls = []
    const originalTransaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      calls.push(args)
      return originalTransaction.apply(this, args)
    }
    let summary
    try {
      summary = await syncNow({
        pushFn: async () => [{
          kind: 'conflict',
          reason: 'stale base',
          current: { object_id: id, object_type: 'link', revision: 3, deleted: false, deleted_at: null, payload: { id, title: 'server' } },
        }],
        pullFn: async () => ({ kind: 'ok', objects: [] }),
      })
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction
    }

    expect(summary.conflict).toBe(1)
    const pending = await pendingFor(repository, id)
    expect(pending.length).toBe(1) // rebased mutation waits for the next cycle
    // 3 pull reads + 1 drain read + markMutationPushed + rebasePendingMutation = 6
    // (the previous markMutationPushed get-then-put cost 7 for this path)
    expect(calls.length).toBe(6)
  })

  it('create then delete before any push sends nothing (no obsolete mutation pushed)', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    const id = 'coalesce-create-delete'

    await repository.addPendingMutation('create', id, 'link', { id, title: 'v1' }, 'acc-1', 0)
    await repository.addPendingMutation('delete', id, 'link', { id }, 'acc-1', 0)

    const pushFn = vi.fn(async () => [{ kind: 'accepted', resultRevision: 1 }])
    const summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })

    expect(pushFn).not.toHaveBeenCalled()
    expect(summary.pushed).toBe(0)
    expect(await pendingFor(repository, id)).toEqual([])
  })

  it('retry behavior unchanged: an unavailable response keeps the single coalesced mutation pending; the next sync pushes it', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    const id = 'coalesce-retry'

    await repository.addPendingMutation('create', id, 'link', { id, title: 'v1' }, 'acc-1', 0)
    await repository.addPendingMutation('update', id, 'link', { id, title: 'v2' }, 'acc-1', 0)
    expect((await pendingFor(repository, id)).length).toBe(1)

    const pushFn = vi.fn(async () => [{ kind: 'unavailable', status: 503, reason: 'x' }])
    let summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(pushFn).toHaveBeenCalledTimes(1)
    expect(summary.unavailable).toBe(1)
    expect((await pendingFor(repository, id)).length).toBe(1) // still pending, retried later

    pushFn.mockImplementation(async () => [{ kind: 'accepted', resultRevision: 1 }])
    summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(summary.succeeded).toBe(1)
    expect(await pendingFor(repository, id)).toEqual([])
  })

  it('conflict handling remains correct for a coalesced create: rebases as update against server revision', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    const id = 'coalesce-conflict'

    // Server already holds revision 3 for this object (e.g. another device).
    await repository.addPendingMutation('create', id, 'link', { id, title: 'v1' }, 'acc-1', 0)
    await repository.addPendingMutation('update', id, 'link', { id, title: 'v2' }, 'acc-1', 0)
    expect((await pendingFor(repository, id)).length).toBe(1)

    const serverCurrent = {
      object_id: id, object_type: 'link', revision: 3, deleted: false, deleted_at: null,
      payload: { id, title: 'server' },
    }
    const pushFn = vi.fn(async () => [{ kind: 'conflict', reason: 'stale base', current: serverCurrent }])
    const summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })

    expect(summary.conflict).toBe(1)
    const pending = await pendingFor(repository, id)
    expect(pending.length).toBe(1) // rebased mutation, processed next cycle
    expect(pending[0].operation).toBe('update') // create-on-existing converts to update
    expect(pending[0].base_revision).toBe(3) // rebased against the server revision
    expect(pending[0].status).toBe('pending') // waits for the next cycle
  })

  it('response-lost create → update: the newer payload is never replayed away and lands on the server', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    const id = 'lost-create-update'

    // Miniature in-memory server, faithful to store.js semantics: a ledger of
    // applied mutation_ids (idempotency replay returns the ORIGINAL result
    // without touching the object) and create/update/delete revision gates.
    // Drain order inside IndexedDB is by mutation_id (primary key), NOT
    // insertion order, so the fake must be identity-aware: the FIRST create it
    // ever sees is committed + ledgered and THEN the response is lost.
    const state = { revision: 0, deleted: false, payload: null }
    const ledger = new Map()
    let firstCreateSent = false
    const parse = (p) => (typeof p === 'string' ? JSON.parse(p) : p)
    const pushFn = vi.fn(async (chunk) => {
      // Batch contract: process members sequentially in chunk order. The
      // create is the chunk's only member on cycle 1; cycles 2-3 chunks hold
      // the (replaying) create next to the fresh mutation.
      const out = []
      for (const m of chunk) {
        if (ledger.has(m.mutation_id)) {
          out.push({ kind: 'accepted', resultRevision: ledger.get(m.mutation_id) })
          continue
        }
        if (m.operation === 'create') {
          state.revision = 1
          state.deleted = false
          state.payload = parse(m.payload)
          ledger.set(m.mutation_id, 1)
          if (!firstCreateSent) {
            // Server committed, response lost — the client sees only a network
            // error (the whole chunk rejects; here the chunk IS the create).
            firstCreateSent = true
            throw new Error('network: response lost after server commit')
          }
          out.push({ kind: 'accepted', resultRevision: 1 })
          continue
        }
        if (state.deleted) {
          out.push({ kind: 'conflict', current: { revision: state.revision, deleted: true, payload: null } })
          continue
        }
        if (m.base_revision !== state.revision) {
          out.push({ kind: 'conflict', current: { revision: state.revision, deleted: false, payload: state.payload } })
          continue
        }
        state.revision += 1
        if (m.operation === 'delete') {
          state.deleted = true
          state.payload = null
        } else {
          state.payload = parse(m.payload)
        }
        ledger.set(m.mutation_id, state.revision)
        out.push({ kind: 'accepted', resultRevision: state.revision })
      }
      return out
    })

    // cycle 1: the create's request is delivered and committed server-side,
    // but the response is lost. The client counts unavailable and the record
    // keeps its pushed=true marker.
    await repository.addPendingMutation('create', id, 'link', { id, title: 'v1' }, 'acc-1', 0)
    let summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(summary.unavailable).toBe(1)
    let pending = await pendingFor(repository, id)
    expect(pending.length).toBe(1)
    expect(pending[0].pushed).toBe(true)

    // User edits to v2 while the create is still pending: the pushed create is
    // never rewritten — a fresh update mutation with its own id appends.
    await repository.addPendingMutation('update', id, 'link', { id, title: 'v2' }, 'acc-1', 0)
    pending = await pendingFor(repository, id)
    expect(pending.length).toBe(2)
    const create = pending.find(m => m.operation === 'create')
    const fresh = pending.find(m => m.operation === 'update')
    expect(create.payload.title).toBe('v1') // original create untouched
    expect(create.pushed).toBe(true)
    expect(fresh).toBeDefined()
    expect(fresh.mutation_id).not.toBe(create.mutation_id)
    expect(fresh.pushed).toBe(false)

    // cycle 2: the old create idempotency-replays (original payload, NOT
    // re-applied); the fresh update conflicts (server at rev 1) and rebases as
    // update@1. Order inside the drain is irrelevant — both converge.
    summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(summary.succeeded).toBe(1) // the create replay
    expect(summary.conflict).toBe(1) // the fresh update rebased
    pending = await pendingFor(repository, id)
    expect(pending.length).toBe(1) // only the rebased update remains
    expect(pending[0].operation).toBe('update')
    expect(pending[0].base_revision).toBe(1)

    // cycle 3: the rebased update applies — the newest payload is on the server.
    summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(summary.succeeded).toBe(1)
    expect(await pendingFor(repository, id)).toEqual([])
    expect(state.payload).toEqual({ id, title: 'v2' }) // newest content, not the replayed v1
  })

  it('response-lost create → delete: the delete intent is never dropped and the server object ends deleted', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    const id = 'lost-create-delete'

    const state = { revision: 0, deleted: false, payload: null }
    const ledger = new Map()
    let firstCreateSent = false
    const parse = (p) => (typeof p === 'string' ? JSON.parse(p) : p)
    const pushFn = vi.fn(async (chunk) => {
      const out = []
      for (const m of chunk) {
        if (ledger.has(m.mutation_id)) {
          out.push({ kind: 'accepted', resultRevision: ledger.get(m.mutation_id) })
          continue
        }
        if (m.operation === 'create') {
          state.revision = 1
          state.deleted = false
          state.payload = parse(m.payload)
          ledger.set(m.mutation_id, 1)
          if (!firstCreateSent) {
            firstCreateSent = true
            throw new Error('network: response lost after server commit')
          }
          out.push({ kind: 'accepted', resultRevision: 1 })
          continue
        }
        if (state.deleted) {
          out.push({ kind: 'conflict', current: { revision: state.revision, deleted: true, payload: null } })
          continue
        }
        if (m.base_revision !== state.revision) {
          out.push({ kind: 'conflict', current: { revision: state.revision, deleted: false, payload: state.payload } })
          continue
        }
        state.revision += 1
        if (m.operation === 'delete') {
          state.deleted = true
          state.payload = null
        } else {
          state.payload = parse(m.payload)
        }
        ledger.set(m.mutation_id, state.revision)
        out.push({ kind: 'accepted', resultRevision: state.revision })
      }
      return out
    })

    // cycle 1: create delivered + committed server-side, response lost.
    await repository.addPendingMutation('create', id, 'link', { id, title: 'v1' }, 'acc-1', 0)
    let summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(summary.unavailable).toBe(1)
    let pending = await pendingFor(repository, id)
    expect(pending.length).toBe(1)
    expect(pending[0].pushed).toBe(true)

    // User deletes before retry: the pushed create must NOT be dropped — a
    // fresh delete mutation stays queued next to it.
    await repository.addPendingMutation('delete', id, 'link', { id }, 'acc-1', 0)
    pending = await pendingFor(repository, id)
    expect(pending.length).toBe(2)
    const create = pending.find(m => m.operation === 'create')
    const freshDelete = pending.find(m => m.operation === 'delete')
    expect(create).toBeDefined()
    expect(create.pushed).toBe(true)
    expect(freshDelete).toBeDefined()
    expect(freshDelete.mutation_id).not.toBe(create.mutation_id)

    // cycle 2: create replays; the fresh delete conflicts (rev 1) and rebases
    // as delete@1 — order inside the drain is irrelevant.
    summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(summary.succeeded).toBe(1)
    expect(summary.conflict).toBe(1)
    pending = await pendingFor(repository, id)
    expect(pending.length).toBe(1)
    expect(pending[0].operation).toBe('delete')
    expect(pending[0].base_revision).toBe(1)

    // cycle 3: the rebased delete applies — final server state is deleted.
    summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(summary.succeeded).toBe(1)
    expect(await pendingFor(repository, id)).toEqual([])
    expect(state.deleted).toBe(true)
  })

  it('syncState recovers after a push that throws: isSyncing() is false and a later sync succeeds', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    const { isSyncing } = await import('./syncState.js')
    const id = 'throw-recovery'
    const pushFn = vi.fn(async () => { throw new Error('flaky network') })

    await repository.addPendingMutation('create', id, 'link', { id, title: 'v1' }, 'acc-1', 0)
    const summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })

    expect(summary.unavailable).toBe(1)
    expect(isSyncing()).toBe(false) // begin/end stayed balanced under the throw

    // The marker was persisted before the attempt, so the mutation remains
    // protected; a second, healthy sync completes normally.
    expect((await pendingFor(repository, id))[0].pushed).toBe(true)
    pushFn.mockImplementation(async () => [{ kind: 'accepted', resultRevision: 1 }])
    const retry = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(retry.succeeded).toBe(1)
    expect(await pendingFor(repository, id)).toEqual([])
  })

  it('30 pending mutations drain over exactly 2 realistic requests (25 + 5)', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    for (let i = 0; i < 30; i++) {
      await repository.addPendingMutation('create', `batch-${i}`, 'link', { id: `batch-${i}`, title: `v${i}` }, 'acc-1', 0)
    }
    const pushFn = vi.fn(async (chunk) => chunk.map((m, i) => ({ kind: 'accepted', resultRevision: 1 })))
    const summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })

    expect(summary.pushed).toBe(30)
    expect(summary.succeeded).toBe(30)
    expect(pushFn).toHaveBeenCalledTimes(2)
    expect(pushFn.mock.calls[0][0]).toHaveLength(25)
    expect(pushFn.mock.calls[1][0]).toHaveLength(5)
    for (let i = 0; i < 30; i++) {
      expect(await pendingFor(repository, `batch-${i}`)).toEqual([])
    }
  })

  it('mixed results in one real batch: accepted applies, conflict rebases, unavailable stays pending', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    await repository.addPendingMutation('create', 'mx-1', 'link', { id: 'mx-1', title: 'a' }, 'acc-1', 0)
    await repository.addPendingMutation('create', 'mx-2', 'link', { id: 'mx-2', title: 'b' }, 'acc-1', 0)
    await repository.addPendingMutation('create', 'mx-3', 'link', { id: 'mx-3', title: 'c' }, 'acc-1', 0)

    const pushFn = vi.fn(async (chunk) => chunk.map((m) => {
      if (m.object_id === 'mx-1') return { kind: 'accepted', resultRevision: 1 }
      if (m.object_id === 'mx-2') return { kind: 'conflict', reason: 'stale base', current: { object_id: 'mx-2', object_type: 'link', revision: 3, deleted: false, deleted_at: null, payload: { id: 'mx-2', title: 'server' } } }
      return { kind: 'unavailable', status: 503, reason: 'x' }
    }))
    const summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    expect(summary.succeeded).toBe(1)
    expect(summary.conflict).toBe(1)
    expect(summary.unavailable).toBe(1)

    // mx-2 rebased as update@3; mx-3 still pending (unavailable)
    const mx2 = await pendingFor(repository, 'mx-2')
    expect(mx2).toHaveLength(1)
    expect(mx2[0].operation).toBe('update')
    expect(mx2[0].base_revision).toBe(3)
    expect(await pendingFor(repository, 'mx-3')).toHaveLength(1)
    expect(await pendingFor(repository, 'mx-1')).toEqual([])
  })

  it('marker failure with the REAL repository: the unprotected member is not sent, its sibling is', async () => {
    const { syncNow, repository } = await bootAuthenticatedRepo()
    await repository.addPendingMutation('create', 'mk-1', 'link', { id: 'mk-1', title: 'a' }, 'acc-1', 0)
    await repository.addPendingMutation('create', 'mk-2', 'link', { id: 'mk-2', title: 'b' }, 'acc-1', 0)

    // Drain order is by mutation_id (primary key), and mutation_id is a random
    // UUID: we cannot know a priori which member drains first. Read the real
    // drain order and make the FIRST member's marker fail while the second
    // succeeds; every assertion below tracks whichever member that turns out
    // to be, so the test is deterministic under any UUID ordering.
    const all = await repository.getPendingMutations()
    const failMutation = all[0]
    const okMutation = all[1]
    const originalMark = repository.markMutationPushed
    const spy = vi.spyOn(repository, 'markMutationPushed').mockImplementation(async (mutationId) => {
      if (mutationId === failMutation.mutation_id) throw new Error('idb tx failed')
      return originalMark.call(repository, mutationId)
    })

    const pushFn = vi.fn(async (chunk) => chunk.map(() => ({ kind: 'accepted', resultRevision: 1 })))
    let summary
    try {
      summary = await syncNow({ pushFn, pullFn: async () => ({ kind: 'ok', objects: [] }) })
    } finally {
      spy.mockRestore()
    }

    expect(summary.unavailable).toBe(1)
    expect(summary.succeeded).toBe(1)
    // The unsafe member was never sent; the safe one went out alone.
    expect(pushFn).toHaveBeenCalledTimes(1)
    expect(pushFn.mock.calls[0][0]).toHaveLength(1)
    expect(pushFn.mock.calls[0][0][0].mutation_id).toBe(okMutation.mutation_id)
    // The sibling was handled normally: accepted => removed from the outbox.
    expect(await pendingFor(repository, okMutation.object_id)).toEqual([])
    // The failed one is still pending with pushed=false (not protected, retried).
    const failedPending = await pendingFor(repository, failMutation.object_id)
    expect(failedPending).toHaveLength(1)
    expect(failedPending[0].pushed).toBe(false)
  })
})