// Account service — the frontend boundary for the ONLINE account (the OAuth
// "cloud-sync account"), distinct from the local Profile identity.
//
// Real account backends: Google OAuth (primary) + GitHub OAuth via the
// Cloudflare Worker.
//   - signIn(provider) starts the provider's OAuth flow with a top-level
//     redirect to /auth/google/login or /auth/github/login. After the
//     callback, the Worker hands the browser an HttpOnly session cookie and
//     redirects to /, where initSession() -> GET /api/me restores the
//     authenticated account.
//   - signOut() revokes the session server-side (POST /auth/logout) through the
//     local session abstraction. Authentication-only; it never touches
//     IndexedDB, profile, links, folders, settings or backups.
//
// The previous username/password operations (register, forgotPassword,
// forgotUsername) were credential-backend dead-ends — no such endpoint exists
// in the Worker. They are removed (isolated to that change), per the
// architecture doc's "OAuth-only" boundary. Account identity comes exclusively
// from the authenticated server session (see http-adapter.js).
import { AUTH_LOGIN_PATHS } from './http-adapter.js'
import { session } from './session.js'

/** Begin provider OAuth sign-in (top-level redirect, never awaited). */
function navigateToOAuth(provider) {
  const path = AUTH_LOGIN_PATHS[provider]
  if (!path) throw new Error(`Unknown authentication provider: ${provider}`)
  if (typeof window !== 'undefined' && window.location) {
    window.location.assign(path)
  }
}

export const accountService = {
  /**
   * Begin provider OAuth sign-in. This is a full-page redirect; the caller's
   * promise is not awaited for the result — the authenticated account is
   * restored on the next boot via initSession() -> /api/me.
   * @param {'google'|'github'} [provider] default 'google' (primary provider).
   *   Non-string arguments (leftover username/password UI calls) are ignored
   *   and fall back to the Google flow — no credential is ever submitted.
   */
  signIn(provider = 'google') {
    navigateToOAuth(typeof provider === 'string' ? provider : 'google')
  },
  /** Revoke the authenticated session. Authentication-only. */
  signOut() {
    return session.logout()
  },
}
