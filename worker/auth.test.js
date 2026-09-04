// @vitest-environment node
//
// Phase 3C-1 — OAuth route handlers (worker/auth.js) end-to-end with a mocked
// GitHub HTTP boundary and the REAL SQLite-backed D1 facade. Covers the happy
// path through every security-negative branch: no secret/token/code ever
// appearing in a response, no raw token ever entering D1, no session cookie
// on any failure.
import { describe, it, expect, vi } from 'vitest'
import { handleOAuthLogin, handleOAuthCallback, handleAuthMe, handleAuthLogout } from './auth.js'
import { createStateCookieValue, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS, pkceCodeChallenge } from './oauth/state.js'
import { createTestDb } from './db/d1-facade.js'
import { createSession, generateSessionToken, getSessionByToken, revokeSessionByToken, resolveAccountByProvider } from './db/store.js'

const SECRETS = { GITHUB_CLIENT_ID: 'Iv1.test-client', GITHUB_CLIENT_SECRET: 'test-client-secret', STATE_HMAC_SECRET: 'test-state-hmac' }
const NOW = 1_700_000_000_000
// mirrors wrangler.jsonc vars: the allowlist the tests' plain-http dev origin
// and https preview origin both appear on
const APPROVED_ORIGINS = 'http://localhost:8787, https://savelinks.pages.dev'

