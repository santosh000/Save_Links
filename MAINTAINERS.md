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

Phase 3A additionally introduced a Workers project (`wrangler.jsonc` + `worker/index.js`) that serves the exact same `dist/` build as static assets behind a Worker boundary. It is the target runtime for the future authentication work (Phase 3C) but currently has no server routes:

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