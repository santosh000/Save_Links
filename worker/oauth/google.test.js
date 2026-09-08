// @vitest-environment node
//
// Google OAuth provider client tests (worker/oauth/google.js). The HTTP
// boundary is mocked via the injectable fetchImpl; id_token SIGNATURE
// verification runs the REAL Web Crypto RS256 path against a key pair minted
// per test (worker/oauth/idtoken.test-util.js) and served back on the mocked
// Google /oauth2/v3/certs endpoint. None of these tests require network or
// real credentials.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OAuthError,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  verifyGoogleIdToken,
  clearJwksCache,
  GOOGLE_AUTHORIZE_URL,
  ID_TOKEN_CLOCK_SKEW_MS,
} from './google.js'
import { makeJwkKeyPair, signTestIdToken } from './idtoken.test-util.js'

const CLIENT_ID = '1234567890.apps.googleusercontent.com'
const NONCE = 'test-nonce'
const NOW = 1_700_000_000_000
const KID = 'test-kid'

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

function baseClaims({ now = NOW, ...overrides } = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-user-105',
    email: 'user@example.com',
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + 3_600_000) / 1000),
    nbf: Math.floor((now - 60_000) / 1000),
    nonce: NONCE,
    ...overrides,
  }
}

function jwksResponse(keyPair, { kid = KID } = {}) {
  return { keys: [{ ...keyPair.publicJwk, kid, use: 'sig' }] }
}

/** Mock fetch that routes by URL to the token and /certs endpoints. */
function mockGoogleFetch({ idToken = null, keys = null, tokenStatus = 200, tokenError = null, certsStatus = 200 } = {}) {
  return vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('oauth2.googleapis.com/token')) {
      if (tokenError) return jsonResponse({ error: tokenError }, tokenStatus)
      if (idToken !== null) return jsonResponse({ id_token: idToken, scope: 'openid email profile' }, tokenStatus)
      return jsonResponse({}, tokenStatus)
    }
    if (u.includes('googleapis.com/oauth2/v3/certs')) {
      return certsStatus === 200 && keys !== null ? jsonResponse(keys) : jsonResponse({ keys: [] }, certsStatus)
    }
    throw new Error(`unexpected URL in test: ${url}`)
  })
}

describe('buildAuthorizationUrl', () => {
  it('sets every OIDC authorization parameter: code + S256 PKCE + nonce + select_account', () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: CLIENT_ID,
        redirectUri: 'http://localhost:8787/auth/google/callback',
        state: 'the-csrf-state',
        codeChallenge: '43-char-challenge',
        nonce: NONCE,
      })
    )
    expect(url.origin + url.pathname).toBe(GOOGLE_AUTHORIZE_URL)
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/google/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('state')).toBe('the-csrf-state')
    expect(url.searchParams.get('code_challenge')).toBe('43-char-challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('nonce')).toBe(NONCE)
    expect(url.searchParams.get('prompt')).toBe('select_account')
    // confidential-client flow: no access_type/offline grant is requested
    expect(url.searchParams.has('access_type')).toBe(false)
    expect(url.searchParams.has('prompt_consent')).toBe(false)
  })
})

