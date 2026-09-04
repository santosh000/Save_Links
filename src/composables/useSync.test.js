// Tests for the sync entry point (src/composables/useSync.js).
// Verifies only the concurrency lock + pass-through behavior; the underlying
// sync semantics (drain, rebase, retry) are covered by coordinator.test.js.
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the coordinator so we control when syncNow resolves, without touching
// IndexedDB or the network. This isolates the lock behavior under test.
const coordinatorSyncNow = vi.fn()
vi.mock('../sync/coordinator.js', () => ({
  syncNow: (...args) => coordinatorSyncNow(...args),
}))

// Mock session - configurable per test suite
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

// Import after mocks are set up
const { syncNow, syncNowWithMutations } = await import('./useSync.js')
const { repository } = await import('../storage/repository.js')

const EMPTY = { pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0 }

describe('useSync.syncNow — concurrency lock', () => {
  beforeEach(() => {
    coordinatorSyncNow.mockReset()
    sessionState = { status: 'unauthenticated', user: null, error: null }
  })

  it('forwards options to the coordinator and returns its summary', async () => {
    coordinatorSyncNow.mockResolvedValue(EMPTY)
    const result = await syncNow({ pushFn: vi.fn() })
    expect(coordinatorSyncNow).toHaveBeenCalledWith({ pushFn: expect.any(Function) })
    expect(result).toEqual(EMPTY)
  })

  it('returns a deterministic empty summary when unauthenticated (no throw)', async () => {
    coordinatorSyncNow.mockResolvedValue(EMPTY)
    const result = await syncNow()
    expect(result).toEqual(EMPTY)
  })

  it('concurrent calls share the same in-flight run (coordinator called once)', async () => {
    let resolveRun
    coordinatorSyncNow.mockImplementation(() => new Promise((r) => { resolveRun = r }))

    const callA = syncNow()
    const callB = syncNow()
    const callC = syncNow()

    // Coordinator invoked exactly once despite three callers.
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(1)

    resolveRun({ ...EMPTY })
    const results = await Promise.all([callA, callB, callC])
    results.forEach((r) => expect(r).toEqual(EMPTY))
  })

  it('releases the lock after the run settles, so a later call runs again', async () => {
    coordinatorSyncNow.mockResolvedValue(EMPTY)
    await syncNow()
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(1)

    coordinatorSyncNow.mockResolvedValue({ ...EMPTY, pushed: 1 })
    const second = await syncNow()
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(2)
    expect(second.pushed).toBe(1)
  })

  it('releases the lock even when the run rejects', async () => {
    coordinatorSyncNow.mockRejectedValueOnce(new Error('boom'))
    coordinatorSyncNow.mockResolvedValueOnce(EMPTY)

    await expect(syncNow()).rejects.toThrow('boom')
    // Lock must have cleared for a fresh call to proceed.
    const retry = await syncNow()
    expect(retry).toEqual(EMPTY)
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(2)
  })

  it('preserves the result shape {pushed, succeeded, failed, conflict, unavailable}', async () => {
    coordinatorSyncNow.mockResolvedValue({ pushed: 3, succeeded: 2, failed: 0, conflict: 1, unavailable: 0 })
    const result = await syncNow()
    expect(result).toEqual({ pushed: 3, succeeded: 2, failed: 0, conflict: 1, unavailable: 0 })
  })
})

