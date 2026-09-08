import { describe, it, expect, vi } from 'vitest'
import { createSession, session, initSession } from './session.js'
import { createMemoryAdapter } from './memory-adapter.js'

const ALICE = { id: 'user-1', name: 'Alice', email: 'alice@example.com' }

describe('session abstraction — initial state', () => {
  it('starts unknown/initializing before initialization resolves', () => {
    const s = createSession(createMemoryAdapter())
    expect(s.getState()).toEqual({ status: 'unknown', user: null, error: null })
  })
})

describe('session abstraction — initialization', () => {
  it('resolves to anonymous when the adapter has no session', async () => {
    const s = createSession(createMemoryAdapter())
    await s.initSession()
    expect(s.getState()).toEqual({ status: 'anonymous', user: null, error: null })
  })

  it('resolves to authenticated and exposes the user when the adapter restores one', async () => {
    const s = createSession(createMemoryAdapter({ initialUser: ALICE }))
    await s.initSession()
    const st = s.getState()
    expect(st.status).toBe('authenticated')
    expect(st.user).toEqual(ALICE)
    expect(st.error).toBeNull()
  })

  it('initialization is idempotent — repeated calls run once and settle to the same state', async () => {
    const base = createMemoryAdapter({ initialUser: ALICE })
    let initCalls = 0
    const counting = {
      init: () => { initCalls += 1; return base.init() },
      login: () => base.login(),
      logout: () => base.logout(),
    }
    const s = createSession(counting)
    await Promise.all([s.initSession(), s.initSession()])
    expect(initCalls).toBe(1) // the adapter's init() must be called exactly once
    expect(s.getState().status).toBe('authenticated')
  })
})

describe('session abstraction — login and logout', () => {
  it('login transitions authenticating → authenticated and exposes the user', async () => {
    const s = createSession(createMemoryAdapter())
    const seen = []
    s.subscribe((st) => seen.push(st.status))
    const user = await s.login()
    expect(user).toEqual({ id: 'memory-user', name: 'Memory User', email: null })
    expect(seen).toContain('authenticating')
    expect(seen).toContain('authenticated')
    expect(s.getState()).toEqual({ status: 'authenticated', user, error: null })
  })

  it('logout clears only the session — returns to anonymous', async () => {
    const s = createSession(createMemoryAdapter())
    await s.login()
    await s.logout()
    expect(s.getState()).toEqual({ status: 'anonymous', user: null, error: null })
  })

  it('logout is authentication-only: the abstraction surface contains no data operations', async () => {
    const s = createSession(createMemoryAdapter())
    await s.login()
    // The only surface session.js exposes is auth state — there is no way
    // for the abstraction (or a logout/refresh) to reach links/folders/profile/etc.
    expect(Object.keys(s).sort()).toEqual(['getState', 'initSession', 'login', 'logout', 'refreshSession', 'subscribe'])
    await s.logout()
    expect(s.getState().status).toBe('anonymous')
  })
})

describe('session abstraction — authentication errors', () => {
  it('records a login failure, returns to anonymous, and never touches local state', async () => {
    const s = createSession(createMemoryAdapter({ failLogin: true }))
    await expect(s.login()).rejects.toThrow('Memory adapter: login failed')
    const st = s.getState()
    expect(st.status).toBe('anonymous')
    expect(st.user).toBeNull()
    expect(st.error).toContain('login failed')
  })

  it('initialization failure must not fail the application boot: initSession resolves and records the error', async () => {
    const s = createSession(createMemoryAdapter({ failInit: true }))
    // Resolves (never rejects) — a local boot that calls initSession() and
    // awaits it is not blocked by an unreachable provider.
    await expect(s.initSession()).resolves.toBeUndefined()
    const st = s.getState()
    expect(st.error).toContain('initialization failed')
    // Status stays unknown: we do not pretend to be anonymous when the
    // provider could not be reached.
    expect(st.status).toBe('unknown')
  })

  it('logout failure keeps the current status and records the error', async () => {
    const s = createSession(createMemoryAdapter({ failLogout: true }))
    await s.login()
    await expect(s.logout()).rejects.toThrow('Memory adapter: logout failed')
    const st = s.getState()
    expect(st.status).toBe('authenticated')
    expect(st.error).toContain('logout failed')
  })
})

describe('session abstraction — subscriptions', () => {
  it('notifies subscribers on every state change and stops after unsubscribe', async () => {
    const s = createSession(createMemoryAdapter())
    const seen = []
    const unsubscribe = s.subscribe((st) => seen.push({ ...st }))
    await s.initSession()
    await s.login()
    expect(seen.length).toBeGreaterThanOrEqual(3) // unknown→anonymous→authenticating→authenticated
    expect(seen.map((st) => st.status)).toContain('anonymous')
    expect(seen.at(-1).status).toBe('authenticated')
    // snapshots are copies — mutating a received snapshot must not change state
    seen.at(-1).user = null
    expect(s.getState().user).not.toBeNull()
    // unsubscribe stops delivery
    unsubscribe()
    const before = seen.length
    await s.logout()
    expect(seen.length).toBe(before)
  })
})

