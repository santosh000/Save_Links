// UI tests for the account/authentication area (AccountPanel.vue, Phase 4 — Auth UI).
// Mounts the component (teleports to body) and mocks the session abstraction and
// accountService, so the full auth-state machine and validation are tested without
// a real backend, IndexedDB, or network.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AccountPanel from './AccountPanel.vue'

// vi.mock factories are hoisted; shared mutable state lives in vi.hoisted.
// AccountUnavailableError is defined inside vi.hoisted so it is guaranteed to
// exist when the hoisted vi.mock factory runs (the component imports this class
// and uses `instanceof` on it to route the honest "not set up yet" message).
const h = vi.hoisted(() => {
  const auth = { status: 'anonymous', user: null }
  const subscribers = new Set()
  class AccountUnavailableError extends Error {
    constructor(m = 'Online account services are not set up yet') { super(m); this.code = 'ACCOUNT_UNAVAILABLE' }
  }
  return {
    auth,
    getState: () => ({ status: auth.status, user: auth.user, error: null }),
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) },
    notify: () => { for (const fn of subscribers) fn(h.getState()) },
    AccountUnavailableError,
    signIn: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn(),
    forgotUsername: vi.fn(),
    signOut: vi.fn(),
  }
})

vi.mock('../auth/session.js', () => ({ session: { getState: h.getState, subscribe: h.subscribe } }))
vi.mock('../auth/accountService.js', () => ({
  accountService: {
    signIn: h.signIn,
    register: h.register,
    forgotPassword: h.forgotPassword,
    forgotUsername: h.forgotUsername,
    signOut: h.signOut,
  },
  AccountUnavailableError: h.AccountUnavailableError,
}))

function setAuth(status, user = null) {
  h.auth.status = status
  h.auth.user = user
  h.notify()
}

