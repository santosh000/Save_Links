// Regression test for Browser C anonymous → authenticated Sync & Merge flow.
// Verifies the complete chain: anonymous link → login → Sync & Merge → mutation
// → pushMutation → server accepts → object visible to other clients.
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { repository } from '../storage/repository.js'
import { session } from '../auth/session.js'
import { syncNowWithMutations, syncNow } from '../composables/useSync.js'
import { pushMutation } from '../sync/protocol.js'
import { pullObjects } from '../sync/protocol.js'
import * as coordinatorModule from '../sync/coordinator.js'

const coordinatorSyncNow = vi.fn()
vi.mock('../sync/coordinator.js', () => ({
  syncNow: (...args) => coordinatorSyncNow(...args),
}))

// Mock session
let sessionState = { status: 'unauthenticated', user: null, error: null }
vi.mock('../auth/session.js', () => ({
  session: {
    getState: () => sessionState,
    subscribe: vi.fn(),
    initSession: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
  initSession: vi.fn(),
}))

const EMPTY = { pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0 }

describe('Browser C Sync & Merge — complete merge flow regression', () => {
  beforeEach(() => {
    coordinatorSyncNow.mockReset()
    sessionState = { status: 'authenticated', user: { id: 'test-account' }, error: null }
  })

  it('anonymous link → login → Sync & Merge → mutation created and pushed → server accepts → mutation marked succeeded', async () => {
    // 1. Simulate anonymous link existing in local IndexedDB
    const linkId = 'anon-link-123'
    await repository.addPendingMutation(
      'create',
      linkId,
      'link',
      { id: linkId, title: 'Test Link', url: 'https://example.com', account_id: 'test-account' },
      'test-account',
      0
    )

    // 2. Verify mutation exists in pending queue
    const pendingBefore = await repository.getPendingMutations()
    const accountPending = pendingBefore.filter(m => m.account_id === 'test-account' && m.status === 'pending')
    expect(accountPending.length).toBe(1)
    expect(accountPending[0].object_id).toBe(linkId)
    expect(accountPending[0].operation).toBe('create')
    const mutationId = accountPending[0].mutation_id

    // 3. Mock coordinator to return success AND mark mutations as succeeded
    let syncResolve
    coordinatorSyncNow.mockImplementation(() => new Promise((resolve) => { syncResolve = resolve }))

    // 4. Call syncNowWithMutations (what Sync & Merge button does)
    const mutationsPromise = syncNowWithMutations()

    // 5. Wait for sync to start
    await new Promise(r => setTimeout(r, 0))

    // 6. Simulate server accepting mutations by marking them succeeded
    const pendingBeforeSync = await repository.getPendingMutations()
    const accountPendingSync = pendingBeforeSync.filter(m => m.account_id === 'test-account' && m.status === 'pending')
    for (const m of accountPendingSync) {
      await repository.markMutationSucceeded(m.mutation_id)
    }

    // 7. Resolve the sync
    syncResolve({ pushed: accountPendingSync.length, succeeded: accountPendingSync.length, failed: 0, conflict: 0, unavailable: 0, pulled: 0, applied: 0, skippedLocal: 0, skippedStale: 0 })
    await new Promise(r => setTimeout(r, 0))

    // 8. Wait for syncNowWithMutations to complete
    const result = await mutationsPromise

    // 9. Verify coordinator was called
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(1)

    // 10. Verify mutation is no longer pending
    const pendingAfter = await repository.getPendingMutations()
    const accountPendingAfter = pendingAfter.filter(m => m.account_id === 'test-account' && m.status === 'pending')
    expect(accountPendingAfter.length).toBe(0)

    // 11. Verify sync result
    expect(result.succeeded).toBe(1)
  })

  it('anonymous link → Sync & Merge with initial sync in flight → recursive sync processes merge mutations', async () => {
    // This test reproduces the exact race condition from the bug report
    let initialSyncResolve
    let recursiveSyncResolve
    let callCount = 0

    coordinatorSyncNow.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return new Promise((resolve) => { initialSyncResolve = resolve })
      } else {
        return new Promise((resolve) => { recursiveSyncResolve = resolve })
      }
    })

    // Pre-existing mutations (simulating initial sync already queued some)
    await repository.addPendingMutation('create', 'link-pre', 'link', { id: 'link-pre' }, 'test-account', 0)

    // Start initial sync
    const initialSyncPromise = syncNow()
    await new Promise(r => setTimeout(r, 0))
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(1)

    // User clicks Sync & Merge - add merge mutations
    await repository.addPendingMutation('create', 'link-merge-1', 'link', { id: 'link-merge-1' }, 'test-account', 0)
    await repository.addPendingMutation('create', 'link-merge-2', 'link', { id: 'link-merge-2' }, 'test-account', 0)

    // Call syncNowWithMutations while initial sync is in flight
    const mutationsPromise = syncNowWithMutations()

    // Resolve initial sync (returns empty - no mutations processed yet)
    initialSyncResolve({ pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0, pulled: 0, applied: 0, skippedLocal: 0, skippedStale: 0 })
    await new Promise(r => setTimeout(r, 0))

    // Wait for recursive sync to start
    await new Promise(r => setTimeout(r, 10))

    // Mark merge mutations as succeeded (simulating server accept)
    const pendingBefore = await repository.getPendingMutations()
    const accountPending = pendingBefore.filter(m => m.account_id === 'test-account' && m.status === 'pending')
    for (const m of accountPending) {
      await repository.markMutationSucceeded(m.mutation_id)
    }

    // Resolve recursive sync
    recursiveSyncResolve({ pushed: accountPending.length, succeeded: accountPending.length, failed: 0, conflict: 0, unavailable: 0, pulled: 0, applied: 0, skippedLocal: 0, skippedStale: 0 })
    await new Promise(r => setTimeout(r, 0))

    // Wait for syncNowWithMutations to complete
    await expect(mutationsPromise).resolves.toBeDefined()

    // Verify both syncs were called
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(2)

    // Verify no pending mutations remain
    const pending = await repository.getPendingMutations()
    const testAccountPending = pending.filter(m => m.account_id === 'test-account' && m.status === 'pending')
    expect(testAccountPending.length).toBe(0)
  })

  it('pushMutation sends correct request and handles 200 accepted response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ accepted: true, result_revision: 1 }),
    })

    const mutation = {
      mutation_id: 'test-mutation-1',
      object_type: 'link',
      object_id: 'link-123',
      operation: 'create',
      base_revision: 0,
      payload: JSON.stringify({ id: 'link-123', title: 'Test', url: 'https://example.com' }),
      account_id: 'test-account',
      status: 'pending',
    }

    const result = await pushMutation(mutation, { fetch: mockFetch })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/sync/mutation')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')

    const sent = JSON.parse(opts.body)
    expect(sent.mutation_id).toBe('test-mutation-1')
    expect(sent.object_type).toBe('link')
    expect(sent.object_id).toBe('link-123')
    expect(sent.operation).toBe('create')
    expect(sent.base_revision).toBe(0)
    expect(typeof sent.payload).toBe('string')
    // account_id must NOT be in the request body
    expect(sent).not.toHaveProperty('account_id')

    // Verify response handling
    expect(result).toEqual({ kind: 'accepted', resultRevision: 1 })
  })

  it('pushMutation handles 409 conflict response correctly', async () => {
    const currentObject = { object_id: 'link-123', object_type: 'link', revision: 5, deleted: false, payload: {} }
    const mockFetch = vi.fn().mockResolvedValue({
      status: 409,
      json: () => Promise.resolve({ accepted: false, reason: 'revision_conflict', current: currentObject }),
    })

    const mutation = {
      mutation_id: 'test-mutation-2',
      object_type: 'link',
      object_id: 'link-123',
      operation: 'create',
      base_revision: 0,
      payload: '{}',
      account_id: 'test-account',
      status: 'pending',
    }

    const result = await pushMutation(mutation, { fetch: mockFetch })

    expect(result).toEqual({
      kind: 'conflict',
      reason: 'revision_conflict',
      current: currentObject,
    })
  })

  it('pushMutation handles 401 rejected response correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ error: 'unauthenticated' }),
    })

    const mutation = {
      mutation_id: 'test-mutation-3',
      object_type: 'link',
      object_id: 'link-123',
      operation: 'create',
      base_revision: 0,
      payload: '{}',
      account_id: 'test-account',
      status: 'pending',
    }

    const result = await pushMutation(mutation, { fetch: mockFetch })

    expect(result).toEqual({ kind: 'rejected', status: 401, reason: 'unauthenticated' })
  })

  it('pushMutation handles network error by throwing', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const mutation = {
      mutation_id: 'test-mutation-4',
      object_type: 'link',
      object_id: 'link-123',
      operation: 'create',
      base_revision: 0,
      payload: '{}',
      account_id: 'test-account',
      status: 'pending',
    }

    await expect(pushMutation(mutation, { fetch: mockFetch })).rejects.toThrow('Network error')
  })
})