describe('session abstraction — session refresh', () => {
  // Deferred-refresh adapter: holds a rotation in flight so a test can resolve
  // or reject it later and exercise concurrent/stale completions deterministically.
  function deferredRefreshAdapter() {
    const base = createMemoryAdapter({ initialUser: ALICE, loginUser: ALICE })
    const deferred = { resolve: null, reject: null }
    let refreshCalls = 0
    return {
      adapter: {
        init: () => base.init(),
        login: () => base.login(),
        logout: () => base.logout(),
        refresh: () => {
          refreshCalls += 1
          return new Promise((resolve, reject) => {
            deferred.resolve = resolve
            deferred.reject = reject
          })
        },
      },
      deferred,
      getCalls: () => refreshCalls,
    }
  }

  it('successful refresh keeps the authenticated user unchanged', async () => {
    const s = createSession(createMemoryAdapter({ initialUser: ALICE }))
    await s.initSession()
    expect(await s.refreshSession()).toBe(true)
    expect(s.getState().status).toBe('authenticated')
    expect(s.getState().user).toEqual(ALICE)
    expect(s.getState().error).toBeNull()
  })

  it('refresh 401 (expired/revoked, code SESSION_EXPIRED) settles safely to anonymous', async () => {
    const s = createSession(createMemoryAdapter({ initialUser: ALICE, expireOnRefresh: true }))
    await s.initSession()
    expect(await s.refreshSession()).toBe(false)
    expect(s.getState()).toEqual({ status: 'anonymous', user: null, error: null })
  })

  it('refresh infrastructure failure (503/network) keeps the authenticated state', async () => {
    const s = createSession(createMemoryAdapter({ initialUser: ALICE, failRefresh: true }))
    await s.initSession()
    expect(await s.refreshSession()).toBe(false)
    // Never end a possibly-valid session on a transient failure.
    expect(s.getState().status).toBe('authenticated')
    expect(s.getState().user).toEqual(ALICE)
    expect(s.getState().error).toContain('refresh failed')
  })

  it('refresh is a no-op when not authenticated', async () => {
    const s = createSession(createMemoryAdapter())
    await s.initSession()
    expect(s.getState().status).toBe('anonymous')
    expect(await s.refreshSession()).toBe(false)
    expect(s.getState().status).toBe('anonymous')
  })

  it('refresh is auth-only: it installs no timers and has no data-touching surface', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const s = createSession(createMemoryAdapter({ initialUser: ALICE }))
    await s.initSession()    // boot refresh runs once here
    await s.refreshSession() // explicit refresh on visibility resume
    expect(intervalSpy).not.toHaveBeenCalled() // no periodic background refresh
    intervalSpy.mockRestore()
    // Expiry transitions the auth state only — local data (IndexedDB links,
    // folders, etc.) is unreachable from the session abstraction by design:
    // the surface test above proves refreshSession is the only addition.
    const s2 = createSession(createMemoryAdapter({ initialUser: ALICE, expireOnRefresh: true }))
    await s2.initSession()
    await s2.refreshSession()
    expect(s2.getState().status).toBe('anonymous')
  })

  it('boot: initSession triggers exactly one server refresh when it restores a session; none when anonymous', async () => {
    let refreshCalls = 0
    const adapter = createMemoryAdapter({ initialUser: ALICE })
    const wrapped = {
      init: () => adapter.init(),
      login: () => adapter.login(),
      logout: () => adapter.logout(),
      refresh: () => { refreshCalls += 1; return adapter.refresh() },
    }
    const s = createSession(wrapped)
    await s.initSession()
    expect(s.getState().status).toBe('authenticated')
    expect(refreshCalls).toBe(1)

    const anon = createSession(createMemoryAdapter())
    await anon.initSession()
    expect(anon.getState().status).toBe('anonymous')
    expect(refreshCalls).toBe(1) // anonymous boot never refreshes
  })

  it('boot: a failed refresh must not fail initSession', async () => {
    const s = createSession(createMemoryAdapter({ initialUser: ALICE, failRefresh: true }))
    await expect(s.initSession()).resolves.toBeUndefined()
    expect(s.getState().status).toBe('authenticated')
    expect(s.getState().error).toContain('refresh failed')
  })

  it('concurrent refresh calls share ONE rotation (exactly one adapter.refresh())', async () => {
    const { adapter, deferred, getCalls } = deferredRefreshAdapter()
    const s = createSession(adapter)
    await s.login()
    const first = s.refreshSession()
    const second = s.refreshSession()
    expect(getCalls()).toBe(1) // deduped: one request for the same authentication
    deferred.resolve()
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    // Once the shared rotation completes, a later refresh rotates again.
    const third = s.refreshSession()
    expect(getCalls()).toBe(2)
    deferred.resolve()
    await expect(third).resolves.toBe(true)
  })

  it('concurrent callers share a failing rotation and settle once to anonymous', async () => {
    const { adapter, deferred, getCalls } = deferredRefreshAdapter()
    const s = createSession(adapter)
    await s.login()
    const first = s.refreshSession()
    const second = s.refreshSession()
    expect(getCalls()).toBe(1)
    deferred.reject(Object.assign(new Error('session expired'), { code: 'SESSION_EXPIRED' }))
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    expect(s.getState()).toEqual({ status: 'anonymous', user: null, error: null })
  })

  it('a stale SESSION_EXPIRED cannot tear down a NEWER valid authentication', async () => {
    const { adapter, deferred } = deferredRefreshAdapter()
    const s = createSession(adapter)
    await s.login()
    const stale = s.refreshSession() // rotation for the FIRST authentication
    await s.logout()
    await s.login() // newer valid authentication — same account, new session
    deferred.reject(Object.assign(new Error('session expired'), { code: 'SESSION_EXPIRED' }))
    await expect(stale).resolves.toBe(false)
    // The stale 401 must NOT log out the newer authentication.
    expect(s.getState().status).toBe('authenticated')
    expect(s.getState().user).toEqual(ALICE)
    expect(s.getState().error).toBeNull()
  })

  it('a refresh completing after logout keeps the logged-out state', async () => {
    const { adapter, deferred } = deferredRefreshAdapter()
    const s = createSession(adapter)
    await s.login()
    const pending = s.refreshSession()
    await s.logout()
    deferred.reject(Object.assign(new Error('session expired'), { code: 'SESSION_EXPIRED' }))
    await expect(pending).resolves.toBe(false)
    expect(s.getState()).toEqual({ status: 'anonymous', user: null, error: null })
  })

  it('an infrastructure-failed refresh after logout records no error on the anonymous state', async () => {
    const { adapter, deferred } = deferredRefreshAdapter()
    const s = createSession(adapter)
    await s.login()
    const pending = s.refreshSession()
    await s.logout()
    deferred.reject(new Error('network unavailable'))
    await expect(pending).resolves.toBe(false)
    expect(s.getState()).toEqual({ status: 'anonymous', user: null, error: null })
  })
})

