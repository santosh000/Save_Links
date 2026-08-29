// Save_Links service worker — app-shell / static-asset caching ONLY.
//
// RESPONSIBILITY SPLIT (do not blur):
//   Service worker  -> app shell + static build assets (Cache Storage)
//   IndexedDB       -> links, folders, profile, settings (application data)
// User data is NEVER stored in this service worker or in Cache Storage.
//
// PRECACHE
//   The PRECACHE list below is filled at BUILD TIME by the
//   save-links:precache-shell plugin in vite.config.js with the actual hashed
//   /assets/* files the generated index.html references (plus the shell's
//   icons). The whole shell therefore lands in the cache during install — an
//   offline load can never reference an asset the cache does not hold, even
//   right after an update replaced the previous cache.
//
// CACHE STRATEGY
//   Navigation ('/'): network-first, fall back to the cached shell. An online
//   load refreshes the cached shell, so a deploy with new hashed assets never
//   serves a stale HTML document; a fully offline load still boots the app.
//   Static assets: cache-first (hashed filenames are immutable). Cross-origin
//   requests (the optional metadata fetch) are never intercepted and fail
//   gracefully on their own.
//
// UPDATE STRATEGY
//   The cache name is versioned under the save-links-shell- prefix. A new
//   deploy ships a changed sw.js; the browser notices it on the next
//   navigation, the new worker installs (precaching its complete asset set)
//   and calls skipWaiting() + clients.claim() so a single-window app is not
//   stuck on the old version, and activate() deletes ONLY obsolete caches
//   with the save-links-shell- prefix — unrelated Cache Storage entries from
//   other apps are never touched. No automatic reload loop: the current page
//   finishes its session on the old assets, the NEXT load is the new version.
//   Bump SHELL_CACHE when the precached set changes.
const SHELL_CACHE_PREFIX = 'save-links-shell-'
const SHELL_CACHE = 'save-links-shell-v2'
const PRECACHE = /*__PRECACHE__*/ []

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      // remove only obsolete Save_Links caches; never delete unrelated caches
      await Promise.all(
        keys
          .filter((k) => k.startsWith(SHELL_CACHE_PREFIX) && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // App shell: network-first, cached fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error()))
    )
    return
  }

  // Static assets: cache-first.
  const isStatic = url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname)
  if (!isStatic) return
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy))
        }
        return res
      })
    })
  )
})