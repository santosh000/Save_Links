import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, effectScope } from 'vue'
import { getStorageKey } from '../utils/environment.js'
import 'fake-indexeddb/auto'
import { repository } from '../storage/repository.js'
import { boot, bootState } from '../storage/migration.js'
import { defaultDBName } from '../storage/indexeddb.js'

function getLS() {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (globalThis.localStorage) return globalThis.localStorage
  if (!globalThis._mockLS) {
    const store = {}
    globalThis._mockLS = {
      getItem(k) { return store[k] ?? null },
      setItem(k, v) { store[k] = String(v) },
      removeItem(k) { delete store[k] },
      clear() { for (const k in store) delete store[k] },
    }
  }
  return globalThis._mockLS
}

describe('useFolders', () => {
  function deleteDB(name) {
    return new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => {}
    })
  }

  function resetBootState() {
    bootState.ready = false
    bootState.links = []
    bootState.folders = []
    bootState.profile = null
    bootState.settings = null
  }

  // fake-indexeddb resolves open + transaction completion across separate
  // macrotask turns, so flushing needs more than one setTimeout(0) hop
  async function flush() {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  }

  beforeEach(async () => {
    await repository.close()
    await deleteDB(defaultDBName())
    resetBootState()
    const mock = getLS()
    if (!globalThis.localStorage) globalThis.localStorage = mock
    if (typeof window !== 'undefined' && !window.localStorage) window.localStorage = mock
    try { if (typeof localStorage === 'undefined') global.localStorage = mock } catch {}
    getLS().clear()
  })

  afterEach(async () => {
    await flush()
    await repository.close()
    await deleteDB(defaultDBName())
  })

  it('creates folder and persists', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { folders, createFolder } = useFolders()
    expect(folders.value.length).toBe(0)
    const f = createFolder('Work')
    expect(f.name).toBe('Work')
    expect(f.id).toBeTruthy()
    expect(folders.value.length).toBe(1)
    await flush()
    const stored = await repository.getAllFolders()
    expect(stored.length).toBe(1)
    expect(stored[0].name).toBe('Work')
  })

  it('prevents duplicate names case-insensitive', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { createFolder } = useFolders()
    createFolder('Personal')
    expect(() => createFolder('personal')).toThrow('Folder already exists')
  })

  it('rename folder', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { folders, createFolder, renameFolder } = useFolders()
    const f = createFolder('Old')
    renameFolder(f.id, 'New')
    expect(folders.value[0].name).toBe('New')
  })

  it('rename prevents duplicate', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { createFolder, renameFolder } = useFolders()
    const a = createFolder('Alpha')
    createFolder('Beta')
    expect(() => renameFolder(a.id, 'Beta')).toThrow()
  })

  it('delete folder', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { folders, createFolder, deleteFolder } = useFolders()
    const f = createFolder('Temp')
    expect(folders.value.length).toBe(1)
    deleteFolder(f.id)
    expect(folders.value.length).toBe(0)
  })

  it('sanitizes invalid folders on load', async () => {
    getLS().setItem(getStorageKey('folders'), JSON.stringify([{ id: '', name: '' }, { id: '1', name: 'Valid' }, null, 'string']))
    await boot(repository)
    const { useFolders } = await import('./useFolders.js')
    const { folders } = useFolders()
    expect(folders.value.length).toBe(1)
    expect(folders.value[0].name).toBe('Valid')
  })

  it('trims folder name to 50', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { createFolder } = useFolders()
    const long = 'a'.repeat(100)
    const f = createFolder(long)
    expect(f.name.length).toBe(50)
  })

  it('queues a create mutation with base_revision 0 when authenticated (account_id present)', async () => {
    const { session, initSession } = await import('../auth/session.js')
    // Restore an authenticated session through the real HTTP adapter (Phase A):
    // a mocked GET /api/me that the Worker would answer for a valid session.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/me') return new Response(JSON.stringify({ authenticated: true, accountId: 'memory-user' }), { status: 200 })
      if (url === '/auth/logout') return new Response(null, { status: 200 })
      return new Response(null, { status: 404 })
    }))
    await initSession()
    const { useFolders } = await import('./useFolders.js')
    const { createFolder } = useFolders()
    const f = createFolder('Synced')
    expect(f.revision).toBe(0)
    await flush()
    const pending = await repository.getPendingMutations()
    expect(pending.length).toBe(1)
    expect(pending[0].operation).toBe('create')
    expect(pending[0].object_type).toBe('folder')
    expect(pending[0].object_id).toBe(f.id)
    expect(pending[0].base_revision).toBe(0)
    expect(pending[0].account_id).toBe('memory-user')
    await session.logout()
    vi.unstubAllGlobals()
  })

  describe('remote pull reactivity (inbound sync)', () => {
    async function pullFolderIntoRepo(record) {
      await repository.upsertFolder(record)
      const { notifyDataChanged } = await import('../storage/dataChanges.js')
      notifyDataChanged()
    }

    it('pulled folder appears in the reactive ref immediately without a reload', async () => {
      const { useFolders } = await import('./useFolders.js')
      const { folders } = useFolders()
      expect(folders.value.length).toBe(0)
      await pullFolderIntoRepo({ id: 'server-folder-1', name: 'Server Folder', revision: 4 })
      await flush()
      expect(folders.value.length).toBe(1)
      expect(folders.value[0].name).toBe('Server Folder')
      expect(folders.value[0].revision).toBe(4) // server revision preserved
    })

    it('remote folder pull does not enqueue a pending mutation', async () => {
      const { useFolders } = await import('./useFolders.js')
      useFolders()
      await pullFolderIntoRepo({ id: 'server-folder-2', name: 'No Mutation', revision: 1 })
      await flush()
      const pending = await repository.getPendingMutations()
      expect(pending.length).toBe(0)
    })

    it('pulling the same server folder again does not duplicate it', async () => {
      const { useFolders } = await import('./useFolders.js')
      const { folders } = useFolders()
      const record = { id: 'server-folder-3', name: 'Once', revision: 1 }
      await pullFolderIntoRepo(record)
      await flush()
      await pullFolderIntoRepo(record)
      await flush()
      expect(folders.value.length).toBe(1)
    })

    it('unsubscribes the change listener when the composable scope is disposed (no duplicate/stale listeners)', async () => {
      // Isolate from the shared module scope: prior unscoped useFolders() mounts
      // in this file leave persistent module-level listeners whose deep watches
      // would otherwise write to IndexedDB concurrently with this test's reload.
      vi.resetModules()
      const { useFolders } = await import('./useFolders.js')
      const { notifyDataChanged } = await import('../storage/dataChanges.js')
      const { repository: freshRepo } = await import('../storage/repository.js')

      // Seed IndexedDB so a notifying listener WOULD reload data into its ref.
      await freshRepo.upsertFolder({ id: 'server-folder-seed', name: 'Seed', revision: 1 })

      // Mount instance A inside its own scope, then tear the scope down.
      const scopeA = effectScope()
      let foldersA
      scopeA.run(() => {
        foldersA = useFolders().folders
      })
      scopeA.stop() // should remove A's listener

      // A stale listener would reload this ref; a properly unsubscribed one won't.
      notifyDataChanged()
      await flush()
      expect(foldersA.value.length).toBe(0)

      // A live instance still reacts -> subscribe works and only live scopes listen.
      const scopeB = effectScope()
      let foldersB
      scopeB.run(() => {
        foldersB = useFolders().folders
      })
      notifyDataChanged()
      await flush()
      expect(foldersB.value.length).toBe(1)
      expect(foldersB.value[0].name).toBe('Seed')
      scopeB.stop()
    })
  })

  describe('reload reconciliation is account-scoped (foreign pending mutations)', () => {
    // Isolated imports: a notifying reload also fires listeners any earlier
    // unscoped mount left behind, so rebuild the modules per test (same pattern
    // as the unsubscribe test above).
    async function isolatedSetup() {
      vi.resetModules()
      const [{ useFolders }, { repository: repo }, { notifyDataChanged }, { session, initSession }] = await Promise.all([
        import('./useFolders.js'),
        import('../storage/repository.js'),
        import('../storage/dataChanges.js'),
        import('../auth/session.js'),
      ])
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url === '/api/me') {
          return new Response(JSON.stringify({ authenticated: true, accountId: 'acc-current' }), { status: 200 })
        }
        if (url === '/auth/logout') return new Response(null, { status: 200 })
        return new Response(null, { status: 404 })
      }))
      await initSession()
      return { useFolders, repo, notifyDataChanged, session }
    }

    const currentFolder = (id) => ({
      id, name: `${id} name`, revision: 3, account_id: 'acc-current',
      createdAt: '2026-01-01T00:00:00.000Z', kept_local: false,
    })

    it.each(['delete', 'create', 'update'])(
      'a foreign-account pending %s for the same object id cannot remove or alter the current-account folder',
      async (operation) => {
        const { useFolders, repo, notifyDataChanged, session } = await isolatedSetup()
        const { folders } = useFolders()
        // current-account folder in ref AND store (as a server pull leaves it)
        folders.value = [currentFolder('shared')]
        await flush()
        // foreign-account pending mutation targeting the same object id
        await repo.addPendingMutation(operation, 'shared', 'folder', { id: 'shared' }, 'acc-foreign', operation === 'create' ? 0 : 3)
        notifyDataChanged()
        await flush()
        // the folder survives untouched — the foreign mutation is ignored
        expect(folders.value.length).toBe(1)
        expect(folders.value[0]).toMatchObject({ id: 'shared', revision: 3, name: 'shared name' })
        const stored = await repo.getAllFolders()
        expect(stored.map((f) => f.id)).toEqual(['shared'])
        await session.logout()
        vi.unstubAllGlobals()
      },
    )
  })

  describe('backup import syncs via the outbox (Bug 2 fix)', () => {
    async function isolatedSetup() {
      vi.resetModules()
      const [{ useFolders }, { repository: repo }, { session, initSession }] = await Promise.all([
        import('./useFolders.js'),
        import('../storage/repository.js'),
        import('../auth/session.js'),
      ])
      const fetchStub = vi.fn(async (url, opts) => {
        if (url === '/api/me') {
          return new Response(JSON.stringify({ authenticated: true, accountId: 'acc-current' }), { status: 200 })
        }
        if (url === '/auth/logout') return new Response(null, { status: 200 })
        // pull succeeds as a no-op (syncNow pulls BEFORE pushing and bails if
        // the pull is unavailable); the mutations POST stays unavailable so the
        // queued create is still pending when asserted
        if (String(url).includes('/api/sync/objects')) {
          return new Response(JSON.stringify({ objects: [] }), { status: 200 })
        }
        if (String(url).includes('/api/sync/mutations')) {
          return new Response(JSON.stringify({ error: 'unavailable', accepted: false, results: [] }), { status: 404 })
        }
        return new Response(null, { status: 404 })
      })
      vi.stubGlobal('fetch', fetchStub)
      await initSession()
      return { useFolders, repo, session, fetchStub }
    }

    const importedFolder = (id, name) => ({
      id, name, createdAt: '2026-01-01T00:00:00.000Z', revision: 0, account_id: null, kept_local: false,
    })

    it('B: importing a new folder assigns a fresh id, queues exactly one account-scoped create at base 0 and fires the auto-sync', async () => {
      const { useFolders, repo, session, fetchStub } = await isolatedSetup()
      const { folders, mergeFolders } = useFolders()
      const res = await mergeFolders([importedFolder('imp-f1', 'Imported Folder')], 'skip')
      await flush()

      // one new folder, but NOT the backup's native id — genuinely new folder
      // imports get a fresh identity (Bug 15)
      expect(res.newCount).toBe(1)
      expect(folders.value).toHaveLength(1)
      const freshId = folders.value[0].id
      expect(freshId).toBeTruthy()
      expect(freshId).not.toBe('imp-f1')
      expect(folders.value[0].name).toBe('Imported Folder')

      const stored = await repo.getAllFolders()
      expect(stored.map((f) => f.id)).toEqual([freshId])
      expect(stored[0].account_id).toBe('acc-current')
      expect(stored[0].revision).toBe(0)

      const pending = await repo.getPendingMutations()
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        object_id: freshId,
        operation: 'create',
        object_type: 'folder',
        account_id: 'acc-current',
        base_revision: 0,
      })
      expect(pending[0].payload).toMatchObject({ revision: 0, account_id: 'acc-current' })
      expect(fetchStub.mock.calls.some(([u, o]) => o?.method === 'POST' && String(u).includes('/api/sync/mutations'))).toBe(true)
      await session.logout()
      vi.unstubAllGlobals()
    })

    it('C: replacing a duplicate folder queues one update claimed on the store-acknowledged revision, preserving ownership', async () => {
      const { useFolders, repo, session } = await isolatedSetup()
      const { folders, mergeFolders } = useFolders()
      const seed = { id: 'existing-f1', name: 'Local Folder', createdAt: '2026-01-01T00:00:00.000Z', revision: 0, account_id: 'acc-current', kept_local: false }
      folders.value = [seed]
      await flush()
      await repo.upsertFolder({ ...seed, revision: 4, account_id: 'acc-current', kept_local: false })
      await flush()

      const res = await mergeFolders([{ id: 'existing-f1', name: 'Backup Folder' }], 'replace')
      await flush()

      expect(res.replacedCount).toBe(1)
      expect(folders.value).toHaveLength(1)
      expect(folders.value[0].name).toBe('Backup Folder')

      const pending = await repo.getPendingMutations()
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        object_id: 'existing-f1',
        operation: 'update',
        object_type: 'folder',
        account_id: 'acc-current',
        base_revision: 4,
      })
      await session.logout()
      vi.unstubAllGlobals()
    })

    it('E: anonymous folder imports stay local-only — no outbox mutation, no auto-sync', async () => {
      vi.resetModules()
      const [{ useFolders }, { repository: repo }] = await Promise.all([
        import('./useFolders.js'),
        import('../storage/repository.js'),
      ])
      const { folders, mergeFolders } = useFolders()

      const res = await mergeFolders([importedFolder('anon-f1', 'Anon')], 'skip')
      await flush()

      expect(res.newCount).toBe(1)
      expect(folders.value).toHaveLength(1)
      expect(await repo.getPendingMutations()).toHaveLength(0)
    })
  })
})
