# Save_Link

Save_Link is a local-first bookmark app: store, organize, and search your links entirely in your browser. No account, no server, no tracking — your data never leaves your machine.

## Local-first architecture

Everything is stored in the browser's `localStorage` under namespaced keys (separate namespaces per environment: development, test, production). There is no backend. The app boots from local data and writes to it on every change, so a page reload always reflects the latest state.

## Main functionality

- **Add links** — paste a URL; title/description are fetched automatically when possible (best-effort, debounced, never blocks saving). Optional image and tags.
- **Organize** — folders (with counts), auto-categorization by domain (GitHub, YouTube, X/Twitter, Amazon, etc.), plus Unfiled and Favorites views.
- **Flag links** — independent **important**, **must have**, and **favorite** flags.
- **Search & filters** — full-text search; filter by status (important / must have / favorites / no favorite), category, and folder. Filters combine.
- **Edit & delete** — change any field, move to another folder, or remove a link.
- **Profile & stats** — optional profile name/bio shown in the header; dashboard with totals and per-category breakdown.
- **Appearance** — light / dark / system appearance, plus four color schemes (ocean, forest, sunset, lavender).
- **Backup & restore** — export all data to a JSON file, import it back later (with validation, migration of older formats, and sanitization of untrusted fields).

## Tech stack

- Vue 3 (Composition API, `<script setup>`)
- Vite (build + dev server)
- Vitest + jsdom (unit tests)
- Playwright (browser end-to-end tests)

## Install

```sh
npm install
```

The E2E suite runs against the installed **Chrome** browser (`channel: 'chrome'` in `playwright.config.js`).

## Development

```sh
npm run dev
```

Starts the Vite dev server (default `http://localhost:5173`).

## Unit tests

```sh
npm test
```

Runs the Vitest suite (app logic: URL normalization, categorization, metadata, storage/environment, backup v1/v2, composables).

## E2E tests

```sh
npm run test:e2e
```

Runs the Playwright suite against a dedicated test server (`vite --mode test`) on port 5173. Make sure port 5173 is free before running; the suite covers saving, editing, filtering, folders, backups, layout, and responsive behavior across desktop/tablet/mobile viewports.

## Build

```sh
npm run build
```

Produces a static production build in `dist/`. Preview it locally with `npm run preview`.

## Storage & privacy model

- All data lives in `localStorage` on your device, prefixed per environment.
- Nothing is sent anywhere: no analytics, no telemetry, no external requests except the optional best-effort metadata fetch of the URL you explicitly paste (metadata is extracted client-side in the browser).
- Clearing browser storage (or a fresh profile) starts the app empty. Use **Backup & restore** to move data between browsers or machines.

## Backup & restore

The **Data & backup** panel exports a JSON backup of everything (links, folders, profile, settings, appearance) and imports it back on demand. Imports are validated: wrong app identifier, unsupported versions, and malformed records are rejected; every imported field is sanitized (URLs are restricted to `http`/`https`, arbitrary fields are never executed). Both legacy (v1) and current (v2) formats are supported.

## Appearance & color options

Switch between **Light**, **Dark**, and **System** (follows OS preference), independently of the four **color schemes**. The choice persists across sessions.

## Project layout

```
src/            Application code (components, composables, utilities)
src/utils/      Pure logic: categorization, metadata, backup, storage, environment
e2e/            Playwright end-to-end tests
public/         Static assets (favicon, icons)
```