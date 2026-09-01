import { describe, it, expect } from 'vitest'
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
    // for the abstraction (or a logout) to reach links/folders/profile/etc.
    expect(Object.keys(s).sort()).toEqual(['getState', 'initSession', 'login', 'logout', 'subscribe'])
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
  it('simulates anonymous, authenticated, login, logout and init failure', async () => {
    const anon = createMemoryAdapter()
    expect(await anon.init()).toBeNull()
    await expect(createMemoryAdapter({ failInit: true }).init()).rejects.toThrow('initialization failed')
    await expect(createMemoryAdapter({ failLogin: true }).login()).rejects.toThrow('login failed')
    await expect(createMemoryAdapter({ failLogout: true }).logout()).rejects.toThrow('logout failed')

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
  it('defaults to anonymous in Phase 2A and never rejects on boot', async () => {
    // The app-wide singleton uses the in-memory adapter (no real backend).
    await expect(initSession()).resolves.toBeUndefined()
    const st = session.getState()
    expect(st.status).toBe('anonymous')
    expect(st.user).toBeNull()
    expect(st.error).toBeNull()
  })
})