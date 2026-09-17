<script setup>
// Account / authentication area (Phase A — provider OAuth).
//
// A single centered account experience rendered as a modal over the main
// workspace (NOT the narrow side-tools column). Two states:
//   signed out  → "Continue with Google" (primary) or "Continue with GitHub";
//                 both start the provider OAuth redirect; the account identity
//                 is restored on the following boot via GET /api/me (see
//                 http-adapter.js).
//   signed in   → server-derived account identity (id only, per /api/me) and a
//                 real sign-out (POST /auth/logout) that revokes the session.
//
// The previous username/password register / forgot-* flows are gone — the
// account layer is provider-OAuth-only (no credential backend exists in the
// Worker), isolated to this change. The local Profile always stays independent
// of the online account: sign-in/out never touches local profile, links,
// folders, settings or backups.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { session } from '../auth/session.js'
import { accountService } from '../auth/accountService.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  localProfile: { type: Object, default: () => ({ name: 'Local User', bio: '' }) },
})
const emit = defineEmits(['close', 'edit-local-profile'])

const panel = ref(null)

// The stored default bio is the product tagline; the account panel shows a
// shorter device-scoped descriptor instead. Display-only — stored data and the
// local-profile save/edit behavior are unchanged.
const DEFAULT_PROFILE_BIO = 'Local-first bookmark manager'
const localBio = computed(() => {
  const bio = props.localProfile.bio || ''
  return bio === DEFAULT_PROFILE_BIO ? 'Saved on this device' : bio
})

// session-reactive identity (exclusively from the authenticated server session)
const isAuthenticated = ref(false)
const user = ref(null)
let unsubscribe

function refreshAuth() {
  const st = session.getState()
  isAuthenticated.value = st.status === 'authenticated' && !!st.user
  user.value = st.user
}

const submitting = ref(false)
const statusMessage = ref('') // live region text (error surface)

function resetStatus() {
  submitting.value = false
  statusMessage.value = ''
}

// Reset status and focus the panel's first button each time it opens.
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetStatus()
    nextTick(() => {
      panel.value?.querySelector('button, input')?.focus()
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

/** Start the selected provider's OAuth (top-level redirect). The
 * authenticated account is restored on the next boot by initSession() ->
 * GET /api/me. */
function handleSignIn(provider) {
  resetStatus()
  accountService.signIn(provider)
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
    <Transition name="modal">
      <div v-if="open" class="account-backdrop" @click.self="emit('close')">
      <div
        ref="panel"
        class="account-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        @keydown.esc="emit('close')"
      >
        <!-- LOCAL (always visible, independent of the online account) -->
        <div class="local-profile-section">
          <div class="local-profile-header">
            <div class="local-profile-avatar">{{ initials(props.localProfile.name) }}</div>
            <div class="local-profile-info">
              <div class="local-profile-label">Local</div>
              <div class="local-profile-name">{{ props.localProfile.name }}</div>
              <div v-if="localBio" class="local-profile-bio">{{ localBio }}</div>
            </div>
            <button type="button" class="local-profile-edit" @click="openLocalProfile" aria-label="Edit local profile">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
        </div>

        <!-- ACCOUNT SECTION -->
        <div class="online-account-section">
          <div class="online-account-header">
            <div class="online-account-label">Account</div>
            <div class="online-account-status" :class="{ 'signed-out': !isAuthenticated }">
              <span class="status-dot" aria-hidden="true"></span>
              <span>{{ isAuthenticated ? 'Signed in' : 'Not signed in' }}</span>
            </div>
          </div>

          <!-- SIGNED IN : account identity -->
          <template v-if="isAuthenticated">
            <dl class="acct-detail">
              <div class="acct-row"><dt>Account ID</dt><dd>{{ user?.id }}</dd></div>
            </dl>
            <p class="muted small">Sync is not enabled yet. Sign-in only links this browser session to your online account.</p>
            <div class="acct-actions">
              <button type="button" class="btn danger" :disabled="submitting" @click="handleSignOut">Sign out</button>
            </div>
          </template>

          <!-- SIGNED OUT : sign in with Google or GitHub (equal, neutral options) -->
          <template v-else>
            <p class="muted small">Sign in to sync your links and folders across devices.</p>
            <div class="signed-out-actions">
              <button type="button" class="btn secondary" @click="handleSignIn('google')">
                <span class="provider-badge google-badge" aria-hidden="true">G</span>
                Continue with Google
              </button>
              <button type="button" class="btn secondary" @click="handleSignIn('github')">
                <svg class="github-mark" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                Continue with GitHub
              </button>
            </div>
            <button type="button" class="switch-line" @click="emit('close')">Continue without signing in</button>
          </template>

          <p v-if="statusMessage" class="status" role="status" aria-live="polite">{{ statusMessage }}</p>
        </div>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.account-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--overlay);
  display: grid;
  place-items: center;
  padding: 16px;
}
.account-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  width: 100%;
  max-width: 480px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 28px;
}
.account-panel h3 { margin: 0 0 18px; font-size: 20px; color: var(--text-h); }