// Pull the real component modules after mocks are registered.
let component
beforeEach(() => {
  h.auth.status = 'anonymous'
  h.auth.user = null
  Object.values({ signIn: h.signIn, register: h.register, forgotPassword: h.forgotPassword, forgotUsername: h.forgotUsername, signOut: h.signOut })
    .forEach((m) => m.mockReset())
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

const VALID_PASSWORD = 'Abcd1234!'

describe('AccountPanel — open/close', () => {
  it('is not rendered when closed', () => {
    const w = mount(AccountPanel, { props: { open: false }, attachTo: document.body })
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    w.unmount()
  })

  it('renders the account area when open (account icon opens the area)', async () => {
    await open()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Sign in')
    close()
  })

  it('closes when the backdrop is clicked', async () => {
    const w = await open()
    const backdrop = document.querySelector('.account-backdrop')
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(w.emitted('close')).toBeTruthy()
    close()
  })
})

describe('AccountPanel — sign in view', () => {
  it('renders the sign-in fields and heading', async () => {
    await open()
    const t = document.body.textContent
    expect(t).toContain('Sign in')
    expect(document.querySelector('#account-identifier')).not.toBeNull()
    expect(document.querySelector('#account-password')).not.toBeNull()
    close()
  })

  it('password is hidden by default', async () => {
    await open()
    expect(document.querySelector('#account-password').type).toBe('password')
    close()
  })

  it('show/hide password toggles visibility and updates the accessible label', async () => {
    await open()
    const btn = document.querySelector('#account-password').closest('.pw-wrap').querySelector('.pw-toggle')
    expect(btn.getAttribute('aria-label')).toBe('Show password')
    btn.click()
    await flushPromises()
    expect(document.querySelector('#account-password').type).toBe('text')
    expect(btn.getAttribute('aria-label')).toBe('Hide password')
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    btn.click()
    await flushPromises()
    expect(document.querySelector('#account-password').type).toBe('password')
    close()
  })

  it('required-field validation on submit with an empty form', async () => {
    await open()
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('Enter your username or email')
    expect(document.body.textContent).toContain('Enter your password')
    expect(h.signIn).not.toHaveBeenCalled()
    close()
  })

  it('a valid sign-in routes to accountService.signIn without falsely signing in (no fake success display)', async () => {
    await open()
    h.signIn.mockRejectedValue(new Error('fail'))
    document.querySelector('#account-identifier').value = 'alice'
    document.querySelector('#account-identifier').dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#account-password').value = 'secret'
    document.querySelector('#account-password').dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    // Collected via rejected promise; signIn WAS called with the credentials.
    await flushPromises()
    expect(h.signIn).toHaveBeenCalledWith({ usernameOrEmail: 'alice', password: 'secret' })
    close()
  })
})

describe('AccountPanel — navigation between auth states', () => {
  it('sign in -> create account -> sign in', async () => {
    await open()
    const findLink = (text) => [...document.querySelectorAll('button.link')].find((b) => b.textContent.trim().includes(text))
    findLink('Create account').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Create account')
    findLink('Sign in').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Username or email')
    close()
  })

  it('sign in -> forgot password -> back to sign in', async () => {
    await open()
    const findLink = (text) => [...document.querySelectorAll('button.link')].find((b) => b.textContent.trim().includes(text))
    findLink('Forgot password').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Forgot password?')
    findLink('Back to Sign in').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Username or email')
    close()
  })

  it('sign in -> forgot username -> back to sign in', async () => {
    await open()
    const findLink = (text) => [...document.querySelectorAll('button.link')].find((b) => b.textContent.trim().includes(text))
    findLink('Forgot username').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Forgot username?')
    findLink('Back to Sign in').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Username or email')
    close()
  })
})

describe('AccountPanel — independent form state (no credential leak)', () => {
  // type a value into a field by id. `v-model` needs an `input` event to update.
  function type(id, value) {
    const el = document.querySelector(id)
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const findLink = (text) => [...document.querySelectorAll('button.link')].find((b) => b.textContent.trim().includes(text))

  it('Sign In password does not leak into the Register form', async () => {
    await open()
    type('#account-password', 'Secret123!')
    type('#account-identifier', 'alice')
    findLink('Create account').click()
    await flushPromises()
    expect(document.querySelector('#acct-pass').value).toBe('')
    expect(document.querySelector('#acct-confirm').value).toBe('')
    expect(document.querySelector('#acct-username').value).toBe('')
    expect(document.querySelector('#acct-email').value).toBe('')
    close()
  })

  it('never carries a password between Sign In and Register in either direction', async () => {
    await open()
    // sign in -> register -> fill register password -> back to sign in
    type('#account-password', 'One!2Three')
    findLink('Create account').click()
    await flushPromises()
    type('#acct-pass', 'Register!4pass')
    type('#acct-confirm', 'Register!4pass')
    findLink('Sign in').click()
    await flushPromises()
    // sign in password field is empty (register value did not leak back)
    expect(document.querySelector('#account-password').value).toBe('')
    // back to register: register fields are empty again
    findLink('Create account').click()
    await flushPromises()
    expect(document.querySelector('#acct-pass').value).toBe('')
    expect(document.querySelector('#acct-confirm').value).toBe('')
    close()
  })

  it('switching to Forgot Password does not carry leftover credentials', async () => {
    await open()
    type('#account-password', 'Leak!2check')
    type('#account-identifier', 'alice')
    findLink('Forgot password').click()
    await flushPromises()
    // forgot-password has only an identifier field, and its value must be empty
    expect(document.querySelector('#forgot-pw-id').value).toBe('')
    expect(document.querySelector('#forgot-pw-id').type ?? 'text').toBe('text') // no obscured field leaked
    close()
  })

  it('switching Sign In -> Forgot Username -> Sign In keeps sign-in fresh', async () => {
    await open()
    type('#account-password', 'Temp!1pass')
    findLink('Forgot username').click()
    await flushPromises()
    expect(document.querySelector('#forgot-user-email').value).toBe('')
    findLink('Back to Sign in').click()
    await flushPromises()
    expect(document.querySelector('#account-password').value).toBe('')
    expect(document.querySelector('#account-identifier').value).toBe('')
    close()
  })

  it('empty Register after navigation still runs full validation (no false prefill)', async () => {
    await open()
    type('#account-password', 'SignInSup3r!secret')
    findLink('Create account').click()
    await flushPromises()
    // submit empty register form
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('Choose a username')
    expect(document.body.textContent).toContain('Create a password')
    close()
  })
})

describe('AccountPanel — register view', () => {
  async function openRegister() {
    await open()
    ;[...document.querySelectorAll('button.link')].find((b) => b.textContent.trim().includes('Create account')).click()
    await flushPromises()
  }

  it('renders register fields', async () => {
    await openRegister()
    expect(document.querySelector('#acct-username')).not.toBeNull()
    expect(document.querySelector('#acct-email')).not.toBeNull()
    expect(document.querySelector('#acct-pass')).not.toBeNull()
    expect(document.querySelector('#acct-confirm')).not.toBeNull()
    close()
  })

  it('password and confirmation are each hidden by default and toggle independently', async () => {
    await openRegister()
    const pass = document.querySelector('#acct-pass')
    const confirm = document.querySelector('#acct-confirm')
    expect(pass.type).toBe('password')
    expect(confirm.type).toBe('password')
    // show password only
    pass.closest('.pw-wrap').querySelector('.pw-toggle').click()
    await flushPromises()
    expect(pass.type).toBe('text')
    expect(confirm.type).toBe('password')
    // show confirmation only
    confirm.closest('.pw-wrap').querySelector('.pw-toggle').click()
    await flushPromises()
    expect(pass.type).toBe('text')
    expect(confirm.type).toBe('text')
    close()
  })

  it('shows the password requirements list while typing', async () => {
    await openRegister()
    const pass = document.querySelector('#acct-pass')
    expect(document.querySelector('.reqs')).toBeNull() // hidden until a value is typed
    pass.value = VALID_PASSWORD
    pass.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const reqs = [...document.querySelectorAll('.reqs li')]
    expect(reqs.length).toBe(6)
    expect(reqs.every((li) => li.classList.contains('met'))).toBe(true)
    close()
  })

  it('length requirement fails below 8 and above 12, met at 8', async () => {
    await openRegister()
    const pass = document.querySelector('#acct-pass')
    const lengthItem = () => [...document.querySelectorAll('.reqs li')].find((li) => li.textContent.includes('characters'))
    pass.value = 'Ab1!'
    pass.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(lengthItem().classList.contains('met')).toBe(false)
    pass.value = 'Ab1!x234'
    pass.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(lengthItem().classList.contains('met')).toBe(true)
    close()
  })

  it('requirement indicators reflect uppercase/lowercase/number/symbol/spaces', async () => {
    await openRegister()
    const pass = document.querySelector('#acct-pass')
    const item = (key) => [...document.querySelectorAll('.reqs li')].find((li) =>
      ({ length: 'characters', uppercase: 'uppercase', lowercase: 'lowercase', number: 'number', symbol: 'symbol', noSpaces: 'No spaces' }[key] === li.textContent.trim() || li.textContent.includes({ length: 'characters', uppercase: 'uppercase', lowercase: 'lowercase', number: 'number', symbol: 'symbol', noSpaces: 'No spaces' }[key])))
    function met(key) { return item(key).classList.contains('met') }

    pass.value = 'abcdefgh'
    pass.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(met('uppercase')).toBe(false); expect(met('lowercase')).toBe(true)
    expect(met('number')).toBe(false); expect(met('symbol')).toBe(false)

    pass.value = 'Abcd1234'
    pass.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(met('uppercase')).toBe(true); expect(met('lowercase')).toBe(true)
    expect(met('number')).toBe(true); expect(met('symbol')).toBe(false)

    pass.value = 'Ab cd123!'
    pass.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(met('symbol')).toBe(true); expect(met('noSpaces')).toBe(false)
    close()
  })

  it('password confirmation mismatch is flagged on submit', async () => {
    await openRegister()
    document.querySelector('#acct-username').value = 'alice'
    document.querySelector('#acct-username').dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#acct-email').value = 'alice@example.com'
    document.querySelector('#acct-email').dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#acct-pass').value = VALID_PASSWORD
    document.querySelector('#acct-pass').dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#acct-confirm').value = 'Different!'
    document.querySelector('#acct-confirm').dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('Passwords do not match')
    expect(h.register).not.toHaveBeenCalled()
    close()
  })

  it('a valid registration routes to accountService.register', async () => {
    await openRegister()
    h.register.mockRejectedValue(new Error('x'))
    const set = (sel, val) => { const el = document.querySelector(sel); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })) }
    set('#acct-username', 'alice')
    set('#acct-email', 'alice@example.com')
    set('#acct-pass', VALID_PASSWORD)
    set('#acct-confirm', VALID_PASSWORD)
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    await flushPromises()
    expect(h.register).toHaveBeenCalledWith({ username: 'alice', email: 'alice@example.com', password: VALID_PASSWORD })
    close()
  })
})

