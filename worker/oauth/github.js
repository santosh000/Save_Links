// Save_Links — GitHub OAuth web-flow client (Phase 3C-1 spike).
//
// Runs in the Cloudflare Worker runtime (workerd) against GitHub's public
// endpoints. This module is HTTP-only: it never persists anything, never logs
// tokens or codes, and returns typed errors whose messages never contain
// credentials. The only value that ever leaves this module is the stable
// provider subject (and a display login for the spike result page).
//
// Endpoints (GitHub docs, "Authorizing OAuth apps", fetched 2026-09-01):
//   GET  https://github.com/login/oauth/authorize          (web application flow)
//   POST https://github.com/login/oauth/access_token       (code exchange)
//   GET  https://api.github.com/user                       (identity)
//
// Scopes: NONE are requested. GitHub's "(no scope)" grants read-only access to
// public profile information, which is all the spike needs for a stable
// identity. See MAINTAINERS.md for why an empty scope list is deliberate.

/** Non-exported error type: message is safe to surface to a browser. */
export class OAuthError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
export const GITHUB_API_USER_URL = 'https://api.github.com/user'

/**
 * Build the authorization request URL. PKCE (S256) is included because GitHub
 * documents it as strongly recommended alongside `state`, and it is cheap
 * defense-in-depth for a confidential-client web flow. No `scope` parameter is
 * set: we request no GitHub permissions (identity is public profile data).
 */
export function buildAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL(GITHUB_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/**
 * Exchange a one-time authorization code for a GitHub access token.
 * The token is held only long enough to fetch identity (see getIdentity) and
 * is then discarded — it is never persisted, logged, or returned to a browser.
 *
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret  — Worker-side secret only, never leaves this call
 * @param {string} opts.code
 * @param {string} opts.redirectUri   — must exactly match the registered callback
 * @param {string} opts.codeVerifier  — PKCE verifier; required because authorization used S256
 * @param {typeof fetch} [opts.fetchImpl] — injectable for tests
 * @returns {Promise<{accessToken: string}>}
 */
export async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri, codeVerifier, fetchImpl = fetch }) {
  const res = await fetchImpl(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  })

  let data
  try {
    data = await res.json()
  } catch {
    throw new OAuthError('GitHub returned an unreadable token response.', 'TOKEN_RESPONSE_UNPARSEABLE')
  }

  // GitHub historically signals failures like `bad_verification_code` in a
  // 200 response body with an `error` field; never trust status alone.
  if (!res.ok || data.error) {
    throw new OAuthError('GitHub rejected the authorization code.', 'TOKEN_EXCHANGE_REJECTED')
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new OAuthError('GitHub token response was missing an access token.', 'TOKEN_RESPONSE_INVALID')
  }
  return { accessToken: data.access_token }
}

/**
 * Fetch the authenticated user's identity. The provider subject is GitHub's
 * stable, immutable numeric user id (String(id)); `login` may change and is
 * never used as an identifier. All identity data comes from this server-side
 * API response, never from the browser.
 *
 * @returns {Promise<{subject: string, login: string}>}
 */
export async function getIdentity({ accessToken, fetchImpl = fetch }) {
  const res = await fetchImpl(GITHUB_API_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      // GitHub's API rejects requests without a recognized User-Agent (403 HTML)
      // and recommends pinning an API version. Both are required to reach /user.
      'User-Agent': 'Save_Link',
      'X-GitHub-Api-Version': '2026-03-10',
    },
  })

  // TEMPORARY DIAGNOSTIC — remove after root-causing the identity-fetch failure.
  // Logs ONLY non-sensitive metadata. NEVER logs the access_token, Authorization
  // header, OAuth code, state, cookies, response body, or any credential/secret.
  let bodyParseSucceeded = false
  try {
    await res.clone().json()
    bodyParseSucceeded = true
  } catch {
    bodyParseSucceeded = false
  }
  {
    const logResUrl = new URL(res.url || GITHUB_API_USER_URL)
    console.log(
      `[getIdentity][diagnostic] status=${res.status} ok=${res.ok} ` +
        `content-type=${res.headers.get('content-type')} ` +
        `content-length=${res.headers.get('content-length')} ` +
        `url=${logResUrl.origin}${logResUrl.pathname} ` +
        `body-json-parse=${bodyParseSucceeded}`
    )
  }

  let data
  try {
    data = await res.json()
  } catch {
    throw new OAuthError('GitHub returned an unreadable identity response.', 'IDENTITY_RESPONSE_UNPARSEABLE')
  }
  if (!res.ok) {
    throw new OAuthError('GitHub could not confirm the identity.', 'IDENTITY_FETCH_FAILED')
  }
  const id = data.id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new OAuthError('GitHub identity response had no stable identifier.', 'IDENTITY_RESPONSE_INVALID')
  }
  return { subject: String(id), login: typeof data.login === 'string' ? data.login : '' }
}