// Sync entry point (Phase 4 Chunk 5).
//
// Provides an explicit syncNow() that application/UI code calls directly when
// the user triggers a sync. Wraps the coordinator's syncNow() with an
// in-memory lock: if two callers invoke simultaneously, the second awaits the
// first and reuses its result instead of starting a duplicate drain.
//
// CRITICAL: After a sync completes, we must check if new mutations were
// queued during the sync. If so, we must run another sync to drain them. This
// prevents mutations queued during an in-flight sync from being
// permanently missed.
//
// To handle the Sync & Merge race properly, callers that need to wait for
// their specific mutations should use syncNowWithMutations() which tracks
// mutations queued during the call.
//
// Deliberately NOT wired to any event — no watchers, timers, visibility/
// online handlers, or startup sync. Call it explicitly.
//
// The coordinator already handles the unauthenticated case internally
// (returns a deterministic empty summary), so no auth gate lives here.
import { syncNow as coordinatorSyncNow } from '../sync/coordinator.js'
import { repository } from '../storage/repository.js'
import { session } from '../auth/session.js'

/** @type {Promise|null} the in-flight sync run, if one is active */
let inflight = null

/** Counter of pending sync runs. Used to ensure all queued syncs complete. */
let pendingSyncCount = 0

/**
 * Drain all pending mutations for the authenticated account.
 *
 * Concurrent calls share the same in-flight run and its result; a second
 * call never starts a duplicate drain of the queue.
 *
 * After the sync completes, we check if new mutations were queued during
 * the sync. If so, we recursively call syncNow() to drain them. This
 * ensures mutations queued during an in-flight sync are not missed.
 *
 * @param {Object} [options] — forwarded to the coordinator's syncNow
 * @returns {Promise<{ pushed: number, succeeded: number, failed: number, conflict: number, unavailable: number }>}
 */
export async function syncNow(options) {
  if (inflight) return inflight

  pendingSyncCount++
  inflight = (async () => {
    try {
      return await coordinatorSyncNow(options)
    } finally {
      inflight = null
      pendingSyncCount--
      // After the sync completes, check if new mutations were queued
      // during the sync. If so, run another sync to drain them.
      // This handles the race where mutations are queued during an in-flight sync.
      const accountId = session.getState().user?.id
      if (accountId && pendingSyncCount === 0) {
        const mutations = await repository.getPendingMutations()
        const hasPending = mutations.some(m => m.account_id === accountId && m.status === 'pending')
        if (hasPending) {
          // New mutations were queued during the sync - run another sync
          await syncNow(options)
        }
      }
    }
  })()

  return inflight
}

/**
 * Wrapper around syncNow that ensures the caller waits for mutations
 * queued during this specific call to be fully processed.
 * Use this when you need to wait for your specific mutations to be pushed.
 *
 * @param {Object} [options] — forwarded to the coordinator's syncNow
 * @returns {Promise<{ pushed: number, succeeded: number, failed: number, conflict: number, unavailable: number }>}
 */
export async function syncNowWithMutations(options) {
  const accountId = session.getState().user?.id
  if (!accountId) return { pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0 }

  // Get the set of pending mutation IDs before this call
  const beforeMutations = await repository.getPendingMutations()
  const beforeIds = new Set(beforeMutations.filter(m => m.account_id === accountId && m.status === 'pending').map(m => m.mutation_id))

  // If there's an in-flight sync, we need to wait for it AND any subsequent syncs
  // that process our mutations. We do this by waiting for our specific mutations
  // to be resolved, regardless of which sync cycle processes them.
  const syncResult = await syncNow(options)

  // Wait until all mutations that existed before this call are resolved
  // (either succeeded or failed)
  while (true) {
    const mutations = await repository.getPendingMutations()
    const stillPending = mutations.some(m =>
      m.account_id === accountId &&
      m.status === 'pending' &&
      beforeIds.has(m.mutation_id)
    )
    if (!stillPending) break
    // Wait a bit and check again
    await new Promise(r => setTimeout(r, 100))
  }
  return syncResult
}