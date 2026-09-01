// Authentication contract — the provider-neutral seam between the application
// and any future authentication backend.
//
// This file mirrors the repository-contract style of src/storage/contract.js:
// a documented interface, not a runtime dependency. Nothing in the application
// (UI, composables, storage, domain, migration, backup) may import a provider;
// everything authentication-related flows through the session abstraction
// (src/auth/session.js), which talks to an AuthAdapter.
//
// Boundary rules:
// - An AuthAdapter may implement ONLY this contract. It never sees domain
//   records, the repository, IndexedDB, migration or backup code.
// - The session abstraction never exposes secrets (tokens, credentials,
//   cookies) to the rest of the application. AuthUser and AuthState contain
//   identity information only.
// - The application knows nothing about providers: no provider terminology,
//   no database concepts, no synchronization concepts.

/**
 * Authenticated identity — the minimum provider-neutral identity information
 * the application needs. Never contains tokens, credentials, provider
 * specifics, device/sync ids, or account data.
 *
 * @typedef {Object} AuthUser
 * @property {string} id            — stable opaque account id (provider-issued
 *                                    in future phases; fake value today)
 * @property {string} name          — display name
 * @property {string|null} [email]  — email address if the provider supplies one
 */

/**
 * Authentication status of the application session.
 * 'unknown'       — initialization/restore has not resolved yet
 * 'anonymous'     — no authenticated account exists (local mode)
 * 'authenticating'— a login attempt is in flight
 * 'authenticated' — an authenticated session is active
 *
 * @typedef {'unknown'|'anonymous'|'authenticating'|'authenticated'} AuthStatus
 */

/**
 * Application session state — what the session abstraction owns and exposes.
 * Distinct from AuthUser: AuthState is the application's current view of the
 * session, AuthUser is the authenticated identity inside it.
 *
 * @typedef {Object} AuthState
 * @property {AuthStatus} status
 * @property {AuthUser|null} user   — set only when status === 'authenticated'
 * @property {string|null} error    — last recorded authentication error
 *                                    message; null when no error is pending
 */

/**
 * AuthAdapter — the provider-agnostic boundary implemented by an
 * authentication backend (Phase 2A: only the in-memory adapter exists).
 *
 * All methods return Promises. Failures REJECT with an Error (or a value
 * whose message string is usable by the session abstraction).
 *
 *   init(): Promise<AuthUser|null>
 *     — restore any existing authenticated session (called once at startup).
 *       Resolves to the current user, or null when no session exists
 *       (anonymous). Rejection = initialization/restore failure — the session
 *       abstraction records the error and the local application proceeds
 *       unaffected.
 *
 *   login(): Promise<AuthUser>
 *     — establish an authenticated session. Resolves to the authenticated
 *       user. Rejection = authentication failure (no session established).
 *
 *   logout(): Promise<void>
 *     — clear the authenticated session. Rejection = revocation failure; the
 *       session abstraction records the error and keeps the current status
 *       (logout must NEVER touch local data — clearing IndexedDB, links,
 *       folders, profile, settings, migrations or backups is forbidden).
 */