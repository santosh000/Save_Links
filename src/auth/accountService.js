// Account service — the frontend boundary for ONLINE account operations
// (cloud-sync account), distinct from the local Profile identity.
//
// The application has NO real username/password backend connected to the
// frontend today:
//   - The Worker/API exposes only GitHub OAuth (/auth/github/*) plus session
//     validation; there is no username/password register/login endpoint.
//   - The frontend session singleton (src/auth/session.js) is backed by an
//     in-memory adapter whose login() is a TEST DOUBLE — it must NOT be reached
//     by the real UI (that would fake authentication).
//
// So the credential-backed operations below are the identified backend
// integration points. They are INTENTIONALLY not wired to any fake success:
// until a real (HTTP) adapter exists for each, they reject with
// AccountUnavailableError. The UI reports this honestly instead of falsely
// signing the user in.
//
// Only signOut() is real today — it operates on the local session abstraction
// (revokes the in-memory/authenticated session) and needs no cloud backend.
//
// Backend integration map (future wiring, one seam per operation):
//   signIn          -> POST /auth/login
//   register        -> POST /auth/register
//   forgotPassword  -> POST /auth/password/forgot  (secure, time-limited token)
//   forgotUsername  -> POST /auth/username/forgot
//   signOut         -> POST /auth/logout (already real via session.logout)
import { session } from './session.js'

export class AccountUnavailableError extends Error {
  constructor(message = 'Online account services are not set up yet') {
    super(message)
    this.name = 'AccountUnavailableError'
    this.code = 'ACCOUNT_UNAVAILABLE'
  }
}

function unavailable() {
  return Promise.reject(new AccountUnavailableError())
}

export const accountService = {
  /** @param {{ usernameOrEmail: string, password: string }} credentials */
  signIn(credentials) {
    return unavailable()
  },
  /** @param {{ username: string, email: string, password: string }} info */
  register(info) {
    return unavailable()
  },
  /** @param {{ usernameOrEmail: string }} info */
  forgotPassword(info) {
    return unavailable()
  },
  /** @param {{ email: string }} info */
  forgotUsername(info) {
    return unavailable()
  },
  /** Real: revokes the local authenticated session. */
  signOut() {
    return session.logout()
  },
}
