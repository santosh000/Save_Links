# Save_Links Project State

## Current Version

`2.0.2`

## Current Repository Checkpoint

```
0b61073 feat(auth): finalize github oauth authentication
e30338b feat(auth): add authenticated api session boundary
```

## Current Status

The authentication and API infrastructure exists and is validated:

- GitHub OAuth authentication flow (`/auth/github/login`, `/auth/github/callback`)
- Session management (`/auth/me`, `/auth/logout`)
- Authenticated API boundary (`GET /api/me`, `POST /api/session/refresh`)
- PKCE, signed single-use OAuth state, approved-origin allowlist
- Session token hashing (SHA-256), HttpOnly cookies, rotation on auth
- All implemented in Cloudflare Worker with D1 persistence

**Cloud application-data synchronization has not been implemented.** The local application (Vue + IndexedDB) remains the primary and fully functional data store.

## Current Auth Capabilities

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/github/login` | GET | Initiate GitHub OAuth (sets signed state cookie) |
| `/auth/github/callback` | GET | Exchange code, create session, issue session cookie |
| `/auth/me` | GET | Return current authenticated identity (AuthUser shape) |
| `/auth/logout` | POST | Revoke session, clear session cookies |
| `/api/me` | GET | API boundary probe — 200 {authenticated, accountId} or 401 |
| `/api/session/refresh` | POST | Rotate session — revoke old, issue fresh cookie |

Security properties:
- Origin/Referer validation against `APPROVED_ORIGINS` for state-changing endpoints
- Session tokens never persisted raw (only SHA-256 hash in D1)
- Expired/revoked sessions rejected in SQL query
- Production `__Host-` cookie, dev `save_links_session_dev` fallback

## Current Testing Baseline

Latest validated results (at checkpoint `e30338b`):

- **Unit tests**: 450/450 pass
- **E2E tests**: 68/68 pass
- **Build**: green

## Known Repository Condition

```
docs/screenshots/showcase.png
```
has a pre-existing unrelated working-tree modification and must not be touched accidentally.

## Current Next Architectural Area

> Before implementing cloud synchronization, design the cloud data model and synchronization semantics carefully, especially identity, object IDs, timestamps/versioning, deletion handling, offline changes, conflict resolution, and backup/sync boundaries.

This is a project-state record, not the sync specification.