# Save_Links Maintainer Guide

This guide is for project maintainers: release, deployment, and verification procedures. Normal users and contributors should read the [README](README.md) instead.

## Development

Basic local setup:

```bash
git clone https://github.com/santosh000/Save_Links.git
cd Save_Links
npm install
npm run dev
```

The dev server is available at `http://localhost:5173` by default.

## Verification Before Release

Run the full check before release work continues:

- `npm test` — unit tests
- `npm run test:e2e` — end-to-end browser tests
- `npm run build` — production build
- `git diff --check` — whitespace and conflict-marker check
- `git status` — confirm a clean working tree

Release work only continues from a clean working tree with all checks green.

## Version and Release

General sequence:

1. Complete and verify the changes.
2. Update the application version in `package.json` and `package-lock.json`.
3. Commit the release preparation.
4. Push the release commit.
5. Create the version tag (annotated, e.g. `git tag -a v2.0.2 -m "..."`).
6. Create the GitHub Release with release notes.
7. Deploy the verified build to production.
8. Verify the live production site.

## Deployment (Cloudflare Workers + Pages)

**Production is the Worker deployment `save-links`** (`wrangler.jsonc` + `worker/index.js`): it serves the `dist/` build as static assets and handles the `/auth/*` and `/api/*` boundaries on one origin (`https://save-links.ucancallmesan.workers.dev`).

- `npm run deploy:worker` — builds `dist/` and runs `wrangler deploy`: THE production deployment command. It deploys to whichever Cloudflare account `wrangler` is logged into (check with `npx wrangler whoami`); the Worker project name `save-links` is separate from the legacy static Pages project `savelinks`.

The static Cloudflare Pages project (`savelinks.pages.dev`) is NOT the production backend — it serves a static-only build without auth or sync. Its two scripts in `package.json` upload static builds only:

- `npm run deploy:pages` — deploys the static build to the Pages project's production branch.
- `npm run deploy:pages:preview` — creates a temporary Cloudflare Pages preview deployment with its own URL.

Other tooling:

- `npx wrangler dev` — run the Worker/static-assets boundary locally (build `dist/` first).
- `public/_headers` — security headers applied by both the Workers static-assets layer and Pages (same file format).

### D1 (accounts + sessions + sync)

The Worker binds the D1 database `save-links-db` as `DB` (`wrangler.jsonc` → `d1_databases`; the `database_id` there is the production database). The browser never talks to D1; only the Worker-side data layer (`worker/db/store.js`) does, behind the `/auth/*` and `/api/*` routes.

Local development (no Cloudflare credentials required):

```bash
npx wrangler d1 migrations apply save-links-db --local   # apply migrations/ to the local D1
npx wrangler d1 execute save-links-db --local --command "SELECT count(*) FROM users"
npx wrangler dev                                          # local Worker runtime with the local D1 binding
```

The data layer is unit-tested against real SQLite (`worker/db/store.test.js` runs `migrations/` through `node:sqlite`) — `npm test` covers it.

**Production D1:** the remote database `save-links-db` already exists (its real `database_id` is set in `wrangler.jsonc`), and migrations 0001–0004 are applied. New migrations are applied with `npx wrangler d1 migrations apply save-links-db --remote`.

### OAuth (Google primary + GitHub): /auth/google/*, /auth/github/*, /auth/me, /auth/logout

Routes live in `worker/auth.js` (`worker/oauth/` holds the Google + GitHub clients and the signed OAuth-state cookie). Routing reaches them because `wrangler.jsonc` sets `assets.run_worker_first: ["/auth/*", "/api/*"]` — with the current `compatibility_date`, navigation requests otherwise never invoke the Worker script and would fall through to the SPA fallback. Methods are enforced per route in `worker/index.js`: `GET` for login/callback/me, `POST` for logout; anything else gets `405` + `Allow`. `/auth/me` and `/auth/logout` need no OAuth secrets — they consume only the session cookie + D1 — so authentication stays optional and the local app never depends on them.

**Secrets (Worker-side only — never in source, `public/`, frontend JS, or git history):**

