# Contributing to Save_Links

Thank you for contributing! This guide covers the development workflow and expectations.

## Getting Started

```bash
git clone https://github.com/santosh000/Save_Links.git
cd Save_Links
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`.

## Development Workflow

1. **Inspect before changing** — read the relevant files and understand the existing implementation
2. **Keep changes scoped** — do one logical thing per change; small focused diffs are easier to review
3. **Reuse existing abstractions** — check for helpers, types, or patterns already in the codebase before writing new ones
4. **Run relevant tests** — `npm test` for unit tests, `npm run test:e2e` for end-to-end
5. **Run build when appropriate** — `npm run build` to verify the production build works
6. **Inspect the final diff** — `git diff --check` and `git diff` before considering work done

## Local-First Rule (Critical)

> **Authentication and cloud services must never become a prerequisite for local/offline use.**

Contributors must not introduce changes that make local data dependent on authentication or network availability. The IndexedDB store, PWA offline support, and local application behavior must remain fully functional without any cloud connectivity.

## Testing

```bash
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end tests (Playwright)
npm run build      # production build verification
```

All checks must pass before a pull request is ready.

## Pull Requests

Please describe in your PR:

- **What changed** — the files and the nature of the change
- **Why** — the problem being solved or feature being added
- **Tests performed** — which test suites were run and any manual verification
- **Migration/security implications** — any database migrations, security boundary changes, or authentication impacts

Keep PRs practical and focused. Large refactors should be split into multiple PRs.

## Code Style

- Follow the existing patterns in the codebase
- TypeScript-style JSDoc for public interfaces
- No unnecessary abstractions (interfaces with one implementation, factories for one product)
- Prefer standard library and platform features over dependencies