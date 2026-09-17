<script setup>
// Local Profile panel — edits the LOCAL user identity (name + bio) shown in
// the header. Deliberately separate from the Online Account / authentication
// area (AccountPanel): this never touches the auth backend or cloud sync and
// is stored only on this device via the existing local profile storage.
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  name: { type: String, default: '' },
  bio: { type: String, default: '' },
})
const emit = defineEmits(['save', 'close'])

const input = ref(null)
const draftName = ref(props.name)
const draftBio = ref(props.bio)

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    draftName.value = props.name
    draftBio.value = props.bio
    nextTick(() => input.value?.focus())
  }
})
watch(() => props.name, (v) => {
  if (!props.open) draftName.value = v
})
watch(() => props.bio, (v) => {
  if (!props.open) draftBio.value = v
})

function close() {
  emit('close')
}
function save() {
  // Persist the local name + bio (trimmed, name falling back like the
  // existing profile save behavior) via the parent's local profile path.
  const name = draftName.value.trim() || 'Local User'
  const bio = draftBio.value.trim()
  emit('save', name, bio)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="lp-backdrop" @click.self="close">
      <div
        class="lp-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lp-title"
        @keydown.esc="close"
      >
        <div class="lp-head">
          <h2 id="lp-title" class="lp-title">Local Profile</h2>
          <button type="button" class="lp-close" aria-label="Close" @click="close">
            <svg class="lp-close-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <p class="lp-sub">Your local identity</p>

        <form @submit.prevent="save">
          <div class="lp-field">
            <label for="lp-name" class="lp-label">Name</label>
            <input
              id="lp-name"
              ref="input"
              v-model="draftName"
              class="input lp-input"
              type="text"
              autocomplete="off"
              placeholder="Local User"
              maxlength="40"
            />
          </div>

          <div class="lp-field">
            <label for="lp-bio" class="lp-label">Bio</label>
            <textarea
              id="lp-bio"
              v-model="draftBio"
              class="input lp-input lp-textarea"
              rows="3"
              autocomplete="off"
              placeholder="A short description"
              maxlength="200"
            ></textarea>
          </div>

          <p class="lp-note">This identity is stored only on this device. Changing it does not change your online account name.</p>

          <div class="lp-actions">
            <button type="button" class="btn ghost" @click="close">Cancel</button>
            <button type="submit" class="btn primary">Save changes</button>
          </div>
        </form>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lp-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-panel);
  background: var(--overlay);
  display: grid;
  place-items: center;
  padding: 16px;
}
.lp-panel {
  width: 100%;
  max-width: 460px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: 26px 28px;
}
.lp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.lp-title {
  margin: 0;
  font-size: 19px;
  color: var(--text-h);
}
.lp-close {
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border: none;
  background: transparent;
  color: var(--muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.lp-close:hover { background: var(--muted-bg); color: var(--text-h); }
.lp-close:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 1px; }
.lp-close-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.lp-sub { margin: 0 0 20px; font-size: var(--text-sm); color: var(--muted); }
.lp-field { margin-bottom: 16px; }
.lp-label { display: block; font-size: var(--text-sm); font-weight: var(--weight-semibold); color: var(--text-h); margin-bottom: 7px; }
/* Field visuals come from the shared .input base (src/app-overrides.css §11);
   only the panel's own textarea height is local. */
.lp-textarea {
  min-height: 92px;
  line-height: 1.45;
}
.lp-note {
  margin: 0 0 22px;
  font-size: 12.5px;
  line-height: var(--leading-normal);
  color: var(--muted);
  max-width: 34ch;
}
.lp-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
