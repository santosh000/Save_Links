// Session abstraction — owns authentication state for the application and
// nothing else. It does NOT touch IndexedDB, links, folders, profile,
// settings, migration, backup or sync: it talks only to an AuthAdapter through
// the contract in src/auth/contract.js. The application observes this
// abstraction; it never observes a provider.

import { createMemoryAdapter } from './memory-adapter.js'

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

  function setState(patch) {
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

  return { getState, subscribe, initSession, login, logout }
}

// Application singleton. Phase 2A: the in-memory adapter is the only adapter —
// there is no authentication backend yet, so every session resolves to
// anonymous and login/logout are simulated only (never surfaced by the UI).
export const session = createSession(createMemoryAdapter())

/** Non-blocking application entry point: initialize the app session async. */
export function initSession() {
  return session.initSession()
}