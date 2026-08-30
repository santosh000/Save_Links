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

## Cloudflare Pages

The app is a static site hosted on Cloudflare Pages (direct upload). The two deploy scripts are defined in `package.json`:

- **Production:** `npm run deploy:production`
- **Preview:** `npm run deploy:preview`

- Production deploys the stable build to the existing Cloudflare Pages project.
- Preview creates a temporary Cloudflare Pages preview deployment with its own URL.
- Do not use `wrangler deploy`.
- The project uses Cloudflare Pages direct upload, not a Worker. Do not create a separate Worker for Save_Links.

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
- Do not run `wrangler deploy`.
- Do not expose credentials in the repository.
- Keep user data and local-storage behavior backward compatible unless a migration is intentionally designed and tested.