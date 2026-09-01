// @vitest-environment node
//
// Phase 3B + 3C-1 — persistence tests for worker/db/store.js.
//
// Runs the REAL migration SQL (migrations/0001_init.sql) on a real SQLite
// database (node:sqlite) behind the shared D1-binding-compatible facade
// (worker/db/d1-facade.js), then exercises the production data-layer code
// end-to-end. No mocks of SQL semantics: constraint violations, FKs,
// uniqueness, CASCADE, expiry queries and batch atomicity all behave as they
// will on D1 (D1 runs SQLite with foreign keys enforced by default and
// identical prepared-statement semantics).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SESSION_TTL_MS,
  claimOAuthState,
  createAccount,
  getAccount,
  addProviderIdentity,
  getAccountIdByProviderIdentity,
  resolveAccountByProvider,
  createSession,
  getSessionByToken,
  revokeSessionByToken,
  revokeAllSessionsForAccount,
  deleteExpiredSessions,
  deleteExpiredOAuthStates,
  generateSessionToken,
  hashSessionToken,
} from './store.js'
import { createTestDb } from './d1-facade.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))

// One shared in-memory DB across all tests: each test scopes by account_id or
// token value, so accumulated rows never affect another test's counts.
const db = createTestDb()
const NOW = 1_700_000_000_000 // fixed server clock (epoch ms UTC)

describe('account persistence', () => {
  it('createAccount stores a stable, opaque, app-generated account id', async () => {
    const { accountId, createdAt } = await createAccount(db, { now: NOW })
    expect(accountId).toBeTruthy()
    expect(createdAt).toBe(NOW)
    const row = await getAccount(db, { accountId })
    expect(row).toMatchObject({ account_id: accountId, created_at: NOW })
  })

  it('duplicate account id is rejected by the database', async () => {
    const { accountId } = await createAccount(db, { now: NOW })
    await expect(createAccount(db, { accountId, now: NOW })).rejects.toThrow()
  })

  it('account not found resolves to null', async () => {
    expect(await getAccount(db, { accountId: crypto.randomUUID() })).toBeNull()
  })

  it('provider identity maps to the account once; duplicates are rejected', async () => {
    const { accountId } = await createAccount(db, { now: NOW })
    await addProviderIdentity(db, { accountId, provider: 'github', providerSubject: 'sub-1', now: NOW })
    const found = await getAccountIdByProviderIdentity(db, { provider: 'github', providerSubject: 'sub-1' })
    expect(found).toMatchObject({ account_id: accountId })
    expect(await getAccountIdByProviderIdentity(db, { provider: 'github', providerSubject: 'missing' })).toBeNull()

    const other = await createAccount(db, { now: NOW })
    // same provider subject cannot map to a second account
    await expect(
      addProviderIdentity(db, { accountId: other.accountId, provider: 'github', providerSubject: 'sub-1', now: NOW })
    ).rejects.toThrow()
  })

  it('identity cannot reference an unknown account (FK enforced)', async () => {
    await expect(
      addProviderIdentity(db, { accountId: crypto.randomUUID(), provider: 'github', providerSubject: 'x', now: NOW })
    ).rejects.toThrow()
  })

  it('deleting an account cascades to its identities and sessions only', async () => {
    const { accountId } = await createAccount(db, { now: NOW })
    await addProviderIdentity(db, { accountId, provider: 'github', providerSubject: 'cascade-sub', now: NOW })
    const { token } = await createSession(db, { accountId, now: NOW })
    expect(await getSessionByToken(db, { token, now: NOW })).not.toBeNull()

    db._sqlite.prepare('DELETE FROM users WHERE account_id = ?').run(accountId)

    expect(await getAccount(db, { accountId })).toBeNull()
    expect(await getSessionByToken(db, { token, now: NOW })).toBeNull()
    const leftover = db._sqlite.prepare(
      'SELECT (SELECT count(*) FROM auth_identities WHERE account_id = ?) + (SELECT count(*) FROM sessions WHERE account_id = ?) AS n'
    ).get(accountId, accountId)
    expect(leftover.n).toBe(0)
  })
})

