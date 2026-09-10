// Focused regression: "link does not appear in the UI immediately after a
// save, while the server accepted it (POST -> 200, result_revision: 1) and
// the very next GET /api/sync/objects returns it (envelope revision 1,
// payload.revision 0). A page refresh / another sync makes it appear."
//
// Real modules everywhere except the wire: real useLinks/useFolders/useSync/
// coordinator/protocol/repository, fake-indexeddb, a fake session via the
// http-adapter mock, and an in-memory server (globalThis.fetch) whose claim
// semantics mirror worker/db/store.js — a create is accepted only while the
// object is absent, the payload blob is stored verbatim (so a create's
// payload keeps the client-side revision 0 while the envelope revision is 1),
// and every write is gated on deleted = 0.
//
// Test 1 asserts the plain happy path (save -> sync -> sync) keeps the link
// visible in the reactive ref and the store.
//
// Test 2 reproduces the reload-vs-save race and asserts the FIXED behavior:
// a pull that applies a REMOTE object fires notifyDataChanged; the reload
// handler in useLinks replaces the reactive ref from a store snapshot read
// while the persistence watch is suppressed (isReloadingFromRemote). A save
// landing inside that window must survive: the reload reconcile preserves the
// record (pending create/update, absent from the snapshot) in the ref AND the
// store, the mutation still reaches the server, and a later pull neither
// duplicates nor drops it.
//
// Test 3 (links) and Test 4 (folders) cover the symmetric delete race: a
// delete queued inside the reload window must not be resurrected by a stale
// snapshot record, must reach the server, and must stay deleted after the
// next pull.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, effectScope } from 'vue'
import 'fake-indexeddb/auto'
import { defaultDBName } from '../storage/indexeddb.js'
import { repository } from '../storage/repository.js'
import { syncNow } from '../composables/useSync.js'

