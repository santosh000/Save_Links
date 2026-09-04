// Save_Links — Worker-side D1 data layer (Phase 3B).
//
// The ONLY module that touches D1. It runs in the Cloudflare Worker runtime
// (workerd) against the `DB` binding and in Node tests against a
// node:sqlite-backed facade with the same API surface
// (prepare().bind().run()/.first()/.all()).
//
// Boundary rules:
// - Never imported from src/ (the browser application). The browser talks to
//   the Worker over HTTP (Phase 3C); it never talks to D1.
// - No authentication provider logic, no cookies, no HTTP — persistence only.
// - Session tokens: the raw opaque token is generated here, returned to the
//   caller EXACTLY once (future cookie issuance), and only its SHA-256 hash is
//   persisted. The raw token is never stored.
// - All timestamps are epoch milliseconds UTC, evaluated server-side.

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// ---- token helpers ---------------------------------------------------------

function bytesToBase64Url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Opaque 32-byte (256-bit) random session token, base64url. */
export function generateSessionToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

/** SHA-256 hex digest — the only representation of a token ever persisted. */
export async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- input validation (trust boundary: the Worker validates what it stores) ---

function requireNonEmpty(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
}

function requireAccountId(accountId) {
  requireNonEmpty(accountId, 'accountId')
}

function requireEpochMs(now) {
  if (!Number.isInteger(now) || now <= 0) throw new TypeError('now must be a positive integer (epoch ms)')
}

// ---- accounts --------------------------------------------------------------

/**
 * Create an application account. Prefer letting the caller omit accountId so
 * a secure UUIDv4 is generated here. Duplicate account ids are rejected by
 * the PRIMARY KEY constraint.
 */
export async function createAccount(db, { accountId = crypto.randomUUID(), now = Date.now() } = {}) {
  requireAccountId(accountId)
  requireEpochMs(now)
  await db.prepare('INSERT INTO users (account_id, created_at) VALUES (?, ?)').bind(accountId, now).run()
  return { accountId, createdAt: now }
}

/** @returns {Promise<{account_id: string, created_at: number}|null>} */
export async function getAccount(db, { accountId }) {
  requireAccountId(accountId)
  return db.prepare('SELECT account_id, created_at FROM users WHERE account_id = ?').bind(accountId).first()
}

/**
 * Map a provider identity to an application account. The
 * PRIMARY KEY (provider, provider_subject) rejects duplicate mappings; the
 * FK rejects unknown accounts.
 */
export async function addProviderIdentity(db, { accountId, provider, providerSubject, now = Date.now() } = {}) {
  requireAccountId(accountId)
  requireNonEmpty(provider, 'provider')
  requireNonEmpty(providerSubject, 'providerSubject')
  requireEpochMs(now)
  await db.prepare('INSERT INTO auth_identities (provider, provider_subject, account_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(provider, providerSubject, accountId, now)
    .run()
}

/** @returns {Promise<{account_id: string}|null>} */
export async function getAccountIdByProviderIdentity(db, { provider, providerSubject }) {
  requireNonEmpty(provider, 'provider')
  requireNonEmpty(providerSubject, 'providerSubject')
  return db.prepare('SELECT account_id FROM auth_identities WHERE provider = ? AND provider_subject = ?')
    .bind(provider, providerSubject)
    .first()
}

/**
 * Resolve a provider identity to an application account, creating the account
 * + identity mapping atomically on first sight (used by the OAuth callback).
 *
 * Create path runs as ONE D1 `batch` (a SQL transaction): either both the
 * users row and the auth_identities row commit, or neither does — no
 * orphaned identity or account. If a concurrent callback creates the same
 * identity first, the batch fails on the (provider, provider_subject) PRIMARY
 * KEY and we simply re-resolve the winner. Never merges or duplicates
 * accounts, never matches on email.
 *
 * @returns {Promise<{account_id: string, created: boolean, createdAt: number}>}
 */
export async function resolveAccountByProvider(db, { provider, providerSubject, accountId = crypto.randomUUID(), now = Date.now() } = {}) {
  requireNonEmpty(provider, 'provider')
  requireNonEmpty(providerSubject, 'providerSubject')
  requireAccountId(accountId)
  requireEpochMs(now)

  const existing = await getAccountIdByProviderIdentity(db, { provider, providerSubject })
  if (existing) return { account_id: existing.account_id, created: false, createdAt: now }

  try {
    await db.batch([
      db.prepare('INSERT INTO users (account_id, created_at) VALUES (?, ?)').bind(accountId, now),
      db.prepare('INSERT INTO auth_identities (provider, provider_subject, account_id, created_at) VALUES (?, ?, ?, ?)')
        .bind(provider, providerSubject, accountId, now),
    ])
    return { account_id: accountId, created: true, createdAt: now }
  } catch {
    // Race: another callback created this identity between our lookup and our
    // batch. Re-resolve; a genuine error is rethrown below.
    const winner = await getAccountIdByProviderIdentity(db, { provider, providerSubject })
    if (winner) return { account_id: winner.account_id, created: false, createdAt: now }
    throw new Error('account creation failed and the identity could not be re-resolved')
  }
}

// ---- sessions --------------------------------------------------------------

/**
 * Create a session for an account. Generates the opaque token, persists ONLY
 * its SHA-256 hash, and returns the raw token exactly once — the browser
 * credential for Phase 3C's cookie issuance. The FK rejects unknown accounts.
 *
 * @returns {Promise<{token: string, tokenHash: string, createdAt: number, expiresAt: number}>}
 */
export async function createSession(db, { accountId, ttlMs = DEFAULT_SESSION_TTL_MS, now = Date.now() } = {}) {
  requireAccountId(accountId)
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be a positive integer')
  requireEpochMs(now)
  const token = generateSessionToken()
  const tokenHash = await hashSessionToken(token)
  const expiresAt = now + ttlMs
  await db.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, accountId, now, expiresAt)
    .run()
  return { token, tokenHash, createdAt: now, expiresAt }
}

