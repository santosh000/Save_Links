// Regression test: deleting ONE synced link must not remove the OTHER links.
// Reproduces the real-browser smoke sequence (login -> synced links appear ->
// save a new link -> delete one link -> every other link must remain in the
// reactive ref AND in storage, with no pending mutations left behind).
// A stress variant injects latency jitter into the storage adapter so the
// async interleavings real IndexedDB produces are exercised.
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

async function settle(times = 6) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

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

// Inject jitter into the storage adapter so the async interleavings real
// IndexedDB produces (reload snapshots vs persistence writes vs pending reads)
// actually overlap in the test.
function jitterRepository(delayMs = 0, diary = null) {
  const names = new Set(['getAllLinks', 'setAllLinks', 'getPendingMutations', 'addPendingMutation', 'getAllFolders', 'setAllFolders'])
  const originals = {}
  for (const name of names) originals[name] = repository[name].bind(repository)
  const install = async () => {
    for (const name of names) {
      vi.spyOn(repository, name).mockImplementation(async (...args) => {
        const d = delayMs > 0 ? Math.floor(Math.random() * delayMs) : 0
        if (d > 0) await new Promise((r) => setTimeout(r, d))
        const result = await originals[name](...args)
        if (diary) {
          if (name === 'setAllLinks') diary.push({ w: (args[0] ?? []).map(l => l.id) })
          else if (name === 'getAllLinks') diary.push({ s: result.map(l => l.id) })
        }
        return result
      })
    }
  }
  const restore = () => { for (const name of names) vi.restoreAllMocks() }
  return { install, restore }
}

// Same in-memory server mirror as link-arrival.test.js (worker/db/store.js
// claim semantics; GET returns the FULL account object set).
function createGatedServer() {
  const objects = new Map()
  const pendingGets = []

  const fetch = vi.fn(async (url, opts = {}) => {
    if (url === '/api/sync/objects') {
      return new Promise((resolve) => { pendingGets.push(resolve) })
    }
    if (url === '/api/sync/mutations') {
      const body = JSON.parse(opts.body)
      const results = body.mutations.map((m) => {
        const cur = objects.get(m.object_id)
        if (m.operation === 'create') {
          if (cur) return { mutation_id: m.mutation_id, accepted: false, reason: 'revision_conflict', current: null }
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

// Drive syncs to completion, resolving every gated GET as it appears.
async function drainServer(server, rounds = 60) {
  for (let i = 0; i < rounds; i++) {
    while (server.pendingGets.length) server.resolveNextGet([...server.objects.values()])
    await settle()
    if (!server.pendingGets.length) return true
  }
  return false
}

async function mountLinks() {
  const { useLinks } = await import('../composables/useLinks.js')
  const scope = effectScope()
  let links
  scope.run(() => { links = useLinks() })
  return { scope, links }
}

describe('delete must not remove other synced links', () => {
  it('smoke sequence: login, synced A/B/C, save NEW, delete A -> B/C/NEW must remain in ref and store', async () => {
    const server = createGatedServer()
    globalThis.fetch = server.fetch

    // Seed the account with three synced links: A, B, C.
    for (const id of ['A', 'B', 'C']) server.objects.set(id, makeRemoteLink(id))
    const refIds = () => links.links.value.map(l => l.id)

    const { scope, links } = await mountLinks()
    const { session } = await import('../auth/session.js')
    await session.login()

    // Step 2: existing synced links appear (first pull).
    let sync = syncNow()
    await drainServer(server)
    await sync
    await settle()
    expect(refIds().sort()).toEqual(['A', 'B', 'C'])

    // Step 3: save a new link -> appears immediately, pushes to server.
    const saved = await links.addLink({ originalUrl: 'https://example.com/NEW' })
    expect(refIds()).toContain(saved.id)
    await settle()
    await drainServer(server)
    await settle()
    expect([...server.objects.keys()].sort()).toEqual(['A', 'B', 'C', saved.id].sort())
    expect(new Set([...server.objects.keys()]).size).toBe(4)

    // Step 5: delete ONE link (A).
    await links.removeLink('A')
    await drainServer(server)
    await settle()

    // Step 6 expectation: A is gone; B, C, NEW remain EVERYWHERE.
    expect(refIds()).not.toContain('A')
    expect(refIds().sort()).toEqual(['B', 'C', saved.id].sort())
    expect((await repository.getAllLinks()).map(l => l.id).sort()).toEqual(['B', 'C', saved.id].sort())
    expect(await repository.getPendingMutations()).toEqual([])

    scope.stop()
    vi.restoreAllMocks()
  })

  it('stress: save + delete under injected storage latency (5 runs) — B/C/NEW must never disappear', async () => {
    vi.restoreAllMocks() // clear any spy leaked by a failed sibling test
    for (let run = 0; run < 5; run++) {
      const server = createGatedServer()
      globalThis.fetch = server.fetch

      const jitter = jitterRepository(12)
      await jitter.install()
      try {
        await deleteDB() // runs share the test DB — reset per run
        for (const id of ['A', 'B', 'C']) server.objects.set(id, makeRemoteLink(id))

        const { scope, links } = await mountLinks()
        const { session } = await import('../auth/session.js')
        await session.login()

        let sync = syncNow()
        const initialDrained = await drainServer(server)
        await sync
        await settle(3)
        if (links.links.value.map(l => l.id).sort().join(',') !== 'A,B,C') {
          scope.stop()
          throw new Error(`run ${run}: initial pull incomplete (drained=${initialDrained})`)
        }

        const saved = await links.addLink({ originalUrl: 'https://example.com/NEW' })
        // addLink fires the push as a background syncNow; the repository spy
        // sleeps up to delayMs before its mutation POST, so drainServer() can
        // exit on a quiet round while the push is still in flight. Poll the
        // condition the sync actually guarantees (the server mirror holding
        // NEW) with a bounded retry instead of counting ticks; the push may
        // land several settle windows after the first quiet round.
        let saveDrained = false
        for (let attempt = 0; attempt < 40 && !server.objects.has(saved.id); attempt++) {
          saveDrained = await drainServer(server)
          await settle(3)
        }
        if (![...server.objects.keys()].includes(saved.id)) {
          scope.stop()
          throw new Error(`run ${run}: NEW not pushed (drained=${saveDrained}, pendingGets=${server.pendingGets.length})`)
        }

        await links.removeLink('A')
        const delDrained = await drainServer(server)
        await settle(3)

        const ref = links.links.value.map(l => l.id)
        const store = (await repository.getAllLinks()).map(l => l.id)
        if (!delDrained) {
          scope.stop()
          throw new Error(`run ${run}: delete sync deadlocked (pendingGets=${server.pendingGets.length}, ref=${ref.join('|')}, store=${store.join('|')})`)
        }
        const refOk = ref.includes(saved.id) && ref.some(x => ['B', 'C'].includes(x))
        const storeOk = store.includes(saved.id) && store.some(x => ['B', 'C'].includes(x))
        if (!refOk || !storeOk) {
          scope.stop()
          throw new Error(`run ${run}: other links disappeared (ref=${ref.join('|')}, store=${store.join('|')})`)
        }
        scope.stop()
      } finally {
        jitter.restore()
      }
    }
  }, 120000)
})