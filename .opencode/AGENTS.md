# OpenCode Agent Instructions for Save_Links

## Project Identity

Save_Links is a local-first bookmark manager / PWA.

## Architecture

- **Frontend**: Vue 3 + Vite, IndexedDB local persistence, PWA/offline support via service worker
- **Worker**: Cloudflare Worker with static-assets binding
- **Database**: Cloudflare D1 (SQLite) for accounts, identities, sessions, OAuth state
- **Auth**: GitHub OAuth with PKCE, signed single-use state cookies

## Non-Negotiable Local-First Invariant

Authentication / cloud failure must never prevent local app boot or local operation.

The IndexedDB store, PWA offline support, and all local application behavior must remain fully functional without any cloud connectivity.

## Infrastructure Constraint

Current development targets Cloudflare Free-plan-compatible infrastructure.

Do not introduce paid infrastructure without explicit approval.

Do not introduce Supabase or another backend unless explicitly requested.

## Development Behavior

- Inspect first — read the relevant files before making changes
- Work in small chunks — one logical change at a time
- Avoid speculative abstractions — no interface with one implementation, no factory for one product
- Reuse existing helpers — check for utilities, types, patterns already in the codebase
- Don't weaken tests to make them pass — fix the code, not the test
- Validate after changes — run `npm test`, `npm run build`, `npm run test:e2e` as appropriate

## Git Safety

Never automatically:
- push
- deploy
- tag
- bump version

unless explicitly requested.

Never touch unrelated working-tree changes.

**Explicitly documented unrelated file:**
```
docs/screenshots/showcase.png
```
It must not be staged, reverted, modified, or committed unless explicitly requested.

## Security Behavior

Never:
- log secrets
- persist raw session tokens
- persist OAuth access tokens
- trust Host/X-Forwarded-* for security decisions
- introduce arbitrary OAuth redirects
- weaken fail-closed behavior

## Scope Discipline

Do only the requested chunk.

If safe implementation is impossible without changing architecture, stop and report the issue rather than weakening the design.