import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createIndexedDBRepository, INDEXEDDB_DB_VERSION, STORES, defaultDBName, upgrade, resolveCoalescing } from './indexeddb.js'
import { generateId } from '../domain/link.js'
import { beginSync, endSync, isSyncing } from '../sync/syncState.js'

// jsdom ships no IndexedDB; fake-indexeddb (test-only devDependency) provides a
// spec-faithful in-memory implementation. Each test gets a clean database.

const TEST_DB = 'save_links:test:adapter'

function deleteDB(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => {}
  })
}

function openDB(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, INDEXEDDB_DB_VERSION)
    req.onupgradeneeded = () => upgrade(req.result)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function writeRaw(dbName, storeName, record, key) {
  const db = await openDB(dbName)
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      store.put(record, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close() // never leak a connection (an open one blocks deleteDatabase)
  }
}

async function readRaw(dbName, storeName, key) {
  const db = await openDB(dbName)
  try {
    const value = await new Promise((resolve, reject) => {
      const req = db.transaction(storeName).objectStore(storeName).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return value
  } finally {
    db.close()
  }
}

function link(id, over = {}) {
  return {
    id,
    originalUrl: `https://example.com/${id}`,
    normalizedUrl: `https://example.com/${id}`,
    url: `https://example.com/${id}`,
    title: `T${id}`,
    description: '',
    image: '',
    tags: [],
    category: 'Other',
    important: false,
    mustHave: false,
    favorite: false,
    folderId: null,
    domain: 'example.com',
    status: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...over,
  }
}

// Repos keep their connection open; deleteDatabase blocks until connections are
// closed (spec-faithful in fake-indexeddb), so track and close every repo
// before wiping the database between tests.
let repos = []

function makeRepo(name = TEST_DB) {
  const repo = createIndexedDBRepository({ dbName: name })
  repos.push(repo)
  return repo
}

async function closeAllRepos() {
  for (const repo of repos) await repo.close()
  repos = []
}

// Count IndexedDB transactions by wrapping fake-indexeddb's transaction()
// (fake-indexeddb/auto installs IDBDatabase globally; the repository opens
// connections from the same global factory, so every repo transaction runs
// through this prototype).
function installTransactionCounter() {
  const calls = []
  const original = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (...args) {
    calls.push(args)
    return original.apply(this, args)
  }
  return {
    calls,
    restore() {
      IDBDatabase.prototype.transaction = original
    },
  }
}

describe('indexeddb repository', () => {
  beforeEach(async () => {
    await closeAllRepos()
    await deleteDB(TEST_DB)
  })

  afterEach(async () => {
    await closeAllRepos()
    await deleteDB(TEST_DB)
  })

  it('defaults the database name to the environment-isolated name', () => {
    expect(defaultDBName()).toBe('save_links:test')
  })

  describe('database initialization', () => {
    it('creates the documented schema at version 2', async () => {
      const repo = makeRepo()
      await repo.getAllLinks() // force open
      const db = await openDB(TEST_DB)
      expect(db.version).toBe(INDEXEDDB_DB_VERSION)
      expect(db.version).toBe(2)
      const names = Array.from(db.objectStoreNames)
      expect(names).toContain(STORES.LINKS)
      expect(names).toContain(STORES.FOLDERS)
      expect(names).toContain(STORES.KV)
      expect(names).toContain(STORES.PENDING_MUTATIONS)
      const linksStore = db.transaction(STORES.LINKS).objectStore(STORES.LINKS)
      expect(Array.from(linksStore.indexNames)).toEqual(expect.arrayContaining(['by-createdAt', 'by-folderId', 'by-category', 'by-revision', 'by-account_id']))
      db.close()
    })

    it('starts empty with documented defaults', async () => {
      const repo = makeRepo()
      expect(await repo.getAllLinks()).toEqual([])
      expect(await repo.getAllFolders()).toEqual([])
      expect(await repo.getProfile()).toEqual({ name: 'Local User', bio: 'Local-first bookmark manager' })
      expect(await repo.getSettings()).toEqual({ appearance: 'system', colorScheme: 'none' })
      expect(await repo.getPendingMutations()).toEqual([])
    })

    it('surfaces unavailable IndexedDB as a clear rejection', async () => {
      const original = globalThis.indexedDB
      globalThis.indexedDB = undefined
      try {
        const repo = createIndexedDBRepository({ dbName: 'save_links:test:noidb' })
        await expect(repo.getAllLinks()).rejects.toThrow(/IndexedDB is not available/)
      } finally {
        globalThis.indexedDB = original
      }
    })
  })

  describe('link CRUD', () => {
    it('creates and reads a link', async () => {
      const repo = makeRepo()
      const saved = await repo.upsertLink(link('a'))
      expect(saved.normalizedUrl).toBe('https://example.com/a')
      const all = await repo.getAllLinks()
      expect(all.length).toBe(1)
      expect(all[0].id).toBe('a')
    })

    it('updates a link by re-inserting the same id', async () => {
      const repo = makeRepo()
      await repo.upsertLink(link('a', { title: 'Old' }))
      await repo.upsertLink(link('a', { title: 'New' }))
      const all = await repo.getAllLinks()
      expect(all.length).toBe(1)
      expect(all[0].title).toBe('New')
    })

    it('deletes a link by id', async () => {
      const repo = makeRepo()
      await repo.upsertLink(link('a'))
      await repo.deleteLink('a')
      expect(await repo.getAllLinks()).toEqual([])
      await expect(repo.deleteLink('')).rejects.toThrow('Invalid link id')
      await expect(repo.deleteLink(null)).rejects.toThrow('Invalid link id')
    })

    it('stores multiple links with distinct ids', async () => {
      const repo = makeRepo()
      await repo.upsertLink(link('a'))
      await repo.upsertLink(link('b'))
      await repo.upsertLink(link('c'))
      const ids = (await repo.getAllLinks()).map((l) => l.id).sort()
      expect(ids).toEqual(['a', 'b', 'c'])
    })

    it('setAllLinks replaces the whole collection', async () => {
      const repo = makeRepo()
      await repo.upsertLink(link('a'))
      await repo.upsertLink(link('b'))
      await repo.setAllLinks([link('c')])
      const ids = (await repo.getAllLinks()).map((l) => l.id)
      expect(ids).toEqual(['c'])
    })
  })

  describe('folder operations', () => {
it('persists folders and deletes by id', async () => {
      const repo = makeRepo()
      await repo.upsertFolder({ id: 'f1', name: 'Work', createdAt: '2024-02-02T00:00:00.000Z' })
      await repo.upsertFolder({ id: 'f2', name: '  Personal  ' })
      const folders = await repo.getAllFolders()
      expect(folders.length).toBe(2)
      expect(folders[0]).toEqual({ id: 'f1', name: 'Work', createdAt: '2024-02-02T00:00:00.000Z', revision: 0, account_id: null, kept_local: false })
      expect(folders[1].name).toBe('Personal')
      expect(folders[1].createdAt).toBeTruthy()
      expect(folders[1].revision).toBe(0)
      expect(folders[1].account_id).toBeNull()
      expect(folders[1].kept_local).toBe(false)
      await repo.deleteFolder('f1')
      expect((await repo.getAllFolders()).map((f) => f.id)).toEqual(['f2'])
    })

    it('rejects invalid folders', async () => {
      const repo = makeRepo()
      await expect(repo.upsertFolder({ name: 'NoId' })).rejects.toThrow('Invalid folder')
      await expect(repo.upsertFolder({ id: 'x', name: '   ' })).rejects.toThrow('Invalid folder')
      await expect(repo.upsertFolder('junk')).rejects.toThrow('Invalid folder')
    })

    it('setAllFolders replaces the whole collection', async () => {
      const repo = makeRepo()
      await repo.upsertFolder({ id: 'a', name: 'A' })
      await repo.upsertFolder({ id: 'b', name: 'B' })
      await repo.setAllFolders([{ id: 'c', name: 'C' }])
      const ids = (await repo.getAllFolders()).map((f) => f.id)
      expect(ids).toEqual(['c'])
    })
  })

  describe('profile & settings', () => {
    it('persists profile and falls back to default when absent', async () => {
      const repo = makeRepo()
      expect((await repo.getProfile()).name).toBe('Local User')
      await repo.saveProfile({ name: 'Ada', bio: 'Bio' })
      expect(await repo.getProfile()).toEqual({ name: 'Ada', bio: 'Bio' })
    })

    it('returns a fresh default profile object (mutation does not leak into the repository default)', async () => {
      const repo = makeRepo()
      const first = await repo.getProfile()
      first.name = 'Mutated'
      first.bio = 'Corrupted'
      const second = await repo.getProfile()
      expect(second).not.toBe(first) // fresh object, not the module-level default
      expect(second).toEqual({ name: 'Local User', bio: 'Local-first bookmark manager' })
    })

    it('rejects malformed profile writes', async () => {
      const repo = makeRepo()
      await expect(repo.saveProfile('junk')).rejects.toThrow('Invalid profile')
      await expect(repo.saveProfile([])).rejects.toThrow('Invalid profile')
    })

    it('persists settings with sanitization on write and read', async () => {
      const repo = makeRepo()
      expect(await repo.getSettings()).toEqual({ appearance: 'system', colorScheme: 'none' })
      await repo.saveSettings({ appearance: 'dark', colorScheme: 'forest' })
      expect(await repo.getSettings()).toEqual({ appearance: 'dark', colorScheme: 'forest' })
      await repo.saveSettings({ appearance: 'neon', colorScheme: 'invalid' })
      expect(await repo.getSettings()).toEqual({ appearance: 'system', colorScheme: 'none' })
    })
  })

  describe('normalization & malformed data', () => {
    it('normalizes legacy link shapes before persistence', async () => {
      const repo = makeRepo()
      const longTitle = 't'.repeat(300)
      const saved = await repo.upsertLink({
        id: 'leg1',
        url: 'https://github.com/x',
        status: 'important',
        title: longTitle,
        tags: [' a ', '', 1],
      })
      expect(saved.normalizedUrl).toBe('https://github.com/x')
      expect(saved.url).toBe('https://github.com/x')
      expect(saved.important).toBe(true)
      expect(saved.status).toBe('important')
      expect(saved.title.length).toBe(200)
      expect(saved.tags).toEqual(['a'])
      expect(saved.createdAt).toBeTruthy()
      // the raw stored record is canonical (fixed field set, no junk fields)
      const raw = await readRaw(TEST_DB, STORES.LINKS, 'leg1')
      expect(raw.normalizedUrl).toBe('https://github.com/x')
      expect(raw.malicious).toBeUndefined()
    })

    it('reads malformed stored records safely (normalizes, keeps data)', async () => {
      // Simulate old-format rows written directly to IDB (bypassing the
      // adapter) — as future migrated data might appear. (Genuinely primitive
      // rows can't exist: keyPath stores reject them with DataError in both
      // browsers and fake-indexeddb, so realistic malformed data is
      // wrong-shape objects, which this covers.)
      await writeRaw(TEST_DB, STORES.LINKS, { id: 'ok', url: 'https://ok.com', status: 'must-have' })
      const repo = makeRepo()
      const all = await repo.getAllLinks()
      expect(all.length).toBe(1)
      expect(all[0].id).toBe('ok')
      expect(all[0].mustHave).toBe(true)
      expect(all[0].normalizedUrl).toBe('https://ok.com')
    })

    it('rejects non-object links on write', async () => {
      const repo = makeRepo()
      await expect(repo.upsertLink('junk')).rejects.toThrow('Invalid link')
      await expect(repo.upsertLink(null)).rejects.toThrow('Invalid link')
    })
  })

  describe('persistence across reopen', () => {
    it('survives close + reopen', async () => {
      const repo = makeRepo()
      await repo.upsertLink(link('a'))
      await repo.upsertFolder({ id: 'f1', name: 'Work' })
      await repo.saveProfile({ name: 'Ada' })
      await repo.saveSettings({ appearance: 'dark' })
      await repo.close()

      const reopened = makeRepo()
      expect((await reopened.getAllLinks()).map((l) => l.id)).toEqual(['a'])
      expect((await reopened.getAllFolders())[0].name).toBe('Work')
      expect((await reopened.getProfile()).name).toBe('Ada')
      expect((await reopened.getSettings()).appearance).toBe('dark')

      // close is idempotent; repeated reopen is safe
      await reopened.close()
      await reopened.close()
      await reopened.getAllLinks()
    })
  })

  describe('versionchange lifecycle', () => {
    it('closes its cached connection when another connection upgrades the schema, so upgrades are never blocked forever', async () => {
      const repo = makeRepo()
      await repo.getAllLinks() // opens + caches a version-1 connection

      // Another "tab" opens the same database with a higher schema version.
      // fake-indexeddb is spec-faithful here: the upgrade fires versionchange
      // at our open connection and BLOCKS until it closes — if our handler did
      // not close it, this promise would reject with the blocked error.
      const upgraded = await new Promise((resolve, reject) => {
        const req = indexedDB.open(TEST_DB, INDEXEDDB_DB_VERSION + 1)
        req.onupgradeneeded = () => upgrade(req.result) // guarded: additive only
        req.onblocked = () => reject(new Error('upgrade blocked: old connection never closed'))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        expect(upgraded.version).toBe(INDEXEDDB_DB_VERSION + 1)

        // cache was reset: close() stays idempotent (no-op) and the repo
        // reopens cleanly at the new schema version
        await repo.close()
        expect(await repo.getAllLinks()).toEqual([])
      } finally {
        upgraded.close() // never leave a connection open (it would block deleteDB teardown)
      }
    })
  })

  describe('atomic bulk replacement', () => {
    it('replaceAll atomically replaces every store', async () => {
      const repo = makeRepo()
      await repo.upsertLink(link('old'))
      await repo.upsertFolder({ id: 'oldf', name: 'Old' })
      await repo.saveProfile({ name: 'Old User' })
      await repo.saveSettings({ appearance: 'dark' })

      const result = await repo.replaceAll({
        links: [link('n1'), link('n2')],
        folders: [{ id: 'nf', name: 'New' }],
        profile: { name: 'New User' },
        settings: { colorScheme: 'amber' }, // missing appearance -> sanitized to default
      })
      expect(result.links.length).toBe(2)
      expect(result.folders.length).toBe(1)
      expect((await repo.getAllLinks()).map((l) => l.id)).toEqual(['n1', 'n2'])
      expect((await repo.getAllFolders()).map((f) => f.id)).toEqual(['nf'])
      expect((await repo.getProfile()).name).toBe('New User')
      expect((await repo.getSettings())).toEqual({ appearance: 'system', colorScheme: 'amber' })
    })

    it('replaceAll with no profile deletes the stored profile', async () => {
      const repo = makeRepo()
      await repo.saveProfile({ name: 'Gone' })
      await repo.replaceAll({ links: [], folders: [], settings: {} })
      expect((await repo.getProfile()).name).toBe('Local User')
    })
  })

  describe('sync metadata (v2)', () => {
    it('new links start at revision 0', async () => {
      const repo = makeRepo()
      const saved = await repo.upsertLink(link('a'))
      expect(saved.revision).toBe(0)
      expect(saved.account_id).toBeNull()
    })

    it('new folders start at revision 0', async () => {
      const repo = makeRepo()
      const saved = await repo.upsertFolder({ id: 'f1', name: 'Test' })
      expect(saved.revision).toBe(0)
      expect(saved.account_id).toBeNull()
    })

    it('generates UUID v4 IDs for new links', async () => {
      const repo = makeRepo()
      const saved = await repo.upsertLink({ originalUrl: 'https://example.com/a' })
      expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    it('generates UUID v4 IDs for new folders', async () => {
      const repo = makeRepo()
      const id = generateId()
      const saved = await repo.upsertFolder({ id, name: 'Test' })
      expect(saved.id).toBe(id)
      expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    it('legacy IDs remain readable and are not migrated', async () => {
      const repo = makeRepo()
      // Simulate legacy base-36 ID
      await repo.upsertLink({ id: 'legacy1', originalUrl: 'https://example.com/legacy', normalizedUrl: 'https://example.com/legacy', url: 'https://example.com/legacy', title: 'Legacy', domain: 'example.com', category: 'Other', tags: [], important: false, mustHave: false, favorite: false, folderId: null, status: null, createdAt: '2023-01-01T00:00:00.000Z', savedFrom: 'Unknown' })
      const saved = await repo.getAllLinks()
      expect(saved.length).toBe(1)
      expect(saved[0].id).toBe('legacy1')
      expect(saved[0].revision).toBe(0) // backfilled to 0
      expect(saved[0].account_id).toBeNull()
    })

    it('pending mutation has all required fields', async () => {
      const repo = makeRepo()
      await repo.upsertLink(link('a'))
      await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)
      const mutations = await repo.getPendingMutations()
      expect(mutations.length).toBe(1)
      const m = mutations[0]
      expect(m.mutation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      expect(m.account_id).toBe('acc1')
      expect(m.object_id).toBe('a')
      expect(m.object_type).toBe('link')
      expect(m.operation).toBe('create')
      expect(m.base_revision).toBe(0)
      expect(m.payload).toBeDefined()
      expect(m.createdAt).toBeTruthy()
      expect(m.status).toBe('pending')
    })

    it('throws when account_id is null for pending mutation', async () => {
      const repo = makeRepo()
      await expect(repo.addPendingMutation('create', 'a', 'link', {}, null, 0)).rejects.toThrow('account_id is required')
      await expect(repo.addPendingMutation('create', 'a', 'link', {}, '', 0)).rejects.toThrow('account_id is required')
      await expect(repo.addPendingMutation('create', 'a', 'link', {}, undefined, 0)).rejects.toThrow('account_id is required')
    })

    it('throws when base_revision is negative', async () => {
      const repo = makeRepo()
      await expect(repo.addPendingMutation('create', 'a', 'link', {}, 'acc1', -1)).rejects.toThrow('base_revision must be a non-negative integer')
    })

    it('local mutations do not increment object.revision', async () => {
      const repo = makeRepo()
      const saved = await repo.upsertLink(link('a'))
      expect(saved.revision).toBe(0)
      // Updating the same link should NOT increment revision locally
      const updated = await repo.upsertLink({ ...link('a'), title: 'Updated' })
      expect(updated.revision).toBe(0)
    })

    it('pending mutations are filtered by status', async () => {
      const repo = makeRepo()
      await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)
      await repo.addPendingMutation('update', 'b', 'link', { id: 'b', revision: 0 }, 'acc1', 0)
      await repo.addPendingMutation('delete', 'c', 'link', { id: 'c' }, 'acc1', 0)
      const mutations = await repo.getPendingMutations()
      await repo.markMutationSucceeded(mutations[0].mutation_id)
      await repo.markMutationFailed(mutations[1].mutation_id)
      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(1)
      expect(pending[0].status).toBe('pending')
    })

    it('rebasePendingMutation: marks original failed and inserts rebased atomically', async () => {
      const repo = makeRepo()
      const mid = await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)

      const rebased = {
        mutation_id: 'rebased-001',
        account_id: 'acc1',
        object_id: 'a',
        object_type: 'link',
        operation: 'update',
        base_revision: 3,
        payload: link('a'),
        createdAt: '2026-01-02T00:00:00.000Z',
        status: 'pending',
      }
      const returned = await repo.rebasePendingMutation(mid, rebased)
      expect(returned).toBe('rebased-001')

      // Original is now failed (hidden by getPendingMutations)
      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(1)
      expect(pending[0].mutation_id).toBe('rebased-001')
      expect(pending[0].status).toBe('pending')
      expect(pending[0].operation).toBe('update')
      expect(pending[0].base_revision).toBe(3)
    })

    it('rebasePendingMutation: throws when original mutation does not exist', async () => {
      const repo = makeRepo()
      const rebased = {
        mutation_id: 'rebased-002',
        account_id: 'acc1',
        object_id: 'a',
        object_type: 'link',
        operation: 'update',
        base_revision: 1,
        payload: {},
        createdAt: '2026-01-02T00:00:00.000Z',
        status: 'pending',
      }
      await expect(repo.rebasePendingMutation('nonexistent', rebased)).rejects.toThrow()
      // The rebased mutation must NOT have been inserted
      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(0)
    })

    it('rebasePendingMutation: preserves original payload in rebased record', async () => {
      const repo = makeRepo()
      const payload = { id: 'x', title: 'Hello', tags: ['a', 'b'] }
      const mid = await repo.addPendingMutation('update', 'x', 'link', payload, 'acc1', 2)

      const rebased = {
        mutation_id: 'rebased-003',
        account_id: 'acc1',
        object_id: 'x',
        object_type: 'link',
        operation: 'update',
        base_revision: 5,
        payload,
        createdAt: '2026-01-02T00:00:00.000Z',
        status: 'pending',
      }
      await repo.rebasePendingMutation(mid, rebased)
      const pending = await repo.getPendingMutations()
      expect(pending[0].payload).toEqual(payload)
    })

    it('rebasePendingMutation: preserves account_id in rebased record', async () => {
      const repo = makeRepo()
      const mid = await repo.addPendingMutation('create', 'a', 'folder', { id: 'a', name: 'Test' }, 'acc-xyz', 0)

      const rebased = {
        mutation_id: 'rebased-004',
        account_id: 'acc-xyz',
        object_id: 'a',
        object_type: 'folder',
        operation: 'update',
        base_revision: 1,
        payload: { id: 'a', name: 'Test' },
        createdAt: '2026-01-02T00:00:00.000Z',
        status: 'pending',
      }
      await repo.rebasePendingMutation(mid, rebased)
      const pending = await repo.getPendingMutations()
      expect(pending[0].account_id).toBe('acc-xyz')
    })
  })

  describe('outbox coalescing (resolveCoalescing)', () => {
    const existing = (operation, over = {}) => ({
      mutation_id: 'existing-001',
      account_id: 'acc1',
      object_id: 'a',
      object_type: 'link',
      operation,
      base_revision: 0,
      payload: { id: 'a', title: 'old' },
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'pending',
      ...over,
    })

    it('create → update rewrites in place, stays a create, latest payload wins', () => {
      const d = resolveCoalescing(existing('create'), 'update', { id: 'a', title: 'new' })
      expect(d.action).toBe('rewrite')
      expect(d.record.operation).toBe('create')
      expect(d.record.payload).toEqual({ id: 'a', title: 'new' })
      expect(d.record.mutation_id).toBe('existing-001') // identity preserved
      expect(d.record.base_revision).toBe(0) // original claim preserved
    })

    it('create → create rewrites in place, stays a create, latest payload wins', () => {
      const d = resolveCoalescing(existing('create'), 'create', { id: 'a', title: 'new' })
      expect(d.action).toBe('rewrite')
      expect(d.record.operation).toBe('create')
      expect(d.record.payload.title).toBe('new')
    })

    it('create → delete drops the pair', () => {
      const d = resolveCoalescing(existing('create'), 'delete', { id: 'a' })
      expect(d.action).toBe('drop')
    })

    it('update → update rewrites in place, latest payload wins', () => {
      const d = resolveCoalescing(existing('update'), 'update', { id: 'a', title: 'new' })
      expect(d.action).toBe('rewrite')
      expect(d.record.operation).toBe('update')
      expect(d.record.payload.title).toBe('new')
    })

    it('update → delete becomes a delete with the delete payload', () => {
      const d = resolveCoalescing(existing('update'), 'delete', { id: 'a' })
      expect(d.action).toBe('rewrite')
      expect(d.record.operation).toBe('delete')
      expect(d.record.payload).toEqual({ id: 'a' })
    })

    it('delete → update becomes an update with the latest payload', () => {
      const d = resolveCoalescing(existing('delete'), 'update', { id: 'a', title: 'new' })
      expect(d.action).toBe('rewrite')
      expect(d.record.operation).toBe('update')
      expect(d.record.payload.title).toBe('new')
    })

    it('delete → delete rewrites in place, stays a delete', () => {
      const d = resolveCoalescing(existing('delete'), 'delete', { id: 'a' })
      expect(d.action).toBe('rewrite')
      expect(d.record.operation).toBe('delete')
    })

    it('update → create and delete → create are not merged (append)', () => {
      expect(resolveCoalescing(existing('update'), 'create', { id: 'a' }).action).toBe('append')
      expect(resolveCoalescing(existing('delete'), 'create', { id: 'a' }).action).toBe('append')
    })
  })

  describe('outbox coalescing (addPendingMutation)', () => {
    it('three consecutive updates collapse to one mutation with the latest payload and original identity', async () => {
      const repo = makeRepo()
      const firstId = await repo.addPendingMutation('create', 'a', 'link', link('a', { title: 'v1' }), 'acc1', 0)
      await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v2' }), 'acc1', 0)
      await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v3' }), 'acc1', 0)

      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(1)
      expect(pending[0].mutation_id).toBe(firstId) // identity preserved
      expect(pending[0].operation).toBe('create')
      expect(pending[0].payload.title).toBe('v3')
      expect(pending[0].base_revision).toBe(0)
    })

    it('create → update keeps exactly one pending create with the latest payload', async () => {
      const repo = makeRepo()
      const firstId = await repo.addPendingMutation('create', 'a', 'link', link('a', { title: 'v1' }), 'acc1', 0)
      const ret = await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v2' }), 'acc1', 0)

      expect(ret).toBe(firstId)
      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(1)
      expect(pending[0].operation).toBe('create')
      expect(pending[0].payload.title).toBe('v2')
    })

    it('create → delete before any push queues nothing', async () => {
      const repo = makeRepo()
      await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)
      const ret = await repo.addPendingMutation('delete', 'a', 'link', { id: 'a' }, 'acc1', 0)

      expect(ret).toBeNull()
      expect(await repo.getPendingMutations()).toEqual([])
    })

    it('update → delete collapses to a single delete mutation', async () => {
      const repo = makeRepo()
      const firstId = await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v1' }), 'acc1', 2)
      await repo.addPendingMutation('delete', 'a', 'link', { id: 'a' }, 'acc1', 2)

      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(1)
      expect(pending[0].mutation_id).toBe(firstId)
      expect(pending[0].operation).toBe('delete')
      expect(pending[0].payload).toEqual({ id: 'a' })
      expect(pending[0].base_revision).toBe(2)
    })

    it('delete → update collapses to a single update mutation with the latest payload', async () => {
      const repo = makeRepo()
      const firstId = await repo.addPendingMutation('delete', 'a', 'link', { id: 'a' }, 'acc1', 3)
      await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v2' }), 'acc1', 3)

      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(1)
      expect(pending[0].mutation_id).toBe(firstId)
      expect(pending[0].operation).toBe('update')
      expect(pending[0].payload.title).toBe('v2')
      expect(pending[0].base_revision).toBe(3)
    })

    it('does not coalesce across different object ids', async () => {
      const repo = makeRepo()
      await repo.addPendingMutation('update', 'a', 'link', link('a'), 'acc1', 0)
      await repo.addPendingMutation('update', 'b', 'link', link('b'), 'acc1', 0)
      expect((await repo.getPendingMutations()).length).toBe(2)
    })

    it('does not coalesce across different object types', async () => {
      const repo = makeRepo()
      await repo.addPendingMutation('update', 'a', 'link', link('a'), 'acc1', 0)
      await repo.addPendingMutation('update', 'a', 'folder', { id: 'a', name: 'F' }, 'acc1', 0)
      expect((await repo.getPendingMutations()).length).toBe(2)
    })

    it('does not coalesce across different accounts', async () => {
      const repo = makeRepo()
      await repo.addPendingMutation('update', 'a', 'link', link('a'), 'acc1', 0)
      await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v2' }), 'acc2', 0)
      expect((await repo.getPendingMutations()).length).toBe(2)
    })

    it('does not coalesce with succeeded or failed records — appends a fresh pending mutation', async () => {
      const repo = makeRepo()
      const createId = await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)
      await repo.markMutationSucceeded(createId)
      const secondId = await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v2' }), 'acc1', 0)

      expect(secondId).not.toBe(createId)
      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(1)
      expect(pending[0].mutation_id).toBe(secondId)
      expect(pending[0].operation).toBe('update')

      await repo.markMutationFailed(secondId)
      const thirdId = await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v3' }), 'acc1', 0)
      expect(thirdId).not.toBe(secondId)
      expect((await repo.getPendingMutations()).length).toBe(1)
      expect((await repo.getPendingMutations())[0].mutation_id).toBe(thirdId)
    })

    it('does not coalesce while a sync is in flight — plain append (safe fallback)', async () => {
      const repo = makeRepo()
      await repo.addPendingMutation('create', 'a', 'link', link('a', { title: 'v1' }), 'acc1', 0)
      expect(isSyncing()).toBe(false)

      beginSync()
      try {
        await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v2' }), 'acc1', 0)
        const pending = await repo.getPendingMutations()
        expect(pending.length).toBe(2) // record may be inside the push snapshot
      } finally {
        endSync()
      }
      expect(isSyncing()).toBe(false)

      // After the sync ends, coalescing resumes for the next append.
      await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v3' }), 'acc1', 0)
      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(2) // latest append folded into the newest pending
      const latest = pending.find(m => m.payload.title === 'v3')
      expect(latest).toBeDefined()
    })

    it('a pushed=true pending mutation is never coalesced into — fresh update appends', async () => {
      const repo = makeRepo()
      const createId = await repo.addPendingMutation('create', 'a', 'link', link('a', { title: 'v1' }), 'acc1', 0)
      await repo.markMutationPushed(createId)

      const ret = await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v2' }), 'acc1', 0)

      expect(ret).not.toBe(createId) // fresh mutation_id — the pushed one replays safely on retry
      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(2)
      expect(pending.find(m => m.mutation_id === createId)).toMatchObject({ operation: 'create', payload: link('a', { title: 'v1' }), pushed: true })
      const fresh = pending.find(m => m.mutation_id === ret)
      expect(fresh).toMatchObject({ operation: 'update', payload: link('a', { title: 'v2' }), pushed: false })
    })

    it('a pushed=true pending create is never dropped by a delete — fresh delete appends', async () => {
      const repo = makeRepo()
      const createId = await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)
      await repo.markMutationPushed(createId)

      const ret = await repo.addPendingMutation('delete', 'a', 'link', { id: 'a' }, 'acc1', 0)

      expect(ret).not.toBe(createId)
      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(2) // create may replay; delete must NOT disappear
      expect(pending.find(m => m.mutation_id === createId)).toBeDefined()
      expect(pending.find(m => m.mutation_id === ret)).toMatchObject({ operation: 'delete', payload: { id: 'a' }, pushed: false })
    })

    it('markMutationPushed persists pushed=true and throws for a missing record', async () => {
      const repo = makeRepo()
      const id = await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)

      const before = await repo.getPendingMutations()
      expect(before[0].pushed).toBe(false) // new records start unattempted

      await repo.markMutationPushed(id)
      expect((await repo.getPendingMutations())[0].pushed).toBe(true)

      await expect(repo.markMutationPushed('missing-id')).rejects.toThrow('Pending mutation not found')
    })

    it('offline queueing still works: coalesced mutations accumulate locally and stay pending', async () => {
      const repo = makeRepo()
      await repo.addPendingMutation('create', 'a', 'link', link('a', { title: 'v1' }), 'acc1', 0)
      await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v2' }), 'acc1', 0)
      await repo.addPendingMutation('update', 'a', 'link', link('a', { title: 'v3' }), 'acc1', 0)
      await repo.addPendingMutation('create', 'b', 'folder', { id: 'b', name: 'F' }, 'acc1', 0)

      const pending = await repo.getPendingMutations()
      expect(pending.length).toBe(2) // one per object, latest payloads
      expect(pending.find(m => m.object_id === 'a').payload.title).toBe('v3')
      expect(pending.find(m => m.object_id === 'a').operation).toBe('create')
      expect(pending.find(m => m.object_id === 'b').operation).toBe('create')
      expect(pending.every(m => m.status === 'pending')).toBe(true)
    })
  })

  describe('single-transaction mutation writes (transaction overhead reduction)', () => {
    it('markMutationPushed: exactly ONE transaction — first call and repeat (already pushed)', async () => {
      const repo = makeRepo()
      const id = await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)

      const counter = installTransactionCounter()
      try {
        await repo.markMutationPushed(id)
        await repo.markMutationPushed(id) // already pushed — no write, still one tx
        expect(counter.calls).toHaveLength(2)
      } finally {
        counter.restore()
      }
    })

    it('markMutationSucceeded: exactly ONE transaction', async () => {
      const repo = makeRepo()
      const id = await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)

      const counter = installTransactionCounter()
      try {
        await repo.markMutationSucceeded(id)
        expect(counter.calls).toHaveLength(1)
      } finally {
        counter.restore()
      }
      expect((await repo.getPendingMutations()).length).toBe(0) // no longer pending
    })

    it('markMutationFailed: exactly ONE transaction', async () => {
      const repo = makeRepo()
      const id = await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)

      const counter = installTransactionCounter()
      try {
        await repo.markMutationFailed(id)
        expect(counter.calls).toHaveLength(1)
      } finally {
        counter.restore()
      }
      expect((await repo.getPendingMutations()).length).toBe(0) // no longer pending
    })

    it('updateObjectRevision: exactly ONE transaction for existing and missing records', async () => {
      const repo = makeRepo()
      await repo.upsertLink(link('a')) // local record exists

      const counter = installTransactionCounter()
      try {
        await repo.updateObjectRevision(STORES.LINKS, 'a', 5) // existing → revision written
        await repo.updateObjectRevision(STORES.LINKS, 'missing', 5) // missing → no-op, still one tx
        expect(counter.calls).toHaveLength(2)
      } finally {
        counter.restore()
      }
      expect((await repo.getAllLinks()).find(l => l.id === 'a').revision).toBe(5)
      // missing record: no-op — nothing was created, nothing thrown
      expect((await repo.getAllLinks()).find(l => l.id === 'missing')).toBeUndefined()
    })

    it('markMutationSucceeded / markMutationFailed reject a missing record with the same error as before', async () => {
      const repo = makeRepo()
      await expect(repo.markMutationSucceeded('missing-id')).rejects.toThrow('Pending mutation not found')
      await expect(repo.markMutationFailed('missing-id')).rejects.toThrow('Pending mutation not found')
    })

    it('rebasePendingMutation: exactly ONE transaction (atomic failed + rebased insert)', async () => {
      const repo = makeRepo()
      const id = await repo.addPendingMutation('create', 'a', 'link', link('a'), 'acc1', 0)

      const counter = installTransactionCounter()
      try {
        await repo.rebasePendingMutation(id, {
          mutation_id: 'rebased-1',
          account_id: 'acc1',
          object_id: 'a',
          object_type: 'link',
          operation: 'update',
          base_revision: 1,
          payload: link('a'),
          createdAt: '2024-01-01T00:00:00.000Z',
          status: 'pending',
        })
        expect(counter.calls).toHaveLength(1)
      } finally {
        counter.restore()
      }
      expect((await repo.getPendingMutations()).find(m => m.mutation_id === 'rebased-1')).toBeDefined()
    })
  })
})