-- Save_Links — Phase 3C-2 Chunk 3: OAuth state single-use consumption tombstones.
--
-- OAuth `state` must be single-use (RFC 6749 §4.1.2: the state value SHOULD
-- be a one-time value). A signed, expiring state payload alone is STATELESS
-- and therefore replayable: verification is a pure function of (payload,
-- query state, secret, time), all of which a client holding the payload can
-- present again. True single-use requires a persistent server-side
-- consumption record, so each state gets a tombstone row here.
--
-- The claim is `INSERT OR IGNORE` on the PRIMARY KEY: the first presentation
-- of a state wins (changes = 1); every later replay hits the unique
-- constraint (changes = 0) and is rejected. The tombstone is NOT deleted on
-- claim — deleting it would make the state claimable again and defeat the
-- purpose. Rows grow one-per-login-attempt and are bounded by the expiry
-- sweep: the login route opportunistically deletes expired rows
-- (store.deleteExpiredOAuthStates), index-driven off expires_at, so steady
-- state is a rolling ~10-minute window of attempts.
--
-- Only the OPAQUE random state is stored — never the PKCE verifier (it stays
-- exclusively inside the signed HttpOnly state payload) and never any token
-- or credential. D1 enforces foreign keys by default; statements are
-- idempotent (IF NOT EXISTS) so the migration is safe to re-run.

CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT    PRIMARY KEY, -- opaque 128-bit random OAuth state (base64url)
  expires_at INTEGER NOT NULL     -- epoch milliseconds UTC, from the signed state's exp
);

-- Housekeeping: the expiry sweep and diagnostics both index off this.
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);