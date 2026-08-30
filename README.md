<p align="center">
  <img src="public/logo.png" alt="Save_Links" width="140" />
</p>

<h1 align="center">Save_Links</h1>

<p align="center">
  A fast, local-first bookmark manager. Save links, clean common tracking parameters, catch duplicates, and fill in titles and preview images when a site provides them — all in your browser.
</p>

<p align="center">
  <img src="docs/screenshots/showcase.png" alt="Save_Links bookmark manager" width="100%" />
</p>

## Stable vs Development Builds

Save_Links is under active development: the `master` branch always carries the latest unreleased work.

| | Stable | Development |
| --- | --- | --- |
| Recommended for | everyday, reliable use | previewing and testing the latest work |
| Contains | verified, released features | the latest work in progress |
| May contain | — | unfinished features, bugs, or breaking changes |

- **Stable** — the latest **released** version, verified by the project's automated tests and recommended for everyday use. The current stable release is v2.0.1, available at **https://savelinks.pages.dev** — normal users just open that address; no installation is required.
- **Development** — the latest **unreleased** code on the `master` branch, for developers and testers who want to preview upcoming work. It may contain unfinished features, bugs, or breaking changes, and there is currently **no permanent public development URL**. To run it locally:

  ```bash
  git clone https://github.com/santosh000/Save_Links.git
  cd Save_Links
  npm install
  npm run dev
  ```

  To test a local production build instead:

  ```bash
  npm run build
  npm run preview
  ```

  Temporary Cloudflare preview deployments may be created manually when needed for testing; they are never created automatically.

## Overview

Save_Links is a lightweight bookmark manager that runs entirely in your browser. Every bookmark you save lives on your device — there is no server, no account, and no cloud dependency. Paste a link and Save_Links takes care of the details: it cleans common tracking parameters, catches duplicates, fetches a title, description, and preview image when the site allows it, and organizes what you save into folders and categories so your links stay easy to find.

Your data is persisted in the browser's **IndexedDB** (older data saved by v1 versions is migrated safely on first launch), and because Save_Links is a **Progressive Web App**, the app shell and assets are precached by a service worker — the app loads and stays usable **offline**, and links can even be created, edited, and deleted while you're offline.

## Features

- **Save links** — add a bookmark in seconds; the URL is validated, normalized, and cleaned of common tracking parameters
- **Automatic metadata** — title, description, and preview image are filled in when a site provides them; saving is never blocked, and metadata is fetched in the background when needed
- **Duplicate detection** — if the cleaned URL is already saved, Save_Links offers **Replace existing**, **Add another**, or **Cancel**
- **Automatic categorization where currently supported** — domains like GitHub, YouTube, X/Twitter, Amazon, and others are tagged automatically; everything else falls into "Other"
- **Folders** — keep related links together; folders show live counts and can be renamed, deleted, or reorganized at any time
- **Favorites, Important, Must Have** — mark links for quick access and priority
- **Search** — full-text search across every saved link
- **Filtering** — combine filters by flag, category, folder, and status
- **Backup/export** — export all data to a JSON file
- **Import/restore** — restore from a backup file later, with validation, migration of older formats, and sanitization of untrusted fields
- **IndexedDB persistence** — every change is written instantly to the browser's IndexedDB; a page reload always reflects the latest state
- **PWA + offline support** — installable from the browser; the app shell and assets are precached by a service worker
- **Offline CRUD** — links can be created, edited, and deleted while offline (data lives only in IndexedDB, never in the service-worker cache)
- **Light/Dark/System appearance and four color schemes** — switch freely; your choice persists across visits
- **Responsive layouts** — clean desktop, tablet, and mobile layouts; on smaller screens the folders and filters/tools drawers open independently, one at a time

## URL cleaning

When you save a link, common tracking parameters are removed while normal functional parameters are kept. One example:

Original:
https://example.com/article?id=123&utm_source=newsletter&utm_campaign=spring

Saved:
https://example.com/article?id=123

## Duplicate links

If the cleaned URL you are saving is already in your collection, Save_Links lets you choose:

- **Replace existing** — update the saved link with the new details
- **Add another** — keep both copies
- **Cancel** — save nothing

The original URL you entered is still shown, while the saved navigation URL is the cleaned one.

## Metadata

Save_Links saves your link immediately — metadata never blocks saving. Title, description, and preview image are filled in when a site provides usable metadata, and retrieval happens in the background when needed. Some websites do not provide usable metadata or block browser requests (for example through browser/CORS restrictions or dynamically generated content), so not every link will have a description or preview image.

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

## Roadmap

### Completed

- [x] Local-first link management (IndexedDB persistence, offline PWA)
- [x] Safe migration of older localStorage data to IndexedDB
- [x] Backup and restore (including older backup formats)
- [x] Search and filtering (status, category, folder)
- [x] Folders with live counts (create, rename, delete)
- [x] URL cleaning of common tracking parameters
- [x] Duplicate detection with Replace / Add another / Cancel
- [x] Background metadata (title, description, preview image)
- [x] Responsive desktop/tablet/mobile UI with mutually exclusive drawers
- [x] PWA manifest, offline shell, and service-worker asset precaching

### Future

Near-term (local-only improvements):

- [ ] Sorting saved links
- [ ] Smart tag suggestions
- [ ] Improved metadata coverage and manual refresh
- [ ] Link health checking
- [ ] Bulk actions

Longer-term (accounts and sync):

- [ ] Authentication
- [ ] Cloud backup
- [ ] Multi-device synchronization
- [ ] Sync queue and conflict resolution
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
| `npm run test:e2e` | Run the Playwright end-to-end suite |
| `npm run build` | Create a static production build in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run deploy:production` | Build and deploy the stable build to Cloudflare Pages (`savelinks.pages.dev`) |
| `npm run deploy:preview` | Build and deploy to a temporary Cloudflare Pages preview deployment |

## Deployment

Save_Links is deployed to **Cloudflare Pages** as static files (no server, no database).

- **Stable** — `npm run deploy:production` builds and deploys to the production URL: **https://savelinks.pages.dev**
- **Development** — `npm run deploy:preview` creates a **temporary preview deployment**; Cloudflare generates a unique preview URL each time. Preview deployments are for testing, not everyday use.

Deployments are manual — there is currently no GitHub integration and no CI/CD, so nothing deploys automatically. There is no permanent development URL; every preview deployment gets its own temporary URL. (The Cloudflare Pages project's production branch is named `main` — a Cloudflare setting, unrelated to this repository's `master` branch.)

## Storage & privacy

- **Runtime store: IndexedDB.** All application data — links, folders, profile, and settings — is persisted in your browser's IndexedDB. It stays on your device; there is no account, no backend, and no cloud database. The Cloudflare-hosted website is only where the application is served from.
- **No analytics or telemetry.** Save_Links does not collect usage data.
- **localStorage is a migration/recovery source only.** Data that older v1 versions kept in localStorage is migrated safely into IndexedDB on first launch; localStorage is no longer the runtime store.
- **No user data in the service-worker cache.** The service worker caches only static application assets to power the offline shell. Your links are never written to Cache Storage.
- **The only external request** is the optional, best-effort metadata fetch for a URL you explicitly paste; metadata extraction happens client-side in your browser. Some websites prevent this because of browser/CORS restrictions or because their content is generated dynamically — in that case only your manually entered details are saved.
- **Backup & restore** — export all data to a JSON file and restore it later, which is also how you move data between browsers or machines.
- Clearing browser storage (or using a fresh profile) starts the app empty — keep a backup if you want to move or protect your links.