// Save_Links Worker — Phase 3D: authenticated API boundary.
//
// The /api/* boundary is the point where a browser request, a session cookie,
// and a D1 account come together. Chunk 1 proved the read boundary:
//   GET /api/me  -> 200 { authenticated: true, accountId } | 401 | 503 | 500
//
// Chunk 2 adds the first real state-changing endpoint:
//   POST /api/session/refresh -> 200 { ok: true } + fresh session cookie
//   | 401 | 403 | 503 | 500
//
// Design constraints honored here:
//   - GET /api/me is READ-ONLY: no CSRF token, no Origin/Referer gate (a
//     cross-site read is harmless and same-origin policy already guards it).
//     It also deliberately never inspects APPROVED_ORIGINS.
//   - POST /api/session/refresh IS state-changing, so it enforces the full
//     boundary FIRST: POST (router) -> Origin/Referer gate -> authenticated
//     session -> account. Origin validation fails closed and never derives a
//     trusted origin from Host/X-Forwarded-Host/X-Forwarded-Proto, query
//     params, or the request body — only from APPROVED_ORIGINS.
//   - Session resolution + rotation REUSE the existing authentication
//     machinery (auth.js readSessionCookie/setCookieHeader/sessionCookieConfig,
//     store.js getSessionByToken/getAccount/revokeSessionByToken/createSession)
//     — no duplicated hashing/cookie-parse/lookup logic.
//   - Nothing here touches application data, IndexedDB, or sync. Local-first
//     behavior stays completely independent.

import {
  getAccount,
  getSessionByToken,
  revokeSessionByToken,
  createSession,
  applyObjectMutation,
  getObjectsForAccount,
} from './db/store.js'
import {
  jsonResponse,
  parseApprovedOrigins,
  readSessionCookie,
  setCookieHeader,
  sessionCookieConfig,
  SESSION_TTL_SECONDS,
} from './auth.js'

// ---- GET /api/me --------------------------------------------------------------

/**
 * Authenticated "who am I" probe for the API boundary.
 *
 * Resolution order (server-side, all-or-nothing per the cleanup chain):
 *   cookie present -> token hashed (getSessionByToken) -> session EXISTS, NOT
 *   revoked, NOT expired (all enforced INSIDE the SQL) -> account EXISTS.
 * Every failure along that chain is a generic 401 { error: 'unauthenticated' }
 * so network observers cannot distinguish absent/malformed/unknown/expired/
 * revoked conditions or a missing account.
 *
 * A missing DB binding is infrastructure, not auth state: 503 (never treat the
 * user as authenticated). An unexpected error is a generic 500; internal
 * exception messages are never exposed. The response body contains only the
 * opaque D1 account id — never the raw token, the GitHub provider subject, any
 * OAuth token, or any DB detail.
 */
export async function handleApiMe(request, env, { now = Date.now() } = {}) {
  if (!env.DB) return jsonResponse(503, { error: 'unavailable' })
  const presented = readSessionCookie(request)
  if (!presented) return jsonResponse(401, { error: 'unauthenticated' })
  try {
    const session = await getSessionByToken(env.DB, { token: presented.token, now })
    if (!session) return jsonResponse(401, { error: 'unauthenticated' })
    const account = await getAccount(env.DB, { accountId: session.account_id })
    if (!account) return jsonResponse(401, { error: 'unauthenticated' })
    return jsonResponse(200, { authenticated: true, accountId: account.account_id })
  } catch {
    return jsonResponse(500, { error: 'server_error' })
  }
}

// ---- POST /api/session/refresh ------------------------------------------------

/**
 * Rotate the browser's authenticated session: revoke the presented session,
 * create a fresh random session, and hand out a new session cookie.
 *
 * Security flow (strict order, POST enforced by the router):
 *   1. POST                                          (router)
 *   2. Origin/Referer gate against APPROVED_ORIGINS  (requireApiOrigin)
 *   3. read the presented session cookie
 *   4. hash the raw token (inside getSessionByToken)
 *   5. resolve the ACTIVE session (revoked/expired -> null)
 *   6. resolve the account
 *   7. revoke the presented session
 *   8. create a fresh random session (only its hash persisted)
 *   9. set the fresh session cookie (existing prod/dev cookie rules)
 *  10. return success
 *
 * The trusted origin comes ONLY from APPROVED_ORIGINS — never from
 * Host/X-Forwarded-Host/X-Forwarded-Proto, query params, or the body (and an
 * account id / token / redirect URL are never accepted from the body).
 *
 * Atomicity: this is not a single DB transaction. Steps 7-8 are ordered
 * revoke-then-create (the same sequence the OAuth callback already uses). If
 * revocation succeeds but creation fails, we return a generic 500 and NO
 * replacement cookie — never a success response and never a misleading
 * replacement cookie. The degradation is a logged-out session, which is safe
 * (a client-initiated rotation that fails simply ends the session); the old
 * token is already revoked so it cannot linger valid.
 *
 * Authentication failures (missing/malformed/unknown/expired/revoked session
 * or missing account) are all a uniform generic 401 - nothing is rotated and
 * nothing is revealed. An origin failure is 403/503 *before* any session work,
 * so nothing is revoked or created. A missing DB or an unexpected error is a
 * generic 500.
 *
 * The success body is minimal ({ ok: true }) and contains no token, GitHub
 * subject, OAuth token, session row, or DB detail. Cache-Control: no-store and
 * the shared security headers come from jsonResponse.
 */
