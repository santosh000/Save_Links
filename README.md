<p align="center">
  <img src="public/logo.png" alt="Save_Links" width="140" />
</p>

<h1 align="center">Save_Links</h1>

<p align="center">
  A fast, local-first bookmark manager for saving, organizing, searching, and backing up your links.
</p>

<p align="center">
  <img src="docs/screenshots/showcase.png" alt="Save_Links bookmark manager" width="100%" />
</p>

## Active development

Save_Links is under active development. Development builds — the latest code on the main branch, a feature branch, or the local dev server — may contain unfinished features, experimental changes, or bugs, and are not intended for normal everyday use.

For reliable, everyday use, use a **stable release** — see [Stable vs Development Builds](#stable-vs-development-builds).

## Stable vs Development Builds

| | Stable | Development |
| --- | --- | --- |
| Recommended for | everyday, reliable use | previewing and testing the latest work |
| Contains | verified, released features | the latest work in progress |
| May contain | — | unfinished features, bugs, or breaking changes |

- **Stable** — the current released version. It has passed the project's automated verification (unit and end-to-end tests) and is what you should use to actually save and organize your links.
- **Development** — the newest code, including work in progress. Features here can be incomplete, change, or disappear at any time. Use it to preview upcoming work or to contribute — not as a daily driver.

## Overview

Save_Links is a lightweight bookmark manager that runs entirely in your browser. Every bookmark you save lives on your device — there is no server, no account, and no cloud dependency. Paste a link and Save_Links takes care of the details: it normalizes the URL, fetches page metadata when it can, and organizes what you save into folders and categories so your links stay easy to find.

Your data is persisted in the browser's **IndexedDB** (older data saved by v1 versions is migrated safely on first launch), and because Save_Links is a **Progressive Web App**, the app shell and assets are precached by a service worker — the app loads and stays usable **offline**, and links can even be created, edited, and deleted while you're offline.

## Features

- **Save links** — add a bookmark in seconds; the URL is validated and normalized automatically
- **Automatic URL/source metadata handling** — title and description are fetched best-effort when available (never blocks saving)
- **Automatic categorization where currently supported** — domains like GitHub, YouTube, X/Twitter, Amazon, and others are tagged automatically; everything else falls into "Other"
- **Folders** — keep related links together; folders show live counts and can be renamed, deleted, or reorganized at any time
- **Favorites** — mark links you want quick access to
- **Important** — flag links that matter most
- **Must Have** — separate the links you can't live without
- **Search** — full-text search across every saved link
- **Filtering** — combine filters by flag (important, must have, favorites), category, folder, and status
- **Backup/export** — export all data to a JSON file
- **Import/restore** — restore from a backup file later, with validation, migration of older formats, and sanitization of untrusted fields
- **IndexedDB persistence** — every change is written instantly to the browser's IndexedDB; a page reload always reflects the latest state
- **PWA + offline support** — installable from the browser; the app shell and assets are precached by a service worker
- **Offline CRUD** — links can be created, edited, and deleted while offline (data lives only in IndexedDB, never in the service-worker cache)
- **Light/Dark/System appearance** — switch appearance freely; the choice persists across visits
- **Four color schemes** — change the accent color to match your taste

## App Preview

Save links quickly with automatic metadata and keep everything organized in one place.

<p align="center">
  <img src="docs/screenshots/save-link-form.png" alt="Save_Links save link form" width="100%" />
</p>

## Getting Started

### Prerequisites

- Node.js
- npm
- Git

### Run locally

```bash
git clone https://github.com/santosh000/Save_Links.git
cd Save_Links
npm install
npm run dev
```

The dev server is available at `http://localhost:5173` by default.

## 🗺️ Roadmap

### Completed

- [x] Local-first link management
- [x] IndexedDB runtime persistence
- [x] Safe migration of older localStorage data to IndexedDB
- [x] Backup and restore (including older v1 backup formats)
- [x] Search and filtering (status, category, folder)
- [x] Folders with live counts (create, rename, delete)
- [x] Responsive desktop/tablet/mobile UI
- [x] PWA manifest
- [x] Offline application shell
- [x] Offline CRUD
- [x] Service-worker asset precaching

### Future

- [ ] User authentication
- [ ] Cloud database
- [ ] Account-based backup
- [ ] Multi-device synchronization
- [ ] Sync queue
- [ ] Conflict resolution
- [ ] Desktop packaging
- [ ] Mobile packaging

## Tech stack

- **Vue 3** (Composition API, `<script setup>`)
- **Vite** for the dev server and production builds
- **IndexedDB** for runtime persistence, with a localStorage → IndexedDB migration path for older data
- **Service worker + PWA manifest** for installation and the offline application shell
- **Vitest + jsdom** for unit tests
- **Playwright** for browser end-to-end tests, including offline/PWA verification against the production build (runs against Chrome)

## Scripts

| Script | Description |
| ------ | ----------- |
| `npm run dev` | Start the Vite dev server |
| `npm test` | Run the unit test suite |
| `npm run test:e2e` | Run the Playwright end-to-end suite (uses a dedicated test server on port 5173) |
| `npm run build` | Create a static production build in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run deploy:production` | Build and deploy the stable build to Cloudflare Pages (`savelinks.pages.dev`) |
| `npm run deploy:preview` | Build and deploy to a Cloudflare Pages preview deployment |

## Deployment

Save_Links is deployed to **Cloudflare Pages** as static files (no server, no database).

- **Stable** — `npm run deploy:production` deploys the current build to the production URL: **https://savelinks.pages.dev**
- **Development** — `npm run deploy:preview` creates a **preview deployment**; Cloudflare generates a unique preview URL for each deployment. Preview deployments may contain unfinished changes and are for testing, not everyday use.

Deployments are manual — there is currently no GitHub integration and no CI/CD, so nothing deploys automatically. There is no permanent development URL; every preview deployment gets its own temporary URL.

## Storage & privacy

- **Runtime store: IndexedDB.** All application data — links, folders, profile, and settings — is persisted in your browser's IndexedDB. Nothing is sent anywhere: no analytics, no telemetry, no accounts.
- **localStorage is a migration/recovery source only.** Data that older v1 versions kept in localStorage is migrated safely into IndexedDB on first launch; localStorage is no longer the runtime store.
- **No user data in the service-worker cache.** The service worker caches only static application assets to power the offline shell. Your links are never written to Cache Storage.
- **The only external request** is the optional, best-effort metadata fetch for a URL you explicitly paste; metadata extraction happens client-side in your browser.
- **Backup & restore** — export all data to a JSON file and restore it later, which is also how you move data between browsers or machines.
- Clearing browser storage (or using a fresh profile) starts the app empty — keep a backup if you want to move or protect your links.