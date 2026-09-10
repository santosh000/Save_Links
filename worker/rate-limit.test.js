// @vitest-environment node
//
// Security Task 1 — the centralized rate limiter (worker/rate-limit.js) on the
// real SQLite D1 facade. createTestDb auto-applies migration 0004, so
// rate_limits exists in every test DB.
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from './db/d1-facade.js'
import { checkRateLimit, clientIp, rateLimitedResponse, RATE_LIMITS, windowStartFor } from './rate-limit.js'

const NOW = 1_700_000_000_000

function seed(db, { scope, key, count, windowStart }) {
  db.prepare('INSERT INTO rate_limits (scope, key, window_start, count) VALUES (?, ?, ?, ?)')
    .bind(scope, key, windowStart, count)
    .run()
}

function readRow(db, scope, key) {
  return db.prepare('SELECT window_start, count FROM rate_limits WHERE scope = ? AND key = ?')
    .bind(scope, key)
    .first()
}

describe('windowStartFor', () => {
  it('aligns to the window floor', () => {
    expect(windowStartFor(1_600_000_000_000, 60_000)).toBe(1_599_999_960_000)
    expect(windowStartFor(NOW, RATE_LIMITS.api.windowMs)).toBe(1_699_999_980_000)
    expect(windowStartFor(NOW, RATE_LIMITS.auth.windowMs)).toBe(1_699_999_800_000)
  })
})

describe('clientIp', () => {
  it('reads cf-connecting-ip (edge-set by Cloudflare, client cannot spoof)', () => {
    const req = new Request('http://x/', { headers: { 'cf-connecting-ip': '203.0.113.9' } })
    expect(clientIp(req)).toBe('203.0.113.9')
  })

  it('falls back to "unknown" (e.g. local wrangler dev) — a single dev bucket', () => {
    expect(clientIp(new Request('http://x/'))).toBe('unknown')
  })
})

describe('checkRateLimit', () => {
  let db
  beforeEach(() => {
    db = createTestDb()
  })

  it('allows requests under the limit and counts them', async () => {
    for (let i = 0; i < 29; i++) {
      expect(await checkRateLimit(db, { scope: 'auth', key: '203.0.113.5', now: NOW })).toEqual({ allowed: true })
    }
    expect(readRow(db, 'auth', '203.0.113.5').count).toBe(29)
  })

  it('rejects at the limit with retryAfterMs pointing at the window end', async () => {
    const { windowMs } = RATE_LIMITS.api
    seed(db, { scope: 'api', key: 'acct-1', count: RATE_LIMITS.api.limit, windowStart: windowStartFor(NOW, windowMs) })
    const gate = await checkRateLimit(db, { scope: 'api', key: 'acct-1', now: NOW })
    expect(gate.allowed).toBe(false)
    expect(gate.retryAfterMs).toBe(windowStartFor(NOW, windowMs) + windowMs - NOW) // 40_000
  })

  it('isolates keys — different IPs and accounts never share a budget', async () => {
    seed(db, { scope: 'auth', key: '203.0.113.5', count: RATE_LIMITS.auth.limit, windowStart: windowStartFor(NOW, RATE_LIMITS.auth.windowMs) })
    expect(await checkRateLimit(db, { scope: 'auth', key: '203.0.113.6', now: NOW })).toEqual({ allowed: true })
    expect(await checkRateLimit(db, { scope: 'api', key: 'acct-1', now: NOW })).toEqual({ allowed: true })
    expect((await checkRateLimit(db, { scope: 'auth', key: '203.0.113.5', now: NOW })).allowed).toBe(false)
  })

  it('resets when a new window starts (stale row overwritten, never accumulated)', async () => {
    const { windowMs } = RATE_LIMITS.api
    const ws = windowStartFor(NOW, windowMs)
    seed(db, { scope: 'api', key: 'acct-1', count: RATE_LIMITS.api.limit, windowStart: ws })
    expect((await checkRateLimit(db, { scope: 'api', key: 'acct-1', now: NOW })).allowed).toBe(false)
    // One minute later = a fresh window: allowed again, with the row reset.
    expect(await checkRateLimit(db, { scope: 'api', key: 'acct-1', now: NOW + windowMs })).toEqual({ allowed: true })
    const row = readRow(db, 'api', 'acct-1')
    expect(row.count).toBe(1)
    expect(row.window_start).toBe(ws + windowMs)
  })

  it('sustains the app cadence: 2 sync polls/minute for an hour', async () => {
    for (let minute = 0; minute < 60; minute++) {
      expect(await checkRateLimit(db, { scope: 'api', key: 'acct-1', now: NOW + minute * 60_000 })).toEqual({ allowed: true })
      expect(await checkRateLimit(db, { scope: 'api', key: 'acct-1', now: NOW + minute * 60_000 + 1 })).toEqual({ allowed: true })
    }
  })

  it('fails open when the DB is missing or broken — never a 429/5xx', async () => {
    expect(await checkRateLimit(undefined, { scope: 'api', key: 'acct-1', now: NOW })).toEqual({ allowed: true })
    expect(await checkRateLimit({}, { scope: 'api', key: 'acct-1', now: NOW })).toEqual({ allowed: true })
    const broken = createTestDb()
    broken._sqlite.exec('DROP TABLE rate_limits')
    expect(await checkRateLimit(broken, { scope: 'api', key: 'acct-1', now: NOW })).toEqual({ allowed: true })
  })

  it('allows when the scope is unconfigured', async () => {
    expect(await checkRateLimit(db, { scope: 'nope', key: 'x', now: NOW })).toEqual({ allowed: true })
  })
})

describe('rateLimitedResponse', () => {
  it('is a JSON 429 with Retry-After seconds and hardened headers', async () => {
    const res = rateLimitedResponse(40_000)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('40')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })
})