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
    refreshSession: vi.fn(),
    waitForRotation: vi.fn(),
  },
  initSession: vi.fn(),
}))

// Import after mocks are set up
const { syncNow, syncNowWithMutations } = await import('./useSync.js')
const { session: mockedSession } = await import('../auth/session.js')
const { repository } = await import('../storage/repository.js')
const { defaultDBName } = await import('../storage/indexeddb.js')

// IndexedDB is shared for the whole file and mutation rows are only retired
// to 'succeeded'/'failed', never deleted — so a test that aborts before its
// cleanup (or merely queues and forgets) leaks PENDING rows straight into the
// next test's queue, even changing the counts another test simulates with.
// Make every test start from an empty store; deleteDatabase succeeds once the
// sole repository connection is closed, and the fallback clears the stores in
// place if anything still holds the DB open.
async function deleteDB(name) {
  const deleted = await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve(true)
    req.onerror = () => resolve(false)
    req.onblocked = () => resolve(false)
  })
  if (deleted) return
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const storeNames = [...db.objectStoreNames]
  if (storeNames.length) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite')
      for (const s of storeNames) tx.objectStore(s).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'))
    })
  }
  db.close()
}

beforeEach(async () => {
  await repository.close()
  await deleteDB(defaultDBName())
})

const EMPTY = { pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0 }

