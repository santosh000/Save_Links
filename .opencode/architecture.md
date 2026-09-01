# Save_Links Architecture

## Local Application

- **Framework**: Vue 3 + Vite
- **Local Persistence**: IndexedDB (via `src/storage/indexeddb.js`)
- **Data Abstraction**: Repository pattern (`src/storage/repository.js`) with domain models (`src/domain/link.js`)
- **Migrations**: Versioned schema migrations (`src/storage/migration.js`) applied on first launch
- **Backup/Export**: JSON export/import with version compatibility (`src/utils/backup.js`)
- **PWA/Offline**: Service worker (`public/sw.js`) caches shell assets; app works offline after first visit
- **Components**: Composable-based architecture (`src/composables/useLinks.js`, `useFolders.js`, `useProfile.js`, `useSettings.js`)

## Local-First Principle

User data remains in IndexedDB. The service worker caches only the application shell (HTML, JS, CSS, icons, manifest) — it does not become the user's data store. Cloud connectivity is optional; all CRUD operations work offline.

## Authentication

```
Browser
  ↓
Cloudflare Worker (static assets + API routes)
  ↓
GitHub OAuth (PKCE, no scopes requested)
  ↓
D1: account + identity + session storage
  ↓
HttpOnly session cookie (production: __Host- prefix)
```

### Security Properties

- **OAuth State**: Signed, expiring (10 min), HttpOnly cookie; single-use enforced via D1 `oauth_states` table (`INSERT OR IGNORE` claim)
- **PKCE**: `code_verifier` stays in signed state payload; never in D1
- **Approved Origins**: `APPROVED_ORIGINS` (comma-separated) is the sole source of truth for redirect destinations and origin validation; never derived from request headers
- **Session Hashing**: Only SHA-256 hash of the opaque bearer token persisted; raw token returned to browser once via cookie
- **Session Expiry/Revocation**: Enforced in SQL (`expires_at > now`, `revoked_at IS NULL`)
- **Production Cookie**: `__Host-save_links_session` — Secure, Path=/, HttpOnly, SameSite=Lax, no Domain (RFC 6265bis `__Host-`)
- **Dev Cookie**: `save_links_session_dev` — non-Secure fallback for `http://localhost` (browsers reject `__Host-` on insecure origins)

## API Boundary

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/auth/github/login` | GET | — | Start OAuth, set signed state cookie |
| `/auth/github/callback` | GET | OAuth state | Exchange code, create session, issue cookie |
| `/auth/me` | GET | Session cookie | Current identity (`{id, name, email}`) |
| `/auth/logout` | POST | Session cookie | Revoke session, clear cookies |
| `/api/me` | GET | Session cookie | API probe — `{authenticated: true, accountId}` or 401 |
| `/api/session/refresh` | POST | Session cookie + Origin | Rotate session — revoke old, issue fresh cookie |

Routing: `assets.run_worker_first: ["/auth/*"]` in `wrangler.jsonc` ensures navigation requests reach the Worker. Unknown `/api/*` routes return 404 (not SPA fallback).

## Security Boundaries

- **OAuth State**: Separate from session cookie; signed payload + D1 claim = single-use
- **PKCE**: Verifier never leaves signed HttpOnly payload; never in D1
- **Approved Origins**: Plaintext `vars`, fail-closed (empty → 503)
- **Session Hashing**: `crypto.subtle.digest('SHA-256')` — only hash in D1
- **Expiry/Revocation**: `expires_at > now` and `revoked_at IS NULL` in session query
- **Cookie Config**: Production `__Host-` (Secure, no Domain); Dev non-Secure fallback
- **Method Enforcement**: Per-route allow list with 405 + `Allow` header
- **Origin Gate**: `requireApiOrigin()` checks `Origin` header, falls back to `Referer`; validates against `APPROVED_ORIGINS`

## Cloud Data

> **Cloud application-data synchronization is not implemented yet.**

No cloud bookmark storage, no conflict resolution, no automatic sync, no cross-device synchronization. The D1 database currently stores only authentication-related data (accounts, provider identities, sessions, OAuth state tombstones).