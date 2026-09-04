// @vitest-environment node
//
// Phase 3D — authenticated API boundary (/api/me) + routing + session rotation
// (POST /api/session/refresh). Uses the same approach as auth.test.js: real
// handlers + real SQLite-backed D1 facade. Covers the /api/me authentication
// chain, the /api/* boundary conventions (routing, generic unauthenticated,
// no token/subject leakage), and the full rotation security flow (origin gate,
// auth failures, revoke-then-create, cookie issuance, failure safety).
import { describe, it, expect, vi } from 'vitest'
import worker from './index.js'
import {
  handleApiMe,
  handleApiSessionRefresh,
  handleApiSyncMutation,
  handleApiSyncObjects,
  requireApiOrigin,
} from './api.js'
import { createTestDb } from './db/d1-facade.js'
import {
  applyObjectMutation,
  getObject,
} from './db/store.js'
import {
  createSession,
  generateSessionToken,
  getSessionByToken,
  revokeSessionByToken,
  resolveAccountByProvider,
} from './db/store.js'

const NOW = 1_700_000_000_000
const APPROVED_ORIGINS = 'http://localhost:8787, https://savelinks.pages.dev'
const REFRESH_URL = 'http://localhost:8787/api/session/refresh'

function makeEnv(overrides = {}) {
  const db = createTestDb()
  // `DB` may be overridden (e.g. { DB: undefined }) to test the no-binding
  // path, so only default it when the override didn't provide a value at all.
  return {
    DB: db,
    APPROVED_ORIGINS,
    ...overrides,
    DB: 'DB' in overrides ? overrides.DB : db,
  }
}

const API_URL = 'http://localhost:8787/api/me'
const DEV_COOKIE = 'save_links_session_dev'

/** Create a real account + session; returns the account id and raw token. */
async function seedSession(env, { now = NOW, ttlMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
  const { account_id: accountId } = await resolveAccountByProvider(env.DB, {
    provider: 'github',
    providerSubject: '42',
    now,
  })
  const session = await createSession(env.DB, { accountId, ttlMs, now })
  return { accountId, token: session.token }
}

function meRequest(cookieHeader) {
  return new Request(API_URL, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined)
}

/**
 * A POST /api/session/refresh request. `origin` sets the Origin header when
 * given; `referer` sets the Referer header when given (falls back to Referer
 * when Origin is absent). `cookie` sets the session cookie. `extraHeaders`
 * allows injection of Host / X-Forwarded-* / malformed cookies etc.
 *
 * IMPORTANT: no Origin/Referer is injected by default. Tests that rely on a
 * valid origin must pass one explicitly — this is what lets the
 * Host / X-Forwarded-Host / X-Forwarded-Proto tests prove those headers alone
 * cannot authenticate the request.
 */
function refreshRequest({ origin, referer, cookie, extraHeaders = {} } = {}) {
  const headers = new Headers()
  if (origin) headers.set('Origin', origin)
  if (referer) headers.set('Referer', referer)
  if (cookie) headers.set('Cookie', cookie)
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value)
  return new Request(REFRESH_URL, { method: 'POST', headers })
}

/** Extract the fresh raw token from a refresh response's Set-Cookie header. */
function freshTokenFromResponse(res) {
  const setCookie = res.headers.get('set-cookie')
  expect(setCookie, 'expected a Set-Cookie header').toBeTruthy()
  const raw = setCookie.split(';')[0] // "name=value"
  const value = raw.slice(raw.indexOf('=') + 1)
  if (value === '') throw new Error('empty session token in Set-Cookie')
  return value
}