function makeEnv(overrides = {}) {
  return {
    ...SECRETS,
    DB: createTestDb(),
    APPROVED_ORIGINS,
    ...overrides,
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockGithub({ token = 'gho_test-token', identity = { id: 42, login: 'octo' }, tokenError = null, identityStatus = 200 } = {}) {
  return vi.fn(async (url) => {
    if (String(url).includes('/login/oauth/access_token')) {
      return tokenError ? jsonResponse({ error: tokenError }) : jsonResponse({ access_token: token })
    }
    if (String(url).includes('api.github.com/user')) {
      return identityStatus === 200 ? jsonResponse(identity, 200) : jsonResponse({ message: 'nope' }, identityStatus)
    }
    throw new Error(`unexpected URL: ${url}`)
  })
}

const LOGIN_URL = 'http://localhost:8787/auth/github/login'
const CALLBACK_URL = 'http://localhost:8787/auth/github/callback'

function setCookieValue(res, name) {
  const header = res.headers.get('set-cookie')
  expect(header, `expected a Set-Cookie for ${name}`).toBeTruthy()
  const eq = header.indexOf('=')
  expect(header.slice(0, eq)).toBe(name)
  return decodeURIComponent(header.slice(eq + 1, header.indexOf(';')))
}

describe('GET /auth/github/login', () => {
  it('redirects to GitHub authorize with state + S256 PKCE and no scope', async () => {
    const res = await handleOAuthLogin(new Request(LOGIN_URL), makeEnv(), { now: NOW })
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location'))
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe(SECRETS.GITHUB_CLIENT_ID)
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/github/callback')
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.has('scope')).toBe(false)
  })

  it('sets the oauth_state cookie HttpOnly/SameSite=Lax/Path=/ and 10-minute lifetime on http', async () => {
    const res = await handleOAuthLogin(new Request(LOGIN_URL), makeEnv(), { now: NOW })
    const header = res.headers.get('set-cookie')
    expect(header).toContain(`${OAUTH_STATE_COOKIE}=`)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
    expect(header).toContain(`Max-Age=${OAUTH_STATE_TTL_MS / 1000}`)
    expect(header).not.toContain('Secure') // plain-http local dev
  })

  it('adds Secure on https', async () => {
    const res = await handleOAuthLogin(new Request('https://savelinks.pages.dev/auth/github/login'), makeEnv(), { now: NOW })
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('503s safely when any secret is missing, leaking nothing', async () => {
    for (const env of [
      makeEnv({ GITHUB_CLIENT_SECRET: undefined }),
      makeEnv({ STATE_HMAC_SECRET: undefined }),
      makeEnv({ GITHUB_CLIENT_ID: '' }),
      {},
    ]) {
      const res = await handleOAuthLogin(new Request(LOGIN_URL), env, { now: NOW })
      expect(res.status).toBe(503)
      const body = await res.text()
      expect(body).not.toContain('Iv1.test-client')
      expect(body).not.toContain('test-client-secret')
      expect(body).not.toContain('test-state-hmac')
    }
  })
})

async function happyCallbackRequest(cookieValue, { state, code = 'one-time-code' } = {}) {
  const base = new URL(CALLBACK_URL)
  base.searchParams.set('state', state)
  base.searchParams.set('code', code)
  return new Request(base, { headers: { cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(cookieValue)}` } })
}

describe('GET /auth/github/callback', () => {
  it('creates the account + hashed session and hands the browser the bearer cookie once', async () => {
    const env = makeEnv()
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const fetchImpl = mockGithub({})

    const res = await handleOAuthCallback(
      await happyCallbackRequest(created.value, { state: created.state }),
      env,
      { now: NOW, fetchImpl }
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:8787/')
    const sessionCookieName = 'save_links_session_dev' // plain-http dev fallback
    const sessionHeader = res.headers.get('set-cookie')
    expect(sessionHeader).toContain(`${sessionCookieName}=`)
    expect(sessionHeader).toContain('HttpOnly')
    expect(sessionHeader).toContain('SameSite=Lax')
    expect(sessionHeader).toContain('Max-Age=2592000') // 30 days (DEFAULT_SESSION_TTL_MS)
    expect(sessionHeader).not.toContain('Secure') // plain-http dev fallback, not __Host-

    const sqlite = env.DB._sqlite
    expect(sqlite.prepare('SELECT count(*) AS n FROM users').get().n).toBe(1)
    expect(sqlite.prepare('SELECT count(*) AS n FROM auth_identities').get().n).toBe(1)
    const identity = sqlite.prepare('SELECT * FROM auth_identities').get()
    expect(identity.provider).toBe('github')
    expect(identity.provider_subject).toBe('42') // GitHub numeric id as String
    const sessionRow = sqlite.prepare('SELECT * FROM sessions').get()
    expect(sessionRow.account_id).toBe(identity.account_id)
    // Session store holds only the SHA-256 hash — the raw bearer token never
    // touches D1.
    expect(sessionRow.token_hash).toMatch(/^[0-9a-f]{64}$/)
    const rawSessionCookie = setCookieValue(res, sessionCookieName)
    expect(sessionRow.token_hash).not.toContain(rawSessionCookie)

    // response (body is empty redirect) and location carry nothing sensitive
    expect(await res.text()).toBe('')
    expect(res.headers.get('location')).not.toContain(rawSessionCookie)
    expect(res.headers.get('location')).not.toContain('gho_test-token')
  })

  it('forwards the PKCE code_verifier recovered from the oauth_state cookie to the GitHub exchange, matching the authorization challenge', async () => {
    const env = makeEnv()

    // 1. Login: capture the authorize URL's code_challenge and the oauth_state cookie.
    const login = await handleOAuthLogin(new Request(LOGIN_URL), env, { now: NOW })
    expect(login.status).toBe(302)
    const authorizeUrl = new URL(login.headers.get('location'))
    const codeChallenge = authorizeUrl.searchParams.get('code_challenge')
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')
    const loginCookies = login.headers.getSetCookie()
    const stateCookie = loginCookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
    expect(stateCookie).toBeTruthy()
    const stateValue = decodeURIComponent(stateCookie.slice(`${OAUTH_STATE_COOKIE}=`.length, stateCookie.indexOf(';')))
    const state = authorizeUrl.searchParams.get('state')

    // 2. Callback: capture the token-exchange POST body.
    const captured = []
    const fetchImpl = vi.fn(async (url, opts = {}) => {
      if (String(url).includes('/login/oauth/access_token')) {
        captured.push(new URLSearchParams(opts.body))
        return jsonResponse({ access_token: 'gho_test-token' })
      }
      if (String(url).includes('api.github.com/user')) {
        return jsonResponse({ id: 42, login: 'octo' })
      }
      throw new Error(`unexpected URL: ${url}`)
    })

    const base = new URL(CALLBACK_URL)
    base.searchParams.set('state', state)
    base.searchParams.set('code', 'one-time-code')
    const callbackReq = new Request(base, {
      headers: { cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(stateValue)}` },
    })
    const cb = await handleOAuthCallback(callbackReq, env, { now: NOW, fetchImpl })
    expect(cb.status).toBe(302)

    // 3. The recovered verifier must reach GitHub AND match the authorization challenge.
    const exchangeBody = captured[0]
    const codeVerifier = exchangeBody.get('code_verifier')
    expect(typeof codeVerifier).toBe('string')
    expect(codeVerifier.length).toBeGreaterThan(0)
    await expect(pkceCodeChallenge(codeVerifier)).resolves.toBe(codeChallenge)
  })

  it('second sign-in with the same GitHub id resolves to the SAME account', async () => {
    const env = makeEnv()
    const fetchImpl = mockGithub({})
    for (let i = 0; i < 2; i++) {
      const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW + i })
      const res = await handleOAuthCallback(
        await happyCallbackRequest(created.value, { state: created.state }),
        env,
        { now: NOW + i, fetchImpl }
      )
      expect(res.status).toBe(302)
    }
    const sqlite = env.DB._sqlite
    expect(sqlite.prepare('SELECT count(*) AS n FROM users').get().n).toBe(1)
    expect(sqlite.prepare('SELECT count(*) AS n FROM auth_identities').get().n).toBe(1)
    expect(sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(2) // two browser sessions, one account
  })

  it('sets the production __Host- session cookie (Secure) on https, without a Domain attribute', async () => {
    const env = makeEnv()
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const base = new URL('https://savelinks.pages.dev/auth/github/callback')
    base.searchParams.set('state', created.state)
    base.searchParams.set('code', 'c')
    const req = new Request(base, { headers: { cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(created.value)}` } })
    const res = await handleOAuthCallback(req, env, { now: NOW, fetchImpl: mockGithub({}) })
    const header = res.headers.get('set-cookie')
    expect(header).toContain('__Host-save_links_session=')
    expect(header).toContain('Secure')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
    expect(header.toLowerCase()).not.toContain('domain=') // host-only -> __Host- valid
  })

  it('revokes a pre-existing session on successful auth (rotation), never reusing it', async () => {
    const env = makeEnv()
    const fetchImpl = mockGithub({})
    // Realistic re-login: the user's account for GitHub id 42 already exists
    // and the browser holds a session for it BEFORE this authentication.
    const { account_id: accountId } = await resolveAccountByProvider(env.DB, {
      provider: 'github',
      providerSubject: '42',
      now: NOW,
    })
    const previous = await createSession(env.DB, { accountId, now: NOW })
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })

    const base = new URL(CALLBACK_URL)
    base.searchParams.set('state', created.state)
    base.searchParams.set('code', 'c')
    const req = new Request(base, {
      headers: {
        cookie:
          `${OAUTH_STATE_COOKIE}=${encodeURIComponent(created.value)}; ` +
          `save_links_session_dev=${encodeURIComponent(previous.token)}`, // dev name in this plain-http test
      },
    })
    const res = await handleOAuthCallback(req, env, { now: NOW, fetchImpl })

    expect(res.status).toBe(302)
    // A NEW session was issued (different raw token than the pre-auth one)...
    const rawCookie = setCookieValue(res, 'save_links_session_dev')
    expect(rawCookie).not.toBe(previous.token)

    const sqlite = env.DB._sqlite
    // ...and the pre-existing session is now revoked in D1.
    const prevRow = sqlite.prepare('SELECT revoked_at FROM sessions WHERE token_hash = ?').get(previous.tokenHash)
    expect(prevRow.revoked_at).not.toBeNull()
    // One account, two sessions: the revoked pre-auth one + the fresh authenticated one.
    expect(sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(2)
    expect(sqlite.prepare('SELECT count(*) AS n FROM users').get().n).toBe(1)
  })

  it('rejects missing/mismatched/expired state and never issues a session', async () => {
    const env = makeEnv()
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const cases = [
      { label: 'no cookie', req: new Request(CALLBACK_URL) },
      { label: 'wrong state param', req: await happyCallbackRequest(created.value, { state: 'not-the-state' }) },
      { label: 'missing state param', req: new Request(CALLBACK_URL + '?code=c', { headers: { cookie: `${OAUTH_STATE_COOKIE}=${created.value}` } }) },
      {
        label: 'expired cookie',
        req: await happyCallbackRequest(created.value, { state: created.state, code: 'c' }),
        now: NOW + OAUTH_STATE_TTL_MS,
      },
      { label: 'tampered cookie', req: await happyCallbackRequest('AAAA.AAAA', { state: 'x' }) },
    ]
    for (const c of cases) {
      const res = await handleOAuthCallback(c.req, env, { now: c.now ?? NOW, fetchImpl: mockGithub({}) })
      expect(res.status, c.label).toBe(400)
      expect(res.headers.get('set-cookie'), c.label).toBeNull()
    }
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(0)
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM users').get().n).toBe(0)
  })

  it('rejects provider-reported error and missing code without touching the store', async () => {
    const env = makeEnv()
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const withError = new URL(CALLBACK_URL)
    withError.searchParams.set('state', created.state)
    withError.searchParams.set('error', 'access_denied')
    const resError = await handleOAuthCallback(
      new Request(withError, { headers: { cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(created.value)}` } }),
      env,
      { now: NOW, fetchImpl: mockGithub({}) }
    )
    expect(resError.status).toBe(400)
    const noCode = new URL(CALLBACK_URL)
    noCode.searchParams.set('state', created.state)
    const resNoCode = await handleOAuthCallback(
      new Request(noCode, { headers: { cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(created.value)}` } }),
      env,
      { now: NOW, fetchImpl: mockGithub({}) }
    )
    expect(resNoCode.status).toBe(400)
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(0)
  })

  it('surfaces GitHub exchange/identity failures as 502 with a safe generic message', async () => {
    for (const case_ of [
      { label: 'token rejected', fetchImpl: mockGithub({ tokenError: 'bad_verification_code' }) },
      { label: 'identity failed', fetchImpl: mockGithub({ identityStatus: 401 }) },
    ]) {
      const env = makeEnv()
      const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
      const res = await handleOAuthCallback(
        await happyCallbackRequest(created.value, { state: created.state }),
        env,
        { now: NOW, fetchImpl: case_.fetchImpl }
      )
      expect(res.status, case_.label).toBe(502)
      const body = await res.text()
      expect(body).not.toContain('bad_verification_code')
      expect(body).not.toContain('gho_test-token')
      expect(body).not.toContain(SECRETS.GITHUB_CLIENT_SECRET)
      // state was ACCEPTED and consumed -> its cookie is cleared...
      const cookies = res.headers.getSetCookie()
      expect(cookies.some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`) && c.includes('Max-Age=0')), case_.label).toBe(true)
      // ...but no session cookie is ever issued on failure
      expect(cookies.some((c) => c.includes('save_links_session_dev=') && !c.includes('Max-Age=0')), case_.label).toBe(false)
      expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(0)
    }
  })

  it('503s when the account store is absent', async () => {
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const env = makeEnv({ DB: undefined })
    const res = await handleOAuthCallback(
      await happyCallbackRequest(created.value, { state: created.state }),
      env,
      { now: NOW, fetchImpl: mockGithub({}) }
    )
    expect(res.status).toBe(503)
  })

  it('every response carries no-store + hardening headers; errors never leak inputs', async () => {
    const env = makeEnv()
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const res = await handleOAuthCallback(
      await happyCallbackRequest(created.value, { state: created.state, code: 'the-one-time-code' }),
      env,
      { now: NOW, fetchImpl: mockGithub({ tokenError: 'bad_verification_code' }) }
    )
    expect(res.status).toBe(502)
    const headers = res.headers
    expect(headers.get('cache-control')).toBe('no-store')
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('referrer-policy')).toBe('no-referrer')
    const body = await res.text()
    expect(body).not.toContain('the-one-time-code')
    expect(body).not.toContain('bad_verification_code')
    expect(body).not.toContain('Iv1.test-client')
  })
})

