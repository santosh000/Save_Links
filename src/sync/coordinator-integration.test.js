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
      pushFn: async () => ({ kind: 'unavailable', status: 503, reason: 'x' }),
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
      pushFn: async () => ({ kind: 'unavailable', status: 503, reason: 'x' }),
    })
    await settle()

    expect(summary.applied).toBe(1)
    expect(foldersRef.value.length).toBe(1)
    expect(foldersRef.value[0].id).toBe('server-folder-1')
    expect(foldersRef.value[0].revision).toBe(1)
    scope.stop()
  })
})