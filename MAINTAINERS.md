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

## Deployment (Cloudflare Pages + Workers)

Production is still served by Cloudflare Pages direct upload at **savelinks.pages.dev** (currently v2.0.2). The two Pages scripts are defined in `package.json`:

- **Production:** `npm run deploy:production`
- **Preview:** `npm run deploy:preview`

- Production deploys the stable build to the existing Cloudflare Pages project.
- Preview creates a temporary Cloudflare Pages preview deployment with its own URL.

Phase 3A additionally introduced a Workers project (`wrangler.jsonc` + `worker/index.js`) that serves the exact same `dist/` build as static assets behind a Worker boundary. It is the target runtime for the authentication work (Phase 3C), which currently exists as the `/auth/*` OAuth spike (below); everything else is still pure asset serving:

- `npx wrangler dev` — run the Worker/static-assets boundary locally (build `dist/` first).
- `npm run deploy:worker` — deploys the Worker to its own `save-links.<account>.workers.dev` URL. This is a **non-production** preview environment; requests to static assets are free and unlimited on the Free tier, and the Worker script itself is not invoked on the asset-serving path. It deploys to whichever Cloudflare account `wrangler` is logged into (check with `wrangler whoami`); the Workers project name `save-links` is separate from the Pages project `savelinks`.
- `public/_headers` — security headers applied by both the Workers static-assets layer and Pages (same file format).

### D1 (Phase 3B: accounts + sessions)

The Worker binds the local D1 database `save-links-db` as `DB` (`wrangler.jsonc` → `d1_databases`). The browser never talks to D1; only the Worker-side data layer (`worker/db/store.js`) does, and it has no HTTP routes yet (Phase 3C adds them).

Local development (no Cloudflare credentials required):

```bash
npx wrangler d1 migrations apply save-links-db --local   # apply migrations/ to the local D1
npx wrangler d1 execute save-links-db --local --command "SELECT count(*) FROM users"
npx wrangler dev                                          # local Worker runtime with the local D1 binding
```

The data layer is unit-tested against real SQLite (`worker/db/store.test.js` runs `migrations/` through `node:sqlite`) — `npm test` covers it.

**Production setup (do NOT do this yet — no production D1 exists and none may be created by this repository until approved):** create the remote database (`npx wrangler d1 create save-links-db`), set its real `database_id` in `wrangler.jsonc` (currently a zero-UUID placeholder that intentionally makes `wrangler deploy` fail — a guard against deploying without a database), then apply migrations with `--remote`.

### GitHub OAuth (Phase 3C-1 spike + 3C-2 consumers: `/auth/github/login`, `/auth/github/callback`, `/auth/me`, `/auth/logout`)

Routes live in `worker/auth.js` (`worker/oauth/` holds the GitHub client and the signed OAuth-state cookie). Routing reaches them because `wrangler.jsonc` sets `assets.run_worker_first: ["/auth/*"]` — with the current `compatibility_date`, navigation requests otherwise never invoke the Worker script and would fall through to the SPA fallback. Methods are enforced per route in `worker/index.js`: `GET` for login/callback/me, `POST` for logout; anything else gets `405` + `Allow`. `/auth/me` and `/auth/logout` need no OAuth secrets — they consume only the session cookie + D1 — so authentication stays optional and the local app never depends on them.

**Secrets (Worker-side only — never in source, `public/`, frontend JS, or git history):**

| Name | Where | Purpose |
|------|-------|---------|
| `GITHUB_CLIENT_ID` | `.dev.vars` / `wrangler secret put` | OAuth app client id (public, but keep with the others) |
| `GITHUB_CLIENT_SECRET` | `.dev.vars` / `wrangler secret put` | OAuth app client secret — never leaves the Worker |
| `STATE_HMAC_SECRET` | `.dev.vars` / `wrangler secret put` | HMAC key signing the OAuth state payload (any long random string, e.g. `openssl rand -hex 32`) |
| `APPROVED_ORIGINS` | `.dev.vars` / `vars` (wrangler.jsonc or per-env, or dashboard Variables) | Comma-separated origins the deployment will accept for `/auth/*` — e.g. `http://localhost:8787` locally, `https://<host>` per preview/production (see below) |

`wrangler.jsonc` → `secrets.required` makes `wrangler deploy` (and `wrangler dev`) fail loudly if any of the three secrets is missing — auth must never ship half-configured. All three are required by both routes; the routes respond 503 "GitHub sign-in is not configured" otherwise. `APPROVED_ORIGINS` is **plaintext configuration**, so it ships as a `vars` entry, not a secret (see the empty default in `wrangler.jsonc`); a deployment with it unset or empty responds 503 and starts no OAuth flow — fail closed on purpose. Origin is always derived from this list, never from `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto`.

**Local development:**

```bash
# 1. build the SPA into dist/ (Worker serves it as static assets)
npm run build

# 2. create a GitHub OAuth App (Developer settings) — no scopes needed:
#    Homepage URL: http://localhost:8787/
#    Callback URL: http://localhost:8787/auth/github/callback   (exact match, no wildcard)
#    (OAuth callback URLs are matched exactly and allow no wildcards.)

# 3. put the three secrets and the allowlist into .dev.vars (gitignored;
#    {env}.dev.vars matching is supported for preview environments):
#    GITHUB_CLIENT_ID=...  GITHUB_CLIENT_SECRET=...  STATE_HMAC_SECRET=...
#    APPROVED_ORIGINS=http://localhost:8787
#    There is no .dev.vars.example — this format IS the documentation.

npx wrangler dev     # http://localhost:8787/auth/github/login
```

