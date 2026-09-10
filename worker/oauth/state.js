// Save_Links — OAuth CSRF state + PKCE.
//
// State binding: the login handler generates an unguessable `state` plus a
// PKCE `code_verifier`, and stores both in a single short-lived, HttpOnly,
// SameSite=Lax cookie, HMAC-SHA256-signed by a Worker-side secret. The cookie
// value is `payload.signature` where payload = base64url(JSON {s, v, exp, p?, n?})
// — `p` binds the state to one provider and `n` is Google's OIDC nonce (see
// createStateCookieValue).
//
// On callback the Worker verifies the signature (constant-time via
// crypto.subtle.verify), checks the expiry, and requires the `state` query
// parameter to equal the cookie's `s`. The signature prevents an attacker from
// forging or tampering with a victim's cookie; expiry keeps it short-lived
// (GitHub authorization codes expire after 10 minutes); `v` (the code_verifier)
// never leaves the HttpOnly cookie.
//
// This is the mechanism Cloudflare's own docs pattern uses (HMAC-signed
// OAuth state in a cookie). A server-side claim makes a state single-use: the
// callback claims the state in the D1 `oauth_states` table
// (store.claimOAuthState) so a state is single-use (RFC 6749 §4.1.2). A
// cookie-only check is stateless and therefore replayable — verification is a
// pure function of (cookie value, query state, secret, time), all of which a
// client holding the cookie value can present again. The D1 row is the only
// memory that can distinguish first use from replay; it stores only the opaque
// random state (never `v`, never a token) and is deleted on claim.

const PAYLOAD_SEPARATOR = '.'

export function bytesToBase64Url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(value) {
  let bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function randomBytesBase64Url(n) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(n)))
}

/** 256-bit random nonce, sent to Google and echoed back in the signed id_token. */
export function generateOAuthNonce() {
  return randomBytesBase64Url(32)
}

function encodeText(text) {
  return new TextEncoder().encode(text)
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encodeText(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function hmacSign(secret, text) {
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, encodeText(text))
  return bytesToBase64Url(new Uint8Array(sig))
}

// exported for tests that must craft well-formed-but-invalid cookies
export { hmacSign }

async function hmacVerify(secret, text, signatureBase64Url) {
  let signature
  try {
    signature = base64UrlToBytes(signatureBase64Url)
  } catch {
    return false
  }
  if (signature.length !== 32) return false
  const key = await hmacKey(secret)
  // crypto.subtle.verify for HMAC is constant-time by spec.
  return crypto.subtle.verify('HMAC', key, signature, encodeText(text))
}

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000 // codes expire in 10 minutes; match that
export const OAUTH_STATE_COOKIE = 'oauth_state'

/**
 * Generate a fresh signed state cookie value.
 * Optional `provider` and `nonce` record WHICH provider the state was issued
 * for (`p`) and the OIDC nonce bound to this sign-in (`n`). The provider claim
 * lets a callback prove the state belongs to its own flow (a google state can
 * never authorize a github callback or vice versa); the nonce lets the google
 * path bind the id_token to exactly this sign-in. GitHub keeps working with
 * provider-less cookies (legacy callers that created them before `p` existed).
 * @returns {Promise<{value: string, state: string, codeVerifier: string, expiresAt: number}>}
 */
export async function createStateCookieValue({ secret, now = Date.now(), ttlMs = OAUTH_STATE_TTL_MS, provider, nonce } = {}) {
  if (typeof secret !== 'string' || secret.length === 0) throw new TypeError('secret must be a non-empty string')
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be a positive integer')
  const state = randomBytesBase64Url(16) // 128-bit unguessable
  const codeVerifier = randomBytesBase64Url(32) // 256-bit PKCE verifier
  const expiresAt = now + ttlMs
  const payload = bytesToBase64Url(
    encodeText(JSON.stringify({
      s: state,
      v: codeVerifier,
      exp: expiresAt,
      ...(typeof provider === 'string' && provider.length > 0 ? { p: provider } : {}),
      ...(typeof nonce === 'string' && nonce.length > 0 ? { n: nonce } : {}),
    }))
  )
  const signature = await hmacSign(secret, payload)
  return { value: `${payload}${PAYLOAD_SEPARATOR}${signature}`, state, codeVerifier, expiresAt }
}

/**
 * Verify a state cookie value: format, signature (constant-time), expiry.
 * @returns {Promise<{state: string, codeVerifier: string, expiresAt: number, provider: string|null, nonce: string|null}|null>}
 */
export async function verifyStateCookieValue(value, { secret, now = Date.now() } = {}) {
  if (typeof value !== 'string' || typeof secret !== 'string' || secret.length === 0 || !Number.isInteger(now)) {
    return null
  }
  const sep = value.lastIndexOf(PAYLOAD_SEPARATOR)
  if (sep <= 0) return null
  const payload = value.slice(0, sep)
  const signature = value.slice(sep + 1)
  if (!(await hmacVerify(secret, payload, signature))) return null

  let data
  try {
    data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)))
  } catch {
    return null
  }
  if (typeof data?.s !== 'string' || typeof data?.v !== 'string' || !Number.isInteger(data.exp)) return null
  if (data.exp <= now) return null
  return {
    state: data.s,
    codeVerifier: data.v,
    expiresAt: data.exp,
    provider: typeof data.p === 'string' && data.p.length > 0 ? data.p : null,
    nonce: typeof data.n === 'string' && data.n.length > 0 ? data.n : null,
  }
}

/** PKCE S256 challenge: base64url(SHA-256(codeVerifier)) — always 43 chars, no padding. */
export async function pkceCodeChallenge(codeVerifier) {
  if (typeof codeVerifier !== 'string' || codeVerifier.length === 0) {
    throw new TypeError('codeVerifier must be a non-empty string')
  }
  const digest = await crypto.subtle.digest('SHA-256', encodeText(codeVerifier))
  return bytesToBase64Url(new Uint8Array(digest))
}