describe('useSync.syncNow — concurrency lock', () => {
  beforeEach(() => {
    coordinatorSyncNow.mockReset()
    sessionState = { status: 'unauthenticated', user: null, error: null }
    mockedSession.waitForRotation.mockReset().mockResolvedValue(true)
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
    let resolveStarted
    // The rotation wait defers the coordinator call by a microtask chain and
    // the pre-sync pending snapshot by IndexedDB hops, so a fixed tick count
    // cannot know when the call happens — resolve on the call itself.
    const started = new Promise((r) => { resolveStarted = r })
    coordinatorSyncNow.mockImplementation(() => {
      resolveStarted()
      return new Promise((r) => { resolveRun = r })
    })

    const callA = syncNow()
    const callB = syncNow()
    const callC = syncNow()

    // Coordinator invoked exactly once despite three callers.
    await started
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
    mockedSession.waitForRotation.mockReset().mockResolvedValue(true)
  })

  it('waits for mutations queued during in-flight initial sync to be pushed', async () => {
    // Simulate an initial sync that is already in flight
    // Use a call-count-based mock to handle initial sync and recursive sync
    // differently, resolving a promise the moment each call is made, so the
    // test synchronizes on the calls themselves instead of guessing how many
    // event-loop hops the async syncNow IIFE needs to reach the coordinator.
    let callCount = 0
    let initialSyncResolve
    let recursiveSyncResolve
    let resolveFirstCall
    let resolveSecondCall
    const firstCallStarted = new Promise((r) => { resolveFirstCall = r })
    const secondCallStarted = new Promise((r) => { resolveSecondCall = r })

    coordinatorSyncNow.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Initial sync - return a promise we control
        resolveFirstCall()
        return new Promise((resolve) => { initialSyncResolve = resolve })
      } else {
        // Recursive sync - return a promise we control
        resolveSecondCall()
        return new Promise((resolve) => { recursiveSyncResolve = resolve })
      }
    })

    // Queue some mutations to simulate "Sync & Merge" while initial sync is in flight
    await repository.addPendingMutation('create', 'link-1', 'link', { id: 'link-1' }, 'test-account', 0)
    await repository.addPendingMutation('create', 'link-2', 'link', { id: 'link-2' }, 'test-account', 0)

    // Start initial sync (simulates login auto-sync)
    const initialSyncPromise = syncNow()
    // Wait for the initial sync to actually reach the coordinator call.
    await firstCallStarted

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

    // The syncNowWithMutations should wait for the mutations to be processed.
    // The useSync.js re-check logic should kick in and trigger a recursive
    // sync — wait for THAT call to arrive, which is also when the recursive
    // sync's resolver becomes usable below.
    await secondCallStarted

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
    let resolveSyncStarted
    // The once-implementation assigns syncResolve only when the coordinator
    // call is actually made (after waitForRotation + the pending snapshot),
    // which no fixed tick count can guarantee — resolve on the call itself.
    const syncStarted = new Promise((r) => { resolveSyncStarted = r })
    coordinatorSyncNow.mockImplementationOnce(() => {
      resolveSyncStarted()
      return new Promise((resolve) => {
        syncResolve = resolve
      })
    })

    // Queue some mutations to simulate "Sync & Merge"
    await repository.addPendingMutation('create', 'link-A', 'link', { id: 'link-A' }, 'test-account', 0)
    await repository.addPendingMutation('create', 'link-B', 'link', { id: 'link-B' }, 'test-account', 0)

    // Call syncNowWithMutations
    const mutationsPromise = syncNowWithMutations()

    // Wait for the sync to reach the coordinator call (syncResolve is set).
    await syncStarted

    // Simulate coordinator processing mutations
    // With per-test store isolation this is exactly the two rows queued above.
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

describe('syncNow — post-login session-rotation race (regression)', () => {
  beforeEach(() => {
    coordinatorSyncNow.mockReset()
    sessionState = { status: 'authenticated', user: { id: 'test-account' }, error: null }
  })

  it('does not dispatch the pull while a rotation is revoking the old cookie (the 401 race)', async () => {
    // Boot scenario: initSession() has started the fire-and-forget rotation
    // (revoke-then-create) and the status watcher fires the first sync. The
    // rotation is still in flight — its response (with the fresh Set-Cookie)
    // has not been applied, so pulling NOW would present the just-revoked
    // cookie and /api/sync/objects would 401.
    let settleRotation
    mockedSession.waitForRotation.mockReturnValue(new Promise((r) => { settleRotation = r }))
    coordinatorSyncNow.mockResolvedValue(EMPTY)

    const run = syncNow()

    // Rotation still in flight: the pull (coordinator → /api/sync/objects)
    // must NOT have been dispatched yet.
    await new Promise((r) => setTimeout(r, 0))
    expect(coordinatorSyncNow).not.toHaveBeenCalled()

    // Rotation settles; the fresh cookie is now in the jar. Only now may the
    // pull run — and it must run exactly once.
    settleRotation(true)
    await run
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(1)
  })
})

describe('syncNow — re-drain loop guard (regression for bug B: endless GET /api/sync/objects + POST /api/sync/mutations)', () => {
  beforeEach(() => {
    coordinatorSyncNow.mockReset()
    sessionState = { status: 'authenticated', user: { id: 'test-account' }, error: null }
    mockedSession.waitForRotation.mockReset().mockResolvedValue(true)
  })

  it('settles to idle when a sync leaves a mutation pending (no immediate retry loop)', async () => {
    // A mutation that predates this sync run and stays pending after it
    // (401-rejected / unavailable — the coordinator deliberately leaves those
    // pending for a later retry) must NOT re-trigger an immediate re-sync.
    // The unguarded re-check used to spin: each cycle pulled + pushed the same
    // stuck mutation again, forever, until a page refresh broke the chain.
    await repository.addPendingMutation('create', 'stuck-link', 'link', { id: 'stuck-link' }, 'test-account', 0)
    coordinatorSyncNow.mockResolvedValue({ pushed: 1, succeeded: 0, failed: 0, conflict: 0, unavailable: 1 })

    const result = await syncNow()

    expect(result.unavailable).toBe(1)
    // The sync ran exactly once and reached idle — no recursive re-drain.
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(1)
    // The stuck mutation stays pending for the next natural trigger (poll,
    // visibility resume, user action) instead of hammering the API.
    const pending = await repository.getPendingMutations()
    expect(pending.some(m => m.object_id === 'stuck-link' && m.status === 'pending')).toBe(true)
  })

  it('still drains genuinely NEW work queued during the sync (one extra cycle, then idle)', async () => {
    // Work queued while a sync is in flight is new (not in the pre-sync
    // snapshot, never handed to the network): it must get one recursive
    // drain — but only once, and only until it clears.
    const linkMutations = async () =>
      (await repository.getPendingMutations()).filter(m => m.account_id === 'test-account' && m.status === 'pending')

    let callCount = 0
    let firstResolve
    let resolveFirstCall
    const firstCallStarted = new Promise((r) => { resolveFirstCall = r })
    coordinatorSyncNow.mockImplementation(() => {
      callCount++
      resolveFirstCall()
      if (callCount === 1) return new Promise((r) => { firstResolve = r })
      return Promise.resolve({ pushed: 2, succeeded: 2, failed: 0, conflict: 0, unavailable: 0 })
    })

    await repository.addPendingMutation('create', 'pre-link', 'link', { id: 'pre-link' }, 'test-account', 0)
    const run = syncNow()
    // Deterministic: wait until the first coordinator call is actually
    // in-flight (the call follows waitForRotation + an IndexedDB snapshot —
    // not guaranteed to have started after one macrotask under load).
    await firstCallStarted
    expect(coordinatorSyncNow).toHaveBeenCalledTimes(1)

    // New work appears during the in-flight sync.
    await repository.addPendingMutation('create', 'mid-link', 'link', { id: 'mid-link' }, 'test-account', 0)

    // The first run returns without processing anything; the finally re-check
    // sees mid-link as new unpushed work and starts one recursive drain.
    firstResolve({ pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0 })
    await run
    await new Promise((r) => setTimeout(r, 10))

    // The recursive drain cleared every pending mutation (both runs in the
    // second call are marked succeeded by its resolver sim).
    for (const m of await linkMutations()) {
      await repository.markMutationSucceeded(m.mutation_id)
    }
    await new Promise((r) => setTimeout(r, 0))

    expect(coordinatorSyncNow).toHaveBeenCalledTimes(2)
    expect((await linkMutations()).length).toBe(0)
  })
})