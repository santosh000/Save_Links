import { describe, it, expect, vi, beforeEach } from 'vitest'
import { accountService } from './accountService.js'
import { AUTH_LOGIN_PATH } from './http-adapter.js'

// vi.hoisted shares the mock's state between the hoisted vi.mock factory and
// the test body. (Plain module-scope `const x = vi.fn()` captured by a hoisted
// factory is evaluated before `x` is initialized — do not use that pattern.)
const h = vi.hoisted(() => ({ logout: vi.fn() }))

vi.mock('./session.js', () => ({
  session: {
    logout: (...a) => h.logout(...a),
    getState: () => ({ status: 'authenticated', user: { id: 'u', name: 'U' } }),
  },
}))

let assignedUrl = null

beforeEach(() => {
  h.logout.mockReset()
  assignedUrl = null
  // accountService navigates via window.location.assign; stub it in jsdom.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: (url) => { assignedUrl = url } },
  })
})

describe('accountService — GitHub OAuth online-account boundary', () => {
  it('signIn starts the GitHub OAuth flow with a top-level redirect', () => {
    // signIn() is synchronous navigation; the authenticated account is restored
    // on the next boot by initSession() -> /api/me, so no in-page promise result.
    expect(accountService.signIn()).toBeUndefined()
    expect(assignedUrl).toBe(AUTH_LOGIN_PATH)
  })

  it('does not claim an in-page authenticated state or touch local data on sign-in', () => {
    accountService.signIn({ username: 'ignored', password: 'ignored' })
    // Only a redirect occurred — accountService never mutates session state or
    // storage, and no credential is submitted. The redirect target is OAuth,
    // not a username/password endpoint.
    expect(assignedUrl).toBe(AUTH_LOGIN_PATH)
    expect(h.logout).not.toHaveBeenCalled()
  })

  it('signOut delegates to the real session.logout (revokes the session server-side)', async () => {
    h.logout.mockResolvedValue()
    await accountService.signOut()
    expect(h.logout).toHaveBeenCalledTimes(1)
  })
  // (signOut simply `return session.logout()`, so any rejection bubbles up
  // verbatim — that is plain promise plumbing and is covered at the component
  // layer, where the UI's try/catch turns sign-out failure into an honest
  // message instead of a false success.)
})
