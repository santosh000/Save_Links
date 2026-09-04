// UI tests for the account/authentication area (AccountPanel.vue, Phase A —
// GitHub OAuth). Mounts the component (teleports to body) and mocks the session
// abstraction and accountService, so the OAuth identity + sign-out UX is tested
// without a real backend, IndexedDB, or network. The previous username/password
// register/forgot-* UI was removed in Phase A (OAuth-only boundary), so those
// tests are replaced below with equal-or-better OAuth coverage.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AccountPanel from './AccountPanel.vue'

// vi.mock factories are hoisted; shared mutable state lives in vi.hoisted.
const h = vi.hoisted(() => {
  const auth = { status: 'anonymous', user: null }
  const subscribers = new Set()
  return {
    auth,
    getState: () => ({ status: auth.status, user: auth.user, error: null }),
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) },
    notify: () => { for (const fn of subscribers) fn(h.getState()) },
    signIn: vi.fn(),
    signOut: vi.fn(),
  }
})

vi.mock('../auth/session.js', () => ({ session: { getState: h.getState, subscribe: h.subscribe } }))
vi.mock('../auth/accountService.js', () => ({
  accountService: { signIn: h.signIn, signOut: h.signOut },
}))

function setAuth(status, user = null) {
  h.auth.status = status
  h.auth.user = user
  h.notify()
}

let component
beforeEach(() => {
  h.auth.status = 'anonymous'
  h.auth.user = null
  h.signIn.mockReset()
  h.signOut.mockReset()
})

async function open() {
  component = mount(AccountPanel, { props: { open: true }, attachTo: document.body })
  await flushPromises()
  return component
}

function close() {
  component?.unmount()
  document.body.innerHTML = ''
}

describe('AccountPanel — open/close', () => {
  it('is not rendered when closed', () => {
    const w = mount(AccountPanel, { props: { open: false }, attachTo: document.body })
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    w.unmount()
  })

  it('renders the account area when open', async () => {
    await open()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Sign in with GitHub')
    close()
  })

  it('closes when the backdrop is clicked', async () => {
    const w = await open()
    document.querySelector('.account-backdrop').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(w.emitted('close')).toBeTruthy()
    close()
  })
})

describe('AccountPanel — signed out (GitHub OAuth)', () => {
  it('shows the signed-out state with a single GitHub sign-in action', async () => {
    await open()
    const t = document.body.textContent
    expect(t).toContain('Online account')
    expect(t).toContain('Not signed in')
    expect(t).toContain('Sign in with GitHub')
    expect(t).toContain('Local profile')
    expect(t).toContain('Or continue using your local profile only')
    close()
  })

  it('does not truthfully claim authentication, sync, or a credential login when signed out', async () => {
    await open()
    const t = document.querySelector('[role="dialog"]').textContent
    expect(t).not.toMatch(/Signed in/)
    expect(t).not.toMatch(/Connected/) // no misleading "Cloud sync: Connected"
    expect(t).not.toMatch(/Synced/)
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(document.querySelector('input[type="email"]')).toBeNull()
    close()
  })

  it('the Sign in with GitHub button starts the OAuth redirect via accountService', async () => {
    await open()
    h.signIn.mockReturnValue(undefined)
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign in with GitHub').click()
    expect(h.signIn).toHaveBeenCalledTimes(1)
    close()
  })

  it('does not call signOut or mutate session when signing in', async () => {
    await open()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign in with GitHub').click()
    expect(h.signOut).not.toHaveBeenCalled()
    close()
  })
})

describe('AccountPanel — signed-in account identity', () => {
  it('signed-out state does not falsely claim the user is authenticated', async () => {
    await open()
    expect(document.body.textContent).toContain('Not signed in')
    close()
  })

  it('shows server-derived account id and a real sign-out when authenticated', async () => {
    setAuth('authenticated', { id: 'acc-42', name: '', email: null })
    await open()
    const t = document.body.textContent
    expect(t).toContain('Local profile')
    expect(t).toContain('Online account')
    expect(t).toContain('Signed in')
    expect(t).toContain('acc-42')
    // Sync stays disabled in Phase A — no misleading "Connected" claim.
    expect(document.querySelector('[role="dialog"]').textContent).not.toMatch(/Connected/)
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Sync is not enabled yet')
    h.signOut.mockResolvedValue()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign out').click()
    await flushPromises()
    expect(h.signOut).toHaveBeenCalledTimes(1)
    close()
  })

  it('renders a sign-out failure honestly instead of claiming success', async () => {
    setAuth('authenticated', { id: 'acc-1', name: '', email: null })
    await open()
    h.signOut.mockRejectedValue(new Error('no network'))
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign out').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Could not sign out')
    // still signed in — the failure must not falsely clear the account
    expect(document.body.textContent).toContain('Signed in')
    close()
  })
})

describe('AccountPanel — local profile independence', () => {
  it('local profile is always shown, independent of online account state', async () => {
    await open()
    expect(document.body.textContent).toContain('Local profile')
    expect(document.body.textContent).toContain('Local User')
    close()
  })

  it('an authenticated online account does not overwrite or hide the local profile', async () => {
    setAuth('authenticated', { id: 'acc-9', name: '', email: null })
    await open()
    const t = document.body.textContent
    expect(t).toContain('Local profile')
    expect(t).toContain('Local User') // local profile name preserved — not replaced by account id
    close()
  })

  it('local profile edit opens the editor without touching account state', async () => {
    const w = await open()
    ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Edit local profile').click()
    expect(w.emitted('edit-local-profile')).toBeTruthy()
    expect(h.signIn).not.toHaveBeenCalled()
    expect(h.signOut).not.toHaveBeenCalled()
    close()
  })
})

describe('AccountPanel — account A/B isolation at the UI boundary', () => {
  it('switching from account A to logged-out to account B clears the stale identity display', async () => {
    // account A signed in
    setAuth('authenticated', { id: 'acc-A', name: '', email: null })
    await open()
    expect(document.body.textContent).toContain('acc-A')

    // logout -> anonymous (session emits the new state)
    setAuth('anonymous', null)
    await flushPromises()
    expect(document.body.textContent).toContain('Not signed in')
    expect(document.querySelector('[role="dialog"]').textContent).not.toContain('acc-A')

    // account B signed in — only B is shown, A never reappears
    setAuth('authenticated', { id: 'acc-B', name: '', email: null })
    await flushPromises()
    expect(document.body.textContent).toContain('acc-B')
    expect(document.querySelector('[role="dialog"]').textContent).not.toContain('acc-A')
    close()
  })
})