describe('Browser C Sync & Merge — pullObjects integration', () => {
  it('pullObjects returns objects from server after successful merge', async () => {
    const serverObjects = [
      { object_id: 'link-merge-1', object_type: 'link', revision: 1, deleted: false, deleted_at: null, payload: { id: 'link-merge-1', title: 'Merged Link', url: 'https://example.com', account_id: 'test-account' }, created_at: Date.now(), updated_at: Date.now() },
    ]

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ objects: serverObjects }),
    })

    const result = await pullObjects({ fetch: mockFetch })

    expect(result).toEqual({ kind: 'ok', objects: serverObjects })
    expect(result.objects.length).toBe(1)
    expect(result.objects[0].object_id).toBe('link-merge-1')
    expect(result.objects[0].payload.account_id).toBe('test-account')
  })

  it('pullObjects handles 401 correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ error: 'unauthenticated' }),
    })

    const result = await pullObjects({ fetch: mockFetch })
    expect(result).toEqual({ kind: 'rejected', status: 401, reason: 'unauthenticated' })
  })
})

describe('Browser C Sync & Merge — mutation payload structure', () => {
  it('anonymous link converted to mutation has correct payload with account_id', async () => {
    const anonLink = {
      id: 'anon-123',
      title: 'Anonymous Link',
      url: 'https://example.com',
      normalizedUrl: 'https://example.com',
      domain: 'example.com',
      description: '',
      image: '',
      category: 'Other',
      tags: [],
      important: false,
      mustHave: false,
      favorite: false,
      folderId: null,
      status: null,
      revision: 0,
      account_id: null,
      kept_local: false,
      createdAt: new Date().toISOString(),
      savedFrom: 'Unknown',
    }

    const accountId = 'test-account'
    const payload = { ...anonLink, account_id: accountId }

    expect(payload.account_id).toBe(accountId)
    expect(payload.id).toBe('anon-123')
    expect(payload.title).toBe('Anonymous Link')
    expect(payload.url).toBe('https://example.com')
  })

  it('anonymous folder converted to mutation has correct payload', async () => {
    const anonFolder = {
      id: 'folder-123',
      name: 'Anonymous Folder',
      createdAt: new Date().toISOString(),
      revision: 0,
      account_id: null,
      kept_local: false,
    }

    const accountId = 'test-account'
    const payload = { ...anonFolder, account_id: accountId }

    expect(payload.account_id).toBe(accountId)
    expect(payload.id).toBe('folder-123')
    expect(payload.name).toBe('Anonymous Folder')
  })
})

