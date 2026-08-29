import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createIndexedDBRepository } from './indexeddb.js'
import { migrateIfNeeded, boot, bootState, MIGRATION_STATE, MigrationConflictError } from './migration.js'
import { getStorageKey } from '../utils/environment.js'

// Migration surface tests: each runs against its own database so store-level
// assertions never leak across scenarios.

const TEST_DB = 'save_links:test:migration'

// jsdom in this vitest setup ships no usable localStorage; install the same
// mock the composable tests use so storage.js loaders see real key/value state.
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

function installLocalStorageMock() {
  const mock = getLS()
  if (!globalThis.localStorage) globalThis.localStorage = mock
  if (!global.localStorage) global.localStorage = mock
  if (typeof window !== 'undefined' && !window.localStorage) window.localStorage = mock
  try { if (typeof localStorage === 'undefined') global.localStorage = mock } catch {}
  mock.clear()
}

function deleteDB(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => {}
  })
}

function seed(key, value) {
  localStorage.setItem(getStorageKey(key), JSON.stringify(value))
}

function seedRaw(key, value) {
  localStorage.setItem(getStorageKey(key), value)
}

function marker() {
  return localStorage.getItem(getStorageKey('migration'))
}

function lsData(key) {
  return JSON.parse(localStorage.getItem(getStorageKey(key)))
}

function legacyLink(id, over = {}) {
  return { id, url: `https://example.com/${id}`, status: 'important', title: `T${id}`, ...over }
}

function resetBootState() {
  bootState.ready = false
  bootState.links = []
  bootState.folders = []
  bootState.profile = null
  bootState.settings = null
}

let repo

beforeEach(async () => {
  installLocalStorageMock()
  await deleteDB(TEST_DB)
  resetBootState()
  vi.restoreAllMocks()
  repo = createIndexedDBRepository({ dbName: TEST_DB })
})

afterEach(async () => {
  await repo.close()
  await deleteDB(TEST_DB)
  vi.restoreAllMocks()
})