| Name | Where | Purpose |
|------|-------|---------|
| `GOOGLE_CLIENT_ID` | `.dev.vars` / `wrangler secret put` | Google OAuth app client id (public, but keep with the others) |
| `GOOGLE_CLIENT_SECRET` | `.dev.vars` / `wrangler secret put` | Google OAuth app client secret — never leaves the Worker |
| `GITHUB_CLIENT_ID` | `.dev.vars` / `wrangler secret put` | GitHub OAuth app client id (public, but keep with the others) |
| `GITHUB_CLIENT_SECRET` | `.dev.vars` / `wrangler secret put` | GitHub OAuth app client secret — never leaves the Worker |
| `STATE_HMAC_SECRET` | `.dev.vars` / `wrangler secret put` | HMAC key signing the OAuth state payload (any long random string, e.g. `openssl rand -hex 32`) |
| `APPROVED_ORIGINS` | `.dev.vars` / `vars` (wrangler.jsonc or per-env, or dashboard Variables) | Comma-separated origins the deployment will accept for `/auth/*` and `/api/*` — e.g. `http://localhost:8787` locally, `https://<host>` per environment (see below) |

`wrangler.jsonc` → `secrets.required` makes `wrangler deploy` fail loudly if any of the five secrets is missing — auth must never ship half-configured. Each provider's login/callback routes require that provider's client pair together with `STATE_HMAC_SECRET`; with a missing pair they respond 503 "<Provider> sign-in is not configured". `APPROVED_ORIGINS` is **plaintext configuration**, so it ships as a `vars` entry, not a secret (see the empty default in `wrangler.jsonc`); a deployment with it unset or empty responds 503 and starts no OAuth flow — fail closed on purpose. Origin is always derived from this list, never from `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto`.

**Local development:**

```bash
# 1. build the SPA into dist/ (Worker serves it as static assets)
npm run build

# 2. create an OAuth App for each provider you want to test (Developer
#    settings) — no scopes needed; Homepage URL http://localhost:8787/ and
#    callback URL http://localhost:8787/auth/<provider>/callback (github and/or
#    google; exact match, no wildcard).

# 3. put the five secrets and the allowlist into .dev.vars (gitignored;
#    {env}.dev.vars matching is supported for preview environments):
#    GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GITHUB_CLIENT_ID=...
#    GITHUB_CLIENT_SECRET=... STATE_HMAC_SECRET=...
#    APPROVED_ORIGINS=http://localhost:8787
#    There is no .dev.vars.example — this format IS the documentation.

npx wrangler dev     # http://localhost:8787/auth/github/login (or /auth/google/login)
```

Production/preview use `wrangler secret put <NAME>` per environment for the five secrets, and the environment's `vars` (dashboard Variables or a `[env.<name>].vars` block) for `APPROVED_ORIGINS` — `vars` are non-inheritable, so each environment must set its own. Each environment's OAuth apps must register their own callback URLs (`https://<host>/auth/github/callback` and/or `https://<host>/auth/google/callback`) exactly, and `<host>` must also be on that environment's `APPROVED_ORIGINS` — Pages-proxied Workers and preview URLs each need their own OAuth apps + allowlist entry. (When a top-level empty `APPROVED_ORIGINS` var exists alongside `secrets`, local dev must still set it in `.dev.vars`; the empty default only ever fails the route closed, never opens it.)

**Details worth knowing:**

