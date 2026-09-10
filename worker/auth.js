// Save_Links — Worker OAuth routes: login/callback for Google + GitHub, plus
// session-cookie hardening, rotation, session validation and logout.
//
// Flow (identical for every provider):
//   browser -> /auth/<provider>/login -> <provider> -> /auth/<provider>/callback
//            -> token exchange (discarded after identity) -> identity
//            -> account resolve/create (D1, atomic)
//            -> create NEW random server-side session (rotation)
//            -> revoke any pre-existing browser session
//            -> __Host- browser session cookie__ -> redirect home
//
// Session consumers (Phase 3C-2):
//   GET  /auth/me     -> resolve the presented session cookie to an
//                        AuthUser-shaped identity (401 when unauthenticated)
//   POST /auth/logout -> revoke the presented session + clear the cookie(s)
//
// The provider access/id token is held only inside this file's call stack and
// is never persisted, logged, or placed in any response. OAuth `state` + PKCE
// verifier (+ provider claim + Google nonce) live in a SIGNED, expiring,
// HttpOnly cookie (worker/oauth/state.js) — a DIFFERENT security object from
// the authenticated session cookie below.
//
// Session cookie (Phase 3C-2): production uses a `__Host-`-prefixed,
// Secure, Path=/, host-only (no Domain), HttpOnly, SameSite=Lax cookie that
// satisfies RFC 6265bis `__Host-` requirements exactly. Plain-HTTP local
// development uses a deliberate dev-only fallback (browsers reject `__Host-`
// cookies over insecure origins). Rotation: every successful authentication
// creates a fresh random session and revokes any session the browser already
// held — a pre-existing session can never simply become the authenticated one.
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  getIdentity,
  OAuthError,
} from './oauth/github.js'
import {
  buildAuthorizationUrl as buildGoogleAuthorizationUrl,
  exchangeCodeForToken as exchangeGoogleCodeForToken,
  verifyGoogleIdToken,
} from './oauth/google.js'
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  createStateCookieValue,
  verifyStateCookieValue,
  pkceCodeChallenge,
  generateOAuthNonce,
} from './oauth/state.js'
import {
  DEFAULT_SESSION_TTL_MS,
  claimOAuthState,
  createSession,
  deleteExpiredOAuthStates,
  getAccount,
  getSessionByToken,
  revokeSessionByToken,
  resolveAccountByProvider,
} from './db/store.js'
import { checkRateLimit, clientIp, rateLimitedResponse } from './rate-limit.js'

export const SESSION_TTL_SECONDS = Math.floor(DEFAULT_SESSION_TTL_MS / 1000)

/**
 * Provider descriptors — the ONLY per-provider differences the shared OAuth
 * pipeline cares about. GitHub and Google both flow through handleOAuthLogin /
 * handleOAuthCallback: the state cookie, PKCE, single-use claim, account
 * resolution, session rotation and cookie machinery are provider-agnostic and
 * implemented ONCE (never two copies of the security-critical parts).
 *
 * - github: identity = second API call; subject = GitHub's numeric id.
 * - google: identity = the VERIFIED signed id_token; subject = Google's `sub`.
 */
const PROVIDERS = {
  github: {
    name: 'GitHub',
    needsNonce: false,
    buildAuthorizeUrl: ({ clientId, redirectUri, state, codeChallenge }) =>
      buildAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }),
    exchange: ({ clientId, clientSecret, code, redirectUri, codeVerifier, fetchImpl }) =>
      exchangeCodeForToken({ clientId, clientSecret, code, redirectUri, codeVerifier, fetchImpl }),
    identify: async ({ exchangeResult, fetchImpl }) => {
      const identity = await getIdentity({ accessToken: exchangeResult.accessToken, fetchImpl })
      return { subject: identity.subject }
    },
  },
  google: {
    name: 'Google',
    needsNonce: true,
    buildAuthorizeUrl: ({ clientId, redirectUri, state, codeChallenge, nonce }) =>
      buildGoogleAuthorizationUrl({ clientId, redirectUri, state, codeChallenge, nonce }),
    exchange: ({ clientId, clientSecret, code, redirectUri, codeVerifier, fetchImpl }) =>
      exchangeGoogleCodeForToken({ clientId, clientSecret, code, redirectUri, codeVerifier, fetchImpl }),
    identify: async ({ exchangeResult, clientId, nonce, fetchImpl, now }) =>
      verifyGoogleIdToken({ idToken: exchangeResult.idToken, clientId, nonce, fetchImpl, now }),
  },
}