const DB_NAME = defaultDBName()
function deleteDB() {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

async function settle(times = 4) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

// App-singleton session appears authenticated (login -> acc-1).
vi.mock('../auth/http-adapter.js', () => ({
  createHttpAdapter: () => ({
    init: vi.fn(async () => null),
    login: vi.fn(async () => ({ id: 'acc-1', name: 'T', email: null })),
    logout: vi.fn(async () => {}),
    getToken: vi.fn(() => 'tok'),
  }),
}))

const { onDataChanged } = await import('../storage/dataChanges.js')

const realFetch = globalThis.fetch
beforeEach(async () => { await deleteDB() })
afterEach(async () => { globalThis.fetch = realFetch; await deleteDB() })

function makeRemoteLink(id) {
  return {
    object_type: 'link',
    object_id: id,
    revision: 1,
    deleted: false,
    deleted_at: null,
    payload: {
      id, object_id: id, revision: 1,
      url: `https://example.com/${id}`, normalizedUrl: `https://example.com/${id}`,
      originalUrl: `https://example.com/${id}`, title: `Remote ${id}`, description: '', image: '',
      domain: 'example.com', category: 'Other', tags: [], important: false, mustHave: false,
      favorite: false, folderId: null, status: null, createdAt: '2026-01-01T00:00:00.000Z',
      savedFrom: 'Cloud', account_id: 'acc-1',
    },
    created_at: 1,
    updated_at: 1,
  }
}

function makeRemoteFolder(id) {
  return {
    object_type: 'folder',
    object_id: id,
    revision: 1,
    deleted: false,
    deleted_at: null,
    payload: {
      id, name: `Folder ${id}`, createdAt: '2026-01-01T00:00:00.000Z', revision: 1, account_id: 'acc-1',
    },
    created_at: 1,
    updated_at: 1,
  }
}

// In-memory server mirroring worker/db/store.js. Each GET returns the current
// object set — payload stored verbatim (as parsed from the wire), envelope
// revision authoritative. A gate lets the test hold a pull open (the network
// round-trip the browser user sees as "the pull is in flight") and resolve it
// later with a chosen object set.
function createGatedServer() {
  const objects = new Map()
  const pendingGets = []

  const fetch = vi.fn(async (url, opts = {}) => {
    if (url === '/api/sync/objects') {
      // Hold the response open until the test resolves it (real latency).
      return new Promise((resolve) => { pendingGets.push(resolve) })
    }
    if (url === '/api/sync/mutations') {
      const body = JSON.parse(opts.body)
      const results = body.mutations.map((m) => {
        const cur = objects.get(m.object_id)
        if (m.operation === 'create') {
          if (cur) return { mutation_id: m.mutation_id, accepted: false, reason: 'revision_conflict', current: null }
          // Verbatim payload: the create payload carries the client-side
          // revision (0), while the envelope revision becomes 1.
          objects.set(m.object_id, {
            object_type: m.object_type, object_id: m.object_id, revision: 1,
            deleted: false, deleted_at: null,
            payload: JSON.parse(m.payload), created_at: 1, updated_at: 1,
          })
          return { mutation_id: m.mutation_id, accepted: true, result_revision: 1 }
        }
        if (!cur || cur.deleted || cur.revision !== m.base_revision) {
          return { mutation_id: m.mutation_id, accepted: false, reason: 'revision_conflict', current: cur }
        }
        const rev = cur.revision + 1
        if (m.operation === 'delete') {
          objects.set(m.object_id, { ...cur, revision: rev, deleted: true, deleted_at: Date.now() })
        } else {
          objects.set(m.object_id, { ...cur, revision: rev, payload: JSON.parse(m.payload) })
        }
        return { mutation_id: m.mutation_id, accepted: true, result_revision: rev }
      })
      return { status: 200, json: async () => ({ accepted: true, results }) }
    }
    return { status: 404, json: async () => ({ error: 'not found' }) }
  })

  return {
    fetch,
    objects,
    pendingGets,
    resolveNextGet(objectsToReturn) {
      const resolve = pendingGets.shift()
      resolve({ status: 200, json: async () => ({ objects: objectsToReturn }) })
    },
  }
}

// Drive a sync (and any chained syncNow re-drain it triggers) to completion:
// mutations queued MID-sync can miss that sync's push phase and start a
// follow-up sync; single-shot resolveNextGet would deadlock on its gated GET.
// Resolve every GET as it appears and only return once the promise settled
// and no gate is left open.
async function pumpUntil(server, promise) {
  while (server.pendingGets.length) server.resolveNextGet([...server.objects.values()])
  while (true) {
    const settled = await Promise.race([
      promise.then(() => true, () => true),
      new Promise((r) => setTimeout(() => r(false), 0)),
    ])
    while (server.pendingGets.length) server.resolveNextGet([...server.objects.values()])
    if (settled && !server.pendingGets.length) break
    await new Promise((r) => setTimeout(r, 0))
  }
}

async function mountLinks() {
  const { useLinks } = await import('../composables/useLinks.js')
  const scope = effectScope()
  let links
  scope.run(() => { links = useLinks() })
  return { scope, links }
}

async function mountFolders() {
  const { useFolders } = await import('../composables/useFolders.js')
  const scope = effectScope()
  let folders
  scope.run(() => { folders = useFolders() })
  return { scope, folders }
}

describe('new link visibility after save + sync (regression: link missing from UI while server has it)', () => {
  it('happy path: a plain authenticated save stays visible in the ref and the store through syncs', async () => {
    const server = createGatedServer()
    globalThis.fetch = server.fetch

    const { scope, links } = await mountLinks()
    const { session } = await import('../auth/session.js')
    await session.login()

    const saved = await links.addLink({ originalUrl: 'https://github.com/shadcn-ui/ui' })
    // The save itself renders the link — the ref is the UI.
    expect(links.links.value.some(l => l.id === saved.id)).toBe(true)

    // First sync: pull (empty) then push the create.
    let sync = syncNow()
    await settle()
    server.resolveNextGet([]) // pull sees nothing yet
    await sync
    await settle()
    expect([...server.objects.values()].map(o => o.object_id)).toEqual([saved.id])
    expect([...server.objects.values()][0].revision).toBe(1)

    // Second sync: pull returns the created object (envelope rev 1,
    // payload.revision still 0 — stored verbatim). Reconcile must apply it:
    // link stays in ref AND store.
    sync = syncNow()
    await settle()
    server.resolveNextGet([...server.objects.values()])
    await sync
    await settle()

    const ids = links.links.value.map(l => l.id)
    expect(ids).toContain(saved.id)
    const stored = (await repository.getAllLinks()).map(l => l.id)
    expect(stored).toContain(saved.id)
    scope.stop()
  })

  it('save landing inside a pull-reload window: the link survives in ref and store, still reaches the server, and a later pull does not duplicate it', async () => {
    const server = createGatedServer()
    globalThis.fetch = server.fetch

    const { scope, links } = await mountLinks()
    const { session } = await import('../auth/session.js')
    await session.login()

    // A remote object exists on the server (the account has prior data), so
    // the next reconcile applies something and fires notifyDataChanged.
    const remote = makeRemoteLink('remote-A')
    server.objects.set(remote.object_id, remote)

    // The reload window: this listener fires synchronously inside
    // notifyDataChanged, i.e. between the reconcile's notify and the
    // useLinks reload-handler's store read completing — the window in which a
    // real user's save hits (the ref unshift lands while the reload's
    // isReloadingFromRemote guard suppresses the persistence watch, and the
    // reload snapshot predates the save).
    let failCleanup = null
    const off = onDataChanged(() => {
      failCleanup = links.addLink({ originalUrl: 'https://github.com/shadcn-ui/ui' })
    })

    // Restore-style sync: pull in flight (server latency), then the save
    // above lands inside the reload window, then the pull resolves and the
    // reconcile applies remote-A -> notify -> the save fires -> reload.
    let sync = syncNow()
    await settle()
    server.resolveNextGet([remote])
    await sync
    await settle()

    const saved = await failCleanup
    expect(saved).toBeTruthy()
    off()

    // --- the server accepted the create... ---
    const serverLink = [...server.objects.values()].find(o => o.object_id === saved.id)
    expect(serverLink).toBeDefined()
    expect(serverLink.revision).toBe(1)

    // ...and the link SURVIVES in the ref and the store (the reload reconcile
    // preserves the local record whose persistence the reload guard swallowed).
    expect(links.links.value.map(l => l.id)).toContain(saved.id)
    expect((await repository.getAllLinks()).map(l => l.id)).toContain(saved.id)

    // The create mutation was pushed and acknowledged — nothing stays pending.
    expect(await repository.getPendingMutations()).toEqual([])

    // A later pull re-applies the server object: no duplicate, no drop, and
    // the sync reaches idle (no lingering gate, nothing pending).
    sync = syncNow()
    await settle()
    server.resolveNextGet([...server.objects.values()])
    await sync
    await settle()

    expect(server.pendingGets).toHaveLength(0)
    expect(links.links.value.filter(l => l.id === saved.id)).toHaveLength(1)
    expect((await repository.getAllLinks()).filter(l => l.id === saved.id)).toHaveLength(1)
    expect([...server.objects.values()].filter(o => o.object_id === saved.id)).toHaveLength(1)
    expect(await repository.getPendingMutations()).toEqual([])
    scope.stop()
  })

  it('delete landing inside a pull-reload window: the stale snapshot must not resurrect the deleted link', async () => {
    const server = createGatedServer()
    globalThis.fetch = server.fetch

    const { scope, links } = await mountLinks()
    const { session } = await import('../auth/session.js')
    await session.login()

    // Seed the account with one link and pull it in (ref + store + server).
    const remoteA = makeRemoteLink('remote-A')
    const remoteB = makeRemoteLink('remote-B')
    server.objects.set(remoteA.object_id, remoteA)

    let sync = syncNow()
    await pumpUntil(server, sync)
    await settle()
    expect(links.links.value.map(l => l.id)).toContain('remote-A')

    // A server-side addition makes the next pull apply something -> notify ->
    // reload window. Inside it, the local delete lands.
    server.objects.set(remoteB.object_id, remoteB)
    let del = null
    const off = onDataChanged(() => {
      if (links.links.value.some(l => l.id === 'remote-A')) del = links.removeLink('remote-A')
    })

    sync = syncNow()
    await pumpUntil(server, sync)
    await settle()
    await del
    off()

    // The stale snapshot (read BEFORE the delete landed) must NOT resurrect
    // remote-A: the ref AND the store both drop it.
    expect(links.links.value.map(l => l.id)).not.toContain('remote-A')
    expect((await repository.getAllLinks()).map(l => l.id)).not.toContain('remote-A')

    // The delete mutation reached the server.
    const serverA = [...server.objects.values()].find(o => o.object_id === 'remote-A')
    expect(serverA).toBeDefined()
    expect(serverA.deleted).toBe(true)

    // Another pull (server tombstone) keeps it deleted — no resurrection and
    // no duplicates; sync reaches idle.
    sync = syncNow()
    await pumpUntil(server, sync)
    await settle()

    expect(server.pendingGets).toHaveLength(0)
    expect(links.links.value.map(l => l.id)).not.toContain('remote-A')
    expect(links.links.value.map(l => l.id)).toContain('remote-B')
    expect((await repository.getAllLinks()).map(l => l.id)).not.toContain('remote-A')
    expect(await repository.getPendingMutations()).toEqual([])
    scope.stop()
  })

  it('delete race for folders: the stale snapshot must not resurrect a locally deleted folder', async () => {
    const server = createGatedServer()
    globalThis.fetch = server.fetch

    const { scope, folders } = await mountFolders()
    const { session } = await import('../auth/session.js')
    await session.login()

    // Create a local folder and sync it up.
    const victim = folders.createFolder('Victim')
    const victimId = victim.id
    await settle()
    let sync = syncNow()
    await pumpUntil(server, sync)
    await settle()
    expect([...server.objects.keys()]).toContain(victimId)
    expect(server.objects.get(victimId).revision).toBe(1)

    // A remote folder makes the next pull apply something -> notify -> reload
    // window. Inside it, the local delete lands.
    const remoteFolder = makeRemoteFolder('remote-Folder-A')
    server.objects.set(remoteFolder.object_id, remoteFolder)
    let del = null
    const off = onDataChanged(() => {
      if (folders.folders.value.some(f => f.id === victimId)) del = folders.deleteFolder(victimId)
    })

    sync = syncNow()
    await pumpUntil(server, sync)
    await settle()
    await del
    off()

    // No resurrection: ref AND store both drop the folder; the delete reached
    // the server.
    expect(folders.folders.value.map(f => f.id)).not.toContain(victimId)
    expect((await repository.getAllFolders()).map(f => f.id)).not.toContain(victimId)
    const serverFolder = server.objects.get(victimId)
    expect(serverFolder).toBeDefined()
    expect(serverFolder.deleted).toBe(true)

    // Another pull keeps it deleted — no resurrection, no duplicates; idle.
    sync = syncNow()
    await pumpUntil(server, sync)
    await settle()

    expect(server.pendingGets).toHaveLength(0)
    expect(folders.folders.value.map(f => f.id)).not.toContain(victimId)
    expect(folders.folders.value.map(f => f.id)).toContain(remoteFolder.object_id)
    expect((await repository.getAllFolders()).map(f => f.id)).not.toContain(victimId)
    expect(await repository.getPendingMutations()).toEqual([])
    scope.stop()
  })
})