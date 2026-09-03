<script setup>
// Explicit cloud sync action (Phase 4 Chunk 6).
//
// A single user-triggered "Sync" button that calls the explicit sync entry
// point (src/composables/useSync.js -> syncNow), which owns the module-level
// in-flight lock so duplicate UI clicks cannot double-drain the queue.
//
// This component is presentation only:
//   - It NEVER auto-runs on mount/startup, and has no watchers or timers.
//   - Loading state is local and cosmetic; the real concurrency guard is the
//     shared lock inside useSync.js.
//   - When unauthenticated, syncNow() is still invoked (it deterministically
//     no-ops without touching the network), but the message reflects that the
//     user is not signed in instead of claiming a successful sync.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { syncNow } from '../composables/useSync.js'
import { session } from '../auth/session.js'

const syncing = ref(false)
const message = ref('')
// 'muted' | 'success' | 'conflict' | 'error'
const tone = ref('muted')
const isAuthenticated = ref(false)

let unsubscribe
function refreshAuth() {
  const state = session.getState()
  isAuthenticated.value = state.status === 'authenticated' && !!state.user
}

onMounted(() => {
  refreshAuth()
  unsubscribe = session.subscribe(refreshAuth)
})
onBeforeUnmount(() => unsubscribe?.())

async function onSync() {
  if (syncing.value) return

  syncing.value = true
  message.value = ''

  try {
    const summary = await syncNow()
    present(summary)
  } catch {
    // Unexpected rejection — never claim pending mutations failed because the
    // UI hit an exception. Present a safe, generic error and re-enable.
    message.value = 'Sync could not be completed. Try again in a moment.'
    tone.value = 'error'
  } finally {
    syncing.value = false
  }
}

function present(summary) {
  if (!isAuthenticated.value) {
    message.value = 'Signed out — changes stay on this device until you sign in'
    tone.value = 'muted'
    return
  }
  if (summary.pushed === 0) {
    message.value = 'Nothing to sync'
    tone.value = 'muted'
    return
  }
  // Priority: the most blocking outcome drives the message/tone.
  if (summary.unavailable > 0) {
    message.value = 'Sync unavailable — changes stay on this device. Try again later.'
    tone.value = 'error'
    return
  }
  if (summary.failed > 0) {
    message.value = `${summary.failed} change${summary.failed === 1 ? '' : 's'} couldn\u2019t be synced`
    tone.value = 'error'
    return
  }
  if (summary.conflict > 0) {
    message.value = `${summary.conflict} change${summary.conflict === 1 ? '' : 's'} updated both places — sync again to finish`
    tone.value = 'conflict'
    return
  }
  message.value = `Synced ${summary.succeeded} change${summary.succeeded === 1 ? '' : 's'}`
  tone.value = 'success'
}
</script>

<template>
  <section class="sync-card" aria-label="Cloud sync">
    <h4>Cloud Sync</h4>
    <p class="muted">Push your saved changes to the cloud.</p>
    <button
      type="button"
      class="btn"
      :disabled="syncing"
      :aria-busy="syncing ? 'true' : 'false'"
      @click="onSync"
    >
      Sync
    </button>
    <p class="sync-status" :class="tone" role="status" aria-live="polite">
      {{ syncing ? 'Syncing…' : message }}
    </p>
  </section>
</template>

<style scoped>
.sync-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
}
.sync-card h4 {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--text-h);
}
.muted {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 12px;
  line-height: 1.4;
}
.btn {
  appearance: none;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-h);
  padding: 8px 12px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn:hover:not(:disabled) {
  border-color: var(--accent-border);
  box-shadow: var(--shadow);
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.sync-status {
  font-size: 12px;
  margin: 10px 0 0;
  line-height: 1.4;
}
.sync-status.muted { color: var(--muted); }
.sync-status.success { color: var(--accent); }
.sync-status.conflict { color: #b45309; }
.sync-status.error { color: #ef4444; }
</style>