/**
 * Resolve a raw bearer token to its ACTIVE session: revoked sessions and
 * expired sessions resolve to null (they cannot authenticate). Evaluation
 * happens in the database against the provided server clock.
 *
 * @returns {Promise<{account_id: string, created_at: number, expires_at: number}|null>}
 */
export async function getSessionByToken(db, { token, now = Date.now() } = {}) {
  requireNonEmpty(token, 'token')
  requireEpochMs(now)
  return db.prepare(
    `SELECT s.account_id, s.created_at, s.expires_at
     FROM sessions s
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`
  ).bind(await hashSessionToken(token), now).first()
}

/** Revoke one session by its bearer token. Returns true when a session was revoked. */
export async function revokeSessionByToken(db, { token, now = Date.now() } = {}) {
  requireNonEmpty(token, 'token')
  requireEpochMs(now)
  const res = await db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(now, await hashSessionToken(token))
    .run()
  return (res.meta?.changes ?? 0) === 1
}

/** Revoke every active session of an account. Returns the number revoked. */
export async function revokeAllSessionsForAccount(db, { accountId, now = Date.now() } = {}) {
  requireAccountId(accountId)
  requireEpochMs(now)
  const res = await db.prepare('UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL')
    .bind(now, accountId)
    .run()
  return res.meta?.changes ?? 0
}

/** Delete rows whose expiry has passed. Returns the number deleted. */
export async function deleteExpiredSessions(db, { now = Date.now() } = {}) {
  requireEpochMs(now)
  const res = await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run()
  return res.meta?.changes ?? 0
}

// ---- OAuth state (Phase 3C-2: single-use claim) -------------------------------

/**
 * Atomically claim an OAuth state for its first (and only) use.
 *
 * INSERT OR IGNORE on the PRIMARY KEY means exactly one request ever wins the
 * insert (changes = 1 — the fresh first use); every later presentation of the
 * same state conflicts (changes = 0 — a replay or an already-claimed state) and
 * returns false. The claimed row is deliberately NOT deleted: it is the
 * tombstone that makes the state single-use — deleting it on claim would let a
 * replay win the insert again. Rows are bounded by the expiry sweep
 * (deleteExpiredOAuthStates), run opportunistically from the login route.
 *
 * Only the opaque random state is stored — never the PKCE code_verifier or any
 * token. Expiry enforcement lives in the signed state payload's `exp` (checked
 * before this call); the table guarantees single-use, it does not re-check time.
 *
 * @returns {Promise<boolean>} true when this call claimed the state (first use)
 */
export async function claimOAuthState(db, { state, expiresAt }) {
  requireNonEmpty(state, 'state')
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) throw new TypeError('expiresAt must be a positive integer (epoch ms)')
  const claim = await db.prepare('INSERT OR IGNORE INTO oauth_states (state, expires_at) VALUES (?, ?)')
    .bind(state, expiresAt)
    .run()
  return (claim.meta?.changes ?? 0) === 1
}

/**
 * Delete OAuth-state tombstones whose expiry has passed. Returns the number
 * deleted. The login route calls this opportunistically so the table stays a
 * rolling ~10-minute window of attempts (state TTL). The expires_at index
 * keeps this a cheap index-range delete.
 */
export async function deleteExpiredOAuthStates(db, { now = Date.now() } = {}) {
  requireEpochMs(now)
  const res = await db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now).run()
  return res.meta?.changes ?? 0
}

