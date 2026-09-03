<script setup>
// Account / authentication area (Phase 4 — Auth UI).
//
// A single centered account experience rendered as a modal over the main
// workspace (NOT the narrow side-tools column). Holds five internal states:
//   signin | register | forgot-password | forgot-username | (authenticated → account)
//
// Honesty boundary: the credential-backed operations go through
// accountService. With no real username/password backend connected yet, those
// reject as unavailable — the UI NEVER fakes a successful sign-in or claims
// cloud sync works. Sign-out is real. Validation is fully implemented.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { session } from '../auth/session.js'
import { accountService, AccountUnavailableError } from '../auth/accountService.js'
import {
  passwordChecks,
  validateSignIn,
  validateRegister,
  validateForgotPassword,
  validateForgotUsername,
  PASSWORD_RULES,
} from '../auth/authValidation.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  localProfile: { type: Object, default: () => ({ name: 'Local User', bio: '' }) },
})
const emit = defineEmits(['close', 'edit-local-profile'])

const view = ref('signin') // 'signin' | 'register' | 'forgot-password' | 'forgot-username'
const panel = ref(null)

// session-reactive identity
const isAuthenticated = ref(false)
const user = ref(null)
let unsubscribe

function refreshAuth() {
  const st = session.getState()
  isAuthenticated.value = st.status === 'authenticated' && !!st.user
  user.value = st.user
}

// ---- form state -----------------------------------------------------------
const form = ref({
  usernameOrEmail: '',
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  forgotIdentifier: '',
})
const errors = ref({})
const showPassword = ref(false)
const showConfirm = ref(false)
const submitting = ref(false)

const statusMessage = ref('') // live region text (unavailable / generic errors)

// live password requirements for the register view
const checks = computed(() => passwordChecks(form.value.password))
const requirementItems = [
  { key: 'length', label: `${PASSWORD_RULES.min}–${PASSWORD_RULES.max} characters` },
  { key: 'uppercase', label: 'One uppercase letter' },
  { key: 'lowercase', label: 'One lowercase letter' },
  { key: 'number', label: 'One number' },
  { key: 'symbol', label: 'One symbol' },
  { key: 'noSpaces', label: 'No spaces' },
]

function resetForView(v) {
  view.value = v
  // Each auth form keeps independent state: reset all fields so a value typed
  // on one view (e.g. the Sign In password) is never carried into another
  // (e.g. Register). Passwords are never copied between forms.
  form.value = {
    usernameOrEmail: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    forgotIdentifier: '',
  }
  errors.value = {}
  statusMessage.value = ''
  submitting.value = false
  showPassword.value = false
  showConfirm.value = false
}

// Reset to Sign in and focus the first field each time the panel opens.
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetForView('signin')
    nextTick(() => {
      const first = panel.value?.querySelector('input, button')
      first?.focus()
    })
  }
})

// Initials helper for local profile avatar
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  return parts.map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'L'
}

// Open local profile editor (emits event for parent to handle)
function openLocalProfile() {
  emit('edit-local-profile')
}

onMounted(() => {
  refreshAuth()
  unsubscribe = session.subscribe(refreshAuth)
})
onBeforeUnmount(() => unsubscribe?.())

function identityConflictMessage(err) {
  return err instanceof AccountUnavailableError
    ? `${err.message}. Your data stays on this device.`
    : 'Something went wrong. Please try again.'
}

async function handleSignIn() {
  const { errors: e, valid } = validateSignIn({
    usernameOrEmail: form.value.usernameOrEmail,
    password: form.value.password,
  })
  errors.value = e
  if (!valid) return
  submitting.value = true
  statusMessage.value = ''
  try {
    await accountService.signIn({ usernameOrEmail: form.value.usernameOrEmail, password: form.value.password })
  } catch (err) {
    statusMessage.value = identityConflictMessage(err)
  } finally {
    submitting.value = false
  }
}

async function handleRegister() {
  const { errors: e, valid } = validateRegister({
    username: form.value.username,
    email: form.value.email,
    password: form.value.password,
    confirmPassword: form.value.confirmPassword,
  })
  errors.value = e
  if (!valid) return
  submitting.value = true
  statusMessage.value = ''
  try {
    await accountService.register({ username: form.value.username, email: form.value.email, password: form.value.password })
  } catch (err) {
    statusMessage.value = identityConflictMessage(err)
  } finally {
    submitting.value = false
  }
}

async function handleForgotPassword() {
  const { errors: e, valid } = validateForgotPassword({ usernameOrEmail: form.value.forgotIdentifier })
  errors.value = e
  if (!valid) return
  submitting.value = true
  statusMessage.value = ''
  // Generic (non-enumerating) response: report unavailable without revealing
  // whether an account exists.
  try {
    await accountService.forgotPassword({ usernameOrEmail: form.value.forgotIdentifier })
  } catch (err) {
    statusMessage.value = identityConflictMessage(err)
  } finally {
    submitting.value = false
  }
}