describe('syncNowWithMutations — race with in-flight initial sync', () => {
  beforeEach(() => {
    coordinatorSyncNow.mockReset()
    sessionState = { status: 'authenticated', user: { id: 'test-account' }, error: null }
  })

  it('waits for mutations queued during in-flight initial sync to be pushed', async () => {
    // Simulate an initial sync that is already in flight
    // Use a call-count-based mock to handle initial sync and recursive sync differently
    let callCount = 0
    let initialSyncResolve
    let recursiveSyncResolve

    coordinatorSyncNow.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Initial sync - return a promise we control
        return new Promise((resolve) => { initialSyncResolve = resolve })
      } else {
        // Recursive sync - return a promise we control
        return new Promise((resolve) => { recursiveSyncResolve = resolve })
      }
    })

    // Queue some mutations to simulate "Sync & Merge" while initial sync is in flight
    await repository.addPendingMutation('create', 'link-1', 'link', { id: 'link-1' }, 'test-account', 0)
    await repository.addPendingMutation('create', 'link-2', 'link', { id: 'link-2' }, 'test-account', 0)

    // Start initial sync (simulates login auto-sync)
    const initialSyncPromise = syncNow()
    await new Promise(r => setTimeout(r, 0)) // Let the sync start

    // Verify initial sync is in flight
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(1)

    // Now simulate user clicking "Sync & Merge" while initial sync is in flight
    // Queue some mutations
    await repository.addPendingMutation('create', 'link-3', 'link', { id: 'link-3' }, 'test-account', 0)
    await repository.addPendingMutation('create', 'link-4', 'link', { id: 'link-4' }, 'test-account', 0)

    // Call syncNowWithMutations while initial sync is in flight
    const mutationsPromise = syncNowWithMutations()

    // Resolve the initial sync - it returns empty (no mutations processed in this sync)
    initialSyncResolve({ pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0 })
    await new Promise(r => setTimeout(r, 0)) // Let microtasks run

    // The syncNowWithMutations should wait for the mutations to be processed
    // The useSync.js re-check logic should kick in and trigger a recursive sync
    // Wait for recursive sync to start
    await new Promise(r => setTimeout(r, 10))

    // Now resolve the recursive sync - simulate it processing all mutations
    // by marking them as succeeded in the repository
    const pendingBefore = await repository.getPendingMutations()
    const accountPending = pendingBefore.filter(m => m.account_id === 'test-account' && m.status === 'pending')

    // Simulate the coordinator marking all pending mutations as succeeded
    for (const m of accountPending) {
      await repository.markMutationSucceeded(m.mutation_id)
    }

    recursiveSyncResolve({
      pushed: accountPending.length,
      succeeded: accountPending.length,
      failed: 0,
      conflict: 0,
      unavailable: 0
    })
    await new Promise(r => setTimeout(r, 0)) // Let microtasks run

    // Wait for syncNowWithMutations to complete
    await expect(mutationsPromise).resolves.toBeDefined()

    // Verify both syncs were called
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(2)

    // Verify no pending mutations remain for our account
    const pending = await repository.getPendingMutations()
    const testAccountPending = pending.filter(m => m.account_id === 'test-account' && m.status === 'pending')
    expect(testAccountPending.length).toBe(0)
  })

  it('works when authentication already completed and no initial sync in flight', async () => {
    // Simple case: already authenticated, just click Sync & Merge
    let syncResolve
    coordinatorSyncNow.mockImplementationOnce(() => new Promise((resolve) => {
      syncResolve = resolve
    }))

    // Queue some mutations to simulate "Sync & Merge"
    await repository.addPendingMutation('create', 'link-A', 'link', { id: 'link-A' }, 'test-account', 0)
    await repository.addPendingMutation('create', 'link-B', 'link', { id: 'link-B' }, 'test-account', 0)

    // Call syncNowWithMutations
    const mutationsPromise = syncNowWithMutations()

    // Wait for sync to start
    await new Promise(r => setTimeout(r, 0))

    // Simulate coordinator processing mutations
    const pendingBefore = await repository.getPendingMutations()
    const accountPending = pendingBefore.filter(m => m.account_id === 'test-account' && m.status === 'pending')
    for (const m of accountPending) {
      await repository.markMutationSucceeded(m.mutation_id)
    }

    syncResolve({
      pushed: accountPending.length,
      succeeded: accountPending.length,
      failed: 0,
      conflict: 0,
      unavailable: 0
    })
    await new Promise(r => setTimeout(r, 0))

    // Wait for syncNowWithMutations to complete
    const result = await mutationsPromise

    // Verify sync was called
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(1)

    // Verify no pending mutations remain for our account
    const pending = await repository.getPendingMutations()
    const testAccountPending = pending.filter(m => m.account_id === 'test-account' && m.status === 'pending')
    expect(testAccountPending.length).toBe(0)
    expect(result).toEqual({ pushed: 2, succeeded: 2, failed: 0, conflict: 0, unavailable: 0 })
  })
})