describe('GET /api/me — authenticated boundary', () => {
  it('authenticated session -> 200 with opaque accountId, no excessive data', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const res = await handleApiMe(meRequest(`${DEV_COOKIE}=${encodeURIComponent(token)}`), env, { now: NOW })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ authenticated: true, accountId })
    expect(accountId).not.toBe('42') // opaque D1 id, never the provider subject
  })

  it('missing cookie -> 401', async () => {
    const env = makeEnv()
    const res = await handleApiMe(meRequest(), env, { now: NOW })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('malformed cookie value -> 401', async () => {
    const env = makeEnv()
    const res = await handleApiMe(meRequest(`${DEV_COOKIE}=!!!not-a-token!!!`), env, { now: NOW })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('unknown session token -> 401', async () => {
    const env = makeEnv()
    const res = await handleApiMe(meRequest(`${DEV_COOKIE}=${generateSessionToken()}`), env, { now: NOW })
    expect(res.status).toBe(401)
  })

  it('expired session -> 401', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env, { ttlMs: 60_000 })
    const res = await handleApiMe(meRequest(`${DEV_COOKIE}=${encodeURIComponent(token)}`), env, {
      now: NOW + 61_000,
    })
    expect(res.status).toBe(401)
  })

  it('revoked session -> 401', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    await revokeSessionByToken(env.DB, { token, now: NOW })
    const res = await handleApiMe(meRequest(`${DEV_COOKIE}=${encodeURIComponent(token)}`), env, { now: NOW })
    expect(res.status).toBe(401)
  })

  it('deleted/nonexistent account -> 401 (generic, not a leak)', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    // Deleting the account CASCADEs to its sessions (0001 semantics), so the
    // session can no longer resolve and the account lookup would also fail —
    // either way /api/me must fail generically, never as authenticated.
    env.DB._sqlite.prepare('DELETE FROM users WHERE account_id = ?').run(accountId)
    const res = await handleApiMe(meRequest(`${DEV_COOKIE}=${encodeURIComponent(token)}`), env, { now: NOW })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('missing DB binding -> 503 (server error, never authenticated)', async () => {
    const env = makeEnv({ DB: undefined })
    const res = await handleApiMe(meRequest(), env, { now: NOW })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'unavailable' })
  })

  it('response never contains the raw session token or provider subject', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiMe(meRequest(`${DEV_COOKIE}=${encodeURIComponent(token)}`), env, { now: NOW })
    const body = await res.text()
    expect(body).not.toContain(token) // raw session token never echoed
    expect(body).not.toContain('github') // provider never named
    // accountId is opaque: never the GitHub numeric provider subject ('42').
    // Compare exactly, not by substring scan — a random UUID can legitimately
    // contain the two characters '42' (e.g. "...-42d2-...") and would
    // false-flag a raw-body scan.
    const json = JSON.parse(body)
    expect(json.authenticated).toBe(true)
    expect(json.accountId).not.toBe('42')
  })
})

describe('/api/* routing + method enforcement (worker/index.js)', () => {
  it('POST /api/me -> 405 with Allow: GET, ASSETS untouched', async () => {
    const db = createTestDb()
    const env = { DB: db, ASSETS: { fetch: () => { throw new Error('should not be called') } } }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await worker.fetch(new Request(API_URL, { method }), env)
      expect(res.status, method).toBe(405)
      expect(res.headers.get('allow')).toBe('GET')
    }
  })

  it('GET /api/me reaches the Worker on the assets-first boundary', async () => {
    let assetsCalled = false
    const env = { DB: createTestDb(), ASSETS: { fetch: () => { assetsCalled = true; return new Response('x') } } }
    const res = await worker.fetch(new Request(API_URL), env)
    expect(res.status).toBe(401) // no cookie -> reached handler
    expect(assetsCalled).toBe(false)
  })

  it('unknown /api/* route -> 404 (never the SPA fallback)', async () => {
    let assetsCalled = false
    const env = { DB: createTestDb(), ASSETS: { fetch: () => { assetsCalled = true; return new Response('x') } } }
    for (const path of ['/api/nope', '/api/unknown', '/api/me/extra']) {
      const res = await worker.fetch(new Request(`http://localhost:8787${path}`), env)
      expect(res.status, path).toBe(404)
      expect(assetsCalled, path).toBe(false)
    }
  })

  it('non-/api/* paths still fall through to the assets boundary', async () => {
    let assetsCalled = false
    const env = { DB: createTestDb(), ASSETS: { fetch: () => { assetsCalled = true; return new Response('ok') } } }
    const res = await worker.fetch(new Request('http://localhost:8787/some/spa/route'), env)
    expect(res.status).toBe(200)
    expect(assetsCalled).toBe(true)
  })

  it('does not weaken existing /auth/* method restrictions', async () => {
    const env = { DB: createTestDb(), ASSETS: { fetch: () => new Response('x') } }
    const postLogin = await worker.fetch(new Request('http://localhost:8787/auth/github/login', { method: 'POST' }), env)
    expect(postLogin.status).toBe(405)
    expect(postLogin.headers.get('allow')).toBe('GET')
    const getLogout = await worker.fetch(new Request('http://localhost:8787/auth/logout'), env)
    expect(getLogout.status).toBe(405)
  })
})