// ---- GET /auth/me -----------------------------------------------------------

const ME_URL = 'http://localhost:8787/auth/me'
const HOST_COOKIE = '__Host-save_links_session'

/** Create a real account + session; returns the account id and raw token. */
async function seedSession(env, { now = NOW, ttlMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
  const { account_id: accountId } = await resolveAccountByProvider(env.DB, {
    provider: 'github',
    providerSubject: '42',
    now,
  })
  const session = await createSession(env.DB, { accountId, ttlMs, now })
  return { accountId, token: session.token, tokenHash: session.tokenHash }
}

function meRequest(cookieHeader) {
  return new Request(ME_URL, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined)
}

describe('GET /auth/me', () => {
  it('401 with no-store JSON when no session cookie is present', async () => {
    const res = await handleAuthMe(meRequest(), makeEnv(), { now: NOW })
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('401 for a malformed cookie value, without touching D1 rows', async () => {
    const env = makeEnv()
    const res = await handleAuthMe(meRequest(`save_links_session_dev=!!!not-a-token!!!`), env, { now: NOW })
    expect(res.status).toBe(401)
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(0)
  })

  it('401 for an unknown session token', async () => {
    const env = makeEnv()
    const res = await handleAuthMe(meRequest(`save_links_session_dev=${generateSessionToken()}`), env, { now: NOW })
    expect(res.status).toBe(401)
  })

  it('401 for an expired session', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env, { ttlMs: 60_000 })
    const res = await handleAuthMe(meRequest(`save_links_session_dev=${encodeURIComponent(token)}`), env, {
      now: NOW + 61_000,
    })
    expect(res.status).toBe(401)
  })

  it('401 for a revoked session', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    await revokeSessionByToken(env.DB, { token, now: NOW })
    const res = await handleAuthMe(meRequest(`save_links_session_dev=${encodeURIComponent(token)}`), env, { now: NOW })
    expect(res.status).toBe(401)
  })

  it('200 with the AuthUser shape: id = D1 account_id, name/email at the schema ceiling', async () => {
    const env = makeEnv()
    const { accountId, token } = await seedSession(env)
    const res = await handleAuthMe(meRequest(`save_links_session_dev=${encodeURIComponent(token)}`), env, { now: NOW })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ id: accountId, name: '', email: null })
    // never GitHub id / login / email source
    expect(accountId).not.toBe('42')
  })

  it('no raw token or secret ever appears in the response body', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleAuthMe(meRequest(`save_links_session_dev=${encodeURIComponent(token)}`), env, { now: NOW })
    const body = await res.text()
    expect(body).not.toContain(token)
    expect(body).not.toContain(SECRETS.GITHUB_CLIENT_SECRET)
    expect(body).not.toContain(SECRETS.STATE_HMAC_SECRET)
  })

  it('reads the production __Host- cookie on https', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const req = new Request('https://savelinks.pages.dev/auth/me', {
      headers: { cookie: `${HOST_COOKIE}=${encodeURIComponent(token)}` },
    })
    const res = await handleAuthMe(req, env, { now: NOW })
    expect(res.status).toBe(200)
  })

  it('503 (infrastructure, not auth state) when the DB binding is absent', async () => {
    const res = await handleAuthMe(meRequest(), makeEnv({ DB: undefined }), { now: NOW })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'unavailable' })
  })
})