.muted.small { font-size: var(--text-xs); color: var(--muted); margin: 0 0 14px; line-height: var(--leading-normal); }

.btn.block { margin-top: 4px; }
.switch-line {
  display: block;
  margin: 14px auto 0;
  padding: 6px 10px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--muted);
  text-align: center;
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
}
.switch-line:hover { color: var(--text-h); background: var(--muted-bg); }
.switch-line:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }

.acct-detail { margin: 0 0 16px; }
.acct-row { display: flex; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border); }
.acct-row dt { width: 110px; flex-shrink: 0; font-size: var(--text-sm); color: var(--muted); }
.acct-row dd { margin: 0; font-size: var(--text-md); color: var(--text-h); overflow-wrap: anywhere; }
.acct-actions { display: flex; gap: var(--space-2); margin-top: 8px; flex-wrap: wrap; }
.acct-actions .danger { background: var(--error); color: var(--on-error); border-color: var(--error); }
.acct-actions .danger:hover { background: var(--error); color: var(--on-error); border-color: var(--error); filter: brightness(0.92); }

.status { margin: 16px 0 0; font-size: var(--text-sm); color: var(--text); line-height: var(--leading-normal); background: var(--muted-bg); border-radius: var(--radius-sm); padding: 10px 12px; }

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
  border-radius: var(--radius-full);
  background: var(--muted-bg);
  color: var(--text-h);
  display: grid;
  place-items: center;
  font-weight: var(--weight-bold);
  font-size: var(--text-sm);
  flex-shrink: 0;
}
.local-profile-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.local-profile-label { font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--muted); }
.local-profile-name { font-weight: var(--weight-bold); font-size: var(--text-lg); color: var(--text-h); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.local-profile-bio { font-size: var(--text-sm); color: var(--muted); margin-top: 2px; word-break: break-word; }
.local-profile-edit {
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border: none;
  background: var(--muted-bg);
  color: var(--muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}
.local-profile-edit:hover { background: var(--accent-bg); color: var(--accent); }
.local-profile-edit:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
.local-profile-edit svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; }

.online-account-section { margin-top: 4px; }
.online-account-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.online-account-label { font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--muted); }
.online-account-status { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--muted); }
.online-account-status .status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--success);
  flex-shrink: 0;
}
.online-account-status.signed-out .status-dot { background: var(--muted); }
.signed-out-actions { display: flex; gap: var(--space-2); margin: 16px 0 0; flex-wrap: wrap; }
/* Both providers are equal, neutral options until the user authenticates. The
   button chrome comes from the shared .btn.secondary variant; only the layout
   (they split the row equally) is local. */
.signed-out-actions .btn {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
}
.github-mark { width: 16px; height: 16px; flex-shrink: 0; }
.provider-badge { flex-shrink: 0; }
/* Google brand colours — fixed, not theme tokens. */
.google-badge {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: #fff;
  color: #4285f4;
  border: 1px solid #dadce0;
  display: inline-grid;
  place-items: center;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1;
}

@media (max-width: 520px) {
  .account-panel { padding: 20px; }
}
</style>