describe('requireApiOrigin — reusable boundary convention (state-changing POST endpoints)', () => {
  it('accepts an Origin on the approved list', () => {
    const req = new Request(API_URL, { method: 'POST', headers: { Origin: 'http://localhost:8787' } })
    expect(requireApiOrigin(req, { APPROVED_ORIGINS })).toEqual({ ok: true })
  })

  it('rejects a cross-site Origin', () => {
    const req = new Request(API_URL, { method: 'POST', headers: { Origin: 'https://evil.example' } })
    expect(requireApiOrigin(req, { APPROVED_ORIGINS })).toEqual({ status: 403 })
  })

  it('rejects a missing Origin/Referer (no identity to validate)', () => {
    const req = new Request(API_URL, { method: 'POST' })
    expect(requireApiOrigin(req, { APPROVED_ORIGINS })).toEqual({ status: 403 })
  })

  it('fails closed (503) when APPROVED_ORIGINS is unset/empty', () => {
    const req = new Request(API_URL, { method: 'POST', headers: { Origin: 'http://localhost:8787' } })
    expect(requireApiOrigin(req, { APPROVED_ORIGINS: '' })).toEqual({ status: 503 })
    expect(requireApiOrigin(req, {})).toEqual({ status: 503 })
  })

  it('accepts a matching Referer as a fallback when Origin is absent', () => {
    const req = new Request(API_URL, { method: 'POST', headers: { Referer: 'https://savelinks.pages.dev/some/page' } })
    expect(requireApiOrigin(req, { APPROVED_ORIGINS })).toEqual({ ok: true })
  })
})

describe('POST /api/session/refresh — Origin/Referer protection', () => {
  it('approved Origin succeeds', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('approved Referer fallback succeeds when Origin is absent', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ referer: 'https://savelinks.pages.dev/app', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(200)
  })

  it('cross-site Origin -> 403, nothing rotated', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'https://evil.example', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    // Session must still be valid (not revoked, not replaced).
    const session = await getSessionByToken(env.DB, { token, now: NOW })
    expect(session).not.toBeNull()
  })

  it('missing Origin + missing Referer fails closed (403, no invented browser exception)', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const headers = new Headers({ Cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` })
    const res = await handleApiSessionRefresh(new Request(REFRESH_URL, { method: 'POST', headers }), env, { now: NOW })
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('missing/empty APPROVED_ORIGINS fails closed (503, config error)', async () => {
    const env = makeEnv({ APPROVED_ORIGINS: '' })
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'unavailable' })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('Host header cannot bypass origin validation', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ extraHeaders: { Host: 'https://localhost:8787' }, cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    // No Origin/Referer was sent; the Host header must not be trusted -> 403.
    expect(res.status).toBe(403)
  })

  it('X-Forwarded-Host cannot bypass origin validation', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ extraHeaders: { 'X-Forwarded-Host': 'http://localhost:8787' }, cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(403)
  })

  it('X-Forwarded-Proto cannot bypass origin validation', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ extraHeaders: { 'X-Forwarded-Proto': 'https' }, cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(403)
  })
})

describe('POST /api/session/refresh — authentication failures', () => {
  it('missing cookie -> 401', async () => {
    const env = makeEnv()
    await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787' }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('malformed cookie -> 401', async () => {
    const env = makeEnv()
    await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=!!!bad!!!` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('unknown session -> 401, no rotation', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${generateSessionToken()}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(401)
    // The real session is untouched.
    expect(await getSessionByToken(env.DB, { token, now: NOW })).not.toBeNull()
  })

  it('expired session -> 401', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env, { ttlMs: 60_000 })
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW + 61_000 }
    )
    expect(res.status).toBe(401)
  })

  it('revoked session -> 401', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    await revokeSessionByToken(env.DB, { token, now: NOW })
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(401)
  })

  it('nonexistent account -> 401 (generic, no leak)', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    env.DB._sqlite.prepare('DELETE FROM users WHERE account_id = ?').run(accountId)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })
})

