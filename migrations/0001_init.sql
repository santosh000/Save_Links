-- Save_Links — Phase 3B: application accounts and server-side sessions.
--
-- This is the Database-scoped migration for the `save-links-db` D1 database
-- (binding `DB` in wrangler.jsonc). Apply locally with:
--
--   npx wrangler d1 migrations apply save-links-db --local
--
-- D1 enforces foreign keys by default (equivalent to PRAGMA foreign_keys = on
-- for every transaction — https://developers.cloudflare.com/d1/sql-api/foreign-keys/).
-- Statements are idempotent (IF NOT EXISTS) so the migration is safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  account_id TEXT    PRIMARY KEY, -- canonical application account id: app-generated
                                  -- UUIDv4 (crypto.randomUUID). Opaque, stable,
                                  -- provider-neutral; the future owner of cloud data.
  created_at INTEGER NOT NULL     -- epoch milliseconds UTC
);

-- Provider identity mapping. The account id never contains provider data; a
-- provider (e.g. 'github', Phase 3C) maps to the account through this table.
-- PRIMARY KEY (provider, provider_subject) is the unique provider identity
-- lookup: one provider subject can map to exactly one account.
CREATE TABLE IF NOT EXISTS auth_identities (
  provider         TEXT    NOT NULL, -- identity provider key, e.g. 'github'
  provider_subject TEXT    NOT NULL, -- provider's stable subject identifier
  account_id       TEXT    NOT NULL REFERENCES users(account_id) ON DELETE CASCADE,
  created_at       INTEGER NOT NULL, -- epoch milliseconds UTC
  PRIMARY KEY (provider, provider_subject)
);

-- Server-side sessions. token_hash is the SHA-256 hex digest of the opaque
-- bearer token the browser eventually holds; the raw token is NEVER stored
-- here. Session validity: revoked_at IS NULL AND expires_at > now.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  account_id TEXT    NOT NULL REFERENCES users(account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, -- epoch milliseconds UTC
  expires_at INTEGER NOT NULL, -- epoch milliseconds UTC
  revoked_at INTEGER           -- epoch milliseconds UTC, NULL = active
);

-- Housekeeping: deleteExpiredSessions() scans by expiry.
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
-- Per-account session lookup / revocation.
CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);

-- DELETION SEMANTICS (account deletion feature arrives in a later phase):
-- deleting a users row CASCADEs to auth_identities and sessions — pure
-- authentication artifacts. Future cloud APPLICATION data tables (links,
-- folders, ...) must NOT use ON DELETE CASCADE: the default NO ACTION will
-- make account deletion fail until an explicit archive/delete flow exists,
-- which is the intended, non-destructive default.