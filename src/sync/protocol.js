// Cloud sync client transport (Phase 4 Chunk 2 — Objective F).
//
// Sends one pending mutation to the server via the explicit push API
// (POST /api/sync/mutation). This module is a pure HTTP transport: it never
// touches IndexedDB or the pending-mutations queue — the caller orchestrates
// the queue read → push → result-handling cycle.
//
// Auth: the session cookie is automatically included on same-origin requests.
// The server derives account_id exclusively from the cookie; the client never
// sends account_id in the body.
//
// Retry strategy: none built in. The caller decides what to do with a failed
// push (leave pending, retry later, mark failed). This keeps the transport
// testable (mock fetch) and single-responsibility.
//
// Invariants:
//   - mutation payload is sent as a JSON string inside the body
//   - base_revision is the local object's revision at mutation-queue time
//   - every response maps to a typed result object (never raw HTTP)

const SYNC_MUTATION_ENDPOINT = '/api/sync/mutation'

/**
 * Push a single pending mutation to the server.
 *
 * @param {Object} mutation — a pending-mutations record from IndexedDB
 * @param {string} mutation.mutation_id
 * @param {string} mutation.object_type — 'link' | 'folder'
 * @param {string} mutation.object_id
 * @param {string} mutation.operation — 'create' | 'update' | 'delete'
 * @param {number} mutation.base_revision
 * @param {string} mutation.payload — JSON-stringified object
 * @param {Object} [options]
 * @param {Function} [options.fetch] — injectable fetch (default: globalThis.fetch)
 * @param {string} [options.apiOrigin] — origin prefix (default: '' = same-origin)
 * @returns {Promise<Object>} typed result
 */
export async function pushMutation(
  mutation,
  { fetch: fetchFn = globalThis.fetch, apiOrigin = '' } = {},
) {
  const url = `${apiOrigin}${SYNC_MUTATION_ENDPOINT}`
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mutation_id: mutation.mutation_id,
      object_type: mutation.object_type,
      object_id: mutation.object_id,
      operation: mutation.operation,
      base_revision: mutation.base_revision,
      payload: mutation.payload,
    }),
  })

  const body = await res.json().catch(() => null)

  // --- success: applied or idempotent replay ---
  if (res.status === 200 && body?.accepted === true) {
    return { kind: 'accepted', resultRevision: body.result_revision }
  }

  // --- conflict: server object is ahead ---
  if (res.status === 409 && body?.accepted === false) {
    return {
      kind: 'conflict',
      reason: body.reason,
      current: body.current,
    }
  }

  // --- client error: malformed request or auth failure ---
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return {
      kind: 'rejected',
      status: res.status,
      reason: body?.error ?? 'unknown',
    }
  }

  // --- server unavailable: 503, 500, or network failure ---
  return {
    kind: 'unavailable',
    status: res.status,
    reason: body?.error ?? 'unknown',
  }
}

const SYNC_OBJECTS_ENDPOINT = '/api/sync/objects'

/**
 * Fetch the server's authoritative object set for the authenticated account
 * (live objects and tombstones) so the caller can pull + reconcile.
 *
 * Read-only transport, same conventions as pushMutation: session cookie is
 * carried automatically on same-origin requests, account_id is never sent
 * (the server derives it from the session), and every response maps to the
 * same typed result object. No retry built in — the caller decides.
 *
 * @param {Object} [options]
 * @param {Function} [options.fetch] — injectable fetch (default: globalThis.fetch)
 * @param {string} [options.apiOrigin] — origin prefix (default: '' = same-origin)
 * @returns {Promise<Object>} typed result
 */
export async function pullObjects({ fetch: fetchFn = globalThis.fetch, apiOrigin = '' } = {}) {
  const res = await fetchFn(`${apiOrigin}${SYNC_OBJECTS_ENDPOINT}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  const body = await res.json().catch(() => null)

  // --- success: parse a valid object array ---
  if (res.status === 200 && body && Array.isArray(body.objects)) {
    return { kind: 'ok', objects: body.objects }
  }

  // --- client error: malformed response or auth failure ---
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { kind: 'rejected', status: res.status, reason: body?.error ?? 'unknown' }
  }

  // --- server unavailable: 503, 500, or network failure ---
  return { kind: 'unavailable', status: res.status, reason: body?.error ?? 'unknown' }
}