- **Scope:** the flow requests NO GitHub scope. GitHub's "(no scope)" grants read-only access to public profile info, which is all identity needs. The provider subject is GitHub's stable numeric `id` (<user id as String>); `login` is display-only. A user who previously granted scopes to this app may get them again when scope is omitted — the access token is exchanged, used for the identity call, and discarded within the callback, so this is harmless (no token is ever stored or returned to the browser).
- **CSRF + single-use state:** OAuth `state` + PKCE `code_verifier` travel in a signed, expiring (10-minute, matching GitHub code lifetime) HttpOnly payload (`worker/oauth/state.js`). Single-use enforcement (`migrations/0002_oauth_states.sql`): the callback claims the opaque `state` in D1's `oauth_states` via `INSERT OR IGNORE` — the first presentation wins, any replay (even after a claimed-but-failed callback, even with a fresh code) is rejected before any GitHub exchange. The claim row is a persistent tombstone (deleting it on claim would let a replay win again); `login` opportunistically sweeps expired tombstones (`deleteExpiredOAuthStates`), so the table stays a rolling ~10-minute window of attempts. Only the opaque random state is stored — the PKCE verifier never leaves the signed HttpOnly payload, and no token ever touches the table. The `oauth_state` payload is a DIFFERENT security object from the authenticated session cookie — signed, short-lived, only gates the OAuth round trip; never a credential. Once a callback accepts and consumes a state (success or later failure), the route emits a deletion cookie for `oauth_state` (Max-Age=0) alongside its response; when verification itself failed, nothing is cleared — an attacker firing a bogus callback cannot erase a victim's state. The GitHub `redirect_uri` and the post-auth destination are ALWAYS derived from `APPROVED_ORIGINS` (never from request host headers), so the flow can never be redirected to an unregistered callback URL.
- **Account mapping:** `resolveAccountByProvider` (`worker/db/store.js`) creates `users` + `auth_identities` rows in one D1 `batch` (atomic); a concurrent callback for the same identity loses the batch to a PRIMARY KEY conflict and re-resolves the winner — one GitHub id maps to exactly one account, never merged, never duplicated.
- **Session:** Phase 3B model — D1 stores only the SHA-256 hash of the opaque bearer token; the browser gets the raw token once in an HttpOnly cookie. Production (HTTPS) uses `__Host-save_links_session` with `Secure`, `Path=/`, and no `Domain`, satisfying RFC 6265bis `__Host-` exactly. Plain-HTTP local dev uses a deliberate exception: browsers reject `__Host-` cookies from insecure origins, so `wrangler dev` sets a non-Secure `save_links_session_dev` fallback instead — production never uses it. Rotation: every successful OAuth sign-in (Google or GitHub) creates a brand-new random session and revokes any session the browser previously held; a pre-existing session can never become the authenticated one. Session consumers: `GET /auth/me` resolves the presented cookie to an AuthUser-shaped identity (`{ id: users.account_id, name, email }`, uniform 401 when unauthenticated, never a server error) and `POST /auth/logout` revokes the session + clears both cookie names, idempotently succeeding for valid/expired/already-revoked/missing cookies. Logout cookie-clearing is emitted only when a session cookie was presented — with SameSite=Lax withholding cookies on cross-site POSTs, no deletion Set-Cookie means a cross-site logout attempt can neither revoke nor erase the victim's session; the full CSRF token budget remains a later chunk. **Display-name gap (reported, not fixed):** the D1 `users` schema stores only `account_id`/`created_at` — no display name — so `/auth/me` returns `name: ''`. Populating a real name requires a profile column (later design decision, explicitly out of the 3C-2 chunks so far). Session cookie is one per fresh sign-in; failures never issue a session.
- **Rate limiting:** implemented in-worker on D1 (`worker/rate-limit.js`, migration `0004_rate_limits.sql`): the `auth` scope allows 30 requests/5 min per client IP, the `api` scope 120/min per account. Throttled requests get `429` + `Retry-After`; a throttled caller is issued no cookie, and storage errors fail open. Applied to the sign-in endpoints (`/auth/*`) and to every authenticated `/api/*` handler.
- **Offline:** the flow touches GitHub servers; the PWA/local-first/last-render behavior is unchanged. The service worker only caches shell assets and never intercepts `/auth/*`.

The production deployment is the Worker (`npm run deploy:worker`); deploy only from a verified, clean tree. The Pages project (`savelinks.pages.dev`) is static-only and not the production backend.

## Production Verification

After a production deployment, verify:

- The production URL responds successfully.
- The application loads.
- Current application assets are served.
- Major user flows work.
- No obvious layout or overflow problems.
- PWA/service-worker behavior still works.
- Saved links and existing local data remain intact.

## Important Rules

- Do not force-push release branches or history.
- Do not move an existing release tag.
- Do not deploy unverified changes to production.
- The production backend is the Worker (`save-links`, via `npm run deploy:worker`), not Pages. `wrangler pages deploy` (or the Pages scripts) uploads a static-only build and is never a production backend deployment.
- Do not expose credentials in the repository.
- Keep user data and local-storage behavior backward compatible unless a migration is intentionally designed and tested.