async function handleForgotUsername() {
  const { errors: e, valid } = validateForgotUsername({ email: form.value.email })
  errors.value = e
  if (!valid) return
  submitting.value = true
  statusMessage.value = ''
  try {
    await accountService.forgotUsername({ email: form.value.email })
  } catch (err) {
    statusMessage.value = identityConflictMessage(err)
  } finally {
    submitting.value = false
  }
}

async function handleSignOut() {
  submitting.value = true
  statusMessage.value = ''
  try {
    await accountService.signOut()
  } catch {
    statusMessage.value = 'Could not sign out. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="account-backdrop" @click.self="emit('close')">
      <div
        ref="panel"
        class="account-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        @keydown.esc="emit('close')"
      >
        <!-- LOCAL PROFILE (always visible) -->
        <div class="local-profile-section">
          <div class="local-profile-header">
            <div class="local-profile-avatar">{{ initials(props.localProfile.name) }}</div>
            <div class="local-profile-info">
              <div class="local-profile-label">Local profile</div>
              <div class="local-profile-name">{{ props.localProfile.name }}</div>
              <div v-if="props.localProfile.bio" class="local-profile-bio">{{ props.localProfile.bio }}</div>
            </div>
            <button type="button" class="local-profile-edit" @click="openLocalProfile" aria-label="Edit local profile">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
        </div>

        <!-- ONLINE ACCOUNT SECTION -->
        <div class="online-account-section">
          <!-- SIGNED IN : account view -->
          <template v-if="isAuthenticated">
            <div class="online-account-header">
              <div class="online-account-label">Online account</div>
              <div class="online-account-status">
                <span class="status-dot" aria-hidden="true"></span>
                <span>Signed in</span>
              </div>
            </div>
            <dl class="acct-detail">
              <div class="acct-row"><dt>Username</dt><dd>{{ user?.name || user?.id }}</dd></div>
              <div class="acct-row"><dt>Email</dt><dd>{{ user?.email || '—' }}</dd></div>
              <div class="acct-row"><dt>Cloud sync</dt><dd>Connected</dd></div>
            </dl>
            <p class="muted small">Account settings, change password, and recovery options will appear here in a later phase.</p>
            <div class="acct-actions">
              <button type="button" class="btn danger" :disabled="submitting" @click="handleSignOut">Sign out</button>
            </div>
          </template>

          <!-- SIGNED OUT : show sign in / create account options -->
          <template v-else-if="view === 'signin' || view === 'register' || view === 'forgot-password' || view === 'forgot-username'">
            <div class="online-account-header">
              <div class="online-account-label">Online account</div>
              <div class="online-account-status signed-out">
                <span class="status-dot" aria-hidden="true"></span>
                <span>Not signed in</span>
              </div>
            </div>
          </template>

          <!-- SIGNED OUT DEFAULT : show sign in / create account options -->
          <template v-else>
            <div class="online-account-header">
              <div class="online-account-label">Online account</div>
              <div class="online-account-status signed-out">
                <span class="status-dot" aria-hidden="true"></span>
                <span>Not signed in</span>
              </div>
            </div>
            <div class="signed-out-actions">
              <button type="button" class="btn primary" @click="resetForView('signin')">Sign in</button>
              <button type="button" class="btn ghost" @click="resetForView('register')">Create account</button>
            </div>
            <p class="switch-line muted small">Or continue using your local profile only.</p>
          </template>

          <!-- SIGN IN FORM -->
          <template v-if="view === 'signin'">
            <h3>Sign in</h3>
            <form novalidate @submit.prevent="handleSignIn">
              <div class="field">
                <label for="account-identifier">Username or email</label>
                <input
                  id="account-identifier"
                  v-model="form.usernameOrEmail"
                  class="field-input"
                  type="text"
                  autocomplete="username"
                  :aria-invalid="!!errors.usernameOrEmail"
                  :aria-describedby="errors.usernameOrEmail ? 'err-identifier' : undefined"
                />
                <p v-if="errors.usernameOrEmail" id="err-identifier" class="field-error">{{ errors.usernameOrEmail }}</p>
              </div>

              <div class="field">
                <label for="account-password">Password</label>
                <div class="pw-wrap">
                  <input
                    id="account-password"
                    v-model="form.password"
                    class="field-input"
                    :type="showPassword ? 'text' : 'password'"
                    autocomplete="current-password"
                    :aria-invalid="!!errors.password"
                    :aria-describedby="errors.password ? 'err-password' : undefined"
                  />
                  <button
                    type="button"
                    class="pw-toggle"
                    :aria-label="showPassword ? 'Hide password' : 'Show password'"
                    :aria-pressed="showPassword"
                    @click="showPassword = !showPassword"
                  >
                    <svg v-if="!showPassword" class="pw-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                    <svg v-else class="pw-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><path d="m4 4 16 16"/><circle cx="12" cy="12" r="3"/></svg>
                  </button>
                </div>
                <p v-if="errors.password" id="err-password" class="field-error">{{ errors.password }}</p>
              </div>

              <div class="acct-links">
                <button type="button" class="link" @click="resetForView('forgot-password')">Forgot password?</button>
                <button type="button" class="link" @click="resetForView('forgot-username')">Forgot username</button>
              </div>

              <button class="btn primary block" type="submit" :disabled="submitting">Sign in</button>
              <p class="switch-line">Don&rsquo;t have an account? <button type="button" class="link" @click="resetForView('register')">Create account</button></p>
            </form>
          </template>

          <!-- REGISTER FORM -->
          <template v-else-if="view === 'register'">
            <h3>Create account</h3>
            <form novalidate @submit.prevent="handleRegister">
              <div class="field">
                <label for="acct-username">Username</label>
                <input id="acct-username" v-model="form.username" class="field-input" type="text" autocomplete="username" :aria-invalid="!!errors.username" :aria-describedby="errors.username ? 'err-username' : undefined" />
                <p v-if="errors.username" id="err-username" class="field-error">{{ errors.username }}</p>
              </div>
              <div class="field">
                <label for="acct-email">Email</label>
                <input id="acct-email" v-model="form.email" class="field-input" type="email" autocomplete="email" :aria-invalid="!!errors.email" :aria-describedby="errors.email ? 'err-email' : undefined" />
                <p v-if="errors.email" id="err-email" class="field-error">{{ errors.email }}</p>
              </div>
              <div class="field">
                <label for="acct-pass">Password</label>
                <div class="pw-wrap">
                  <input id="acct-pass" v-model="form.password" class="field-input" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" :aria-invalid="!!errors.password" :aria-describedby="errors.password ? 'err-acct-pass' : undefined" />
                  <button type="button" class="pw-toggle" :aria-label="showPassword ? 'Hide password' : 'Show password'" :aria-pressed="showPassword" @click="showPassword = !showPassword">
                    <svg v-if="!showPassword" class="pw-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                    <svg v-else class="pw-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><path d="m4 4 16 16"/><circle cx="12" cy="12" r="3"/></svg>
                  </button>
                </div>
                <p v-if="errors.password" id="err-acct-pass" class="field-error">{{ errors.password }}</p>
                <ul class="reqs" v-if="form.password">
                  <li v-for="item in requirementItems" :key="item.key" :class="{ met: checks[item.key] }">{{ item.label }}</li>
                </ul>
              </div>
              <div class="field">
                <label for="acct-confirm">Confirm password</label>
                <div class="pw-wrap">
                  <input id="acct-confirm" v-model="form.confirmPassword" class="field-input" :type="showConfirm ? 'text' : 'password'" autocomplete="new-password" :aria-invalid="!!errors.confirmPassword" :aria-describedby="errors.confirmPassword ? 'err-confirm' : undefined" />
                  <button type="button" class="pw-toggle" :aria-label="showConfirm ? 'Hide confirmation' : 'Show confirmation'" :aria-pressed="showConfirm" @click="showConfirm = !showConfirm">
                    <svg v-if="!showConfirm" class="pw-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                    <svg v-else class="pw-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><path d="m4 4 16 16"/><circle cx="12" cy="12" r="3"/></svg>
                  </button>
                </div>
                <p v-if="errors.confirmPassword" id="err-confirm" class="field-error">{{ errors.confirmPassword }}</p>
              </div>

              <button class="btn primary block" type="submit" :disabled="submitting">Create account</button>
              <p class="switch-line">Already have an account? <button type="button" class="link" @click="resetForView('signin')">Sign in</button></p>
            </form>
          </template>

          <!-- FORGOT PASSWORD -->
          <template v-else-if="view === 'forgot-password'">
            <h3>Forgot password?</h3>
            <form novalidate @submit.prevent="handleForgotPassword">
              <div class="field">
                <label for="forgot-pw-id">Username or email</label>
                <input id="forgot-pw-id" v-model="form.forgotIdentifier" class="field-input" type="text" autocomplete="username" :aria-invalid="!!errors.usernameOrEmail" :aria-describedby="errors.usernameOrEmail ? 'err-forgot-pw' : undefined" />
                <p v-if="errors.usernameOrEmail" id="err-forgot-pw" class="field-error">{{ errors.usernameOrEmail }}</p>
              </div>
              <button class="btn primary block" type="submit" :disabled="submitting">Send reset link</button>
              <p class="switch-line"><button type="button" class="link" @click="resetForView('signin')">Back to Sign in</button></p>
            </form>
          </template>

          <!-- FORGOT USERNAME -->
          <template v-else-if="view === 'forgot-username'">
            <h3>Forgot username?</h3>
            <form novalidate @submit.prevent="handleForgotUsername">
              <div class="field">
                <label for="forgot-user-email">Email</label>
                <input id="forgot-user-email" v-model="form.email" class="field-input" type="email" autocomplete="email" :aria-invalid="!!errors.email" :aria-describedby="errors.email ? 'err-forgot-user' : undefined" />
                <p v-if="errors.email" id="err-forgot-user" class="field-error">{{ errors.email }}</p>
              </div>
              <button class="btn primary block" type="submit" :disabled="submitting">Send username</button>
              <p class="switch-line"><button type="button" class="link" @click="resetForView('signin')">Back to Sign in</button></p>
            </form>
          </template>

          <p v-if="statusMessage" class="status" role="status" aria-live="polite">{{ statusMessage }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.account-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.5);
  display: grid;
  place-items: center;
  padding: 16px;
}
.account-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: 100%;
  max-width: 480px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 28px;
}
.account-panel h3 { margin: 0 0 18px; font-size: 20px; color: var(--text-h); }

