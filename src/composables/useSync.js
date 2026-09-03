// Sync entry point (Phase 4 Chunk 5).
//
// Provides an explicit syncNow() that application/UI code calls directly when
// the user triggers a sync. Wraps the coordinator's syncNow() with an
// in-memory lock: if two callers invoke simultaneously, the second awaits the
// first and reuses its result instead of starting a duplicate drain.
//
// Deliberately NOT wired to any event — no watchers, timers, visibility/
// online handlers, or startup sync. Call it explicitly.
//
// The coordinator already handles the unauthenticated case internally
// (returns a deterministic empty summary), so no auth gate lives here.
import { syncNow as coordinatorSyncNow } from '../sync/coordinator.js'

/** @type {Promise|null} the in-flight sync run, if one is active */
let inflight = null

/**
 * Drain all pending mutations for the authenticated account.
 *
 * Concurrent calls share the same in-flight run and its result; a second
 * call never starts a duplicate drain of the queue.
 *
 * @param {Object} [options] — forwarded to the coordinator's syncNow
 * @returns {Promise<{ pushed: number, succeeded: number, failed: number, conflict: number, unavailable: number }>}
 */
export function syncNow(options) {
  if (inflight) return inflight
  inflight = coordinatorSyncNow(options).finally(() => {
    inflight = null
  })
  return inflight
}