// ---- cloud sync objects (Phase 4 Chunk 2) -----------------------------------

export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const OBJECT_TYPES = new Set(['link', 'folder'])
const OPERATIONS = new Set(['create', 'update', 'delete'])

function requireObjectType(t) {
  if (!OBJECT_TYPES.has(t)) throw new TypeError('object_type must be "link" or "folder"')
}

function requireObjectId(id) {
  requireNonEmpty(id, 'objectId')
}

function requireOperation(op) {
  if (!OPERATIONS.has(op)) throw new TypeError('operation must be create, update, or delete')
}

function requireBaseRevision(rev) {
  if (!Number.isInteger(rev) || rev < 0) throw new TypeError('base_revision must be a non-negative integer')
}

/**
 * Read the current authoritative object for an account (live or tombstoned).
 *
 * @returns {Promise<{object_id, object_type, revision, deleted, deleted_at, payload}|null>}
 */
export async function getObject(db, { accountId, objectType, objectId }) {
  requireAccountId(accountId)
  requireObjectType(objectType)
  requireObjectId(objectId)
  return db.prepare(
    'SELECT object_id, object_type, revision, deleted, deleted_at, payload FROM sync_objects WHERE account_id = ? AND object_id = ?'
  ).bind(accountId, objectId).first()
}

/**
 * Return every sync object (live AND tombstoned) for one account — the
 * server-side read side of the pull/reconcile flow.
 *
 * Account scoping is enforced here in SQL: callers pass the account id from
 * the authenticated session only, and the query filters by it, so rows of
 * another account are never returned.
 *
 * @returns {Promise<Array<{object_id, object_type, revision, deleted, deleted_at, payload, created_at, updated_at}>>}
 */
export async function getObjectsForAccount(db, { accountId }) {
  requireAccountId(accountId)
  const res = await db.prepare(
    `SELECT object_id, object_type, revision, deleted, deleted_at, payload, created_at, updated_at
     FROM sync_objects
     WHERE account_id = ?
     ORDER BY object_type, object_id`
  ).bind(accountId).all()
  return res.results
}

/**
 * Atomically apply one client mutation for an account and record its outcome
 * in the idempotency ledger — or return the original result if this exact
 * mutation_id was already applied.
 *
 * D1 transaction strategy (see api.js / spec): {account_id, mutation_id} rows
 * are claimed with INSERT OR IGNORE, and the object write is revision-gated,
 * ALL inside a single db.batch() (one atomic transaction). The conditionality
 * that a naive "read-then-branch INSIDE db.batch()" cannot express is instead
 * encoded in the SQL (WHERE revision = ?, NOT EXISTS, INSERT...SELECT), and we
 * branch only on the returned `changes` AFTER the batch resolves. This is D1-
 * valid, atomic, and idempotent WITHOUT the (unavailable) withSession API.
 *
 * @param {Object} input
 * @param {string} input.accountId  FROM THE AUTHENTICATED SESSION ONLY
 * @param {string} input.mutationId idempotency key, reused verbatim on retry
 * @param {'link'|'folder'} input.objectType
 * @param {string} input.objectId
 * @param {'create'|'update'|'delete'} input.operation
 * @param {number} input.baseRevision
 * @param {string} input.payload JSON body (opaque to the store)
 * @returns {Promise<{kind:'applied', resultRevision:number}|{kind:'replay', resultRevision:number}|{kind:'conflict', current:object|null}|{kind:'error'}>}
 */