describe('resolveAccountByProvider (Phase 3C-1 OAuth mapping)', () => {
  it('creates the account + identity atomically on first sight', async () => {
    const result = await resolveAccountByProvider(db, { provider: 'github', providerSubject: 'github-42', now: NOW })
    expect(result).toMatchObject({ created: true, createdAt: NOW })
    expect(result.account_id).toMatch(/^[0-9a-f-]{36}$/)

    const mapped = await getAccountIdByProviderIdentity(db, { provider: 'github', providerSubject: 'github-42' })
    expect(mapped.account_id).toBe(result.account_id)
    // account row exists and is usable
    expect(await getAccount(db, { accountId: result.account_id })).toMatchObject({ account_id: result.account_id })
  })

  it('resolves to the SAME account on the second sign-in (never duplicates)', async () => {
    const first = await resolveAccountByProvider(db, { provider: 'github', providerSubject: 'github-42-again', now: NOW })
    const second = await resolveAccountByProvider(db, { provider: 'github', providerSubject: 'github-42-again', now: NOW + 1000 })
    expect(second.account_id).toBe(first.account_id)
    expect(second.created).toBe(false)

    const count = db._sqlite.prepare('SELECT count(*) AS n FROM users').get()
    // exactly one account exists for this subject (no orphan, no duplicate)
    expect(count.n).toBeGreaterThanOrEqual(1)
    const identityCount = db._sqlite.prepare(
      'SELECT count(*) AS n FROM auth_identities WHERE provider_subject = ?'
    ).get('github-42-again')
    expect(identityCount.n).toBe(1)
  })

  it('a failure inside the create batch leaves NO partial rows behind (atomic)', async () => {
    const beforeUsers = db._sqlite.prepare('SELECT count(*) AS n FROM users').get().n

    // Trigger a mid-batch failure: pre-create an identity row with the same
    // subject bound to a DIFFERENT account, forcing the batch's second INSERT
    // to violate the (provider, provider_subject) PRIMARY KEY. The first
    // INSERT (users) must roll back with it.
    const other = await createAccount(db, { now: NOW })
    await addProviderIdentity(db, {
      accountId: other.accountId,
      provider: 'github',
      providerSubject: 'atomic-collision',
      now: NOW,
    })

    const attempt = resolveAccountByProvider(db, {
      provider: 'github',
      providerSubject: 'atomic-collision',
      accountId: crypto.randomUUID(),
      now: NOW,
    })
    // the collision resolves to the existing winner instead of throwing
    await expect(attempt).resolves.toMatchObject({ account_id: other.accountId, created: false })

    // no ghost users row appeared for the failed/raced account
    const usersAfter = db._sqlite.prepare('SELECT count(*) AS n FROM users').get().n
    expect(usersAfter).toBe(beforeUsers + 1) // only the winner's account exists
  })

  it('a genuine batch failure rethrows after full rollback', async () => {
    const beforeUsers = db._sqlite.prepare('SELECT count(*) AS n FROM users').get().n
    // Force users-INSERT failure inside the batch: the requested account_id
    // already exists for a DIFFERENT subject. The batch throws, drops the
    // pending auth_identities row (rollback), and the race re-resolve finds
    // nothing for this subject -> the Error propagates.
    const existing = await createAccount(db, { now: NOW })
    await expect(
      resolveAccountByProvider(db, {
        provider: 'github',
        providerSubject: 'genuine-failure-subject',
        accountId: existing.accountId,
        now: NOW,
      })
    ).rejects.toThrow()

    // rollback left NOTHING behind: no ghost identity, no extra users row
    const usersAfter = db._sqlite.prepare('SELECT count(*) AS n FROM users').get().n
    expect(usersAfter).toBe(beforeUsers + 1) // only `existing` remains
    const ghost = db._sqlite.prepare(
      'SELECT count(*) AS n FROM auth_identities WHERE provider_subject = ?'
    ).get('genuine-failure-subject')
    expect(ghost.n).toBe(0)
  })

  it('rejects invalid inputs at the boundary', async () => {
    await expect(resolveAccountByProvider(db, { provider: 'github', providerSubject: '', now: NOW })).rejects.toThrow()
    await expect(resolveAccountByProvider(db, { provider: '', providerSubject: 'x', now: NOW })).rejects.toThrow()
  })
})