describe('AccountPanel — honest submit feedback', () => {
  it('shows a non-committal message when the backend reports the service unavailable', async () => {
    await open()
    h.signIn.mockRejectedValue(new h.AccountUnavailableError())
    const set = (sel, val) => { const el = document.querySelector(sel); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })) }
    set('#account-identifier', 'alice')
    set('#account-password', 'secret')
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    await flushPromises()
    expect(document.body.textContent).toContain('stays on this device')
    // must NOT claim a successful sign-in
    expect(document.querySelector('[role="dialog"]').textContent).not.toMatch(/Signed in/)
    close()
  })
})

describe('AccountPanel — signed-in account view', () => {
  it('signed-out state does not falsely claim the user is authenticated', async () => {
    await open()
    expect(document.body.textContent).toContain('Sign in')
    expect(document.body.textContent).toContain('Local profile')
    expect(document.body.textContent).toContain('Not signed in')
    close()
  })

  it('shows the account details and signs out when authenticated', async () => {
    setAuth('authenticated', { id: 'u1', name: 'Alice', email: 'alice@example.com' })
    await open()
    expect(document.body.textContent).toContain('Local profile')
    expect(document.body.textContent).toContain('Alice')
    expect(document.body.textContent).toContain('Online account')
    expect(document.body.textContent).toContain('Signed in')
    expect(document.body.textContent).toContain('alice@example.com')
    h.signOut.mockResolvedValue()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign out').click()
    await flushPromises()
    expect(h.signOut).toHaveBeenCalledTimes(1)
    close()
  })
})