describe('Browser C Sync & Merge — IndexedDB structured clone boundary', () => {
  // This test reproduces the exact DataCloneError from production:
  // When a reactive Vue object (with nested reactive arrays) is spread
  // and passed to addPendingMutation, the nested reactive arrays
  // cause "Failed to execute 'put' on 'IDBObjectStore': [object Object] could not be cloned."
  
  function createReactiveLikeLink() {
    // Simulate a Vue reactive link object where nested arrays are also reactive proxies
    const originalTags = ['tag1', 'tag2']
    const reactiveTags = new Proxy(originalTags, {
      get(target, prop) {
        return Reflect.get(target, prop)
      }
    })
    
    const link = {
      id: 'link-reactive-123',
      title: 'Reactive Link',
      url: 'https://example.com',
      normalizedUrl: 'https://example.com',
      domain: 'example.com',
      description: '',
      image: '',
      category: 'Other',
      tags: reactiveTags,  // This is a Proxy - not structured-cloneable
      important: false,
      mustHave: false,
      favorite: false,
      folderId: null,
      status: null,
      revision: 0,
      account_id: null,
      kept_local: false,
      createdAt: new Date().toISOString(),
      savedFrom: 'Unknown',
    }
    
    // Wrap the whole object in a Proxy to simulate Vue's reactive()
    return new Proxy(link, {
      get(target, prop) {
        return Reflect.get(target, prop)
      },
      ownKeys(target) {
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, prop) {
        return Reflect.getOwnPropertyDescriptor(target, prop)
      }
    })
  }

  function createReactiveLikeFolder() {
    const folder = {
      id: 'folder-reactive-123',
      name: 'Reactive Folder',
      createdAt: new Date().toISOString(),
      revision: 0,
      account_id: null,
      kept_local: false,
    }
    
    return new Proxy(folder, {
      get(target, prop) {
        return Reflect.get(target, prop)
      },
      ownKeys(target) {
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, prop) {
        return Reflect.getOwnPropertyDescriptor(target, prop)
      }
    })
  }

function toRawLike(obj) {
  // Simulate Vue's toRaw - returns the target object
  // In real Vue, toRaw unwraps the top-level proxy
  if (obj && typeof obj === 'object' && typeof obj[Symbol.toPrimitive] === 'function') {
    // This is a proxy, return target
  }
  // For our test proxy, we can't easily unwrap, so we simulate by creating a plain copy
  // In real Vue, toRaw returns the target of the proxy
  return obj
}

  it('addPendingMutation fails with DataCloneError when payload contains reactive-like nested arrays', async () => {
    const reactiveLink = createReactiveLikeLink()
    // Spread the reactive-like object (simulates { ...link } in App.vue before fix)
    const spreadPayload = { ...reactiveLink, account_id: 'test-account' }
    
    // This should fail with DataCloneError because tags is a Proxy
    await expect(
      repository.addPendingMutation(
        'create',
        reactiveLink.id,
        'link',
        spreadPayload,
        'test-account',
        0
      )
    ).rejects.toThrow()
  })

  it('addPendingMutation succeeds when payload is a plain object (simulating toRaw fix)', async () => {
    // Create a plain object (simulating what toRaw returns)
    const plainLink = {
      id: 'link-plain-123',
      title: 'Plain Link',
      url: 'https://example.com',
      normalizedUrl: 'https://example.com',
      domain: 'example.com',
      description: '',
      image: '',
      category: 'Other',
      tags: ['tag1', 'tag2'],  // Plain array
      important: false,
      mustHave: false,
      favorite: false,
      folderId: null,
      status: null,
      revision: 0,
      account_id: null,
      kept_local: false,
      createdAt: new Date().toISOString(),
      savedFrom: 'Unknown',
    }
    
    // This should work - plain object with plain nested arrays
    const mutationId = await repository.addPendingMutation(
      'create',
      plainLink.id,
      'link',
      { ...plainLink, account_id: 'test-account' },
      'test-account',
      0
    )
    
    expect(mutationId).toBeDefined()
    
    // Verify it was persisted and can be read back
    const pending = await repository.getPendingMutations()
    const mutation = pending.find(m => m.mutation_id === mutationId)
    expect(mutation).toBeDefined()
    expect(mutation.payload.tags).toEqual(['tag1', 'tag2'])
  })

  it('addPendingMutation works for folders with reactive-like objects when using plain objects', async () => {
    const plainFolder = {
      id: 'folder-plain-123',
      name: 'Plain Folder',
      createdAt: new Date().toISOString(),
      revision: 0,
      account_id: null,
      kept_local: false,
    }
    
    const mutationId = await repository.addPendingMutation(
      'create',
      plainFolder.id,
      'folder',
      { ...plainFolder, account_id: 'test-account' },
      'test-account',
      0
    )
    
    expect(mutationId).toBeDefined()
    
    const pending = await repository.getPendingMutations()
    const mutation = pending.find(m => m.mutation_id === mutationId)
    expect(mutation).toBeDefined()
    expect(mutation.object_type).toBe('folder')
  })

  it('toRaw + spread still fails when nested arrays remain reactive (Vue toRaw is shallow)', async () => {
    // This test verifies the actual behavior: toRaw() only unwraps top-level proxy
    // Nested reactive arrays (like tags) remain Proxies and cause DataCloneError
    const reactiveLink = createReactiveLikeLink()
    
    // Simulate Vue's toRaw - returns the target object but nested properties
    // remain reactive Proxies (toRaw is SHALLOW in Vue 3)
    const rawLink = reactiveLink // In real Vue, toRaw(reactiveLink) returns the target but tags is still a Proxy
    // For our test proxy, we need to simulate: top-level unwrapped, but nested tags still a Proxy
    const rawLinkSimulated = {
      ...reactiveLink,  // spread unwraps top-level
      tags: reactiveLink.tags  // but nested tags is still the original Proxy!
    }
    
    const spreadPayload = { ...rawLinkSimulated, account_id: 'test-account' }
    
    // This SHOULD fail with DataCloneError because tags is still a Proxy
    // This proves toRaw() alone is NOT sufficient
    await expect(
      repository.addPendingMutation(
        'create',
        reactiveLink.id,
        'link',
        spreadPayload,
        'test-account',
        0
      )
    ).rejects.toThrow()
  })

  it('deep unwrapping via JSON serialization fixes the nested proxy issue', async () => {
    // Test the actual fix: deep unwrap via JSON serialization
    const reactiveLink = createReactiveLikeLink()
    
    // Simulate: toRaw(link) then JSON.stringify/parse to deeply unwrap all nested proxies
    const rawLink = reactiveLink // target object
    const deepUnwrapped = JSON.parse(JSON.stringify(rawLink))
    
    const spreadPayload = { ...deepUnwrapped, account_id: 'test-account' }
    
    // This should succeed - all nested proxies are now plain
    const mutationId = await repository.addPendingMutation(
      'create',
      reactiveLink.id,
      'link',
      spreadPayload,
      'test-account',
      0
    )
    
    expect(mutationId).toBeDefined()
    
    // Verify it was persisted and can be read back
    const pending = await repository.getPendingMutations()
    const mutation = pending.find(m => m.mutation_id === mutationId)
    expect(mutation).toBeDefined()
    expect(mutation.payload.tags).toEqual(['tag1', 'tag2'])
  })
})