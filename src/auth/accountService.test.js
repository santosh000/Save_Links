import { describe, it, expect, vi, beforeEach } from 'vitest'
import { accountService, AccountUnavailableError } from './accountService.js'

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

describe('accountService — honest backend integration seam', () => {
  beforeEach(() => h.logout.mockReset())

  it('credential-backed operations reject as unavailable (never fake success)', async () => {
    await expect(accountService.signIn({ usernameOrEmail: 'a', password: 'p' })).rejects.toBeInstanceOf(AccountUnavailableError)
    await expect(accountService.register({ username: 'a', email: 'a@b.co', password: 'p' })).rejects.toBeInstanceOf(AccountUnavailableError)
    await expect(accountService.forgotPassword({ usernameOrEmail: 'a' })).rejects.toBeInstanceOf(AccountUnavailableError)
    await expect(accountService.forgotUsername({ email: 'a@b.co' })).rejects.toBeInstanceOf(AccountUnavailableError)
  })

  it('unavailable rejection carries a code so the UI can show an honest message', async () => {
    try {
      await accountService.signIn({ usernameOrEmail: 'a', password: 'p' })
    } catch (e) {
      expect(e).toBeInstanceOf(AccountUnavailableError)
      expect(e.code).toBe('ACCOUNT_UNAVAILABLE')
    }
  })

  it('signOut delegates to the real session.logout (no cloud backend needed)', async () => {
    h.logout.mockResolvedValue()
    await accountService.signOut()
    expect(h.logout).toHaveBeenCalledTimes(1)
  })
  // (signOut simply `return session.logout()`, so any rejection bubbles up
  // verbatim — that is plain promise plumbing and is covered at the component
  // layer, where the UI's try/catch turns sign-out failure into an honest
  // message instead of a false success.)
})
