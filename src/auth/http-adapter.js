// Real HTTP AuthAdapter for Phase A — replaces the Phase 2A in-memory test
// double with the existing Cloudflare Worker OAuth + session endpoints.
// Implements the contract in src/auth/contract.js.
//
// Boundary rules preserved (AGENTS.md / SECURITY.md / .opencode/architecture.md):
//   - The browser sends its HttpOnly session cookie automatically on same-origin
//     requests; fetch always uses credentials:'same-origin' and navigation is
//     a plain location.assign — no token is ever read, stored, or sent by app code.
//   - Account identity comes EXCLUSIVELY from the authenticated server session:
//     /api/me returns the account_id the Worker derived from the session cookie.
//     The client never supplies or trusts an account id for authentication.
//   - No secret (session token, OAuth token, state secret, cookie value) ever
//     reaches this module or any other application state.
//   - OAuth is a top-level redirect (/auth/github/login). It cannot hand back a
//     user in-page: the callback sets the cookie and redirects to /, where the
//     app boots, init() calls /api/me, and the authenticated account resolves.
//
// Failure semantics (session.js records these; a boot must never fail local UI):
//   - 401  -> anonymous (no / expired / revoked session) — normal signed-out result
//   - 503  -> infrastructure unavailable — reject (do not pretend anonymous)
//   - network / other non-2xx -> reject (identity cannot be verified)
//   - login() is a redirect and therefore resolves to nothing; the in-page
//     session is NOT set to authenticated here — identity is restored by
//     init() after the OAuth callback. The UI signs in via accountService,
//     never by awaiting session.login().

export const AUTH_LOGIN_PATH = '/auth/github/login'
export const AUTH_ME_PATH = '/api/me'
export const AUTH_LOGOUT_PATH = '/auth/logout'

function unavailableFetch() {
  return Promise.reject(new Error('Fetch is not available in this environment'))
}

function defaultFetch() {
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return (...args) => globalThis.fetch(...args)
  }
  return unavailableFetch
}

function defaultLocation() {
  if (typeof window !== 'undefined' && window.location) return window.location
  return { assign() {} }
}

/**
 * @param {Object} [options]
 * @param {Function} [options.fetch]   injectable fetch (default: globalThis.fetch)
 * @param {{assign:(url:string)=>void}} [options.location]  injectable location (default: window.location)
 */
export function createHttpAdapter({
  fetch: fetchFn = defaultFetch(),
  location = defaultLocation(),
} = {}) {
  async function get(path) {
    let res
    try {
      res = await fetchFn(path, { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } })
    } catch (err) {
      throw new Error('Auth check failed: network unavailable')
    }
    return res
  }

  async function post(path) {
    try {
      return await fetchFn(path, { method: 'POST', credentials: 'same-origin' })
    } catch {
      throw new Error('Sign out failed: network unavailable')
    }
  }

  return {
    /**
     * Restore the authenticated server account, or null when signed out.
     * @returns {Promise<{id:string,name:string,email:null}|null>}
     */
    async init() {
      const res = await get(AUTH_ME_PATH)
      if (res.status === 401) return null            // no / expired / revoked session
      if (res.status === 503) throw new Error('Auth service unavailable') // infrastructure, not auth state
      if (!res.ok) throw new Error('Auth check failed: unexpected response')
      const body = await res.json().catch(() => null)
      if (!body || body.authenticated !== true || typeof body.accountId !== 'string' || !body.accountId) {
        throw new Error('Auth check returned an invalid response')
      }
      // Account identity is the server-issued account_id only. name/email stay
      // at the schema ceiling ('' / null), matching GET /auth/me.
      return { id: body.accountId, name: '', email: null }
    },

    /**
     * Start GitHub OAuth via a top-level redirect. The supplied promise never
     * resolves in-page: the page navigates away and the identity is restored by
     * init() after the callback. Callers must NOT await this to drive session
     * state — sign in via accountService.signIn(), never session.login().
     */
    login() {
      location.assign(AUTH_LOGIN_PATH)
      // Never-settling: an OAuth login does not complete inside a single page
      // load, and setting session to 'authenticated' here would be a false claim.
      return new Promise(() => {})
    },

    /** Revoke the session server-side. Logout always clears local state. */
    async logout() {
      const res = await post(AUTH_LOGOUT_PATH)
      // The Worker returns 200 for valid/expired/revoked/missing sessions; a
      // non-2xx means we cannot confirm revocation — reject so the UI surfaces it.
      if (!res.ok) throw new Error('Sign out failed: unexpected response')
      return undefined
    },
  }
}