export async function applyObjectMutation(db, {
  accountId,
  mutationId,
  objectType,
  objectId,
  operation,
  baseRevision,
  payload,
  now = Date.now(),
}) {
  requireAccountId(accountId)
  requireNonEmpty(mutationId, 'mutationId')
  requireObjectType(objectType)
  requireObjectId(objectId)
  requireOperation(operation)
  requireBaseRevision(baseRevision)
  requireEpochMs(now)

  if (operation === 'create' && baseRevision !== 0) {
    const current = await getObject(db, { accountId, objectType, objectId })
    return { kind: 'conflict', current }
  }

  // Fast-path replay: an already-committed mutation_id returns its original
  // result without touching the object. (The authoritative guard is the
  // INSERT OR IGNORE claim inside the batch below; this read is the cheap
  // happy path for the dominant retry-after-lost-response case.)
  const prior = await db.prepare(
    'SELECT result_revision FROM sync_mutations WHERE account_id = ? AND mutation_id = ?'
  ).bind(accountId, mutationId).first()
  if (prior) {
    return { kind: 'replay', resultRevision: prior.result_revision }
  }

  // Build the claim + object-write SQL for ONE atomic batch. The claim's
  // INSERT...SELECT only inserts (changes = 1) when the object is in the
  // exact pre-mutation state the operation needs; the object write is gated
  // by the SAME condition, so both commit together or neither does.
  let claimSql, objSql, claimParams, objParams

  if (operation === 'create') {
    // CREATE: base_revision must be 0 (checked above) and the object must be
    // ABSENT. result_revision = 1.
    claimSql = `INSERT OR IGNORE INTO sync_mutations
      (account_id, mutation_id, object_id, object_type, operation, base_revision, status, result_revision, applied_at)
      SELECT ?, ?, ?, ?, ?, ?, 'applied', 1, ?
      WHERE NOT EXISTS (SELECT 1 FROM sync_objects WHERE account_id = ? AND object_id = ?)`
    claimParams = [accountId, mutationId, objectId, objectType, operation, baseRevision, now, accountId, objectId]
    objSql = `INSERT INTO sync_objects
      (account_id, object_id, object_type, revision, deleted, deleted_at, payload, created_at, updated_at)
      SELECT ?, ?, ?, 1, 0, NULL, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM sync_objects WHERE account_id = ? AND object_id = ?)`
    objParams = [accountId, objectId, objectType, payload, now, now, accountId, objectId]
  } else if (operation === 'update') {
    // UPDATE: base_revision must equal the current live revision; result = rev+1.
    claimSql = `INSERT OR IGNORE INTO sync_mutations
      (account_id, mutation_id, object_id, object_type, operation, base_revision, status, result_revision, applied_at)
      SELECT account_id, ?, object_id, object_type, ?, ?, 'applied', revision + 1, ?
      FROM sync_objects
      WHERE account_id = ? AND object_id = ? AND deleted = 0 AND revision = ?`
    claimParams = [mutationId, operation, baseRevision, now, accountId, objectId, baseRevision]
    objSql = `UPDATE sync_objects
      SET revision = revision + 1, payload = ?, deleted = 0, deleted_at = NULL, updated_at = ?
      WHERE account_id = ? AND object_id = ? AND deleted = 0 AND revision = ?`
    objParams = [payload, now, accountId, objectId, baseRevision]
  } else {
    // DELETE: base_revision must equal the current live revision; result = rev+1.
    claimSql = `INSERT OR IGNORE INTO sync_mutations
      (account_id, mutation_id, object_id, object_type, operation, base_revision, status, result_revision, applied_at)
      SELECT account_id, ?, object_id, object_type, ?, ?, 'applied', revision + 1, ?
      FROM sync_objects
      WHERE account_id = ? AND object_id = ? AND deleted = 0 AND revision = ?`
    claimParams = [mutationId, operation, baseRevision, now, accountId, objectId, baseRevision]
    objSql = `UPDATE sync_objects
      SET revision = revision + 1, deleted = 1, deleted_at = ?, updated_at = ?
      WHERE account_id = ? AND object_id = ? AND deleted = 0 AND revision = ?`
    objParams = [now, now, accountId, objectId, baseRevision]
  }

  const [claimRes, objRes] = await db.batch([
    db.prepare(claimSql).bind(...claimParams),
    db.prepare(objSql).bind(...objParams),
  ])
  const claimChanges = claimRes?.meta?.changes ?? 0
  const objChanges = objRes?.meta?.changes ?? 0

  if (claimChanges === 1) {
    // This request won the atomic claim AND the object write — committed
    // together. result_revision for create is 1; for update/delete it was
    // recorded in the claim as rev+1. Re-read the ledger for the exact value.
    const recorded = await db.prepare(
      'SELECT result_revision FROM sync_mutations WHERE account_id = ? AND mutation_id = ?'
    ).bind(accountId, mutationId).first()
    return { kind: 'applied', resultRevision: recorded ? recorded.result_revision : 1 }
  }

  // claimChanges === 0: the claim collided — either the mutation_id was
  // already applied (replay) or the object was not in the expected state
  // (conflict). Distinguish by checking the ledger.
  const ledger = await db.prepare(
    'SELECT result_revision FROM sync_mutations WHERE account_id = ? AND mutation_id = ?'
  ).bind(accountId, mutationId).first()
  if (ledger) {
    return { kind: 'replay', resultRevision: ledger.result_revision }
  }
  const current = await getObject(db, { accountId, objectType, objectId })
  return { kind: 'conflict', current }
}

/**
 * Reclaim tombstoned objects older than the retention window. Returns the
 * number of rows hard-deleted.
 */
export async function purgeExpiredTombstones(db, { now = Date.now() } = {}) {
  requireEpochMs(now)
  const res = await db.prepare('DELETE FROM sync_objects WHERE deleted = 1 AND deleted_at <= ?')
    .bind(now - TOMBSTONE_RETENTION_MS)
    .run()
  return res.meta?.changes ?? 0
}