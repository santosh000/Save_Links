-- Save_Links - Phase 4 Chunk 2: cloud sync protocol foundation.
--
-- Server-authoritative object storage + per-mutation idempotency ledger.
--
-- DESIGN (all from Chunk 2 spec):
--   - sync_objects is the single object space for links AND folders, scoped by
--     OBJECT_TYPE. The server owns the authoritative revision. Every accepted
--     mutation increments `revision` by exactly one.
--   - `deleted`/`deleted_at` is a tombstone, NOT a hard delete: a delete is a
--     server-authoritative mutation that bumps revision and marks the row
--     tombstoned, so a retry/other-device can still observe the authoritative
--     end-state during the 30-day retention window. PurgeExpiredTombstones()
--     reclaims rows past retention.
--   - sync_mutations is the idempotency ledger, PK (account_id, mutation_id).
--     A mutation is claimed with INSERT OR IGNORE atomically with its object
--     write inside ONE db.batch() transaction, so a retry of the same
--     mutation_id can never apply twice and always returns the original
--     result_revision.
--   - Account scoping: every object row and every ledger row is keyed by
--     account_id, which comes EXCLUSIVELY from the authenticated server
--     session (never the HTTP body). DELETE ... ON DELETE CASCADE from users
--     is intentionally NOT used here (per 0001's deletion-semantics note):
--     account deletion must fail until an explicit archive flow exists.
--
-- Statements are idempotent (IF NOT EXISTS) so the migration is safe to
-- re-run, matching 0001/0002.

CREATE TABLE IF NOT EXISTS sync_objects (
  account_id  TEXT    NOT NULL REFERENCES users(account_id),
  object_id   TEXT    NOT NULL,
  object_type TEXT    NOT NULL,                -- 'link' | 'folder'
  revision    INTEGER NOT NULL,                -- server-authoritative
  deleted     INTEGER NOT NULL DEFAULT 0,      -- 0 = live, 1 = tombstone
  deleted_at  INTEGER,                         -- epoch ms UTC, NULL when live
  payload     TEXT    NOT NULL,                -- JSON body, opaque to the store
  created_at  INTEGER NOT NULL,                -- epoch ms UTC, server-side
  updated_at  INTEGER NOT NULL,                -- epoch ms UTC, server-side
  PRIMARY KEY (account_id, object_id)
);

CREATE TABLE IF NOT EXISTS sync_mutations (
  account_id      TEXT    NOT NULL REFERENCES users(account_id),
  mutation_id     TEXT    NOT NULL,
  object_id       TEXT    NOT NULL,
  object_type     TEXT    NOT NULL,            -- 'link' | 'folder'
  operation       TEXT    NOT NULL,            -- 'create' | 'update' | 'delete'
  base_revision   INTEGER NOT NULL,
  status          TEXT    NOT NULL,            -- 'applied'
  result_revision INTEGER NOT NULL,            -- authoritative revision after apply
  applied_at      INTEGER NOT NULL,            -- epoch ms UTC, server-side
  PRIMARY KEY (account_id, mutation_id)
);

-- Per-account authoritative revision lookup (future pull/snapshot).
CREATE INDEX IF NOT EXISTS idx_sync_objects_account_rev ON sync_objects(account_id, object_type, revision);
-- 30-day tombstone sweep driven off deleted_at.
CREATE INDEX IF NOT EXISTS idx_sync_objects_purge ON sync_objects(account_id, deleted_at);
-- Replay lookups by mutation id within an account.
CREATE INDEX IF NOT EXISTS idx_sync_mutations_account ON sync_mutations(account_id);
