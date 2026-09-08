// Save_Links — Google OAuth / OpenID Connect provider client (worker-side).
//
// Google is the PRIMARY auth provider. The flow shape mirrors
// worker/oauth/github.js (state + PKCE cookie machinery lives in
// worker/oauth/state.js, driven by worker/auth.js), but identity is derived by
// VERIFYING Google's signed OpenID Connect `id_token` — a JWT — against
// Google's published JWKS, server-side. There is no second "get identity" API
// call and nothing about identity is ever trusted from the browser.
//
// Security invariants:
//   - The id_token signature is verified with Web Crypto, alg pinned to RS256
//     (Google's only signing algorithm), against
//     https://www.googleapis.com/oauth2/v3/certs (cached ~1h, refetched once
//     on an unknown kid to ride natural key rotation).
//   - iss / aud / exp / nbf / nonce / sub are validated here. `aud` must equal
//     our GOOGLE_CLIENT_ID exactly.
//   - The subject is Google's stable `sub` claim — the email is display-only
//     metadata and NEVER becomes identity.
//   - access_token / id_token stay inside this module's call scope: never
//     persisted, never logged, never returned to the browser.
//
// This module is HTTP-only and messages from OAuthError are always safe to
// surface to a browser (they never embed codes, tokens, or secrets).
export { OAuthError } from './github.js'
import { OAuthError } from './github.js'
import { bytesToBase64Url, base64UrlToBytes } from './state.js'

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
export const GOOGLE_SCOPE = 'openid email profile'
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
/** Verify jwks cache lifetime (Google rotates keys well within this window). */
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000
/** Tolerance on exp/nbf so a slightly drifting clock never logs someone out. */
export const ID_TOKEN_CLOCK_SKEW_MS = 5 * 60 * 1000

const textEncoder = new TextEncoder()

function decodeSegment(segmentBase64Url) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segmentBase64Url)))
  } catch {
    return null
  }
}

// ---- authorize URL -----------------------------------------------------------

/**
 * Build the Google authorization URL. Parameters:
 *  - response_type=code + PKCE S256 (Google supports PKCE for confidential
 *    clients too; cheap defense-in-depth alongside `state`)
 *  - nonce: a fresh 256-bit random per login (worker/oauth/state.js), echoed
 *    back in the signed id_token — proves the token belongs to THIS sign-in
 *  - scope 'openid email profile': openid makes Google return an id_token;
 *    email is used as display-only metadata (identity is `sub`)
 *  - prompt=select_account: always show the account chooser, so a browser
 *    holding several Google sessions cannot silently sign in as the wrong one
 */
export function buildAuthorizationUrl({ clientId, redirectUri, state, codeChallenge, nonce }) {
  const url = new URL(GOOGLE_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (nonce) url.searchParams.set('nonce', nonce)
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

// ---- token exchange ----------------------------------------------------------

/**
 * Exchange a one-time authorization code for Google's id_token.
 * Only the id_token is returned (least exposure): if Google includes an
 * access_token, it stays inside this call's scope and is discarded with it.
 * The OAuth code is single-use server-side and never logged.
 *
 * @returns {Promise<{idToken: string}>}
 */
export async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri, codeVerifier, fetchImpl = fetch }) {
  let res
  try {
    res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    })
  } catch {
    throw new OAuthError('Could not reach the Google token endpoint.', 'TOKEN_ENDPOINT_UNREACHABLE')
  }
  let data
  try {
    data = await res.json()
  } catch {
    throw new OAuthError('Google returned an unreadable token response.', 'TOKEN_RESPONSE_UNPARSEABLE')
  }
  if (!res.ok) {
    throw new OAuthError('Google rejected the authorization code.', 'TOKEN_EXCHANGE_REJECTED')
  }
  if (typeof data?.id_token !== 'string' || data.id_token.length === 0) {
    throw new OAuthError('Google token response had no id_token.', 'TOKEN_RESPONSE_INVALID')
  }
  return { idToken: data.id_token }
}

// ---- JWKS + id_token verification --------------------------------------------

let jwksCache = { fetchedAt: 0, keys: [] }

/** Test hook: drop the cached JWKS (each test mints its own key pair). */
export function clearJwksCache() {
  jwksCache = { fetchedAt: 0, keys: [] }
}

async function fetchJwks(fetchImpl) {
  let res
  try {
    res = await fetchImpl(GOOGLE_JWKS_URL)
  } catch {
    throw new OAuthError('Could not fetch Google signing keys.', 'JWKS_FETCH_FAILED')
  }
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok || !Array.isArray(body?.keys)) {
    throw new OAuthError('Could not fetch Google signing keys.', 'JWKS_FETCH_FAILED')
  }
  return body.keys
}

