// In-memory "a sync run is active" signal shared between the coordinator
// (which drains the pending-mutation outbox) and the IndexedDB queue (which
// coalesces the outbox in addPendingMutation).
//
// While a sync is running, addPendingMutation must NOT rewrite an existing
// pending mutation record: that record may already be inside the push snapshot
// the sync is iterating, and an 'accepted' response for the OLD payload could
// mark the REWRITTEN record succeeded — silently dropping the fresh payload.
// During a sync the outbox therefore behaves exactly as before (plain append;
// the useSync recursion drains the appended mutation on the next cycle).
//
// This module imports nothing, so importing it from both the coordinator and
// the storage adapter introduces no import cycle.
let activeSyncs = 0

/** Mark the start of a sync run (idempotent; nested runs are counted). */
export function beginSync() {
  activeSyncs++
}

/** Mark the end of a sync run (never drops below zero). */
export function endSync() {
  activeSyncs = Math.max(0, activeSyncs - 1)
}

/** True while at least one sync run is active. */
export function isSyncing() {
  return activeSyncs > 0
}