describe('POST /api/session/refresh — rotation', () => {
  it('successful request returns 200 and issues a fresh session cookie', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const fresh = freshTokenFromResponse(res)
    expect(fresh).not.toBe(token)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('save_links_session_dev=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    // The fresh token must be the ENTIRE value of the single Set-Cookie row.
    expect(setCookie.startsWith(`${DEV_COOKIE}=${fresh}`)).toBe(true)
    expect((setCookie.match(/save_links_session_dev=/g) ?? []).length).toBe(1) // exactly one replacement cookie
  })

  it('old token is revoked, new token authenticates', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    const fresh = freshTokenFromResponse(res)
    expect(await getSessionByToken(env.DB, { token, now: NOW })).toBeNull() // old revoked
    expect(await getSessionByToken(env.DB, { token: fresh, now: NOW })).not.toBeNull() // new active
  })

  it('only the token hash is persisted (raw token never stored)', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    const fresh = freshTokenFromResponse(res)
    const rows = env.DB._sqlite.prepare('SELECT token_hash FROM sessions WHERE account_id = ?').all(accountId)
    const hashes = rows.map((r) => r.token_hash)
    expect(hashes).toHaveLength(2) // old (revoked) + new (active)
    for (const hash of hashes) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex, not a raw token
      expect(hash).not.toBe(token)
      expect(hash).not.toBe(fresh)
    }
  })

  it('response never contains the raw token (old or new)', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    const body = await res.text()
    const fresh = freshTokenFromResponse(res)
    expect(body).not.toContain(token)
    expect(body).not.toContain(fresh)
  })
})

describe('POST /api/session/refresh — failure safety', () => {
  it('failed origin check does not revoke the session', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'https://evil.example', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(403)
    expect(await getSessionByToken(env.DB, { token, now: NOW })).not.toBeNull()
  })

  it('failed authentication does not rotate the session', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${generateSessionToken()}` }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await getSessionByToken(env.DB, { token, now: NOW })).not.toBeNull()
  })

  it('session-creation failure produces a server error, no success response and no replacement cookie', async () => {
    const env = makeEnv()
    const { token, accountId } = await seedSession(env)
    const store = await import('./db/store.js')
    const spy = vi.spyOn(store, 'createSession').mockRejectedValueOnce(new Error('db down'))
    try {
      const res = await handleApiSessionRefresh(
        refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
        env,
        { now: NOW }
      )
      expect(res.status).toBe(500)
      expect(res.headers.get('set-cookie')).toBeNull()
      expect(await res.json()).toEqual({ error: 'server_error' })
    } finally {
      spy.mockRestore()
    }
    // The old session was already revoked (degradation is a logged-out state).
    expect(await getSessionByToken(env.DB, { token, now: NOW })).toBeNull()
    // No replacement session was created.
    const rows = env.DB._sqlite.prepare('SELECT token_hash FROM sessions WHERE account_id = ?').all(accountId)
    expect(rows).toHaveLength(1)
  })

  it('no replacement cookie is emitted on failed authentication or failed origin validation', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const authRes = await handleApiSessionRefresh(
      refreshRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${generateSessionToken()}` }),
      env,
      { now: NOW }
    )
    expect(authRes.status).toBe(401)
    expect(authRes.headers.get('set-cookie')).toBeNull()
    const originRes = await handleApiSessionRefresh(
      refreshRequest({ origin: 'https://evil.example', cookie: `${DEV_COOKIE}=${encodeURIComponent(token)}` }),
      env,
      { now: NOW }
    )
    expect(originRes.status).toBe(403)
    expect(originRes.headers.get('set-cookie')).toBeNull()
  })
})