describe('exchangeCodeForToken', () => {
  it('exchanges a code for the id_token with the form-encoded grant', async () => {
    const fetchImpl = mockGoogleFetch({ idToken: 'jwt.header.sig' })
    const { idToken } = await exchangeCodeForToken({
      clientId: CLIENT_ID,
      clientSecret: 'google-secret',
      code: 'one-time-code',
      redirectUri: 'http://localhost:8787/auth/google/callback',
      codeVerifier: 'known-verifier-value',
      fetchImpl,
    })
    expect(idToken).toBe('jwt.header.sig')

    const [url, opts] = fetchImpl.mock.calls[0]
    expect(String(url)).toContain('oauth2.googleapis.com/token')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(opts.headers.Accept).toBe('application/json')
    const body = new URLSearchParams(opts.body)
    expect(body.get('client_id')).toBe(CLIENT_ID)
    expect(body.get('client_secret')).toBe('google-secret')
    expect(body.get('code')).toBe('one-time-code')
    expect(body.get('redirect_uri')).toBe('http://localhost:8787/auth/google/callback')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toBe('known-verifier-value')
  })

  it('rejects a non-2xx token response', async () => {
    await expect(
      exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'c', redirectUri: 'r', fetchImpl: mockGoogleFetch({ tokenStatus: 400, tokenError: 'invalid_grant' }) })
    ).rejects.toMatchObject({ code: 'TOKEN_EXCHANGE_REJECTED' })
  })

  it('rejects an unparseable token body', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>oops</html>', { status: 200 }))
    await expect(
      exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'c', redirectUri: 'r', fetchImpl })
    ).rejects.toMatchObject({ code: 'TOKEN_RESPONSE_UNPARSEABLE' })
  })

  it('rejects a 2xx body without an id_token', async () => {
    await expect(
      exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'c', redirectUri: 'r', fetchImpl: mockGoogleFetch({}) })
    ).rejects.toMatchObject({ code: 'TOKEN_RESPONSE_INVALID' })
  })

  it('reports an unreachable token endpoint distinctly', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('no network') })
    await expect(
      exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'c', redirectUri: 'r', fetchImpl })
    ).rejects.toMatchObject({ code: 'TOKEN_ENDPOINT_UNREACHABLE' })
  })

  it('error messages never embed the secret, code or token', async () => {
    const fetchImpl = mockGoogleFetch({ tokenStatus: 400, tokenError: 'my-secret-token-goes-nowhere' })
    try {
      await exchangeCodeForToken({ clientId: 'super-secret-client', clientSecret: 'super-secret', code: 'super-code', redirectUri: 'r', fetchImpl })
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError)
      expect(err.message).not.toContain('super-secret')
      expect(err.message).not.toContain('super-code')
    }
  })
})

