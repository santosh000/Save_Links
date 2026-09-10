// Session abstraction — owns authentication state for the application and
// nothing else. It does NOT touch IndexedDB, links, folders, profile,
// settings, migration, backup or sync: it talks only to an AuthAdapter through
// the contract in src/auth/contract.js. The application observes this
// abstraction; it never observes a provider.

import { createHttpAdapter } from './http-adapter.js'

function messageOf(err) {
  return err instanceof Error ? err.message : String(err ?? 'unknown error')
}

/**
 * Create an isolated session abstraction around an AuthAdapter.
 * @param {import('./contract.js').AuthAdapter} adapter
 */
export function createSession(adapter) {
  /** @type {import('./contract.js').AuthState} */
  const state = { status: 'unknown', user: null, error: null }
  const listeners = new Set()
  let initPromise = null
  // Authentication-epoch guard: bumped on every status transition (unknown →
  // authenticated, authenticated → anonymous, …). A refresh that started for
  // an OLDER epoch must never tear down or annotate a NEWER authentication.
  let authVersion = 0
  // In-flight rotation dedupe: concurrent refreshSession() callers (boot +
  // visibility resume, several tabs, …) share ONE adapter.refresh() request.
  let refreshInFlight = null
  let refreshInFlightVersion = null

  function setState(patch) {
    if (patch.status && patch.status !== state.status) authVersion += 1
    Object.assign(state, patch)
    const snapshot = { ...state }
    for (const listener of listeners) listener(snapshot)
  }

  /** Read the current session state (a copy; callers cannot mutate it). */
  function getState() {
    return { ...state }
  }

  /** Subscribe to session-state changes; returns an unsubscribe function. */
  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /**
   * Initialize/restore the session once. Fires asynchronously and NEVER
   * rejects: an authentication failure is recorded on the state and the local
   * application proceeds — an auth failure must never become a boot failure.
   * Resolves to the settled AuthState.
   */
  function initSession() {
    if (!initPromise) {
      initPromise = adapter.init()
        .then((user) => {
          if (user && typeof user === 'object') {
            setState({ status: 'authenticated', user, error: null })
            // Boot-triggered session rotation (approved trigger #1): refresh
            // the freshly-restored session so the server extends the session
            // expiry. Fire-and-forget — refreshSession() never rejects and a
            // failed rotation must never fail the boot.
            refreshSession()
          } else {
            setState({ status: 'anonymous', user: null, error: null })
          }
        })
        .catch((err) => {
          // Keep the current status (unknown at boot). Do not pretend to be
          // anonymous when the provider was unreachable; record the error so
          // a future UI can surface it. A retry path is a later-phase concern
          // (would require a reset/retry hook; the memory adapter never fails
          // in production in Phase 2A). Local mode is unaffected.
          setState({ error: messageOf(err) })
        })
    }
    return initPromise
  }

  /**
   * Rotate the authenticated session server-side (approved triggers: after
   * successful boot init; on visibility resume). Policy:
   *  - authenticated → adapter.refresh(); on success the user is unchanged
   *    (rotation only replaces the server cookie, never the identity).
   *  - refresh fails with error code 'SESSION_EXPIRED' (adapter saw 401) →
   *    settle safely to anonymous INSTEAD: a genuinely expired/revoked session
   *    must not keep pretending to be authenticated. Only when the state is
   *    still the exact authentication this rotation started for — a stale
   *    result must never log out a NEWER, valid authentication (logout then
   *    re-login, or a different user, during the request bumps authVersion).
   *  - refresh fails for infrastructure reasons (network/503) → keep the
   *    current authenticated state — never end a possibly-valid session on a
   *    transient failure — and record the error (also only for the same
   *    authentication).
   *  - concurrent calls while a rotation is in flight for the SAME
   *    authentication share that single request (exactly one
   *    adapter.refresh()); a rotation started for a newer authentication is
   *    never shared with an older in-flight one.
   *  - not authenticated → no-op (never rotates an anonymous state).
   * Never rejects. Never touches local data — auth-only, exactly like logout.
   * @returns {Promise<boolean>} true when the rotation succeeded
   */
  async function refreshSession() {
    if (typeof adapter.refresh !== 'function') return false
    if (state.status !== 'authenticated' || !state.user) return false

    // In-flight dedupe for the SAME authentication: return the shared rotation.
    if (refreshInFlight && refreshInFlightVersion === authVersion) return refreshInFlight

    const versionAtStart = authVersion
    const userAtStart = state.user
    const promise = (async () => {
      try {
        await adapter.refresh()
        return true
      } catch (err) {
        if (err && err.code === 'SESSION_EXPIRED') {
          // Stale-result protection: the session is only ended when the state
          // is still the exact authentication we started with. Any logout /
          // re-login / different-user transition during the request bumped
          // authVersion — a stale 401 must never destroy a newer valid session.
          if (state.status === 'authenticated' && state.user === userAtStart && authVersion === versionAtStart) {
            setState({ status: 'anonymous', user: null, error: null })
          }
          return false
        }
        // Infrastructure failure: keep the authenticated state; annotate the
        // error only on the same authentication (never on a newer one).
        if (state.status === 'authenticated' && state.user === userAtStart && authVersion === versionAtStart) {
          setState({ error: messageOf(err) })
        }
        return false
      } finally {
        if (refreshInFlight === promise) {
          refreshInFlight = null
          refreshInFlightVersion = null
        }
      }
    })()
    refreshInFlight = promise
    refreshInFlightVersion = versionAtStart
    return refreshInFlight
  }

  /**
   * Resolve when any in-flight rotation for the CURRENT authentication has
   * settled. Never starts a rotation — callers that must not rotate (e.g. the
   * 30s sync poll) proceed immediately. Sync runs await this before pulling:
   * a server rotation is revoke-then-create, so a sync request dispatched at
   * the same time presents the just-revoked cookie and 401s the pull.
   * @returns {Promise<boolean>} the rotation's outcome, or true when no
   *   rotation is in flight
   */
  function waitForRotation() {
    if (refreshInFlight && refreshInFlightVersion === authVersion) return refreshInFlight
    return Promise.resolve(true)
  }

  /** Establish an authenticated session. Rejects on authentication failure. */
  async function login() {
    setState({ status: 'authenticating', user: null, error: null })
    try {
      const user = await adapter.login()
      setState({ status: 'authenticated', user, error: null })
      return user
    } catch (err) {
      setState({ status: 'anonymous', user: null, error: messageOf(err) })
      throw err
    }
  }

  /**
   * Authentication-only logout: clears the session state and NOTHING else.
   * Must never clear IndexedDB, links, folders, profile, settings, migrations
   * or backups — logout is authentication-only by construction.
   */
  async function logout() {
    try {
      await adapter.logout()
      setState({ status: 'anonymous', user: null, error: null })
    } catch (err) {
      // Session could not be revoked at the adapter: keep the current status
      // and record the error. Local data is untouched either way.
      setState({ error: messageOf(err) })
      throw err
    }
  }

  return { getState, subscribe, initSession, login, logout, refreshSession, waitForRotation }
}

// Application singleton. Phase A: the real HTTP adapter talks to the existing
// Cloudflare Worker OAuth + session endpoints. init() restores the
// authenticated account via GET /api/me on boot (persistent session across
// reloads); logout() revokes it via POST /auth/logout. Sign-in is a top-level
// provider OAuth redirect (Google primary, GitHub supported) initiated by
// accountService.signIn(provider) — the identity is
// restored by initSession() after the callback, then state becomes
// authenticated. session.login() is not the UI sign-in path for OAuth (see
// http-adapter.login()).
export const session = createSession(createHttpAdapter())

/** Non-blocking application entry point: initialize the app session async. */
export function initSession() {
  return session.initSession()
}