describe('/api/session/refresh routing + method enforcement', () => {
  it('POST /api/session/refresh reaches the Worker (handler path)', async () => {
    const env = { DB: createTestDb(), APPROVED_ORIGINS, ASSETS: { fetch: () => new Response('x') } }
    // Approved origin present so routing reaches the cookie/auth branch (401,
    // not a 403 origin rejection) — proving the route hit the Worker handler.
    const res = await worker.fetch(refreshRequest({ origin: 'http://localhost:8787' }), env)
    expect(res.status).toBe(401) // no cookie -> reached handler, unauthenticated
  })

  it('GET /api/session/refresh -> 405 with Allow: POST', async () => {
    const env = { DB: createTestDb(), APPROVED_ORIGINS, ASSETS: { fetch: () => new Response('x') } }
    const res = await worker.fetch(new Request(REFRESH_URL), env)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  it('PUT/PATCH/DELETE /api/session/refresh -> 405 with Allow: POST', async () => {
    const env = { DB: createTestDb(), APPROVED_ORIGINS, ASSETS: { fetch: () => new Response('x') } }
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await worker.fetch(new Request(REFRESH_URL, { method }), env)
      expect(res.status, method).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
    }
  })

  it('unknown /api/* route -> 404 (never the SPA fallback)', async () => {
    const env = { DB: createTestDb(), ASSETS: { fetch: () => new Response('x') } }
    for (const path of ['/api/unknown/thing', '/api/session/refresh/extra']) {
      const res = await worker.fetch(new Request(`http://localhost:8787${path}`, { method: 'POST' }), env)
      expect(res.status, path).toBe(404)
    }
  })

  it('does not weaken /auth/* method restrictions', async () => {
    const env = { DB: createTestDb(), ASSETS: { fetch: () => new Response('x') } }
    const res = await worker.fetch(new Request('http://localhost:8787/auth/github/login', { method: 'POST' }), env)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET')
  })
})

describe('POST /api/sync/mutation — cloud sync protocol', () => {
  const SYNC_URL = 'http://localhost:8787/api/sync/mutation'

  function syncRequest({ origin, cookie, body }) {
    const headers = new Headers()
    if (origin) headers.set('Origin', origin)
    if (cookie) headers.set('Cookie', cookie)
    headers.set('Content-Type', 'application/json')
    return new Request(SYNC_URL, { method: 'POST', headers, body: JSON.stringify(body) })
  }

  it('no DB binding -> 503', async () => {
    const env = makeEnv({ DB: undefined })
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=fake`, body: { mutation_id: 'm1', object_type: 'link', object_id: 'o1', operation: 'create', base_revision: 0, payload: '{}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(503)
  })

  it('missing session cookie -> 401', async () => {
    const env = makeEnv()
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', body: { mutation_id: 'm1', object_type: 'link', object_id: 'o1', operation: 'create', base_revision: 0, payload: '{}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('cross-site request -> 403', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'https://evil.com', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: 'm1', object_type: 'link', object_id: 'o1', operation: 'create', base_revision: 0, payload: '{}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  it('malformed JSON body -> 400', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const headers = new Headers()
    headers.set('Origin', 'http://localhost:8787')
    headers.set('Cookie', `${DEV_COOKIE}=${token}`)
    headers.set('Content-Type', 'application/json')
    const bad = new Request(SYNC_URL, { method: 'POST', headers, body: 'not-json' })
    const res = await handleApiSyncMutation(bad, env, { now: NOW })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'malformed_mutation' })
  })

  it('missing required fields -> 400', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: 'm1' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(400)
  })

  it('bad object_type -> 400', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: 'm1', object_type: 'note', object_id: 'o1', operation: 'create', base_revision: 0, payload: '{}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(400)
  })

  it('bad base_revision -> 400', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: 'm1', object_type: 'link', object_id: 'o1', operation: 'create', base_revision: -1, payload: '{}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(400)
  })

  it('create accepted -> 200 { accepted: true, result_revision: 1 }', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const objectId = crypto.randomUUID()
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: crypto.randomUUID(), object_type: 'link', object_id: objectId, operation: 'create', base_revision: 0, payload: '{"url":"x"}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ accepted: true, result_revision: 1 })
    // verify stored on server
    const row = await getObject(env.DB, { accountId, objectType: 'link', objectId })
    expect(row.revision).toBe(1)
    expect(row.deleted).toBe(0)
  })

  it('idempotent replay of same mutation_id -> 200 with original result', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const objectId = crypto.randomUUID()
    const mutationId = crypto.randomUUID()
    const body = { mutation_id: mutationId, object_type: 'link', object_id: objectId, operation: 'create', base_revision: 0, payload: '{}' }
    const res1 = await handleApiSyncMutation(syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body }), env, { now: NOW })
    expect(res1.status).toBe(200)
    const res2 = await handleApiSyncMutation(syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body }), env, { now: NOW })
    expect(res2.status).toBe(200)
    expect(await res2.json()).toEqual({ accepted: true, result_revision: 1 })
    // object revision unchanged (not bumped twice)
    expect((await getObject(env.DB, { accountId, objectType: 'link', objectId })).revision).toBe(1)
  })

  it('create conflict (existing object) -> 409', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const objectId = crypto.randomUUID()
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'link', objectId, operation: 'create', baseRevision: 0, payload: '{}', now: NOW })
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: crypto.randomUUID(), object_type: 'link', object_id: objectId, operation: 'create', base_revision: 0, payload: '{}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.accepted).toBe(false)
    expect(body.reason).toBe('revision_conflict')
    expect(body.current.revision).toBe(1)
  })

  it('update accepted -> 200 with incremented revision', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const objectId = crypto.randomUUID()
    const mutationId = crypto.randomUUID()
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'link', objectId, operation: 'create', baseRevision: 0, payload: '{}', now: NOW })
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: mutationId, object_type: 'link', object_id: objectId, operation: 'update', base_revision: 1, payload: '{"v":2}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(200)
    expect((await res.json()).result_revision).toBe(2)
  })

  it('stale base_revision -> 409 with current object', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const objectId = crypto.randomUUID()
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'link', objectId, operation: 'create', baseRevision: 0, payload: '{}', now: NOW })
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'link', objectId, operation: 'update', baseRevision: 1, payload: '{}', now: NOW })
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: crypto.randomUUID(), object_type: 'link', object_id: objectId, operation: 'update', base_revision: 1, payload: '{}' } }),
      env, { now: NOW }
    )
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(409)
    expect(body.reason).toBe('revision_conflict')
    expect(body.current.revision).toBe(2)
  })

  it('delete accepted -> 200; tombstone preserved on server', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const objectId = crypto.randomUUID()
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'folder', objectId, operation: 'create', baseRevision: 0, payload: '{}', now: NOW })
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: crypto.randomUUID(), object_type: 'folder', object_id: objectId, operation: 'delete', base_revision: 1, payload: '{}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(200)
    expect((await res.json()).result_revision).toBe(2)
    const row = await getObject(env.DB, { accountId, objectType: 'folder', objectId })
    expect(row.deleted).toBe(1)
    expect(row.revision).toBe(2)
  })

  it('account scoping: own mutation only targets own account', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const otherAccountId = (await resolveAccountByProvider(env.DB, { provider: 'github', providerSubject: '99', now: NOW })).account_id
    const objectId = crypto.randomUUID()
    // create in another account
    await applyObjectMutation(env.DB, { accountId: otherAccountId, mutationId: crypto.randomUUID(), objectType: 'link', objectId, operation: 'create', baseRevision: 0, payload: '{}', now: NOW })
    // authed user tries to create same objectId (different namespace) -> accepted
    const res = await handleApiSyncMutation(
      syncRequest({ origin: 'http://localhost:8787', cookie: `${DEV_COOKIE}=${token}`, body: { mutation_id: crypto.randomUUID(), object_type: 'link', object_id: objectId, operation: 'create', base_revision: 0, payload: '{}' } }),
      env, { now: NOW }
    )
    expect(res.status).toBe(200)
  })
})

describe('GET /api/sync/objects — pull/read-back', () => {
  const OBJECTS_URL = 'http://localhost:8787/api/sync/objects'

  function objectsRequest(cookieHeader) {
    return new Request(OBJECTS_URL, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined)
  }

  it('authenticated account can read its own objects (live + tombstone), no-store', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const liveId = crypto.randomUUID()
    const tombId = crypto.randomUUID()
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'link', objectId: liveId, operation: 'create', baseRevision: 0, payload: '{"title":"A"}', now: NOW })
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'folder', objectId: tombId, operation: 'create', baseRevision: 0, payload: '{"name":"F"}', now: NOW })
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'folder', objectId: tombId, operation: 'delete', baseRevision: 1, payload: '{}', now: NOW })

    const res = await handleApiSyncObjects(objectsRequest(`${DEV_COOKIE}=${encodeURIComponent(token)}`), env, { now: NOW })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    const live = body.objects.find((o) => o.object_id === liveId)
    const tomb = body.objects.find((o) => o.object_id === tombId)
    expect(live).toEqual({
      object_id: liveId,
      object_type: 'link',
      revision: 1,
      deleted: false,
      deleted_at: null,
      payload: { title: 'A' },
      created_at: NOW,
      updated_at: NOW,
    })
    expect(tomb.deleted).toBe(true)
    expect(tomb.deleted_at).toBe(NOW)
    expect(tomb.revision).toBe(2)
  })

  it('unauthenticated request is rejected with 401', async () => {
    const env = makeEnv()
    const res = await handleApiSyncObjects(objectsRequest(), env, { now: NOW })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('account A cannot read account B\'s objects', async () => {
    const env = makeEnv()
    const { accountId: a, token: tokenA } = await seedSession(env) // subject '42'
    // A distinct account (different GitHub subject).
    const { account_id: b } = await resolveAccountByProvider(env.DB, {
      provider: 'github',
      providerSubject: '99',
      now: NOW,
    })
    expect(b).not.toBe(a)
    // B owns an object; A must not see it.
    await applyObjectMutation(env.DB, { accountId: b, mutationId: crypto.randomUUID(), objectType: 'link', objectId: crypto.randomUUID(), operation: 'create', baseRevision: 0, payload: '{"secret":"B"}', now: NOW })
    const res = await handleApiSyncObjects(objectsRequest(`${DEV_COOKIE}=${encodeURIComponent(tokenA)}`), env, { now: NOW })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.objects).toEqual([])
  })

  it('tombstones are returned to the owning account', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const id = crypto.randomUUID()
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'link', objectId: id, operation: 'create', baseRevision: 0, payload: '{}', now: NOW })
    await applyObjectMutation(env.DB, { accountId, mutationId: crypto.randomUUID(), objectType: 'link', objectId: id, operation: 'delete', baseRevision: 1, payload: '{}', now: NOW })
    const res = await handleApiSyncObjects(objectsRequest(`${DEV_COOKIE}=${encodeURIComponent(token)}`), env, { now: NOW })
    const body = await res.json()
    const obj = body.objects.find((o) => o.object_id === id)
    expect(obj.deleted).toBe(true)
    expect(obj.deleted_at).toBe(NOW)
  })

  it('missing DB binding -> 503 (never authenticated, no internals leaked)', async () => {
    const env = makeEnv({ DB: undefined })
    const res = await handleApiSyncObjects(objectsRequest(), env, { now: NOW })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'unavailable' })
  })

  it('unexpected database failure -> generic 500 with no internals leaked', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const store = await import('./db/store.js')
    const spy = vi.spyOn(store, 'getObjectsForAccount').mockRejectedValueOnce(new Error('db exploded'))
    try {
      const res = await handleApiSyncObjects(objectsRequest(`${DEV_COOKIE}=${encodeURIComponent(token)}`), env, { now: NOW })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'server_error' })
    } finally {
      spy.mockRestore()
    }
  })

  it('response never contains the raw session token', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleApiSyncObjects(objectsRequest(`${DEV_COOKIE}=${encodeURIComponent(token)}`), env, { now: NOW })
    const text = await res.text()
    expect(text).not.toContain(token)
  })
})

describe('GET /api/sync/objects — routing + method enforcement (worker/index.js)', () => {
  const OBJECTS_URL = 'http://localhost:8787/api/sync/objects'

  it('POST /api/sync/objects -> 405 with Allow: GET', async () => {
    const env = { DB: createTestDb(), ASSETS: { fetch: () => { throw new Error('should not be called') } } }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await worker.fetch(new Request(OBJECTS_URL, { method }), env)
      expect(res.status, method).toBe(405)
      expect(res.headers.get('allow'), method).toBe('GET')
    }
  })

  it('GET /api/sync/objects reaches the Worker (unauthenticated -> 401, not 404/asset)', async () => {
    let assetsCalled = false
    const env = { DB: createTestDb(), ASSETS: { fetch: () => { assetsCalled = true; return new Response('x') } } }
    const res = await worker.fetch(new Request(OBJECTS_URL), env)
    expect(res.status).toBe(401) // reached the handler
    expect(assetsCalled).toBe(false)
  })
})
