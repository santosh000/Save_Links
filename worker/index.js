// Save_Links Worker — Phase 3A static-asset boundary + Phase 3C OAuth spike +
// Phase 3C-2 session validation and logout.
//
// Routing (wrangler.jsonc): assets-first by default (free, unlimited asset
// serving; this script is not invoked for asset matches or SPA fallbacks —
// compatibility_date >= 2025-04-01 makes navigation requests prefer assets).
// The `assets.run_worker_first = ["/auth/*"]` pattern routes ONLY /auth/*
// navigation requests to this script; everything else keeps Phase 3A behavior.
//
// Routes (allowed methods enforced per route, 405 + Allow otherwise):
//   GET  /auth/github/login  -> start GitHub OAuth (signed state cookie)
//   GET  /auth/github/callback -> exchange code, identify, resolve account,
//                                 create session, hand out browser cookie
//   GET  /auth/me            -> current authenticated identity (AuthUser shape)
//   POST /auth/logout        -> revoke session + clear session cookie(s)
//   GET  /api/me             -> authenticated API boundary probe (200/401/503/500)
//   POST /api/session/refresh -> rotate session: revoke old, issue fresh cookie
//                                (200 {ok:true} | 401 | 403 | 503 | 500)
// Worker-generated responses carry their own security headers (public/_headers
// applies only to static-asset responses, not to script responses).
//
// Still NOT implemented (later phases): /api/* beyond /api/me and
// /api/session/refresh, session validation on app requests beyond these
// handlers, the HTTP AuthAdapter bridge, any frontend coupling, cloud sync.
import { handleOAuthLogin, handleOAuthCallback, handleAuthMe, handleAuthLogout } from './auth.js'
import { handleApiMe, handleApiSessionRefresh, handleApiSyncMutation } from './api.js'

const AUTH_ROUTES = new Map([
  ['/auth/github/login', { allow: ['GET'], handler: handleOAuthLogin }],
  ['/auth/github/callback', { allow: ['GET'], handler: handleOAuthCallback }],
  ['/auth/me', { allow: ['GET'], handler: handleAuthMe }],
  ['/auth/logout', { allow: ['POST'], handler: handleAuthLogout }],
])

const API_ROUTES = new Map([
  ['/api/me', { allow: ['GET'], handler: handleApiMe }],
  ['/api/session/refresh', { allow: ['POST'], handler: handleApiSessionRefresh }],
  ['/api/sync/mutation', { allow: ['POST'], handler: handleApiSyncMutation }],
])

function methodNotAllowed(allow) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: {
      Allow: allow.join(', '),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const route = AUTH_ROUTES.get(url.pathname) ?? API_ROUTES.get(url.pathname)
    if (route) {
      if (!route.allow.includes(request.method)) {
        return methodNotAllowed(route.allow)
      }
      return route.handler(request, env)
    }
    // Unknown /api/* path: the API is not the SPA — 404, never the index.html
    // fallback (an unknown API path must not be mistaken for a page load).
    if (url.pathname.startsWith('/api/')) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    return env.ASSETS.fetch(request)
  },
}