describe('migration', () => {
  it('fresh user (no localStorage data): marks complete, adopts empty IndexedDB', async () => {
    const result = await migrateIfNeeded(repo)
    expect(result.migrated).toBe(false)
    expect(result.state).toBe(MIGRATION_STATE.COMPLETE)
    expect(marker()).toBe(MIGRATION_STATE.COMPLETE)
    expect(await repo.getAllLinks()).toEqual([])
    expect(await repo.getAllFolders()).toEqual([])
    expect(await repo.getSettings()).toEqual({ appearance: 'system', colorScheme: 'ocean' })
  })

  it('migrates links preserving ids, createdAt, flags, and the canonical shape', async () => {
    const createdAt = '2023-05-05T00:00:00.000Z'
    seed('links', [
      { id: 'a', url: 'https://example.com/a', status: 'important', title: 'A', createdAt },
      { id: 'b', url: 'https://example.com/b', originalUrl: 'example.com/b', tags: [' x '], important: true, mustHave: true, favorite: true },
      { id: 'c', normalizedUrl: 'https://example.com/c' },
    ])
    await migrateIfNeeded(repo)
    expect(marker()).toBe(MIGRATION_STATE.COMPLETE)
    const links = await repo.getAllLinks()
    expect(links.length).toBe(3)

    const a = links.find((l) => l.id === 'a')
    expect(a.createdAt).toBe(createdAt)
    expect(a.important).toBe(true)
    expect(a.status).toBe('important')
    expect(a.normalizedUrl).toBe('https://example.com/a')

    const b = links.find((l) => l.id === 'b')
    expect(b.originalUrl).toBe('example.com/b')
    expect(b.tags).toEqual(['x'])
    expect(b.important).toBe(true)
    expect(b.mustHave).toBe(true)
    expect(b.favorite).toBe(true)
    expect(b.status).toBe('both')

    const c = links.find((l) => l.id === 'c')
    expect(c.normalizedUrl).toBe('https://example.com/c')
    expect(c.favorite).toBe(false)
  })

  it('migrates folders; preserves valid folderId, nulls dangling folderId, never drops links', async () => {
    seed('folders', [
      { id: 'f1', name: 'Work', createdAt: '2023-01-01T00:00:00.000Z' },
      { id: 'f2', name: '  Personal  ' },
    ])
    seed('links', [
      legacyLink('in-folder', { folderId: 'f1' }),
      legacyLink('dangling', { folderId: 'nope' }),
      legacyLink('unfiled'),
    ])
    await migrateIfNeeded(repo)
    const folders = await repo.getAllFolders()
    expect(folders.map((f) => f.id).sort()).toEqual(['f1', 'f2'])
    expect(folders.find((f) => f.id === 'f2').name).toBe('Personal')

    const links = await repo.getAllLinks()
    expect(links).toHaveLength(3) // nothing dropped for an invalid folder reference
    expect(links.find((l) => l.id === 'in-folder').folderId).toBe('f1')
    expect(links.find((l) => l.id === 'dangling').folderId).toBeNull()
    expect(links.find((l) => l.id === 'unfiled').folderId).toBeNull()
  })

  it('migrates profile; keeps default when none stored', async () => {
    seed('profile', { name: 'Ada', bio: 'Bio here' })
    seed('links', [legacyLink('p')])
    await migrateIfNeeded(repo)
    expect(await repo.getProfile()).toEqual({ name: 'Ada', bio: 'Bio here' })

    // fresh database, only links now — profile must fall back to default
    await repo.close()
    await deleteDB(TEST_DB)
    localStorage.clear()
    resetBootState()
    repo = createIndexedDBRepository({ dbName: TEST_DB })
    seed('links', [legacyLink('p2')])
    await migrateIfNeeded(repo)
    expect(await repo.getProfile()).toEqual({ name: 'Local User', bio: 'Local-first bookmark manager' })
  })

  it('migrates settings: appearance and colorScheme preserved independently', async () => {
    // both storage keys hold JSON-encoded strings, so seed them raw
    seedRaw('appearance', '"dark"')
    seedRaw('colorScheme', '"lavender"')
    seed('links', [legacyLink('s')])
    await migrateIfNeeded(repo)
    expect(await repo.getSettings()).toEqual({ appearance: 'dark', colorScheme: 'lavender' })
  })

  it('sanitizes invalid settings via the existing loaders', async () => {
    seedRaw('appearance', '"neon"')
    seedRaw('colorScheme', '"bogus"')
    seed('links', [legacyLink('s')])
    await migrateIfNeeded(repo)
    expect(await repo.getSettings()).toEqual({ appearance: 'system', colorScheme: 'ocean' })
  })

  it('is idempotent: a second boot does not migrate again and never duplicates', async () => {
    seed('links', [legacyLink('x')])
    const first = await migrateIfNeeded(repo)
    expect(first.migrated).toBe(true)
    const second = await migrateIfNeeded(repo)
    expect(second.migrated).toBe(false)
    expect(second.state).toBe(MIGRATION_STATE.COMPLETE)
    expect(await repo.getAllLinks()).toHaveLength(1)
    expect((await repo.getAllLinks())[0].id).toBe('x')
  })

  it('a failed replaceAll leaves in-progress (never complete), keeps localStorage, retry succeeds', async () => {
    seed('links', [legacyLink('r')])
    const spy = vi.spyOn(repo, 'replaceAll').mockRejectedValueOnce(new Error('QuotaExceededError'))
    await expect(migrateIfNeeded(repo)).rejects.toThrow('QuotaExceededError')
    expect(marker()).toBe(MIGRATION_STATE.IN_PROGRESS)
    expect(await repo.getAllLinks()).toEqual([]) // atomic: nothing was written
    expect(lsData('links').length).toBe(1) // localStorage untouched
    spy.mockRestore()
    const retry = await migrateIfNeeded(repo)
    expect(retry.migrated).toBe(true)
    expect(marker()).toBe(MIGRATION_STATE.COMPLETE)
    expect(await repo.getAllLinks()).toHaveLength(1)
  })

  it('recovers from a previous interrupted migration (in-progress marker) without duplicating', async () => {
    seed('links', [legacyLink('i')])
    localStorage.setItem(getStorageKey('migration'), MIGRATION_STATE.IN_PROGRESS)
    const res = await migrateIfNeeded(repo)
    expect(res.migrated).toBe(true)
    expect(marker()).toBe(MIGRATION_STATE.COMPLETE)
    expect(await repo.getAllLinks()).toHaveLength(1)
  })

  it('IndexedDB open failure preserves localStorage and leaves the marker untouched', async () => {
    seed('links', [legacyLink('x')])
    const spy = vi.spyOn(repo, 'getAllLinks').mockRejectedValueOnce(new Error('open failed'))
    await expect(migrateIfNeeded(repo)).rejects.toThrow('open failed')
    // the marker key was never written — readMigrationState() treats absence
    // (null) as 'pending'
    expect(marker()).toBeNull()
    expect(lsData('links')).toHaveLength(1)
    spy.mockRestore()
    await migrateIfNeeded(repo)
    expect(marker()).toBe(MIGRATION_STATE.COMPLETE)
  })

  it('verification failure does not mark complete and remains retryable', async () => {
    seed('links', [legacyLink('v')])
    // first getAllLinks (conflict check) succeeds with empty IDB; the read-back
    // call inside verifyMigration fails
    const spy = vi.spyOn(repo, 'getAllLinks')
      .mockImplementationOnce(() => Promise.resolve([]))
      .mockRejectedValueOnce(new Error('read-back failed'))
    await expect(migrateIfNeeded(repo)).rejects.toThrow('read-back failed')
    expect(marker()).toBe(MIGRATION_STATE.IN_PROGRESS)
    spy.mockRestore()
    await migrateIfNeeded(repo)
    expect(marker()).toBe(MIGRATION_STATE.COMPLETE)
  })

  it('existing IndexedDB data without a migration in progress → conflict: neither store modified', async () => {
    seed('links', [legacyLink('ls')])
    await repo.upsertLink({
      id: 'idb', originalUrl: 'https://idb.com', normalizedUrl: 'https://idb.com', url: 'https://idb.com',
      title: 'IDB', domain: 'idb.com', createdAt: '2020-01-01T00:00:00.000Z',
    })
    await expect(migrateIfNeeded(repo)).rejects.toBeInstanceOf(MigrationConflictError)
    // marker key never written (conflict throws before any marker write) —
    // absence means 'pending'
    expect(marker()).toBeNull()
    expect(lsData('links')).toHaveLength(1) // localStorage untouched
    expect((await repo.getAllLinks()).map((l) => l.id)).toEqual(['idb']) // IndexedDB untouched
  })

  it('a failed verification write of the complete marker self-heals on retry', async () => {
    seed('links', [legacyLink('h')])
    // simulate the write of 'complete' failing the first time (already migrated
    // state present in IDB, marker still in-progress)
    await migrateIfNeeded(repo)
    expect(marker()).toBe(MIGRATION_STATE.COMPLETE)
    // re-set the marker to in-progress without touching IDB: like a crash
    // between replaceAll and marker write
    localStorage.setItem(getStorageKey('migration'), MIGRATION_STATE.IN_PROGRESS)
    const retry = await migrateIfNeeded(repo)
    expect(retry.migrated).toBe(true)
    expect(marker()).toBe(MIGRATION_STATE.COMPLETE)
    expect(await repo.getAllLinks()).toHaveLength(1) // no duplicates
  })
})

describe('boot snapshot', () => {
  it('seeds the in-memory snapshot from migrated IndexedDB data before any render', async () => {
    seed('links', [legacyLink('b')])
    seed('folders', [{ id: 'f1', name: 'Work' }])
    seed('profile', { name: 'Bo', bio: 'B' })
    seedRaw('appearance', '"dark"')
    seedRaw('colorScheme', '"amber"')

    const snap = await boot(repo)
    expect(snap.ready).toBe(true)
    expect(bootState.ready).toBe(true)
    expect(snap.links).toHaveLength(1)
    expect(snap.links[0].id).toBe('b')
    expect(snap.folders).toHaveLength(1)
    expect(snap.folders[0].name).toBe('Work')
    expect(snap.profile.name).toBe('Bo')
    expect(snap.settings).toEqual({ appearance: 'dark', colorScheme: 'amber' })
  })

  it('loadSnapshot reads the persisted state without migrating again', async () => {
    seed('links', [legacyLink('q')])
    await boot(repo)
    const again = await migrateIfNeeded(repo)
    expect(again.migrated).toBe(false)
    expect(again.state).toBe(MIGRATION_STATE.COMPLETE)
  })
})