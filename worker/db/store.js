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