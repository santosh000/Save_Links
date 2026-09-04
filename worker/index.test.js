// @vitest-environment node
//
// Phase 3C — Worker entry routing (worker/index.js). Proves:
//   - /auth/* reaches the Worker handlers (Worker-first, before ASSETS)
//   - per-route methods: GET /auth/github/login, GET /auth/github/callback,
//     GET /auth/me, POST /auth/logout — wrong methods get 405 + Allow
//   - every other path — including SPA fallbacks like /sw.js — stays on the
//     Phase 3A assets boundary and never invokes Worker code
import { describe, it, expect, vi } from 'vitest'
import worker from './index.js'
import { createTestDb } from './db/d1-facade.js'

function makeEnv(overrides = {}) {
  return {
    // deliberately NO OAuth secrets: routing is proven by the safe 503 path,
    // which still proves the route hit the Worker and not the SPA fallback
    DB: {},
    ASSETS: { fetch: vi.fn(async (request) => new Response(`ASSET:${new URL(request.url).pathname}`)) },
    ...overrides,
  }
}

const WITH_DB = { DB: createTestDb() }

describe('worker routing', () => {
  it('routes GET /auth/github/login to the Worker (503 without secrets = route reached)', async () => {
    const env = makeEnv()
    const res = await worker.fetch(new Request('http://localhost:8787/auth/github/login'), env)
    expect(res.status).toBe(503)
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('routes GET /auth/github/callback to the Worker (503 without secrets = route reached)', async () => {
    const env = makeEnv()
    const res = await worker.fetch(new Request('http://localhost:8787/auth/github/callback'), env)
    expect(res.status).toBe(503)
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('rejects non-GET on /auth/* with 405 and Allow: GET', async () => {
    const env = makeEnv()
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await worker.fetch(new Request('http://localhost:8787/auth/github/login', { method }), env)
      expect(res.status, method).toBe(405)
      expect(res.headers.get('allow')).toBe('GET')
      expect(env.ASSETS.fetch).not.toHaveBeenCalled()
    }
  })

  it('routes GET /auth/me to the Worker (401 without a cookie = route reached)', async () => {
    const env = makeEnv(WITH_DB)
    const res = await worker.fetch(new Request('http://localhost:8787/auth/me'), env)
    expect(res.status).toBe(401)
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('routes POST /auth/logout to the Worker (200 with no cookie = route reached)', async () => {
    const env = makeEnv(WITH_DB)
    const res = await worker.fetch(new Request('http://localhost:8787/auth/logout', { method: 'POST' }), env)
    expect(res.status).toBe(200)
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('enforces per-route methods: /auth/me is GET-only, /auth/logout is POST-only', async () => {
    const env = makeEnv(WITH_DB)
    const postMe = await worker.fetch(new Request('http://localhost:8787/auth/me', { method: 'POST' }), env)
    expect(postMe.status).toBe(405)
    expect(postMe.headers.get('allow')).toBe('GET')

    const getLogout = await worker.fetch(new Request('http://localhost:8787/auth/logout'), env)
    expect(getLogout.status).toBe(405)
    expect(getLogout.headers.get('allow')).toBe('POST')

    const putLogout = await worker.fetch(new Request('http://localhost:8787/auth/logout', { method: 'PUT' }), env)
    expect(putLogout.status).toBe(405)
    expect(putLogout.headers.get('allow')).toBe('POST')
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('keeps everything else on the assets boundary: / and real files', async () => {
    const env = makeEnv()
    for (const path of ['/', '/sw.js', '/manifest.webmanifest', '/assets/app-abc123.js', '/some/spa/route']) {
      const req = new Request(`http://localhost:8787${path}`)
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(200)
      expect(env.ASSETS.fetch).toHaveBeenLastCalledWith(req)
    }
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(5)
  })
})