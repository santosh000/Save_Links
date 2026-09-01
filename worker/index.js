// Save_Links Worker — Phase 3A: static-asset delivery boundary.
//
// Assets-first routing (no run_worker_first in wrangler.jsonc): requests that
// match a file in dist/ are served directly by the static-assets layer and this
// script is never invoked for them. Non-asset NAVIGATION requests are served
// index.html by not_found_handling: single-page-application — again without
// this script. It runs only for NON-navigation requests that match no asset,
// e.g. a client-side fetch() to an unknown path.
//
// There are no server routes yet (no authentication, no APIs, no database), so
// the only correct behavior is to defer to the assets binding, which applies
// the same routing rules (asset match -> asset, SPA fallback otherwise).
// Security headers are applied by public/_headers on the static-asset layer.
//
// Phase 3C will add /auth/* and /api/* handlers here (with their own headers on
// Worker-generated responses, per the static-assets headers docs) — this file
// is the future runtime host, not yet a backend.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request)
  },
}