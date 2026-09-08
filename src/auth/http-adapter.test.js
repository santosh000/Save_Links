import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHttpAdapter, AUTH_ME_PATH, AUTH_LOGOUT_PATH, AUTH_LOGIN_PATHS, AUTH_REFRESH_PATH } from './http-adapter.js'

// The http adapter's security contract (see http-adapter.js): identity comes
// EXCLUSIVELY from the authenticated server session (/api/me); 401 is the only
// "anonymous" answer; 503/network/invalid are infrastructure failures that must
// surface as a rejection (never pretend anonymous); no secret ever appears in
// state; logout revokes server-side and login is a top-level OAuth redirect.

function makeResponse({ status = 200, body = null } = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

let calls = []
function fetchMock(impl) {
  calls = []
  return vi.fn((...args) => { calls.push(args); return impl(...args) })
}

describe('http adapter — init (GET /api/me)', () => {
  beforeEach(() => { calls = [] })

  it('returns null (anonymous) when the server reports no session with a 401', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ status: 401 })) })
    expect(await a.init()).toBeNull()
    expect(calls[0][0]).toBe(AUTH_ME_PATH)
    expect(calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin' })
  })

  it('restores the authenticated account id from the server session only', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ body: { authenticated: true, accountId: 'acc-42' } })) })
    expect(await a.init()).toEqual({ id: 'acc-42', name: '', email: null })
  })

  it('rejects (does not fake anonymous) when the auth service is unavailable (503)', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ status: 503 })) })
    await expect(a.init()).rejects.toThrow()
  })

  it('rejects on any other non-2xx (identity cannot be verified)', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ status: 500 })) })
    await expect(a.init()).rejects.toThrow()
  })

  it('rejects on network failure rather than claiming anonymous', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => Promise.reject(new Error('no network'))) })
    await expect(a.init()).rejects.toThrow()
  })

  it('rejects when the response is not the documented /api/me JSON shape', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ body: { authenticated: true } })) })
    await expect(a.init()).rejects.toThrow()
  })

  it('never reflects the raw session into state — the user shape is only id/name/email, no secrets', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ body: { authenticated: true, accountId: 'acc-7' } })) })
    const user = await a.init()
    expect(Object.keys(user).sort()).toEqual(['email', 'id', 'name'])
    expect(JSON.stringify(user)).not.toMatch(/token|secret|session|credential|password/i)
  })
})

describe('http adapter — logout (POST /auth/logout)', () => {
  it('revokes the session server-side with a same-origin POST', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ status: 200 })) })
    await expect(a.logout()).resolves.toBeUndefined()
    expect(calls[0][0]).toBe(AUTH_LOGOUT_PATH)
    expect(calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin' })
  })

  it('rejects when revocation cannot be confirmed (non-2xx)', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ status: 500 })) })
    await expect(a.logout()).rejects.toThrow()
  })

  it('rejects on network failure while signing out', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => Promise.reject(new Error('no network'))) })
    await expect(a.logout()).rejects.toThrow()
  })
})

describe('http adapter — refresh (POST /api/session/refresh)', () => {
  it('rotates the session server-side with a same-origin POST', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ status: 200 })) })
    await expect(a.refresh()).resolves.toBeUndefined()
    expect(calls[0][0]).toBe(AUTH_REFRESH_PATH)
    expect(calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin' })
  })

  it('rejects with code SESSION_EXPIRED when the presented session is genuinely gone (401)', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ status: 401 })) })
    const err = await a.refresh().then(() => null, (e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('SESSION_EXPIRED')
  })

  it('rejects WITHOUT code SESSION_EXPIRED when the service is unavailable (503)', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => makeResponse({ status: 503 })) })
    const err = await a.refresh().then(() => null, (e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBeUndefined()
  })

  it('rejects on network failure while refreshing', async () => {
    const a = createHttpAdapter({ fetch: fetchMock(() => Promise.reject(new Error('no network'))) })
    const err = await a.refresh().then(() => null, (e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('network unavailable')
    expect(err.code).toBeUndefined()
  })
})

describe('http adapter — login (OAuth redirect)', () => {
  it('defaults to Google — a top-level assign to /auth/google/login', () => {
    let assigned = null
    const a = createHttpAdapter({
      fetch: () => Promise.reject(new Error('unused')),
      location: { assign: (url) => { assigned = url } },
    })
    a.login()
    expect(assigned).toBe(AUTH_LOGIN_PATHS.google)
  })

  it('starts GitHub OAuth on request: /auth/github/login', () => {
    let assigned = null
    const a = createHttpAdapter({
      fetch: () => Promise.reject(new Error('unused')),
      location: { assign: (url) => { assigned = url } },
    })
    a.login('github')
    expect(assigned).toBe(AUTH_LOGIN_PATHS.github)
  })

  it('refuses an unknown provider instead of assigning anywhere', () => {
    let assigned = null
    const a = createHttpAdapter({
      fetch: () => Promise.reject(new Error('unused')),
      location: { assign: (url) => { assigned = url } },
    })
    expect(() => a.login('email')).toThrow()
    expect(assigned).toBeNull()
  })

  it('returns a never-settling promise — an OAuth login does not complete in-page', async () => {
    let assigned = null
    const a = createHttpAdapter({
      fetch: () => Promise.reject(new Error('unused')),
      location: { assign: (url) => { assigned = url } },
    })
    const p = a.login()
    expect(assigned).toBe(AUTH_LOGIN_PATHS.google)
    // The identity is restored by init() after the callback, not by login().
    const timed = await Promise.race([p.then(() => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 10))])
    expect(timed).toBe('pending')
  })
})
