// Tests for the sync entry point (src/composables/useSync.js).
// Verifies only the concurrency lock + pass-through behavior; the underlying
// sync semantics (drain, rebase, retry) are covered by coordinator.test.js.
import { describe, it, expect, vi } from 'vitest'

// Mock the coordinator so we control when syncNow resolves, without touching
// IndexedDB or the network. This isolates the lock behavior under test.
const coordinatorSyncNow = vi.fn()
vi.mock('../sync/coordinator.js', () => ({
  syncNow: (...args) => coordinatorSyncNow(...args),
}))

const { syncNow } = await import('./useSync.js')

const EMPTY = { pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0 }

describe('useSync.syncNow — concurrency lock', () => {
  beforeEach(() => {
    coordinatorSyncNow.mockReset()
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
