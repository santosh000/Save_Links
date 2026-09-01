// @vitest-environment node
//
// Phase 3C-1 — GitHub OAuth client tests (worker/oauth/github.js).
// The HTTP boundary is mocked via the injectable fetchImpl; URL construction,
// error mapping and the "200 body with error" GitHub quirk are all exercised.
// None of these tests require network or real credentials.
import { describe, it, expect, vi } from 'vitest'
import {
  OAuthError,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  getIdentity,
  GITHUB_AUTHORIZE_URL,
} from './github.js'

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

/** Mock fetch that routes by URL to canned token/identity responses. */
const mockGithub = ({ token = null, tokenStatus = 200, identity = null, identityStatus = 200, tokenError = null } = {}) =>
  vi.fn(async (url) => {
    if (String(url).includes('/login/oauth/access_token')) {
      if (tokenError) return jsonResponse({ error: tokenError }, tokenStatus)
      if (token === null) return jsonResponse({}, tokenStatus)
      return jsonResponse({ access_token: token, token_type: 'bearer' }, tokenStatus)
    }
    if (String(url).includes('api.github.com/user')) {
      if (identityStatus !== 200) return jsonResponse({ message: 'nope' }, identityStatus)
      if (identity === null) return jsonResponse({}, identityStatus)
      return jsonResponse(identity, identityStatus)
    }
    throw new Error(`unexpected URL in test: ${url}`)
  })

describe('buildAuthorizationUrl', () => {
  it('sets every OAuth web-flow parameter and requests no scope', () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: 'Iv1.client',
        redirectUri: 'http://localhost:8787/auth/github/callback',
        state: 'the-csrf-state',
        codeChallenge: '43-char-challenge',
      })
    )
    expect(url.origin + url.pathname).toBe(GITHUB_AUTHORIZE_URL)
    expect(url.searchParams.get('client_id')).toBe('Iv1.client')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/github/callback')
    expect(url.searchParams.get('state')).toBe('the-csrf-state')
    expect(url.searchParams.get('code_challenge')).toBe('43-char-challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // no scope requested on purpose (public profile is enough for identity)
    expect(url.searchParams.has('scope')).toBe(false)
  })
})

describe('exchangeCodeForToken', () => {
  it('exchanges a code for an access token', async () => {
    const fetchImpl = mockGithub({ token: 'gho_very-secret-token' })
    const { accessToken } = await exchangeCodeForToken({
      clientId: 'c',
      clientSecret: 's',
      code: 'one-time-code',
      redirectUri: 'http://localhost:8787/auth/github/callback',
      fetchImpl,
    })
    expect(accessToken).toBe('gho_very-secret-token')

    const [url, opts] = fetchImpl.mock.calls[0]
    expect(String(url)).toContain('/login/oauth/access_token')
    expect(opts.method).toBe('POST')
    expect(opts.headers.Accept).toBe('application/json')
    const body = new URLSearchParams(opts.body)
    expect(body.get('client_id')).toBe('c')
    expect(body.get('client_secret')).toBe('s')
    expect(body.get('code')).toBe('one-time-code')
    expect(body.get('redirect_uri')).toBe('http://localhost:8787/auth/github/callback')
  })

  it('treats GitHub\'s 200-with-error response as a failure (historical quirk)', async () => {
    await expect(
      exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'bad', redirectUri: 'r', fetchImpl: mockGithub({ tokenError: 'bad_verification_code' }) })
    ).rejects.toMatchObject({ name: 'OAuthError', code: 'TOKEN_EXCHANGE_REJECTED' })
  })

  it('rejects a non-2xx status', async () => {
    await expect(
      exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'c', redirectUri: 'r', fetchImpl: mockGithub({ tokenStatus: 401 }) })
    ).rejects.toMatchObject({ code: 'TOKEN_EXCHANGE_REJECTED' })
  })

  it('rejects an unparseable body', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>oops</html>', { status: 200 }))
    await expect(
      exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'c', redirectUri: 'r', fetchImpl })
    ).rejects.toMatchObject({ code: 'TOKEN_RESPONSE_UNPARSEABLE' })
  })

  it('rejects a 2xx body missing the access token', async () => {
    await expect(
      exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'c', redirectUri: 'r', fetchImpl: mockGithub({}) })
    ).rejects.toMatchObject({ code: 'TOKEN_RESPONSE_INVALID' })
  })

  it('error messages never embed the secret, code or token', async () => {
    const fetchImpl = mockGithub({ tokenError: 'bad_verification_code' })
    try {
      await exchangeCodeForToken({ clientId: 'super-secret-client', clientSecret: 'super-secret', code: 'super-code', redirectUri: 'r', fetchImpl })
    } catch (err) {
      expect(err.message).not.toContain('super-secret')
      expect(err.message).not.toContain('super-code')
      expect(err.message).not.toContain('bad_verification_code')
      expect(err).toBeInstanceOf(OAuthError)
    }
  })
})

describe('getIdentity', () => {
  it('maps GitHub id to the stable String subject with display login', async () => {
    const identity = await getIdentity({
      accessToken: 'gho_x',
      fetchImpl: mockGithub({ token: 'gho_x', identity: { id: 42, login: 'octo', name: 'Octo Cat' } }),
    })
    expect(identity).toEqual({ subject: '42', login: 'octo' })
  })

  it('requires a positive safe-integer id — never trusts login as the subject', async () => {
    await expect(
      getIdentity({ accessToken: 't', fetchImpl: mockGithub({ identity: { id: '42', login: 'octo' } }) })
    ).rejects.toMatchObject({ code: 'IDENTITY_RESPONSE_INVALID' })
    await expect(
      getIdentity({ accessToken: 't', fetchImpl: mockGithub({ identity: { id: -1, login: 'octo' } }) })
    ).rejects.toMatchObject({ code: 'IDENTITY_RESPONSE_INVALID' })
  })

  it('fails when GitHub cannot confirm identity', async () => {
    await expect(
      getIdentity({ accessToken: 't', fetchImpl: mockGithub({ identity: { id: 1 }, identityStatus: 401 }) })
    ).rejects.toMatchObject({ code: 'IDENTITY_FETCH_FAILED' })
  })

  it('does not leak the bearer token into errors', async () => {
    const fetchImpl = mockGithub({ identityStatus: 500 })
    try {
      await getIdentity({ accessToken: 'gho_do-not-leak-me', fetchImpl })
    } catch (err) {
      expect(err.message).not.toContain('gho_do-not-leak-me')
    }
  })
})