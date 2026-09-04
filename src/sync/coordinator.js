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
import { notifyDataChanged } from '../storage/dataChanges.js'
import { pushMutation, pullObjects } from './protocol.js'

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
 * Apply one authoritative server object to local IndexedDB, preserving the
 * server's revision. Tombstones become local deletions (the object leaves the
 * live local store) rather than a hard purge with no record.
 *
 * @param {Object} repo — repository with upsertLink/upsertFolder/deleteLink/deleteFolder
 * @param {Object} server — a pulled server object, { object_id, object_type, revision, deleted, payload }
 * @returns {Promise<void>}
 */
async function applyServerObject(repo, server) {
  if (server.object_type === 'link') {
    if (server.deleted) {
      await repo.deleteLink(server.object_id)
    } else {
      await repo.upsertLink({ ...(server.payload ?? {}), id: server.object_id, revision: server.revision })
    }
  } else if (server.object_type === 'folder') {
    if (server.deleted) {
      await repo.deleteFolder(server.object_id)
    } else {
      await repo.upsertFolder({ ...(server.payload ?? {}), id: server.object_id, revision: server.revision })
    }
  }
}

/**
 * Pull the server's authoritative object set for the authenticated account and
 * reconcile it against local IndexedDB.
 *
 * Reconciliation rules (deterministic, no conflict UI):
 *   - Objects with a locally pending mutation for the SAME (object_type,
 *     object_id) are skipped: pending local work wins until the push drain
 *     resolves it (rebase on 409). A pull never silently destroys it.
 *   - Where the local acknowledged revision is strictly NEWER than the server's,
 *     the server object is not applied (never overwrite newer local state).
 *   - Otherwise the server object wins: live objects are upserted with the
 *     server revision; tombstones delete the local object (local "deleted").
 *
 * @param {Object} [options]
 * @param {Function} [options.pullFn] — injectable pullObjects (default: module import)
 * @param {Object} [options.repo] — injectable repository (default: singleton)
 * @returns {Promise<{ pulled: number, applied: number, skippedLocal: number, skippedStale: number, unavailable: boolean, rejected: boolean }>}
 */
export async function pullAndReconcile({ pullFn = pullObjects, repo = repository } = {}) {
  const summary = { pulled: 0, applied: 0, skippedLocal: 0, skippedStale: 0, unavailable: false, rejected: false }

  const accountId = session.getState().user?.id
  if (!accountId) return summary

  let result
  try {
    result = await pullFn()
  } catch {
    // Network-level failure (fetch threw). Nothing reconciled.
    summary.unavailable = true
    return summary
  }

  if (result.kind === 'rejected') {
    summary.rejected = true
    return summary
  }
  if (result.kind === 'unavailable' || !Array.isArray(result.objects)) {
    summary.unavailable = true
    return summary
  }

  // Local state snapshots + pending mutations, read once through the repo.
  const [localLinks, localFolders, pending] = await Promise.all([
    repo.getAllLinks(),
    repo.getAllFolders(),
    repo.getPendingMutations(),
  ])

  const localByKey = new Map()
  for (const l of localLinks) localByKey.set(`link:${l.id}`, l)
  for (const f of localFolders) localByKey.set(`folder:${f.id}`, f)

  // Pending local mutations must never be clobbered by a pull's server state.
  const pendingKeys = new Set()
  for (const m of pending) {
    if (m.account_id === accountId) pendingKeys.add(`${m.object_type}:${m.object_id}`)
  }

  summary.pulled = result.objects.length

  for (const server of result.objects) {
    if (!server || typeof server !== 'object') continue
    const key = `${server.object_type}:${server.object_id}`
    if (pendingKeys.has(key)) {
      summary.skippedLocal++
      continue
    }
    const local = localByKey.get(key)
    if (local && (local.revision ?? 0) > server.revision) {
      // Local acknowledged revision is ahead of the server's — do not overwrite.
      summary.skippedStale++
      continue
    }
    await applyServerObject(repo, server)
    summary.applied++
  }

  // The reconcile wrote remote state into IndexedDB from outside the
  // composables; notify them so the mounted useLinks/useFolders refs reload and
  // reflect the pulled data immediately (no page refresh), without enqueueing a
  // new pending mutation.
  if (summary.applied > 0) notifyDataChanged()

  return summary
}

/**
 * Full explicit sync: pull the server state, reconcile it into local
 * IndexedDB, then drain the pending-mutation push queue. Executed in that
 * strict order (pull → reconcile → push).
 *
 * The pull reads the server's authoritative object set for the authenticated
 * account and reconciles it locally (never clobbering pending local work or
 * newer acknowledged local state). The push then drains the queue exactly as
 * before — unchanged semantics (accepted/conflict rebase/rejected/unavailable).
 *
 * If the pull is unavailable or rejected, the push is skipped and the summary
 * reports it (unavailable/failed) so a failed reconciliation is never reported
 * as a successful sync.
 *
 * @param {Object} [options]
 * @param {Function} [options.pushFn] — injectable pushMutation (default: module import)
 * @param {Function} [options.pullFn] — injectable pullObjects (default: module import)
 * @param {Object} [options.repo] — injectable repository (default: singleton)
 * @returns {Promise<{ pushed: number, succeeded: number, failed: number, conflict: number, unavailable: number, pulled: number, applied: number, skippedLocal: number, skippedStale: number }>}
 */
export async function syncNow({
  pushFn = pushMutation,
  pullFn = pullObjects,
  repo = repository,
} = {}) {
  const summary = { pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0, pulled: 0, applied: 0, skippedLocal: 0, skippedStale: 0 }

  const accountId = session.getState().user?.id
  if (!accountId) return summary

  // 1. Pull + reconcile. If the pull cannot be performed, the sync stops here
  //    (no push, no false success) per the pull→reconcile→push ordering.
  const pull = await pullAndReconcile({ pullFn, repo })
  summary.pulled = pull.pulled
  summary.applied = pull.applied
  summary.skippedLocal = pull.skippedLocal
  summary.skippedStale = pull.skippedStale
  if (pull.unavailable) {
    summary.unavailable = 1
    return summary
  }
  if (pull.rejected) {
    summary.failed = 1
    return summary
  }

  // 2. Push drain (existing behavior, unchanged).
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