export async function handleApiSessionRefresh(request, env, { now = Date.now() } = {}) {
  if (!env.DB) return jsonResponse(503, { error: 'unavailable' })

  // Origin/Referer gate FIRST: fail closed before doing any session work.
  const gate = requireApiOrigin(request, env)
  if (gate.status) {
    // 503 = APPROVED_ORIGINS unset/empty (misconfigured); 403 = cross-site.
    const body = gate.status === 503 ? { error: 'unavailable' } : { error: 'forbidden' }
    return jsonResponse(gate.status, body)
  }

  const presented = readSessionCookie(request)
  if (!presented) return jsonResponse(401, { error: 'unauthenticated' })

  try {
    const session = await getSessionByToken(env.DB, { token: presented.token, now })
    if (!session) return jsonResponse(401, { error: 'unauthenticated' })
    const account = await getAccount(env.DB, { accountId: session.account_id })
    if (!account) return jsonResponse(401, { error: 'unauthenticated' })

    // Authenticated + origin-approved: rotate. Revoke first, then create.
    await revokeSessionByToken(env.DB, { token: presented.token, now })
    const fresh = await createSession(env.DB, { accountId: account.account_id, now })

    const { name, secure } = sessionCookieConfig(new URL(request.url))
    const cookie = setCookieHeader(name, fresh.token, {
      maxAgeSeconds: SESSION_TTL_SECONDS,
      secure,
    })
    return jsonResponse(200, { ok: true }, { 'Set-Cookie': [cookie] })
  } catch {
    return jsonResponse(500, { error: 'server_error' })
  }
}

// ---- POST /api/sync/mutation -------------------------------------------------

const SYNC_BODY_MAX = 512 * 1024

/**
 * Apply one queued client mutation against the server-authoritative object
 * storage (Phase 4 Chunk 2). This is the cloud-sync protocol foundation:
 * objective A (push mutation), B (server behavior), C (idempotency), E (error
 * semantics), F (atomicity).
 *
 * Security flow (strict order, POST enforced by the router):
 *   1. POST                                            (router)
 *   2. missing DB binding                              -> 503
 *   3. Origin/Referer gate (state-changing)            -> 403 / 503
 *   4. read presented session cookie, resolve account  -> 401 on any failure
 *   5. parse + structurally validate the JSON body     -> 400 on malformed
 *   6. delegate the whole mutation to store.applyObjectMutation, which does the
 *      atomic object write + idempotency-record in ONE db.batch() transaction
 *   7. map the structured result to HTTP
 *
 * account_id is NEVER read from the body — it comes exclusively from the
 * authenticated session (invariant 4). The local record's account_id is
 * informational only; the server derives the true owner from the cookie.
 *
 * Response mapping:
 *   applied / replay -> 200 { accepted: true, result_revision }
 *   conflict         -> 409 { accepted: false, reason: 'revision_conflict', current }
 *   internal error   -> 500 { error: 'server_error' } (no internals leaked)
 *
 * The "duplicate mutation_id" replay is a successful 200 with the ORIGINAL
 * result_revision (idempotent retry), indistinguishable from a first apply.
 */
export async function handleApiSyncMutation(request, env, { now = Date.now() } = {}) {
  if (!env.DB) return jsonResponse(503, { error: 'unavailable' })

  const gate = requireApiOrigin(request, env)
  if (gate.status) {
    return jsonResponse(gate.status, gate.status === 503 ? { error: 'unavailable' } : { error: 'forbidden' })
  }

  const presented = readSessionCookie(request)
  if (!presented) return jsonResponse(401, { error: 'unauthenticated' })

  try {
    const session = await getSessionByToken(env.DB, { token: presented.token, now })
    if (!session) return jsonResponse(401, { error: 'unauthenticated' })
    const account = await getAccount(env.DB, { accountId: session.account_id })
    if (!account) return jsonResponse(401, { error: 'unauthenticated' })
    const accountId = account.account_id

    let body
    try {
      const raw = await request.text()
      if (raw.length > SYNC_BODY_MAX) return jsonResponse(400, { error: 'malformed_mutation' })
      body = JSON.parse(raw)
    } catch {
      return jsonResponse(400, { error: 'malformed_mutation' })
    }

    const mutation = parseMutation(body)
    if (!mutation) return jsonResponse(400, { error: 'malformed_mutation' })

    const result = await applyObjectMutation(env.DB, { accountId, now, ...mutation })

    if (result.kind === 'applied' || result.kind === 'replay') {
      return jsonResponse(200, { accepted: true, result_revision: result.resultRevision })
    }
    if (result.kind === 'conflict') {
      const c = result.current
      const current = c
        ? {
            object_id: c.object_id,
            object_type: c.object_type,
            revision: c.revision,
            deleted: c.deleted === 1,
            deleted_at: c.deleted_at,
            payload: safePayload(c.payload),
          }
        : null
      return jsonResponse(409, { accepted: false, reason: 'revision_conflict', current })
    }
    return jsonResponse(500, { error: 'server_error' })
  } catch {
    return jsonResponse(500, { error: 'server_error' })
  }
}