function responseHeaders(extra = {}) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  }
}

/**
 * Attach multiple cookies to a Headers instance, one Set-Cookie line each.
 * Undici comma-joins an ARRAY value ('a=1, b=2' inside one Set-Cookie line),
 * which browsers parse as a single corrupted cookie — so every multi-cookie
 * response must append each cookie separately (jsonResponse used this from
 * 3C-2; redirectResponse/errorResponse join it now that they can carry a
 * session cookie + an oauth_state deletion cookie in one response).
 */
function withCookies(headers, cookies) {
  if (Array.isArray(cookies)) {
    for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  }
  return headers
}

/** Safe, credential-free error page. Never include inputs (code/state/token). */
function errorResponse(status, message, cookies = []) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Sign in failed</title></head>` +
      `<body><h1>Sign in failed</h1><p>${message}</p>` +
      `<p><a href="/">Back to Save_Links</a></p></body></html>`,
    { status, headers: withCookies(new Headers(responseHeaders()), cookies) }
  )
}

export function setCookieHeader(name, value, { maxAgeSeconds, secure, path = '/', sameSite = 'Lax' }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    `SameSite=${sameSite}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

const HOST_SESSION_COOKIE = '__Host-save_links_session'
const DEV_SESSION_COOKIE = 'save_links_session_dev'

/**
 * Authenticated-session cookie parameters for a given request URL.
 *
 * Production HTTPS: `__Host-save_links_session` with Secure, Path=/, host-only
 * (no Domain) — satisfies RFC 6265bis `__Host-` exactly. (Set-Cookie always
 * emits HttpOnly + SameSite=Lax via setCookieHeader.)
 *
 * Plain-HTTP local development: browsers REJECT `__Host-` cookies unless the
 * response is Secure AND served from a secure origin, so a `__Host-` cookie
 * simply cannot be set at all on http://localhost. We therefore use an
 * un-prefixed, non-Secure dev-only name. This is a deliberate dev exception —
 * production traffic (the only path that reaches https) always takes the
 * `__Host-` branch above. Never weaken production for the dev case.
 */
export function sessionCookieConfig(url) {
  const secure = url.protocol === 'https:'
  if (!secure) {
    return { name: DEV_SESSION_COOKIE, secure: false }
  }
  return { name: HOST_SESSION_COOKIE, secure: true }
}

function redirectResponse(location, cookies = []) {
  return new Response(null, { status: 302, headers: withCookies(new Headers(responseHeaders({ Location: location })), cookies) })
}

/** JSON response with the shared hardening headers (no-store + nosniff + no frame). */
export function jsonResponse(status, body, extraHeaders = {}) {
  const headers = new Headers(
    responseHeaders({ 'Content-Type': 'application/json; charset=utf-8' })
  )
  const { 'Set-Cookie': setCookies, ...rest } = extraHeaders
  for (const [name, value] of Object.entries(rest)) headers.set(name, value)
  return new Response(JSON.stringify(body), { status, headers: withCookies(headers, setCookies) })
}

function readCookie(request, name) {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      // Malformed percent-encoding in a hostile cookie header must not crash
      // the route — fall back to the raw value (no hash will match it, so
      // callers treat it as an unknown/absent session).
      return part.slice(eq + 1).trim()
    }
  }
  return null
}

/**
 * Read the authenticated session cookie the browser presented, whichever name
 * applies to this origin. Only one can genuinely exist per origin (production
 * https -> __Host-, plain-http dev -> the dev fallback), but a dev cookie set
 * over http can also be forwarded to https (it carries no Secure), so host
 * name wins when both are present.
 *
 * @returns {{name: string, token: string}|null}
 */
