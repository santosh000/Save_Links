// Deterministic end-to-end reproductions for bug C (post-merge divergence) and
// the sync-termination guarantee (bug B surface), exercising the COMPLETE
// mutation lifecycle with real modules:
//
//   local action -> IndexedDB persistence -> mutation queue -> real coordinator
//   -> real protocol -> fake HTTP server -> accepted/conflict -> revision
//   update -> reactive state -> next sync
//
// The only things faked: the session's http-adapter (to log in as acc-1) and
// globalThis.fetch (an in-memory server whose claim semantics mirror
// worker/db/store.js: every write is gated on the object's exact pre-mutation
// state, every claim requires deleted = 0, results are aligned per mutation).
// Everything else — repository, IndexedDB (fake-indexeddb), the coordinator,
// the protocol, useLinks/useFolders, useSync — is the real production code.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, effectScope } from 'vue'
import 'fake-indexeddb/auto'
import { defaultDBName } from '../storage/indexeddb.js'
import { repository } from '../storage/repository.js'
import { syncNow, syncNowWithMutations } from '../composables/useSync.js'

const DB_NAME = defaultDBName()
function deleteDB() {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

// Let the fire-and-forget reload (await repository.getAllLinks), Vue's
// scheduler, and the watch -> setAllLinks persistence settle. Bounded and
// deterministic — no polling, no sleeps.
async function settle(times = 3) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

// Make the app-singleton session appear authenticated (login -> acc-1).
vi.mock('../auth/http-adapter.js', () => ({
  createHttpAdapter: () => ({
    init: vi.fn(async () => null),
    login: vi.fn(async () => ({ id: 'acc-1', name: 'T', email: null })),
    logout: vi.fn(async () => {}),
    getToken: vi.fn(() => 'tok'),
  }),
}))

const realFetch = globalThis.fetch
beforeEach(async () => { await deleteDB() })
afterEach(async () => { globalThis.fetch = realFetch; await deleteDB() })

// ---- fixtures ---------------------------------------------------------------

function makeLink(id, revision = 1, overrides = {}) {
  return {
    object_type: 'link',
    object_id: id,
    revision,
    deleted: false,
    deleted_at: null,
    payload: {
      id, object_id: id, revision,
      url: `https://example.com/${id}`, normalizedUrl: `https://example.com/${id}`,
      originalUrl: `https://example.com/${id}`, title: `Link ${id}`, description: '', image: '',
      domain: 'example.com', category: 'Other', tags: [], important: false, mustHave: false,
      favorite: false, folderId: null, status: null, createdAt: '2026-01-01T00:00:00.000Z',
      savedFrom: 'Cloud', account_id: 'acc-1',
    },
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

function makeFolder(id, revision = 1, overrides = {}) {
  return {
    object_type: 'folder',
    object_id: id,
    revision,
    deleted: false,
    deleted_at: null,
    payload: { id, name: `Folder ${id}`, revision, createdAt: '2026-01-01T00:00:00.000Z', account_id: 'acc-1' },
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

function anonLink(id) {
  return {
    id, url: `https://example.com/${id}`, normalizedUrl: `https://example.com/${id}`,
    originalUrl: `https://example.com/${id}`, title: `Link ${id}`, description: '', image: '',
    domain: 'example.com', category: 'Other', tags: [], important: false, mustHave: false,
    favorite: false, folderId: null, status: null, revision: 0,
    createdAt: '2026-01-02T00:00:00.000Z', savedFrom: 'Local',
  }
}

function anonFolder(id) {
  return { id, name: `Folder ${id}`, createdAt: '2026-01-02T00:00:00.000Z', revision: 0 }
}

// In-memory server whose write claims mirror worker/db/store.js:
//   - create: absent object only (rev 1); update/delete: live object whose
//     revision equals base_revision (rev + 1)
//   - every claim requires deleted = 0 -> a tombstone can never be overwritten
//   - conflicts carry the server's current object (or null)
// Wire results match protocol.pushMutations' expectation: 200 + { accepted,
// results } with one per-mutation entry in input order.
function createFakeServer(seed = []) {
  const objects = new Map()
  for (const o of seed) objects.set(o.object_id, { ...o })

  function current(id) {
    const o = objects.get(id)
    if (!o) return null
    return { object_type: o.object_type, object_id: o.object_id, revision: o.revision, deleted: o.deleted, deleted_at: o.deleted_at, payload: o.payload }
  }

  function apply(m) {
    const cur = current(m.object_id)
    if (m.operation === 'create') {
      if (cur) return { kind: 'conflict', current: cur }
      objects.set(m.object_id, { object_type: m.object_type, object_id: m.object_id, revision: 1, deleted: false, deleted_at: null, payload: JSON.parse(m.payload) })
      return { kind: 'accepted', resultRevision: 1 }
    }
    if (!cur || cur.deleted || cur.revision !== m.base_revision) {
      return { kind: 'conflict', current: cur }
    }
    const rev = cur.revision + 1
    if (m.operation === 'delete') {
      objects.set(m.object_id, { ...cur, revision: rev, deleted: true, deleted_at: Date.now() })
    } else { // update
      objects.set(m.object_id, { ...cur, revision: rev, payload: JSON.parse(m.payload) })
    }
    return { kind: 'accepted', resultRevision: rev }
  }

  const fetch = vi.fn(async (url, opts = {}) => {
    if (url === '/api/sync/objects') {
      return { status: 200, json: async () => ({ objects: [...objects.values()] }) }
    }
    if (url === '/api/sync/mutations') {
      const body = JSON.parse(opts.body)
      const results = body.mutations.map((m) => {
        const r = apply(m)
        return r.kind === 'accepted'
          ? { mutation_id: m.mutation_id, accepted: true, result_revision: r.resultRevision }
          : { mutation_id: m.mutation_id, accepted: false, reason: 'revision_conflict', current: r.current }
      })
      return { status: 200, json: async () => ({ accepted: true, results }) }
    }
    return { status: 404, json: async () => ({ error: 'not found' }) }
  })
  return { fetch, objects }
}

// Mirrors App.vue handleAnonymousSyncChoice('merge'): deep-unwrap each anon
// record, queue a create at base 0 with the account identity, mark the
// reactive records owned, then sync and wait for the creates to drain.
async function mergeAnonymous(linksRef, foldersRef) {
  const accountId = 'acc-1'
  const anonLinks = linksRef.value.filter(l => !l.account_id && !l.kept_local)
  const anonFolders = foldersRef.value.filter(f => !f.account_id && !f.kept_local)

  for (const link of anonLinks) {
    const plain = JSON.parse(JSON.stringify(link))
    await repository.addPendingMutation('create', plain.id, 'link', { ...plain, account_id: accountId }, accountId, 0)
  }
  for (const folder of anonFolders) {
    const plain = JSON.parse(JSON.stringify(folder))
    await repository.addPendingMutation('create', plain.id, 'folder', { ...plain, account_id: accountId }, accountId, 0)
  }

  const linkIds = new Set(anonLinks.map(l => l.id))
  const folderIds = new Set(anonFolders.map(f => f.id))
  linksRef.value = linksRef.value.map(l => (linkIds.has(l.id) ? { ...l, account_id: accountId } : l))
  foldersRef.value = foldersRef.value.map(f => (folderIds.has(f.id) ? { ...f, account_id: accountId } : f))

  await syncNowWithMutations()
  await settle()
}

async function mountComposables() {
  const { useLinks } = await import('../composables/useLinks.js')
  const { useFolders } = await import('../composables/useFolders.js')
  const scope = effectScope()
  let links, folders
  scope.run(() => {
    links = useLinks()
    folders = useFolders()
  })
  return { scope, links, folders }
}

const pendingForAccount = async () =>
  (await repository.getPendingMutations()).filter(m => m.status === 'pending')

// ---- reproductions ----------------------------------------------------------

describe('mutation lifecycle — restore + merge + one-link delete (bug C reproduction)', () => {
  it('remote multi-object, merge/claim, ONE delete: exactly one remote deletion, reload keeps everything else', async () => {
    const server = createFakeServer([makeLink('A'), makeLink('B'), makeLink('C'), makeFolder('F')])
    globalThis.fetch = server.fetch

    const { scope, links, folders } = await mountComposables()

    // Local anonymous data (pre-login) + G as an anonymous folder.
    links.links.value = [anonLink('D'), anonLink('E')]
    folders.folders.value = [anonFolder('G')]
    await settle()

    const { session } = await import('../auth/session.js')
    await session.login()

    // Restore + Sync & Merge: pulls A/B/C/F, creates D/E/G at base 0.
    await mergeAnonymous(links.links, folders.folders)

    expect(links.links.value.map(l => l.id).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(folders.folders.value.map(f => f.id).sort()).toEqual(['F', 'G'])
    expect(links.links.value.every(l => l.account_id === 'acc-1')).toBe(true)
    expect((await pendingForAccount()).length).toBe(0) // queue is idle
    expect([...server.objects.values()].filter(o => o.deleted)).toEqual([])

    // One-link delete: the delete claims the pulled store-acknowledged rev (1).
    await links.removeLink('A')
    await syncNow()
    await settle()

    // EXACTLY one remote deletion, nothing else touched.
    const tombstones = [...server.objects.values()].filter(o => o.deleted)
    expect(tombstones.map(o => ({ type: o.object_type, id: o.object_id }))).toEqual([{ type: 'link', id: 'A' }])
    expect([...server.objects.values()].filter(o => !o.deleted).map(o => o.object_id).sort())
      .toEqual(['B', 'C', 'D', 'E', 'F', 'G'])
    const tomb = tombstones[0]
    expect(tomb.revision).toBe(2) // A's delete landed at rev+1
    expect((await pendingForAccount()).length).toBe(0)

    // "Reload": a fresh read of the authoritative store (what boot produces).
    expect((await repository.getAllLinks()).map(l => l.id).sort()).toEqual(['B', 'C', 'D', 'E'])
    expect((await repository.getAllFolders()).map(f => f.id).sort()).toEqual(['F', 'G'])

    // Repeated sync converges: server state unchanged, queue stays idle, no
    // re-delete invented.
    await syncNow()
    await syncNow()
    await settle()
    expect([...server.objects.values()].filter(o => o.deleted).map(o => o.object_id)).toEqual(['A'])
    expect((await pendingForAccount()).length).toBe(0)
    expect(links.links.value.map(l => l.id).sort()).toEqual(['B', 'C', 'D', 'E'])

    scope.stop()
  })
})

describe('mutation lifecycle — merge, edit one, delete another (bug C reproduction, inverse)', () => {
  it('edit and delete survive repeated sync; exactly one deletion on reload', async () => {
    const server = createFakeServer([makeLink('A'), makeFolder('F')])
    globalThis.fetch = server.fetch

    const { scope, links, folders } = await mountComposables()
    links.links.value = [anonLink('D'), anonLink('E')]
    folders.folders.value = []
    await settle()

    const { session } = await import('../auth/session.js')
    await session.login()
    await mergeAnonymous(links.links, folders.folders)

    // Edit D, delete a DIFFERENT item (A).
    await links.updateLink('D', { title: 'Edited D' })
    await syncNow()
    await settle()

    await links.removeLink('A')
    await syncNow()
    await settle()

    // Repeated sync until fully converged.
    for (let i = 0; i < 2; i++) {
      await syncNow()
      await settle()
    }

    // Server: exactly one deletion (A); D edited, E and F untouched.
    const live = [...server.objects.values()].filter(o => !o.deleted)
    const tombs = [...server.objects.values()].filter(o => o.deleted)
    expect(tombs.map(o => o.object_id)).toEqual(['A'])
    expect(live.find(o => o.object_id === 'D').payload.title).toBe('Edited D')
    expect(live.find(o => o.object_id === 'D').revision).toBe(2)
    expect(live.find(o => o.object_id === 'E').revision).toBe(1)
    expect(live.find(o => o.object_id === 'F').revision).toBe(1)

    // Reload: local matches server, the edit survived, queue idle.
    const allLinks = await repository.getAllLinks()
    expect(allLinks.map(l => l.id).sort()).toEqual(['D', 'E'])
    expect(allLinks.find(l => l.id === 'D').title).toBe('Edited D')
    expect(allLinks.find(l => l.id === 'D').revision).toBe(2)
    expect((await repository.getAllFolders()).map(f => f.id)).toEqual(['F'])
    expect((await pendingForAccount()).length).toBe(0)

    scope.stop()
  })
})

describe('mutation lifecycle — update against a server-deleted object (livelock guard)', () => {
  it('edit-on-tombstone fails and converges; the next pull applies the deletion', async () => {
    // Another device deleted X (server holds a tombstone at rev 5); this
    // client still has the pre-delete X (rev 2) and edits it. The server can
    // never accept the update (every claim requires deleted = 0), so the
    // coordinator must fail the mutation — syncNow must RESOLVE, not recurse
    // forever — and the next pull must apply the authoritative tombstone.
    const server = createFakeServer([makeLink('X', 5, { deleted: true, payload: null })])
    globalThis.fetch = server.fetch

    const { scope, links } = await mountComposables()
    links.links.value = [{ ...anonLink('X'), revision: 2, account_id: 'acc-1' }]
    await settle()

    const { session } = await import('../auth/session.js')
    await session.login()

    await links.updateLink('X', { title: 'stale edit' })
    // Termination proof: this must resolve. A rebase livelock would keep the
    // re-drain guard recursing and never settle (vitest would time out).
    await syncNow()
    await settle()

    // The failed update left no pending mutation behind — nothing to drain.
    expect((await pendingForAccount()).length).toBe(0)

    // Next sync pulls the tombstone: X leaves the local store and the ref.
    await syncNow()
    await settle()
    expect((await repository.getAllLinks()).map(l => l.id)).toEqual([])
    expect(links.links.value.map(l => l.id)).toEqual([])
    expect([...server.objects.values()].filter(o => o.deleted).map(o => o.object_id)).toEqual(['X'])

    scope.stop()
  })
})