/** Get a signing key by kid; refeatches once on an unknown kid (key rotation). */
async function jwksKeyByKid(kid, fetchImpl) {
  const fresh = jwksCache.keys.length > 0 && Date.now() < jwksCache.fetchedAt + JWKS_CACHE_TTL_MS
  if (!fresh) {
    jwksCache = { fetchedAt: Date.now(), keys: await fetchJwks(fetchImpl) }
  }
  let key = jwksCache.keys.find((k) => k.kid === kid)
  if (!key) {
    jwksCache = { fetchedAt: Date.now(), keys: await fetchJwks(fetchImpl) }
    key = jwksCache.keys.find((k) => k.kid === kid)
  }
  return key ?? null
}

/**
 * Verify a Google OpenID Connect id_token (RS256 JWT, Web Crypto) and return
 * the provider identity. Every claim is validated server-side: signature,
 * algorithm (RS256 only), issuer, audience (=== clientId, exact), exp (with
 * clock skew), nbf, sub, and the nonce issued for THIS sign-in.
 *
 * @param {object} opts
 * @param {string} opts.idToken   — the JWT from the token exchange
 * @param {string} opts.clientId  — GOOGLE_CLIENT_ID; `aud` must equal it
 * @param {string} opts.nonce     — the nonce stored in the oauth_state cookie
 * @param {typeof fetch} [opts.fetchImpl] — injectable for tests
 * @param {number} [opts.now]     — injectable clock for tests (ms epoch)
 * @returns {Promise<{subject: string, email: string|null}>}
 */
export async function verifyGoogleIdToken({ idToken, clientId, nonce, fetchImpl = fetch, now = Date.now() } = {}) {
  const parts = String(idToken ?? '').split('.')
  if (parts.length !== 3) {
    throw new OAuthError('Google returned a malformed id_token.', 'ID_TOKEN_MALFORMED')
  }
  const [headerB64, payloadB64, signatureB64] = parts

  // Algorithm pin: Google signs id_tokens with RS256 only; anything else is
  // not a Google token and must be rejected before any crypto runs.
  const header = decodeSegment(headerB64)
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length === 0) {
    throw new OAuthError('Google id_token used an unsupported signing algorithm.', 'ID_TOKEN_BAD_ALGORITHM')
  }

  const key = await jwksKeyByKid(header.kid, fetchImpl)
  // key use/kty checks are defense-in-depth: only Google's sig-RSA keys qualify.
  if (!key || key.kty !== 'RSA' || (key.use !== undefined && key.use !== 'sig') || typeof key.n !== 'string' || typeof key.e !== 'string') {
    throw new OAuthError('Google id_token was signed by an unknown key.', 'ID_TOKEN_SIGNATURE_INVALID')
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
  let signatureBytes
  try {
    signatureBytes = base64UrlToBytes(signatureB64)
  } catch {
    throw new OAuthError('Google returned a malformed id_token.', 'ID_TOKEN_MALFORMED')
  }
  const verified = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    signatureBytes,
    textEncoder.encode(`${headerB64}.${payloadB64}`)
  )
  if (!verified) {
    throw new OAuthError('Google id_token signature did not verify.', 'ID_TOKEN_SIGNATURE_INVALID')
  }

  const claims = decodeSegment(payloadB64)
  if (!claims || typeof claims !== 'object') {
    throw new OAuthError('Google id_token payload was malformed.', 'ID_TOKEN_MALFORMED')
  }

  if (!GOOGLE_ISSUERS.includes(claims.iss)) {
    throw new OAuthError('Google id_token was issued by an unexpected issuer.', 'ID_TOKEN_ISSUER_INVALID')
  }
  if (typeof clientId !== 'string' || clientId.length === 0 || claims.aud !== clientId) {
    throw new OAuthError('Google id_token was not issued for this application.', 'ID_TOKEN_AUDIENCE_INVALID')
  }
  if (typeof claims.exp !== 'number' || now > claims.exp * 1000 + ID_TOKEN_CLOCK_SKEW_MS) {
    throw new OAuthError('Google id_token has expired.', 'ID_TOKEN_EXPIRED')
  }
  if (typeof claims.nbf === 'number' && now + ID_TOKEN_CLOCK_SKEW_MS < claims.nbf * 1000) {
    throw new OAuthError('Google id_token is not valid yet.', 'ID_TOKEN_NOT_YET_VALID')
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new OAuthError('Google id_token had no subject.', 'ID_TOKEN_SUBJECT_INVALID')
  }
  if (typeof nonce !== 'string' || nonce.length === 0 || claims.nonce !== nonce) {
    throw new OAuthError('Google id_token nonce did not match the sign-in.', 'ID_TOKEN_NONCE_MISMATCH')
  }

  return {
    subject: claims.sub,
    email: typeof claims.email === 'string' && claims.email.length > 0 ? claims.email : null,
  }
}