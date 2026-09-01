// In-memory AuthAdapter for Phase 2A.
//
// Two roles:
// 1. TEST DOUBLE — simulates anonymous/authenticated sessions, login, logout
//    and initialization failure without any network, browser storage,
//    IndexedDB, localStorage, cookies or external dependencies.
// 2. CURRENT DEFAULT — the application has no authentication backend yet, so
//    the session singleton is created from this adapter and every session
//    resolves as anonymous (login/logout are simulated only and never exposed
//    by the UI).
//
// A real provider adapter (Cloudflare spike, later phase) implements the same
// contract from src/auth/contract.js and replaces this instance at creation.

/** @typedef {import('./contract.js').AuthUser} AuthUser */

/**
 * @param {Object} [options]
 * @param {AuthUser|null} [options.initialUser]  resolved by init() (default null = anonymous)
 * @param {boolean} [options.failInit]           make init() reject
 * @param {boolean} [options.failLogin]          make login() reject
 * @param {boolean} [options.failLogout]         make logout() reject
 * @param {AuthUser} [options.loginUser]         user returned by login()
 */
export function createMemoryAdapter(options = {}) {
  const {
    initialUser = null,
    failInit = false,
    failLogin = false,
    failLogout = false,
    loginUser = { id: 'memory-user', name: 'Memory User', email: null },
  } = options

  let user = initialUser

  return {
    init() {
      if (failInit) return Promise.reject(new Error('Memory adapter: initialization failed'))
      return Promise.resolve(user)
    },
    login() {
      if (failLogin) return Promise.reject(new Error('Memory adapter: login failed'))
      user = user || { ...loginUser }
      return Promise.resolve(user)
    },
    logout() {
      if (failLogout) return Promise.reject(new Error('Memory adapter: logout failed'))
      user = null
      return Promise.resolve()
    },
  }
}