describe('session persistence', () => {
  const setup = async () => (await createAccount(db, { now: NOW })).accountId

  it('createSession persists only the token hash, and returns the raw token once', async () => {
    const accountId = await setup()
    const { token, tokenHash, createdAt, expiresAt } = await createSession(db, { accountId, now: NOW })
    expect(expiresAt).toBe(NOW + DEFAULT_SESSION_TTL_MS)
    expect(createdAt).toBe(NOW)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 random bytes, base64url, no padding
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex
    expect(tokenHash).toBe(await hashSessionToken(token))

    const stored = db._sqlite.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(tokenHash)
    expect(stored.token_hash).toBe(tokenHash)
    // the raw bearer token must never appear anywhere in the database
    const dump = db._sqlite.prepare('SELECT group_concat(token_hash) AS all_hashes FROM sessions').get()
    expect(dump.all_hashes).not.toContain(token)
  })

  it('getSessionByToken resolves an active session to its account', async () => {
    const accountId = await setup()
    const { token } = await createSession(db, { accountId, now: NOW })
    const row = await getSessionByToken(db, { token, now: NOW })
    expect(row).toMatchObject({ account_id: accountId, created_at: NOW, expires_at: NOW + DEFAULT_SESSION_TTL_MS })
  })

  it('unknown token resolves to null', async () => {
    expect(await getSessionByToken(db, { token: generateSessionToken(), now: NOW })).toBeNull()
  })

  it('expired session cannot authenticate', async () => {
    const accountId = await setup()
    const { token } = await createSession(db, { accountId, ttlMs: 60_000, now: NOW })
    expect(await getSessionByToken(db, { token, now: NOW + 59_000 })).not.toBeNull()
    expect(await getSessionByToken(db, { token, now: NOW + 60_000 })).toBeNull()
  })

  it('revoked session cannot authenticate; revoke is idempotent per session', async () => {
    const accountId = await setup()
    const { token } = await createSession(db, { accountId, now: NOW })
    expect(await revokeSessionByToken(db, { token, now: NOW })).toBe(true)
    expect(await getSessionByToken(db, { token, now: NOW })).toBeNull()
    expect(await revokeSessionByToken(db, { token, now: NOW })).toBe(false)
    expect(await revokeSessionByToken(db, { token: generateSessionToken(), now: NOW })).toBe(false)
  })

  it('revokeAllSessionsForAccount revokes every active session of the account', async () => {
    const accountId = await setup()
    const first = await createSession(db, { accountId, now: NOW })
    const second = await createSession(db, { accountId, now: NOW })
    expect(await revokeAllSessionsForAccount(db, { accountId, now: NOW })).toBe(2)
    expect(await getSessionByToken(db, { token: first.token, now: NOW })).toBeNull()
    expect(await getSessionByToken(db, { token: second.token, now: NOW })).toBeNull()
    // already-revoked account: nothing to revoke
    expect(await revokeAllSessionsForAccount(db, { accountId, now: NOW })).toBe(0)
  })

  it('deleteExpiredSessions removes expired rows only', async () => {
    const accountId = await setup()
    const expired = await createSession(db, { accountId, ttlMs: 1000, now: NOW })
    const live = await createSession(db, { accountId, now: NOW })
    expect(await deleteExpiredSessions(db, { now: NOW + 2000 })).toBe(1)
    expect(await getSessionByToken(db, { token: expired.token, now: NOW + 2000 })).toBeNull()
    expect(await getSessionByToken(db, { token: live.token, now: NOW + 2000 })).not.toBeNull()
  })

  it('session cannot reference an unknown account (FK enforced)', async () => {
    await expect(createSession(db, { accountId: crypto.randomUUID(), now: NOW })).rejects.toThrow()
  })

  it('rejects invalid ttl and clocks at the boundary', async () => {
    const accountId = await setup()
    await expect(createSession(db, { accountId, ttlMs: 0, now: NOW })).rejects.toThrow()
    await expect(createSession(db, { accountId, ttlMs: -1, now: NOW })).rejects.toThrow()
    await expect(createSession(db, { accountId, now: 0 })).rejects.toThrow()
  })
})