Production/preview use `wrangler secret put <NAME>` per environment for the three secrets, and the environment's `vars` (dashboard Variables or a `[env.<name>].vars` block) for `APPROVED_ORIGINS` — `vars` are non-inheritable, so each environment must set its own. Each environment's OAuth app must register its own callback URL (`https://<host>/auth/github/callback`) exactly, and `<host>` must also be on that environment's `APPROVED_ORIGINS` — Pages-proxied Workers and preview URLs each need their own GitHub OAuth App + allowlist entry. (When a top-level empty `APPROVED_ORIGINS` var exists alongside `secrets`, local dev must still set it in `.dev.vars`; the empty default only ever fails the route closed, never opens it.)

**Details worth knowing:**

- **Scope:** the flow requests NO GitHub scope. GitHub's "(no scope)" grants read-only access to public profile info, which is all identity needs. The provider subject is GitHub's stable numeric `id` (<user id as String>); `login` is display-only. A user who previously granted scopes to this app may get them again when scope is omitted — the access token is exchanged, used for the identity call, and discarded within the callback, so this is harmless (no token is ever stored or returned to the browser).
- **CSRF + single-use state:** OAuth `state` + PKCE `code_verifier` travel in a signed, expiring (10-minute, matching GitHub code lifetime) HttpOnly payload (`worker/oauth/state.js`). Phase 3C-2 Chunk 3 adds single-use enforcement (`migrations/0002_oauth_states.sql`): the callback claims the opaque `state` in D1's `oauth_states` via `INSERT OR IGNORE` — the first presentation wins, any replay (even after a claimed-but-failed callback, even with a fresh code) is rejected before any GitHub exchange. The claim row is a persistent tombstone (deleting it on claim would let a replay win again); `login` opportunistically sweeps expired tombstones (`deleteExpiredOAuthStates`), so the table stays a rolling ~10-minute window of attempts. Only the opaque random state is stored — the PKCE verifier never leaves the signed HttpOnly payload, and no token ever touches the table. The `oauth_state` payload is a DIFFERENT security object from the authenticated session cookie — signed, short-lived, only gates the OAuth round trip; never a credential. Once a callback accepts and consumes a state (success or later failure), the route emits a deletion cookie for `oauth_state` (Max-Age=0) alongside its response; when verification itself failed, nothing is cleared — an attacker firing a bogus callback cannot erase a victim's state. The GitHub `redirect_uri` and the post-auth destination are ALWAYS derived from `APPROVED_ORIGINS` (never from request host headers), so the flow can never be redirected to an unregistered callback URL.
- **Account mapping:** `resolveAccountByProvider` (`worker/db/store.js`) creates `users` + `auth_identities` rows in one D1 `batch` (atomic); a concurrent callback for the same identity loses the batch to a PRIMARY KEY conflict and re-resolves the winner — one GitHub id maps to exactly one account, never merged, never duplicated.
- **Session:** Phase 3B model — D1 stores only the SHA-256 hash of the opaque bearer token; the browser gets the raw token once in an HttpOnly cookie. Production (HTTPS) uses `__Host-save_links_session` with `Secure`, `Path=/`, and no `Domain`, satisfying RFC 6265bis `__Host-` exactly. Plain-HTTP local dev uses a deliberate exception: browsers reject `__Host-` cookies from insecure origins, so `wrangler dev` sets a non-Secure `save_links_session_dev` fallback instead — production never uses it. Rotation: every successful GitHub auth creates a brand-new random session and revokes any session the browser previously held; a pre-existing session can never become the authenticated one. Session consumers (Phase 3C-2): `GET /auth/me` resolves the presented cookie to an AuthUser-shaped identity (`{ id: users.account_id, name, email }`, uniform 401 when unauthenticated, never a server error) and `POST /auth/logout` revokes the session + clears both cookie names, idempotently succeeding for valid/expired/already-revoked/missing cookies. Logout cookie-clearing is emitted only when a session cookie was presented — with SameSite=Lax withholding cookies on cross-site POSTs, no deletion Set-Cookie means a cross-site logout attempt can neither revoke nor erase the victim's session; the full CSRF token budget remains a later chunk. **Display-name gap (reported, not fixed):** the D1 `users` schema stores only `account_id`/`created_at` — no display name — so `/auth/me` returns `name: ''`. Populating a real name requires a profile column (later design decision, explicitly out of the 3C-2 chunks so far). Session cookie is one per fresh sign-in; failures never issue a session.
- **Rate limiting:** Workers Rate Limiting bindings exist but the spike does not add one (free-tier availability unconfirmed in official docs). Revisit in 3C-2.
- **Offline:** the flow touches GitHub servers; the PWA/local-first/last-render behavior is unchanged. The service worker only caches shell assets and never intercepts `/auth/*`.

Do not deploy the new Worker architecture to production (`savelinks.pages.dev`) until explicitly instructed.

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
- Do not run `wrangler deploy` against the production Pages project; the Workers project (`save-links`) is a separate, non-production preview environment until explicitly approved for production.
- Do not expose credentials in the repository.
- Keep user data and local-storage behavior backward compatible unless a migration is intentionally designed and tested.