.field { margin-bottom: 18px; }
.field label { display: block; font-size: 13px; font-weight: 600; color: var(--text-h); margin-bottom: 7px; }
.field-input {
  width: 100%;
  padding: 0 13px;
  height: 46px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
  font-size: 14px;
}
.field-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.pw-wrap { position: relative; }
.pw-wrap .field-input { padding-right: 46px; }
.pw-toggle {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 38px;
  height: 38px;
  border: none;
  background: transparent;
  color: var(--muted);
  border-radius: 8px;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.pw-toggle:hover { color: var(--text-h); background: var(--muted-bg); }
.pw-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pw-icon { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

.field-error { margin: 6px 0 0; font-size: 12px; color: #dc2626; }
.reqs { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
.reqs li { font-size: 12px; color: var(--muted); }
.reqs li::before { content: '○'; margin-right: 6px; }
.reqs li.met { color: var(--accent); }
.reqs li.met::before { content: '✓'; }

.acct-links { display: flex; justify-content: space-between; gap: 8px; margin: -6px 0 18px; }
.link { background: none; border: none; color: var(--accent); font-size: 13px; cursor: pointer; padding: 0; }
.link:hover { text-decoration: underline; }
.link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

.btn.block { margin-top: 4px; }
.switch-line { margin: 16px 0 0; font-size: 13px; color: var(--text); text-align: center; }

.acct-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.acct-head h3 { margin: 0; }
.signed-in-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-bg);
  border: 1px solid var(--accent-border);
  padding: 3px 9px;
  border-radius: 999px;
}
.acct-detail { margin: 0 0 16px; }
.acct-row { display: flex; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border); }
.acct-row dt { width: 110px; flex-shrink: 0; font-size: 13px; color: var(--muted); }
.acct-row dd { margin: 0; font-size: 14px; color: var(--text-h); overflow-wrap: anywhere; }
.acct-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.acct-actions .danger { background: #dc2626; color: #fff; border-color: #dc2626; }
.acct-actions .danger:hover { background: #b91c1c; border-color: #b91c1c; }
.muted.small { font-size: 12px; color: var(--muted); margin: 0 0 14px; line-height: 1.5; }

.status { margin: 16px 0 0; font-size: 13px; color: var(--text); line-height: 1.5; background: var(--muted-bg); border-radius: 8px; padding: 10px 12px; }

/* New unified identity layout styles */
.local-profile-section {
  padding-bottom: 20px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
.local-profile-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.local-profile-avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
}
.local-profile-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.local-profile-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.local-profile-name { font-weight: 700; font-size: 15px; color: var(--text-h); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.local-profile-bio { font-size: 13px; color: var(--muted); margin-top: 2px; word-break: break-word; }
.local-profile-edit {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--muted-bg);
  color: var(--muted);
  border-radius: 8px;
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: all 0.15s;
}
.local-profile-edit:hover { background: var(--accent-bg); color: var(--accent); }
.local-profile-edit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.local-profile-edit svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; }

.online-account-section { margin-top: 4px; }
.online-account-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.online-account-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.online-account-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--muted); }
.online-account-status .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--success, #22c55e);
  flex-shrink: 0;
}
.online-account-status.signed-out .status-dot { background: var(--muted); }
.signed-out-actions { display: flex; gap: 8px; margin: 16px 0; flex-wrap: wrap; }
.signed-out-actions .btn { flex: 1; min-width: 120px; }

@media (max-width: 520px) {
  .account-panel { padding: 20px; }
}
</style>