// ---- GET /api/sync/objects ---------------------------------------------------

/**
 * Return the authenticated account's full server object state (live objects
 * AND tombstones) so the client can pull + reconcile.
 *
 * This is a READ-ONLY endpoint (like /api/me): it enforces authentication but
 * NOT the Origin/Referer gate — a cross-site read is harmless and same-origin
 * policy already guards the response. account_id is EXCLUSIVELY derived from
 * the authenticated session; it is never accepted from query params, headers,
 * or a body.
 *
 * Response: 200 { objects: [{ object_id, object_type, revision, deleted,
 * deleted_at, payload, created_at, updated_at }, ...] } | 401 | 503 | 500.
 * All responses are Cache-Control: no-store; D1/internal errors never leak.
 */
export async function handleApiSyncObjects(request, env, { now = Date.now() } = {}) {
  if (!env.DB) return jsonResponse(503, { error: 'unavailable' })

  const presented = readSessionCookie(request)
  if (!presented) return jsonResponse(401, { error: 'unauthenticated' })

  try {
    const session = await getSessionByToken(env.DB, { token: presented.token, now })
    if (!session) return jsonResponse(401, { error: 'unauthenticated' })
    const account = await getAccount(env.DB, { accountId: session.account_id })
    if (!account) return jsonResponse(401, { error: 'unauthenticated' })
    const accountId = account.account_id

    const rows = await getObjectsForAccount(env.DB, { accountId })
    // Normalize the SQLite integer deleted flag to a boolean for the client.
    const objects = rows.map((row) => ({
      object_id: row.object_id,
      object_type: row.object_type,
      revision: row.revision,
      deleted: row.deleted === 1,
      deleted_at: row.deleted_at,
      payload: safePayload(row.payload),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
    return jsonResponse(200, { objects })
  } catch {
    return jsonResponse(500, { error: 'server_error' })
  }
}

/** Opaque JSON payload — never rendered server-side, so pass it through as-is. */
function safePayload(payload) {
  try { return typeof payload === 'string' ? JSON.parse(payload) : payload } catch { return null }
}

/**
 * Parse + validate the push-mutation body. Returns the mutation fields the
 * store needs, or null when malformed. account_id is deliberately absent here
 * (session-derived). Sizes of every string field are bounded defensively.
 */
function parseMutation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const getStr = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

  const mutationId = getStr(body.mutation_id, 128)
  const objectId = getStr(body.object_id, 128)
  const objectType = getStr(body.object_type, 32)
  const operation = getStr(body.operation, 16)
  const baseRevision = body.base_revision
  const payload = body.payload

  if (!mutationId || !objectId || !objectType || !operation) return null
  if (objectType !== 'link' && objectType !== 'folder') return null
  if (operation !== 'create' && operation !== 'update' && operation !== 'delete') return null
  if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision) || baseRevision < 0) return null
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > SYNC_BODY_MAX) return null

  return { mutationId, objectType, objectId, operation, baseRevision, payload }
}

// ---- Reusable API boundary convention (for state-changing endpoints) ----------
/**
 * Origin/Referer gate for state-changing /api/* endpoints (used by
 * POST /api/session/refresh).
 *
 * Intended usage by the first mutation endpoint:
 *   - require POST (method enforcement lives in the router)
 *   - await-require an authenticated session
 *   - call requireApiOrigin(request, env) and return the error status when
 *     `ok` is false.
 *
 * It verifies the request's Origin (falling back to Referer, per the
 * SameSite/OAuth npm guidance) against APPROVED_ORIGINS and fails closed:
 *   { ok: true }            origin is on the approved list
 *   { status: 503 }         APPROVED_ORIGINS unset/empty (misconfigured)
 *   { status: 403 }         cross-site or missing origin/referer — reject
 *
 * Store-closing note: SameSite=Lax withholds the session cookie on cross-site
 * POSTs, so a cross-site mutation arrives sessionless and is 401 before this
 * even runs; this gate is defense-in-depth + explicit allowlisting, not the
 * only control. NOT used by GET/read-only endpoints like /api/me.
 *
 * @returns {{ok: true}|{status: number}}
 */
export function requireApiOrigin(request, env) {
  const approved = parseApprovedOrigins(env.APPROVED_ORIGINS)
  if (approved.length === 0) return { status: 503 }
  let origin = request.headers.get('origin')
  if (!origin) {
    const ref = request.headers.get('referer')
    if (ref) {
      try {
        origin = new URL(ref).origin
      } catch {
        origin = null
      }
    }
  }
  if (!origin || !approved.includes(origin)) return { status: 403 }
  return { ok: true }
}
