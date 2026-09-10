-- Save_Links — Security Task 1: in-worker rate limiting counters.
--
-- Cloudflare-native rate limiting is not available on this deployment (no
-- `rate_limits` binding, no Durable Objects, no KV; Free plan; workers.dev
-- domains cannot use zone Rate Limiting Rules), so the limiter lives in the
-- Worker on the EXISTING D1 binding (worker/rate-limit.js).
--
-- Model: ONE live row per (scope, key), holding only the CURRENT window's
-- count. A request that finds a stale row (older window) resets it to
-- count = 1 for the new window in the SAME upsert (see
-- store.consumeRateLimit), so a key never accumulates rows and no background
-- sweep is needed. The only growth is one row per distinct key ever seen —
-- client IPs (scope 'auth') and account ids (scope 'api') — which is
-- negligible against the D1 storage budget.
--
-- Only opaque counters are stored — never account data, never credentials.
-- Kept idempotent (IF NOT EXISTS) like the other migrations.

CREATE TABLE IF NOT EXISTS rate_limits (
  scope        TEXT    NOT NULL, -- 'auth' (per client IP) | 'api' (per account)
  key          TEXT    NOT NULL, -- cf-connecting-ip value, or an account id
  window_start INTEGER NOT NULL, -- window-aligned epoch milliseconds UTC
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key)
);