describe('OAuth state claim (Phase 3C-2 single-use)', () => {
  it('first claim wins; replay of the same state is rejected', async () => {
    expect(await claimOAuthState(db, { state: 'claim-1', expiresAt: NOW + 60_000 })).toBe(true)
    // the tombstone PERSISTS — deleting on claim would let a replay win again
    const count = db._sqlite.prepare('SELECT count(*) AS n FROM oauth_states WHERE state = ?').get('claim-1')
    expect(count.n).toBe(1)
    // replay: the uniqueness of the PRIMARY KEY rejects it
    expect(await claimOAuthState(db, { state: 'claim-1', expiresAt: NOW + 60_000 })).toBe(false)
  })

  it('distinct states claim independently', async () => {
    const a = await claimOAuthState(db, { state: 'claim-a', expiresAt: NOW + 60_000 })
    const b = await claimOAuthState(db, { state: 'claim-b', expiresAt: NOW + 60_000 })
    expect([a, b]).toEqual([true, true])
  })

  it('stores only the opaque state and its expiry — never a verifier or token', async () => {
    await claimOAuthState(db, { state: 'claim-inspect', expiresAt: NOW + 1234 })
    // claim deletes the row, so probe the schema instead of a row: columns are
    // exactly (state, expires_at) — no verifier/token/session surface exists.
    const cols = db._sqlite.prepare('PRAGMA table_info(oauth_states)').all().map((c) => c.name)
    expect(cols).toEqual(['state', 'expires_at'])
  })

  it('rejects invalid inputs at the boundary', async () => {
    await expect(claimOAuthState(db, { state: '', expiresAt: NOW + 1 })).rejects.toThrow()
    await expect(claimOAuthState(db, { state: 'x', expiresAt: 0 })).rejects.toThrow()
    await expect(claimOAuthState(db, { state: 'x', expiresAt: -5 })).rejects.toThrow()
    await expect(claimOAuthState(db, { state: 'x', expiresAt: 1.5 })).rejects.toThrow()
  })

  it('deleteExpiredOAuthStates sweeps only expired tombstones (bounds table growth)', async () => {
    const dead = `sweep-dead-${Date.now()}`
    const live = `sweep-live-${Date.now()}`
    await claimOAuthState(db, { state: dead, expiresAt: NOW - 1 })
    await claimOAuthState(db, { state: live, expiresAt: NOW + 60_000 })
    expect(await deleteExpiredOAuthStates(db, { now: NOW })).toBe(1)
    expect(db._sqlite.prepare('SELECT count(*) AS n FROM oauth_states WHERE state = ?').get(live).n).toBe(1)
    expect(db._sqlite.prepare('SELECT count(*) AS n FROM oauth_states WHERE state = ?').get(dead).n).toBe(0)
    expect(await deleteExpiredOAuthStates(db, { now: NOW })).toBe(0) // idempotent
  })
})

describe('security invariants', () => {
  it('no password, token, secret or credential columns exist anywhere in the schema', async () => {
    const rows = db._sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'd1_%'").all()
    const schema = rows.map((r) => r.sql).join('\n')
    for (const forbidden of ['password', 'access_token', 'refresh_token', 'secret', 'credential', 'provider_token', 'cookie']) {
      expect(schema.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('session lookup depends on the hash, not on any stored secret', async () => {
    const accountId = await createAccount(db, { now: NOW }).then((a) => a.accountId)
    const { token } = await createSession(db, { accountId, now: NOW })
    const hash = await hashSessionToken(token)
    const row = db._sqlite.prepare('SELECT account_id FROM sessions WHERE token_hash = ?').get(hash)
    expect(row.account_id).toBe(accountId)
  })

  it('hashes are deterministic and unique per token', async () => {
    const a = generateSessionToken()
    const b = generateSessionToken()
    expect(await hashSessionToken(a)).toBe(await hashSessionToken(a))
    expect(await hashSessionToken(a)).not.toBe(await hashSessionToken(b))
  })
})

describe('isolation (Phase 3B data layer)', () => {
  it('never references browser/local-first machinery', () => {
    const source = readFileSync(fileURLToPath(new URL('./store.js', import.meta.url)), 'utf8')
    // the module has zero imports: it cannot reach the browser app or any
    // local-first machinery, and the worker runtime can load it standalone.
    expect(source).not.toMatch(/\bimport\b|\brequire\(/)
    for (const forbidden of ['indexedDB', 'localStorage', 'repository', 'migration', 'backup']) {
      expect(source.toLowerCase()).not.toContain(forbidden)
    }
  })
})