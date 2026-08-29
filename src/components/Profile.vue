<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  profile: { type: Object, required: true },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['update'])

const editing = ref(false)
const draftName = ref(props.profile.name)
const draftBio = ref(props.profile.bio)

watch(() => props.profile, (v) => {
  if (!editing.value) {
    draftName.value = v.name
    draftBio.value = v.bio
  }
})

function save() {
  emit('update', { name: draftName.value.trim() || 'Local User', bio: draftBio.value.trim() })
  editing.value = false
}
function cancel() {
  draftName.value = props.profile.name
  draftBio.value = props.profile.bio
  editing.value = false
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  return parts.map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'L'
}
</script>

<template>
  <div class="profile" :class="{ compact }">
    <div class="avatar">{{ initials(profile.name) }}</div>
    <div class="info">
      <template v-if="!editing">
        <div class="name">{{ profile.name }}</div>
        <div class="bio">{{ profile.bio }}</div>
        <button class="link-btn" @click="editing = true">Edit</button>
      </template>
      <template v-else>
        <input v-model="draftName" placeholder="Name" class="input sm" aria-label="Profile name" />
        <input v-model="draftBio" placeholder="Bio" class="input sm" aria-label="Profile bio" />
        <div class="row">
          <button class="btn primary sm" @click="save">Save</button>
          <button class="btn ghost sm" @click="cancel">Cancel</button>
        </div>
      </template>
    </div>
    <div class="badge-local">Local</div>
  </div>
</template>

<style scoped>
.profile {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  position: relative;
}
.avatar {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}
.info { flex: 1; min-width: 0; }
.name { font-weight: 700; color: var(--text-h); font-size: 15px; }
.bio { font-size: 13px; color: var(--muted); margin: 2px 0 6px; word-break: break-word; }
.link-btn {
  font-size: 12px;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
  font-size: 13px;
  margin-bottom: 6px;
  box-sizing: border-box;
}
.row { display: flex; gap: 8px; }
.badge-local {
  position: absolute;
  top: 10px;
  right: 10px;
  font-size: 10px;
  letter-spacing: .08em;
  text-transform: uppercase;
  background: var(--accent-bg);
  color: var(--accent);
  border: 1px solid var(--accent-border);
  padding: 3px 6px;
  border-radius: 999px;
}
.btn.sm { padding: 6px 10px; font-size: 12px; }

/* header variant: single row, no card chrome */
.profile.compact {
  background: none;
  border: none;
  padding: 4px 6px;
  gap: 8px;
  align-items: center;
  border-radius: 10px;
}
.profile.compact:hover { background: var(--muted-bg); }
.profile.compact .avatar { width: 30px; height: 30px; font-size: 11px; }
.profile.compact .name { font-size: 13px; line-height: 1.2; }
.profile.compact .bio,
.profile.compact .badge-local { display: none; }
.profile.compact .info { min-width: 0; }
.profile.compact .link-btn { font-size: 11px; }
.profile.compact .input { margin-bottom: 4px; padding: 5px 8px; font-size: 12px; width: 90px; max-width: 100%; }
.profile.compact .row { gap: 6px; flex-wrap: wrap; }
</style>
