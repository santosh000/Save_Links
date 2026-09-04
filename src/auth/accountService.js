// Account service — the frontend boundary for the ONLINE account (the OAuth
// "cloud-sync account"), distinct from the local Profile identity.
//
// Phase A: the real account backend is GitHub OAuth via the Cloudflare Worker.
//   - signIn()  starts GitHub OAuth with a top-level redirect to
//               /auth/github/login. After the callback, the Worker hands the
//               browser an HttpOnly session cookie and redirects to /, where
//               initSession() -> GET /api/me restores the authenticated account.
//   - signOut() revokes the session server-side (POST /auth/logout) through the
//               local session abstraction. Authentication-only; it never
//               touches IndexedDB, profile, links, folders, settings or backups.
//
// The previous username/password operations (register, forgotPassword,
// forgotUsername) were credential-backend dead-ends — no such endpoint exists
// in the Worker. They are removed for Phase A (isolated to this change), per
// the architecture doc's "OAuth-only" boundary. Account identity comes
// exclusively from the authenticated server session (see http-adapter.js).
import { AUTH_LOGIN_PATH } from './http-adapter.js'
import { session } from './session.js'

function navigateToOAuth() {
  if (typeof window !== 'undefined' && window.location) {
    window.location.assign(AUTH_LOGIN_PATH)
  }
}

export const accountService = {
  /**
   * Begin GitHub OAuth sign-in. This is a full-page redirect; the caller's
   * promise is not awaited for the result — the authenticated account is
   * restored on the next boot via initSession() -> /api/me.
   * @param {any} [_credentials] accepted for backward call-shape only; unused.
   */
  signIn(_credentials) {
    navigateToOAuth()
  },
  /** Revoke the authenticated session. Authentication-only. */
  signOut() {
    return session.logout()
  },
}
