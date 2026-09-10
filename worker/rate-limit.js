// Save_Links — Worker rate limiter (Security Task 1).
//
// Cloudflare-native rate limiting is not available on this deployment (no
// `rate_limits` binding, no Durable Objects, no KV; Free plan; workers.dev
// domains cannot use zone Rate Limiting Rules), so the limiter is implemented
// in the Worker on the EXISTING D1 binding: one table (migration 0004), one
// read + one conditional-upsert write per request (store.getRateLimitCount /
// store.consumeRateLimit). It is the ONLY place the limits and window math
// live — every route that wants a budget calls checkRateLimit with its scope.
//
// Scopes:
//   'auth'  per client IP   — cf-connecting-ip is SET BY CLOUDFLARE at the
//           edge (the client cannot spoof it; inbound copies of the header are
//           stripped). The worker never trusts a host-derived fallback.
//   'api'   per account id  — resolved from the authenticated session cookie,
//           so a budget is shared across all of an account's devices/tabs.
//
// Fail-open: any limiter storage/read error degrades to "allowed — no limit
// recorded". A rate limiter is protective, not authoritative, so a transient
// D1 failure must never become an auth/API outage. Every handler's fail-closed
// authorization gates (origin allowlist, session, account) run BEFORE the
// limiter. Fail-open is deliberate and documented: an attacker who can force
// limiter errors gets back to the pre-task state, never past any gate.
import { consumeRateLimit, getRateLimitCount } from './db/store.js'

export const RATE_LIMITS = {
  // Sign-in endpoints: a real flow is 1 login + 1 callback; a human retrying
  // a failed sign-in a handful of times is ~10 requests per 5 minutes.
  // 30/5min per IP bounds unauthenticated flood attempts (each = one
  // oauth_state insert + a provider redirect) at 6/min/IP.
  auth: { limit: 30, windowMs: 5 * 60 * 1000 },
  // Authenticated API: the app polls ~2x/min per tab and imports in 25-batch
  // chunks (2000 links = 80 requests in seconds). 120/min per account absorbs
  // many tabs/devices and import bursts while capping a replayed-cookie flood
  // at 2 requests/sec/account.
  api: { limit: 120, windowMs: 60 * 1000 },
}

/** Window-aligned epoch-ms start for the window containing `now`. */
export function windowStartFor(now, windowMs) {
  return Math.floor(now / windowMs) * windowMs
}

/** Client IP for /auth scope limits: edge-set by Cloudflare, spoof-proof. */
export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}

/**
 * Record + evaluate one request against the limit for the window containing
 * `now`.
 *   { allowed: true }              under the limit (counted)
 *   { allowed: false, retryAfterMs }   over the limit; ms until the window ends
 *
 * Race note (ponytail: read-then-upsert is not transactional, so concurrent
 * requests at the boundary can overshoot by a few — acceptable for a DoS
 * guard; a strict per-window ceiling would need a D1 transaction).
 * Any error fails OPEN (see header) — never a 5xx, never a false 429.
 */
export async function checkRateLimit(db, { scope, key, now }) {
  const spec = RATE_LIMITS[scope]
  if (!db || !spec) return { allowed: true }
  const windowStart = windowStartFor(now, spec.windowMs)
  try {
    const row = await getRateLimitCount(db, { scope, key })
    const count = row && row.window_start === windowStart ? row.count : 0
    if (count >= spec.limit) {
      return { allowed: false, retryAfterMs: windowStart + spec.windowMs - now }
    }
    await consumeRateLimit(db, { scope, key, windowStart })
    return { allowed: true }
  } catch {
    return { allowed: true }
  }
}

/** JSON 429 with Retry-After (RFC 7231, seconds), hardened cache headers. */
export function rateLimitedResponse(retryAfterMs) {
  return new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}