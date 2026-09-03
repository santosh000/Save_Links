<script setup>
const props = defineProps({
  profile: { type: Object, required: true },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['update', 'edit'])

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  return parts.map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'L'
}

// Clicking Edit (or the identity itself) opens the dedicated Local Profile
// panel in the parent instead of expanding inline inputs in the header.
function openEditor() {
  emit('edit')
}
</script>

<template>
  <div class="profile" :class="{ compact }">
    <div class="avatar">{{ initials(profile.name) }}</div>
    <button class="info" type="button" @click="openEditor">
      <div class="name">{{ profile.name }}</div>
      <div class="bio">{{ profile.bio }}</div>
    </button>
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
.info { flex: 1; min-width: 0; text-align: left; background: none; border: none; padding: 0; cursor: pointer; color: inherit; font: inherit; }
.info:hover .name { color: var(--accent); }
.name { font-weight: 700; color: var(--text-h); font-size: 15px; }
.bio { font-size: 13px; color: var(--muted); margin: 2px 0 0; word-break: break-word; }
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
</style>