describe('verifyGoogleIdToken', () => {
  let keyPair

  beforeEach(async () => {
    clearJwksCache() // each test mints its own key pair; never bleed state across tests
    keyPair = await makeJwkKeyPair()
  })

  it('verifies a real RS256 signature and returns the verified sub as subject', async () => {
    const idToken = await signTestIdToken({ claims: baseClaims(), privateKey: keyPair.privateKey, kid: KID })
    const fetchImpl = mockGoogleFetch({ keys: jwksResponse(keyPair) })
    const identity = await verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl, now: NOW })
    expect(identity).toEqual({ subject: 'google-user-105', email: 'user@example.com' })
    expect(fetchImpl).toHaveBeenCalledTimes(1) // only the /certs fetch
  })

  it('rejects a token signed by a different key', async () => {
    const otherKey = await makeJwkKeyPair()
    const idToken = await signTestIdToken({ claims: baseClaims(), privateKey: otherKey.privateKey, kid: KID })
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({ keys: jwksResponse(keyPair) }), now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_SIGNATURE_INVALID' })
  })

  it('rides key rotation: refetches once on an unknown kid, then verifies', async () => {
    const rotatedKey = await makeJwkKeyPair()
    const idToken = await signTestIdToken({ claims: baseClaims(), privateKey: rotatedKey.privateKey, kid: 'rotated-kid' })
    // First /certs response is the OLD key set; the refetch serves the new kid.
    let serves = 0
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('/oauth2/v3/certs')) {
        serves += 1
        return serves === 1
          ? jsonResponse(jwksResponse(keyPair))
          : jsonResponse(jwksResponse(rotatedKey, { kid: 'rotated-kid' }))
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    const identity = await verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl, now: NOW })
    expect(identity.subject).toBe('google-user-105')
    expect(serves).toBe(2) // initial + one refetch on the kid miss
  })

  it('rejects when the kid is unknown even after the refetch', async () => {
    const idToken = await signTestIdToken({ claims: baseClaims(), privateKey: keyPair.privateKey, kid: 'never-published-kid' })
    let serves = 0
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('/oauth2/v3/certs')) {
        serves += 1
        return jsonResponse(jwksResponse(keyPair)) // never contains the token's kid
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl, now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_SIGNATURE_INVALID' })
    expect(serves).toBe(2)
  })

  it('rejects a non-RSA (or missing-use) key outright — defense in depth', async () => {
    const idToken = await signTestIdToken({ claims: baseClaims(), privateKey: keyPair.privateKey, kid: KID })
    const bogus = [{ ...keyPair.publicJwk, kty: 'EC', kid: KID }]
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({ keys: { keys: bogus } }), now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_SIGNATURE_INVALID' })
  })

  it('rejects a wrong issuer', async () => {
    const idToken = await signTestIdToken({ claims: baseClaims({ iss: 'https://evil.example' }), privateKey: keyPair.privateKey, kid: KID })
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({ keys: jwksResponse(keyPair) }), now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_ISSUER_INVALID' })
  })

  it('rejects a wrong audience (exact-string aud check)', async () => {
    const idToken = await signTestIdToken({ claims: baseClaims({ aud: 'another-app.apps.googleusercontent.com' }), privateKey: keyPair.privateKey, kid: KID })
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({ keys: jwksResponse(keyPair) }), now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_AUDIENCE_INVALID' })
  })

  it('rejects an expired token', async () => {
    const idToken = await signTestIdToken({
      claims: baseClaims({ exp: Math.floor((NOW - ID_TOKEN_CLOCK_SKEW_MS - 1000) / 1000) }),
      privateKey: keyPair.privateKey, kid: KID,
    })
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({ keys: jwksResponse(keyPair) }), now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_EXPIRED' })
  })

  it('allows a token whose exp sits inside the clock-skew window', async () => {
    const idToken = await signTestIdToken({
      claims: baseClaims({ exp: Math.floor((NOW - 60_000) / 1000) }), // 60s ago, inside the 5-min skew
      privateKey: keyPair.privateKey, kid: KID,
    })
    const identity = await verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({ keys: jwksResponse(keyPair) }), now: NOW })
    expect(identity.subject).toBe('google-user-105')
  })

  it('rejects a token that is not valid yet (nbf in the future)', async () => {
    const idToken = await signTestIdToken({
      claims: baseClaims({ nbf: Math.floor((NOW + ID_TOKEN_CLOCK_SKEW_MS + 1000) / 1000) }),
      privateKey: keyPair.privateKey, kid: KID,
    })
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({ keys: jwksResponse(keyPair) }), now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_NOT_YET_VALID' })
  })

  it('rejects a non-RS256 token before any signature work', async () => {
    const idToken = await signTestIdToken({ claims: baseClaims(), privateKey: keyPair.privateKey, kid: KID, header: { alg: 'HS256' } })
    const fetchImpl = mockGoogleFetch({ keys: jwksResponse(keyPair) })
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl, now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_BAD_ALGORITHM' })
    expect(fetchImpl).not.toHaveBeenCalled() // rejected before JWKS/crypto
  })

  it('rejects a missing subject — email is never the identity', async () => {
    const idToken = await signTestIdToken({ claims: baseClaims({ sub: '' }), privateKey: keyPair.privateKey, kid: KID })
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({ keys: jwksResponse(keyPair) }), now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_SUBJECT_INVALID' })
  })

  it('rejects a nonce mismatch — the token must belong to THIS sign-in', async () => {
    const idToken = await signTestIdToken({ claims: baseClaims({ nonce: 'some-other-nonce' }), privateKey: keyPair.privateKey, kid: KID })
    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({ keys: jwksResponse(keyPair) }), now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_NONCE_MISMATCH' })
  })

  it('rejects a structurally malformed token', async () => {
    await expect(
      verifyGoogleIdToken({ idToken: 'only-two.parts', clientId: CLIENT_ID, nonce: NONCE, fetchImpl: mockGoogleFetch({}), now: NOW })
    ).rejects.toMatchObject({ code: 'ID_TOKEN_MALFORMED' })
  })

  it('fails cleanly when the JWKS endpoint is unavailable', async () => {
    const idToken = await signTestIdToken({ claims: baseClaims(), privateKey: keyPair.privateKey, kid: KID })
    for (const fetchImpl of [
      mockGoogleFetch({ keys: null, certsStatus: 500 }),
      vi.fn(async () => { throw new Error('no network') }),
    ]) {
      await expect(
        verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, nonce: NONCE, fetchImpl, now: NOW })
      ).rejects.toMatchObject({ code: 'JWKS_FETCH_FAILED' })
    }
  })
})