describe('session abstraction — provider neutrality', () => {
  it('a user object contains only provider-neutral identity fields — no secrets', async () => {
    const s = createSession(createMemoryAdapter())
    await s.login()
    const user = s.getState().user
    expect(Object.keys(user).sort()).toEqual(['email', 'id', 'name'])
    expect(JSON.stringify(user)).not.toMatch(/token|secret|session|credential|password/i)
  })

  it('behaves identically regardless of the adapter implementation', async () => {
    // Two different adapters: the in-memory fake and a minimal custom adapter
    // shaped like a future backend. Same session logic, same state trajectory.
    const customAdapter = {
      init: () => Promise.resolve({ id: 'custom-1', name: 'Custom', email: 'custom@example.com' }),
      login: () => Promise.resolve({ id: 'custom-1', name: 'Custom', email: 'custom@example.com' }),
      logout: () => Promise.resolve(),
    }
    const trajectory = async (s) => {
      const statuses = []
      s.subscribe((st) => statuses.push(st.status))
      await s.initSession()
      await s.logout()
      return statuses
    }
    const fromMemory = await trajectory(createSession(createMemoryAdapter({ initialUser: ALICE })))
    const fromCustom = await trajectory(createSession(customAdapter))
    expect(fromCustom).toEqual(fromMemory)
  })
})

describe('fake in-memory adapter', () => {
  it('simulates anonymous, authenticated, login, logout, init and refresh', async () => {
    const anon = createMemoryAdapter()
    expect(await anon.init()).toBeNull()
    await expect(createMemoryAdapter({ failInit: true }).init()).rejects.toThrow('initialization failed')
    await expect(createMemoryAdapter({ failLogin: true }).login()).rejects.toThrow('login failed')
    await expect(createMemoryAdapter({ failLogout: true }).logout()).rejects.toThrow('logout failed')
    await expect(createMemoryAdapter({ failRefresh: true }).refresh()).rejects.toThrow('refresh failed')
    await createMemoryAdapter({ expireOnRefresh: true }).refresh().catch((err) => {
      expect(err.code).toBe('SESSION_EXPIRED')
    })

    const withUser = createMemoryAdapter({ initialUser: ALICE })
    expect(await withUser.init()).toEqual(ALICE)

    const auto = createMemoryAdapter()
    const u = await auto.login()
    expect(u).toEqual({ id: 'memory-user', name: 'Memory User', email: null })
    expect(await auto.init()).toEqual(u) // login persists in the fake
    await auto.logout()
    expect(await auto.init()).toBeNull()
  })
})

describe('application singleton', () => {
  it('restores anonymous on boot when the server reports no session (GET /api/me 401)', async () => {
    // The app-wide singleton now uses the real HTTP adapter (Phase A). A 401
    // from GET /api/me means no/expired/revoked session -> anonymous, and boot
    // never rejects.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(initSession()).resolves.toBeUndefined()
      const st = session.getState()
      expect(st.status).toBe('anonymous')
      expect(st.user).toBeNull()
      expect(st.error).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})