// ---- POST /auth/logout --------------------------------------------------------

const LOGOUT_URL = 'http://localhost:8787/auth/logout'

describe('POST /auth/logout', () => {
  it('valid session: revokes it in D1 and clears the dev session cookie (http)', async () => {
    const env = makeEnv()
    const { token, tokenHash } = await seedSession(env)
    const req = new Request(LOGOUT_URL, {
      method: 'POST',
      headers: { cookie: `save_links_session_dev=${encodeURIComponent(token)}` },
    })
    const res = await handleAuthLogout(req, env, { now: NOW })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('cache-control')).toBe('no-store')

    // D1: the session row is actually revoked.
    const row = env.DB._sqlite.prepare('SELECT revoked_at FROM sessions WHERE token_hash = ?').get(tokenHash)
    expect(row.revoked_at).not.toBeNull()

    // Cookie clearing: dev deletion without Secure (matches the original dev
    // cookie), host deletion with Secure (ignored on plain http, harmless).
    const setCookies = res.headers.getSetCookie()
    const dev = setCookies.find((c) => c.startsWith('save_links_session_dev='))
    const host = setCookies.find((c) => c.startsWith(`${HOST_COOKIE}=`))
    for (const c of [dev, host]) {
      expect(c).toBeTruthy()
      expect(c).toContain('Max-Age=0')
      expect(c).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
      expect(c).toContain('Path=/')
      expect(c.toLowerCase()).not.toContain('domain=')
    }
    expect(dev).not.toContain('Secure')
    expect(host).toContain('Secure')
  })

  it('a previously captured session cookie can no longer authenticate after logout', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const res = await handleAuthLogout(
      new Request(LOGOUT_URL, {
        method: 'POST',
        headers: { cookie: `save_links_session_dev=${encodeURIComponent(token)}` },
      }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(200)

    expect(await getSessionByToken(env.DB, { token, now: NOW })).toBeNull()
    const me = await handleAuthMe(meRequest(`save_links_session_dev=${encodeURIComponent(token)}`), env, { now: NOW })
    expect(me.status).toBe(401)
  })

  it('deletes the __Host- production cookie with a Secure, no-Domain deletion cookie on https', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const req = new Request('https://savelinks.pages.dev/auth/logout', {
      method: 'POST',
      headers: { cookie: `${HOST_COOKIE}=${encodeURIComponent(token)}` },
    })
    const res = await handleAuthLogout(req, env, { now: NOW })
    expect(res.status).toBe(200)

    const setCookies = res.headers.getSetCookie()
    const host = setCookies.find((c) => c.startsWith(`${HOST_COOKIE}=`))
    expect(host).toContain('Secure')
    expect(host).toContain('Path=/')
    expect(host).toContain('Max-Age=0')
    expect(host.toLowerCase()).not.toContain('domain=')
  })

  it('already-revoked session: success, cookie still cleared', async () => {
    const env = makeEnv()
    const { token, tokenHash } = await seedSession(env)
    await revokeSessionByToken(env.DB, { token, now: NOW })
    const res = await handleAuthLogout(
      new Request(LOGOUT_URL, {
        method: 'POST',
        headers: { cookie: `save_links_session_dev=${encodeURIComponent(token)}` },
      }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toBeTruthy()
    const row = env.DB._sqlite.prepare('SELECT revoked_at FROM sessions WHERE token_hash = ?').get(tokenHash)
    expect(row.revoked_at).not.toBeNull()
  })

  it('expired session: success, cookie cleared', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env, { ttlMs: 60_000 })
    const res = await handleAuthLogout(
      new Request(LOGOUT_URL, {
        method: 'POST',
        headers: { cookie: `save_links_session_dev=${encodeURIComponent(token)}` },
      }),
      env,
      { now: NOW + 61_000 }
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeTruthy()
  })

  it('missing cookie: success with NO deletion Set-Cookie (closes logout CSRF) and no D1 writes', async () => {
    const env = makeEnv()
    const res = await handleAuthLogout(new Request(LOGOUT_URL, { method: 'POST' }), env, { now: NOW })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(0)
  })

  it('malformed cookie: success, no crash, nothing leaked', async () => {
    const env = makeEnv()
    const res = await handleAuthLogout(
      new Request(LOGOUT_URL, {
        method: 'POST',
        headers: { cookie: 'save_links_session_dev=%%%garbage%%%' },
      }),
      env,
      { now: NOW }
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe('{"ok":true}')
    expect(body).not.toContain('%%%garbage%%%')
  })

  it('never returns the raw token and carries no-store', async () => {
    const env = makeEnv()
    const { token } = await seedSession(env)
    const req = new Request(LOGOUT_URL, {
      method: 'POST',
      headers: { cookie: `save_links_session_dev=${encodeURIComponent(token)}` },
    })
    const res = await handleAuthLogout(req, env, { now: NOW })
    const body = await res.text()
    expect(body).toBe('{"ok":true}')
    expect(body).not.toContain(token)
    expect(body).not.toContain(SECRETS.GITHUB_CLIENT_SECRET)
  })
})

// ---- Phase 3C-2 Chunk 3: single-use OAuth state + redirect-origin allowlist ---

const EVIL_URL = 'https://evil.example'

describe('redirect-origin allowlist (Phase 3C-2)', () => {
  it('login 503s (fails closed, leaks nothing) when APPROVED_ORIGINS is unset or empty', async () => {
    for (const overrides of [{ APPROVED_ORIGINS: undefined }, { APPROVED_ORIGINS: '' }]) {
      const res = await handleOAuthLogin(new Request(LOGIN_URL), makeEnv(overrides), { now: NOW })
      expect(res.status).toBe(503)
      const body = await res.text()
      expect(body).not.toContain('localhost:8787')
      expect(body).not.toContain(SECRETS.GITHUB_CLIENT_ID)
    }
  })

  it('login 400s for an unapproved request origin: no redirect, no state cookie, no secrets', async () => {
    const res = await handleOAuthLogin(new Request(`${EVIL_URL}/auth/github/login`), makeEnv(), { now: NOW })
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('set-cookie')).toBeNull()
    const body = await res.text()
    expect(body).not.toContain('evil.example')
    expect(body).not.toContain(SECRETS.GITHUB_CLIENT_ID)
  })

  it('callback 503s when APPROVED_ORIGINS is unset', async () => {
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const res = await handleOAuthCallback(
      await happyCallbackRequest(created.value, { state: created.state }),
      makeEnv({ APPROVED_ORIGINS: undefined }),
      { now: NOW, fetchImpl: mockGithub({}) }
    )
    expect(res.status).toBe(503)
  })

  it('callback 400s for an unapproved callback origin before anything runs', async () => {
    const env = makeEnv()
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const fetchImpl = mockGithub({})
    const base = new URL(`${EVIL_URL}/auth/github/callback`)
    base.searchParams.set('state', created.state)
    base.searchParams.set('code', 'c')
    const res = await handleOAuthCallback(
      new Request(base, { headers: { cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(created.value)}` } }),
      env,
      { now: NOW, fetchImpl }
    )
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled() // no exchange, no identity call
    // nothing touched the store, not even a claim
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM users').get().n).toBe(0)
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM oauth_states').get().n).toBe(0)
  })

  it('ignores X-Forwarded-Host / X-Forwarded-Proto: origin derives only from the allowlist', async () => {
    const res = await handleOAuthLogin(
      new Request(LOGIN_URL, {
        headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' },
      }),
      makeEnv(),
      { now: NOW }
    )
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location'))
    // redirect_uri must be the APPROVED origin + fixed path — never the forged headers
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/github/callback')
  })
})

describe('single-use OAuth state (Phase 3C-2)', () => {
  it('a state replay after a SUCCESSFUL sign-in is rejected without any fetch or new session', async () => {
    const env = makeEnv()
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const firstFetch = mockGithub({})
    const first = await handleOAuthCallback(
      await happyCallbackRequest(created.value, { state: created.state }),
      env,
      { now: NOW, fetchImpl: firstFetch }
    )
    expect(first.status).toBe(302)
    expect(firstFetch).toHaveBeenCalledTimes(2) // token exchange + identity call

    const replayFetch = mockGithub({})
    const replay = await handleOAuthCallback(
      await happyCallbackRequest(created.value, { state: created.state }),
      env,
      { now: NOW, fetchImpl: replayFetch }
    )
    expect(replay.status).toBe(400)
    expect(replayFetch).not.toHaveBeenCalled() // claim rejects BEFORE the exchange
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(1) // only the first sign-in's
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM oauth_states').get().n).toBe(1) // the persistent tombstone
  })

  it('a state replay after a FAILED-but-accepted callback is rejected the same way', async () => {
    const env = makeEnv()
    const created = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    // First presentation: provider-reported failure (user clicked Cancel).
    // The state was validated and consumed, so the flow is spent.
    const errorUrl = new URL(CALLBACK_URL)
    errorUrl.searchParams.set('state', created.state)
    errorUrl.searchParams.set('error', 'access_denied')
    const first = await handleOAuthCallback(
      new Request(errorUrl, { headers: { cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(created.value)}` } }),
      env,
      { now: NOW, fetchImpl: mockGithub({}) }
    )
    expect(first.status).toBe(400)

    // Replay with a perfectly valid code: the consumed state must block it.
    const replayFetch = mockGithub({})
    const replay = await handleOAuthCallback(
      await happyCallbackRequest(created.value, { state: created.state }),
      env,
      { now: NOW, fetchImpl: replayFetch }
    )
    expect(replay.status).toBe(400)
    expect(replayFetch).not.toHaveBeenCalled()
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(0)
    expect(env.DB._sqlite.prepare('SELECT count(*) AS n FROM users').get().n).toBe(0)
  })

  it('the oauth_state cookie is cleared on success and on every consumed-state failure', async () => {
    // success: session cookie + oauth_state deletion cookie both on separate lines
    const okEnv = makeEnv()
    const okCreated = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const ok = await handleOAuthCallback(
      await happyCallbackRequest(okCreated.value, { state: okCreated.state }),
      okEnv,
      { now: NOW, fetchImpl: mockGithub({}) }
    )
    expect(ok.status).toBe(302)
    const okCookies = ok.headers.getSetCookie()
    const okDeletion = okCookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
    expect(okDeletion).toBeTruthy()
    expect(okDeletion).toContain('Max-Age=0')
    expect(okDeletion).toContain('Path=/')
    expect(okDeletion).toContain('HttpOnly')
    expect(okDeletion.toLowerCase()).not.toContain('domain=')
    expect(okCookies).toHaveLength(2) // session + deletion, never comma-joined

    // exchange failure: state consumed -> deletion cookie present, no session
    const failEnv = makeEnv()
    const failCreated = await createStateCookieValue({ secret: SECRETS.STATE_HMAC_SECRET, now: NOW })
    const fail = await handleOAuthCallback(
      await happyCallbackRequest(failCreated.value, { state: failCreated.state }),
      failEnv,
      { now: NOW, fetchImpl: mockGithub({ tokenError: 'bad_verification_code' }) }
    )
    expect(fail.status).toBe(502)
    const failCookies = fail.headers.getSetCookie()
    expect(failCookies.some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`) && c.includes('Max-Age=0'))).toBe(true)
    expect(failCookies.some((c) => c.includes('save_links_session_dev='))).toBe(false)

    // unverified state: NOT consumed -> NO deletion cookie (attacker cannot
    // erase a victim's state by firing a bogus callback at it)
    const noClearEnv = makeEnv()
    const untouched = await handleOAuthCallback(new Request(CALLBACK_URL), noClearEnv, { now: NOW })
    expect(untouched.status).toBe(400)
    expect(untouched.headers.get('set-cookie')).toBeNull()
  })
})