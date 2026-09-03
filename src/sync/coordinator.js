// Cloud sync client coordinator (Phase 4 Chunks 3–4).
//
// Drains the pending_mutations queue explicitly via syncNow(). Processes
// mutations sequentially, updating local state from server responses. Exposes
// only syncNow() — no background sync, no timers, no automatic drain.
//
// Conflict model (Chunk 4):
//   On conflict, the coordinator creates a NEW rebased pending mutation and
//   marks the original failed — atomically via rebasePendingMutation. The
//   rebased mutation waits for the next explicit syncNow() invocation.
//
//   Conflict cases:
//     - serverCurrent is null: mark failed, no rebase
//     - DELETE where server object is already deleted: mark succeeded (intent
//       satisfied), update local revision
//     - CREATE where object exists: convert to UPDATE, rebase against
//       server's revision
//     - UPDATE: rebase as UPDATE against server's revision
//     - DELETE against live object: rebase as DELETE against server's revision
//
// Invariants enforced:
//   - object.revision is the last server-acknowledged revision.
//   - Local mutations never increment object.revision.
//   - Rebased mutation base_revision comes from serverCurrent.revision.
//   - Rebased mutation gets a new mutation_id (genuinely new server mutation).
//   - Original conflicted mutation is preserved as failed history.
//   - account_id is never sent in the HTTP body.
//   - Server revision is authoritative.
import { repository } from '../storage/repository.js'
import { STORES } from '../storage/indexeddb.js'
import { session } from '../auth/session.js'
import { pushMutation } from './protocol.js'

const OBJECT_TYPE_TO_STORE = {
  link: STORES.LINKS,
  folder: STORES.FOLDERS,
}

/**
 * Handle a conflict response from the server. Creates a rebased pending
 * mutation (or marks the original as succeeded/failed) as appropriate.
 *
 * @param {Object} mutation — the original pending mutation record
 * @param {Object|null} serverCurrent — server's current object state (from 409 response)
 * @param {Object} repo — repository instance with rebasePendingMutation
 * @returns {Promise<void>}
 */
export async function rebaseConflict(mutation, serverCurrent, repo) {
  // A. serverCurrent is null — server has no record of this object and we
  //    cannot determine a valid base_revision. Mark the original failed.
  if (!serverCurrent) {
    await repo.markMutationFailed(mutation.mutation_id)
    return
  }

  // B. DELETE where the server object is already deleted — intent satisfied.
  if (mutation.operation === 'delete' && serverCurrent.deleted) {
    const storeName = OBJECT_TYPE_TO_STORE[mutation.object_type]
    if (storeName && serverCurrent.revision != null) {
      await repo.updateObjectRevision(storeName, mutation.object_id, serverCurrent.revision)
    }
    await repo.markMutationSucceeded(mutation.mutation_id)
    return
  }

  // C/D/E — Create a rebased mutation. Determine the operation:
  let operation = mutation.operation
  if (mutation.operation === 'create' && serverCurrent.revision > 0) {
    operation = 'update' // object exists; CREATE with base > 0 is rejected by server
  }

  // Build the rebased mutation record. The payload is the original desired
  // end-state (object or string). Generate a new mutation_id — this is a
  // genuinely new server mutation, not a retry.
  const rebasedPayload = mutation.payload
  const rebased = {
    mutation_id: crypto.randomUUID(),
    account_id: mutation.account_id,
    object_id: mutation.object_id,
    object_type: mutation.object_type,
    operation,
    base_revision: serverCurrent.revision,
    payload: rebasedPayload,
    createdAt: new Date().toISOString(),
    status: 'pending',
  }

  // Atomic: mark original failed + insert rebased in one IndexedDB tx.
  // The rebased mutation is pending and will NOT be processed in this
  // syncNow() call (we iterate a snapshot taken before the rebase).
  await repo.rebasePendingMutation(mutation.mutation_id, rebased)
}

/**
 * Drain all pending mutations for the currently authenticated account.
 *
 * Processes mutations sequentially in queue order. For each mutation:
 *   - accepted  → update local revision from server, mark succeeded
 *   - conflict  → rebase against server state (new pending mutation created)
 *   - rejected  → mark failed (not retryable: 400/401/403)
 *   - unavailable → leave pending (retryable: 500/503/network)
 *
 * @param {Object} [options]
 * @param {Function} [options.pushFn] — injectable pushMutation (default: module import)
 * @param {Object} [options.repo] — injectable repository (default: singleton)
 * @returns {Promise<{ pushed: number, succeeded: number, failed: number, conflict: number, unavailable: number }>}
 */
export async function syncNow({
  pushFn = pushMutation,
  repo = repository,
} = {}) {
  const summary = { pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0 }

  const accountId = session.getState().user?.id
  if (!accountId) return summary

  const mutations = await repo.getPendingMutations()
  const myMutations = mutations.filter(m => m.account_id === accountId)

  for (const mutation of myMutations) {
    summary.pushed++

    // The composables store payloads as JS objects; the server expects a JSON
    // string. Stringify here so pushMutation sends the correct wire format.
    const payload = typeof mutation.payload === 'string'
      ? mutation.payload
      : JSON.stringify(mutation.payload)

    let result
    try {
      result = await pushFn({ ...mutation, payload })
    } catch {
      // Network-level failure — fetch threw (DNS, TLS, offline). Leave the
      // mutation pending for retry.
      summary.unavailable++
      continue
    }

    switch (result.kind) {
      case 'accepted': {
        // Server accepted the mutation — sync local revision to the
        // authoritative value. No content change: the server already has
        // the payload; the local object already has the user's content.
        const storeName = OBJECT_TYPE_TO_STORE[mutation.object_type]
        if (storeName && result.resultRevision != null) {
          await repo.updateObjectRevision(storeName, mutation.object_id, result.resultRevision)
        }
        await repo.markMutationSucceeded(mutation.mutation_id)
        summary.succeeded++
        break
      }
      case 'conflict': {
        // Chunk 4: rebase against server state. The rebased mutation is
        // pending and will be processed on the next syncNow() call.
        await rebaseConflict(mutation, result.current, repo)
        summary.conflict++
        break
      }
      case 'rejected': {
        // Client error (400/401/403). Not retryable — mark failed.
        await repo.markMutationFailed(mutation.mutation_id)
        summary.failed++
        break
      }
      case 'unavailable': {
        // Server error or network issue. Leave pending for retry.
        summary.unavailable++
        break
      }
    }
  }

  return summary
}