export function readSessionCookie(request) {
  const host = readCookie(request, HOST_SESSION_COOKIE)
  if (host) return { name: HOST_SESSION_COOKIE, token: host }
  const dev = readCookie(request, DEV_SESSION_COOKIE)
  if (dev) return { name: DEV_SESSION_COOKIE, token: dev }
  return null
}

/**
 * Deletion Set-Cookie for a session cookie: empty value, Max-Age=0 (+ Expires
 * epoch for maximal client compatibility), Path=/, no Domain — the same scope
 * as the original. `secure` must mirror which cookie is being deleted (the
 * __Host- cookie requires Secure on its own deletion cookie; the dev cookie
 * must remain non-Secure so a browser on plain http can honor it).
 */
function deleteCookieHeader(name, { secure }) {
  const parts = [
    `${name}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Per-provider config from the environment. Secret names are per-provider
 * (GITHUB_CLIENT_ID/…, GOOGLE_CLIENT_ID/…); STATE_HMAC_SECRET is shared. All
 * three must be present or the provider is unconfigured (fail loud, no
 * half-flow). Only config names are referenced here — never values.
 */
function providerConfig(env, provider) {
  const vars = provider === 'google'
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
  if (!vars.clientId || !vars.clientSecret || !env.STATE_HMAC_SECRET) return null
  return { clientId: vars.clientId, clientSecret: vars.clientSecret, stateSecret: env.STATE_HMAC_SECRET }
}

// ---- Redirect-origin allowlist (Phase 3C-2 Chunk 3) --------------------------
//
// Every side effect of an OAuth route derives its destination origin from the
// configured APPROVED_ORIGINS list (comma-separated origins, whitespace
// trimmed) — NEVER from Host, X-Forwarded-Host or X-Forwarded-Proto (all
// attacker-controllable request headers). This makes two guarantees:
//   1. The GitHub redirect_uri (= approved origin + /auth/github/callback) is
//      always exactly the callback URL registered for this environment's
//      GitHub OAuth App (GitHub matches callbacks exactly), so the app's
//      authorization_code and any token in flight can never be sent anywhere
//      else — a hostile Host header cannot redirect the flow anywhere.
//   2. The post-auth destination is always the approved origin itself.
// APPROVED_ORIGINS is plaintext configuration, so it ships as a Wrangler
// `vars` entry per environment (Cloudflare best practice: secrets for
// credentials, vars for config) and locally via .dev.vars.

export function parseApprovedOrigins(value) {
  if (typeof value !== 'string') return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Resolve the effective origin for an /auth/* request from the allowlist.
 * Fail closed:
 *   { status: 503 }       APPROVED_ORIGINS unset / yields no entries
 *                         (deployment not configured; safe generic error, no
 *                         config details)
 *   { status: 400 }       request origin not on the list (configured but not
 *                         approved — never redirect; never start OAuth)
 *   { origin }            approved origin (the ONLY value callers may trust)
 */
export function resolveApprovedOrigin(request, env) {
  const approved = parseApprovedOrigins(env.APPROVED_ORIGINS)
  if (approved.length === 0) return { status: 503 }
  const requestOrigin = new URL(request.url).origin
  if (!approved.includes(requestOrigin)) return { status: 400 }
  return { origin: requestOrigin }
}

// ---- GET /auth/<provider>/login ----------------------------------------------

export async function handleOAuthLogin(request, env, { now = Date.now(), provider = 'github' } = {}) {
  const spec = PROVIDERS[provider]
  const config = spec ? providerConfig(env, provider) : null
  if (!spec) return errorResponse(404, 'Unknown authentication provider.')
  if (!config) return errorResponse(503, `${spec.name} sign-in is not configured on this deployment.`)

  const origin = resolveApprovedOrigin(request, env)
  if (origin.status === 503) return errorResponse(503, `${spec.name} sign-in is not configured on this deployment.`)
  if (origin.status === 400) return errorResponse(400, 'Sign-in is not allowed from this address.')

  // Per-IP budget BEFORE any work (state insert, provider redirect). All
  // fail-closed authorization checks (config, origin) already ran; the limiter
  // itself fails open on storage errors (see rate-limit.js header).
  const gate = await checkRateLimit(env.DB, { scope: 'auth', key: clientIp(request), now })
  if (!gate.allowed) return rateLimitedResponse(gate.retryAfterMs)

  // Opportunistic housekeeping: expired single-use state tombstones are swept
  // (index-driven) so oauth_states stays a rolling ~10-minute window of
  // attempts. Login does not require the DB — this sweep is best-effort.
  if (env.DB) await deleteExpiredOAuthStates(env.DB, { now }).catch(() => {})

  // Google binds its signed id_token back to this sign-in via a nonce; GitHub
  // has no token claim to bind, so no nonce is minted.
  const nonce = spec.needsNonce ? generateOAuthNonce() : null
  const { value, state, codeVerifier } = await createStateCookieValue({
    secret: config.stateSecret,
    now,
    provider,
    nonce: nonce ?? undefined,
  })
  const codeChallenge = await pkceCodeChallenge(codeVerifier)
  const redirectUri = `${origin.origin}/auth/${provider}/callback`
  const authorizeUrl = spec.buildAuthorizeUrl({ clientId: config.clientId, redirectUri, state, codeChallenge, nonce: nonce ?? undefined })

  const secure = new URL(origin.origin).protocol === 'https:'
  const cookie = setCookieHeader(OAUTH_STATE_COOKIE, value, {
    maxAgeSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    secure,
  })
  return redirectResponse(authorizeUrl, [cookie])
}

// ---- GET /auth/<provider>/callback -------------------------------------------

export async function handleOAuthCallback(request, env, { now = Date.now(), fetchImpl = fetch, provider = 'github' } = {}) {
  const spec = PROVIDERS[provider]
  const config = spec ? providerConfig(env, provider) : null
  if (!spec) return errorResponse(404, 'Unknown authentication provider.')
  if (!config) return errorResponse(503, `${spec.name} sign-in is not configured on this deployment.`)
  if (!env.DB) return errorResponse(503, 'The account store is not configured on this deployment.')

  const origin = resolveApprovedOrigin(request, env)
  if (origin.status === 503) return errorResponse(503, `${spec.name} sign-in is not configured on this deployment.`)
  if (origin.status === 400) return errorResponse(400, 'Sign-in is not allowed from this address.')

  // Per-IP budget BEFORE any work: state verification, the single-use claim
  // and every provider round-trip. Same fail-open semantics as login; the
  // authorization gates above already ran.
  const gate = await checkRateLimit(env.DB, { scope: 'auth', key: clientIp(request), now })
  if (!gate.allowed) return rateLimitedResponse(gate.retryAfterMs)

  const url = new URL(request.url)
  const redirectUri = `${origin.origin}/auth/${provider}/callback`
  const secure = url.protocol === 'https:'
  // The oauth_state cookie is cleared once the callback has ACCEPTED and
  // consumed the state — success or any failure after that point. It is NOT
  // cleared when verification failed (nothing was consumed; the cookie stays
  // for a retry, and an attacker must not be able to erase a victim's state).
  const clearStateCookie = () => [deleteCookieHeader(OAUTH_STATE_COOKIE, { secure })]
  const consumedStateFailure = (status, message) => errorResponse(status, message, clearStateCookie())

  // 1. CSRF/state validation (cookie signature + expiry + query match) AND
  //    provider binding: the state cookie must have been issued for THIS
  //    provider. Legacy github-era cookies carry no provider claim and still
  //    pass on the github path; anything carrying a DIFFERENT provider claim
  //    is rejected here, and the google path requires the explicit 'google'
  //    claim (no legacy google cookie exists). Not consumed on failure.
  const verified = await verifyStateCookieValue(readCookie(request, OAUTH_STATE_COOKIE), {
    secret: config.stateSecret,
    now,
  })
  const callbackState = url.searchParams.get('state')
  if (
    !verified ||
    typeof callbackState !== 'string' ||
    callbackState !== verified.state ||
    (verified.provider && verified.provider !== provider) ||
    (provider === 'google' && verified.provider !== 'google')
  ) {
    // Unverified/expired/tampered/provider-swapped: NOT consumed, cookie NOT cleared.
    return errorResponse(400, 'The sign-in attempt was invalid or expired. Please try again.')
  }
  if (spec.needsNonce && typeof verified.nonce !== 'string') {
    // Google: without the nonce minted at login the id_token cannot be bound
    // to this sign-in — reject before consuming anything.
    return errorResponse(400, 'The sign-in attempt was invalid or expired. Please try again.')
  }

  // 1b. Single-use claim (Phase 3C-2): only exactly one presentation of this
  // state may proceed. The signed cookie alone is replayable; the D1 claim
  // row is the consumption record. Verification failure stays above (cookie
  // intact); every path below has already consumed the state.
  let claimed
  try {
    claimed = await claimOAuthState(env.DB, { state: verified.state, expiresAt: verified.expiresAt })
  } catch {
    return errorResponse(500, 'Something went wrong during sign-in. Please try again.')
  }
  if (!claimed) {
    // Already presented (replay of a consumed state). Nothing to clear: the
    // cookie was already deleted by the request that consumed the state, and
    // a replayed value is not a browser jar we should mutate.
    return errorResponse(400, 'The sign-in attempt was invalid or expired. Please try again.')
  }

  // 2. Provider-reported failure (e.g. user clicked "Cancel") — state consumed.
  if (url.searchParams.get('error')) {
    return consumedStateFailure(400, `${spec.name} did not complete the authorization. Please try again.`)
  }

  // 3. Authorization code presence — state consumed.
  const code = url.searchParams.get('code')
  if (typeof code !== 'string' || code.length === 0) {
    return consumedStateFailure(400, `${spec.name} did not provide an authorization code. Please try again.`)
  }

  try {
    // 4. Exchange the code server-side; token lives only in this scope.
    const exchangeResult = await spec.exchange({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
      // PKCE: the authorize request used S256, so the provider requires the
      // matching verifier here (recovered from the signed oauth_state cookie).
      codeVerifier: verified.codeVerifier,
      fetchImpl,
    })

    // 5. Identity, verified server-side by the provider module (never from
    //    the browser). GitHub: numeric id from /user. Google: the signed
    //    id_token verified against Google JWKS; subject = `sub`.
    const identity = await spec.identify({ exchangeResult, clientId: config.clientId, nonce: verified.nonce, fetchImpl, now })
    // The exchange result is deliberately out of scope now: nothing below can
    // log the token. `code` is also deliberately unusable past this point.

    // 6. Map the stable provider subject to an application account (atomic,
    //    one provider subject → exactly one account; never email-matched).
    const { account_id: accountId } = await resolveAccountByProvider(env.DB, {
      provider,
      providerSubject: identity.subject,
      now,
    })

    // 7. Rotation / fixation protection: a session that existed before this
    //    authentication MUST NOT become the authenticated session. We always
    //    create a brand-new random session, and we revoke any token the browser
    //    previously held so it cannot linger valid afterwards.
    const previousSession = readSessionCookie(request)
    if (previousSession) {
      await revokeSessionByToken(env.DB, { token: previousSession.token, now })
    }

    // 8. Fresh server-side session (Phase 3B model: only the hash is persisted).
    const session = await createSession(env.DB, { accountId, now })

    // 9. Hand the raw bearer token to the browser once, via an HttpOnly cookie.
    const { name, secure: sessionSecure } = sessionCookieConfig(url)
    const sessionCookie = setCookieHeader(name, session.token, {
      maxAgeSeconds: SESSION_TTL_SECONDS,
      secure: sessionSecure,
    })
    // Destination derives ONLY from the approved origin; the consumed
    // oauth_state cookie is cleared alongside the new session cookie.
    return redirectResponse(`${origin.origin}/`, [sessionCookie, ...clearStateCookie()])
  } catch (err) {
    // Never leak secret/token/code/D1 internals; OAuthError messages are
    // already safe, anything else is a generic server failure. The state was
    // consumed, so clear its cookie.
    const message = err instanceof OAuthError ? err.message : 'Something went wrong during sign-in. Please try again.'
    return errorResponse(err instanceof OAuthError ? 502 : 500, message, clearStateCookie())
  }
}

// ---- GET /auth/me ------------------------------------------------------------

/**
 * Determine the current authenticated identity. Reads the session cookie,
 * hashes the presented token, resolves the ACTIVE session in D1 (revoked or
 * expired -> unauthenticated), and returns the Phase 2A AuthUser shape:
 *   { id: users.account_id, name, email }
 *
 * `id` is the D1 account id (provider-neutral) — NEVER the GitHub id/login.
 * `name` is reported as '' because the D1 schema stores no display name
 * (users = account_id + created_at only); populating it needs a profile/
 * name column, which is a later design decision, explicitly NOT this chunk.
 *
 * Authentication failure is never a server error: no cookie / unknown /
 * expired / revoked session -> uniform 401 `{ error: 'unauthenticated' }`.
 * A missing DB or an unexpected failure is infrastructure, not auth state:
 * 503/500 with generic bodies. Nothing here exposes D1 rows or tokens.
 */
export async function handleAuthMe(request, env, { now = Date.now() } = {}) {
  if (!env.DB) return jsonResponse(503, { error: 'unavailable' })
  const presented = readSessionCookie(request)
  if (!presented) return jsonResponse(401, { error: 'unauthenticated' })

  try {
    const session = await getSessionByToken(env.DB, { token: presented.token, now })
    if (!session) return jsonResponse(401, { error: 'unauthenticated' })
    const account = await getAccount(env.DB, { accountId: session.account_id })
    if (!account) return jsonResponse(401, { error: 'unauthenticated' })
    return jsonResponse(200, { id: account.account_id, name: '', email: null })
  } catch {
    return jsonResponse(500, { error: 'server_error' })
  }
}

// ---- POST /auth/logout --------------------------------------------------------

/**
 * Revoke the presented session and clear the session cookie(s). Safe and
 * idempotent: valid / expired / already-revoked / malformed / missing all
 * return 200 `{ ok: true }` — nothing about the response leaks whether a
 * session existed.
 *
 * CSRF reasoning (documented, smallest defensible implementation — the full
 * CSRF token budget is a later 3C-2 chunk): the session cookie is
 * SameSite=Lax, which browsers withhold on cross-site POSTs (Lax sends only
 * on top-level GET navigations). A cross-site logout POST therefore arrives
 * WITHOUT the session cookie, so it can neither revoke anything (no valid
 * token to hash-match) nor erase the victim's cookie (we emit deletion
 * cookies only when a session cookie was actually presented). A genuine
 * same-site logout always presents the cookie and gets the full revoke +
 * clear. Remaining limitation: anyone who can mount a same-site
 * state-changing request (e.g. a subdomain) is not covered — that is what the
 * later CSRF token budget is for.
 *
 * A D1 failure during revocation surfaces as a 500 (fail loud — we will not
 * claim logout while the server-side session stays live); a client can retry.
 */
export async function handleAuthLogout(request, env, { now = Date.now() } = {}) {
  const presented = readSessionCookie(request)
  const clearCookies = []
  try {
    if (presented) {
      if (env.DB) {
        await revokeSessionByToken(env.DB, { token: presented.token, now })
      }
      // Clear BOTH names: the https __Host- cookie always needs a Secure
      // deletion cookie; the dev fallback must stay non-Secure. Emitting both
      // guarantees no cookie variant survives on this browser. (A Secure
      // deletion cookie over plain http is ignored by browsers — harmless.)
      clearCookies.push(deleteCookieHeader(HOST_SESSION_COOKIE, { secure: true }))
      clearCookies.push(deleteCookieHeader(DEV_SESSION_COOKIE, { secure: false }))
    }
    const extra = clearCookies.length > 0 ? { 'Set-Cookie': clearCookies } : {}
    return jsonResponse(200, { ok: true }, extra)
  } catch {
    return jsonResponse(500, { error: 'server_error' })
  }
}