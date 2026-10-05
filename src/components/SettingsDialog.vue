<script setup>
// P15.12 — the Settings/About modal content: one section nav + the existing
// SaveLink panes (appearance, profile summary, backup/restore, about). The
// modal shell itself is AppDialog (size="wide"), so backdrop, Escape, focus
// trap/restore and the mobile sheet presentation stay in one place.
import Icon from './Icon.vue'
import SettingsPanel from './SettingsPanel.vue'
import DataBackup from './DataBackup.vue'
import About from './About.vue'

const props = defineProps({
  section: { type: String, default: 'general' },
  appearance: { type: String, required: true },
  colorScheme: { type: String, required: true },
  profile: { type: Object, required: true },
  initials: { type: String, default: '' },
  signedIn: { type: Boolean, default: false },
  links: { type: Array, default: () => [] },
  folders: { type: Array, default: () => [] },
  version: { type: String, default: '' }
})
const emit = defineEmits(['update:section', 'update:appearance', 'update:color-scheme', 'import-request', 'show-toast', 'open-account'])

// One coherent section list: only surfaces SaveLink actually has.
const SECTIONS = [
  { value: 'general', label: 'General', icon: 'settings' },
  { value: 'profile', label: 'Profile', icon: 'atom' },
  { value: 'data', label: 'Data', icon: 'database' },
  { value: 'about', label: 'About', icon: 'info' },
]
</script>

<template>
  <div class="settings-dialog">
    <nav class="settings-nav" aria-label="Settings sections">
      <button
        v-for="s in SECTIONS"
        :key="s.value"
        type="button"
        class="settings-nav-item"
        :class="{ active: section === s.value }"
        :aria-current="section === s.value ? 'true' : undefined"
        @click="emit('update:section', s.value)"
      >
        <Icon :name="s.icon" size="sm" />
        <span>{{ s.label }}</span>
      </button>
    </nav>

    <div class="settings-pane">
      <div :key="section" class="settings-section">
        <SettingsPanel
          v-if="section === 'general'"
          :appearance="appearance"
          :color-scheme="colorScheme"
          @update:appearance="emit('update:appearance', $event)"
          @update:color-scheme="emit('update:color-scheme', $event)"
        />

        <section v-else-if="section === 'profile'" class="profile-pane" aria-label="Profile">
          <header class="section-head">
            <h4>Profile</h4>
            <p class="section-desc">Manage your local account and preferences.</p>
          </header>
          <div class="profile-card">
            <div class="profile-avatar" aria-hidden="true">{{ initials }}</div>
            <div class="profile-id">
              <strong>{{ profile.name || 'Local User' }}</strong>
              <span>{{ signedIn ? 'Signed in · synced across devices' : 'Local-first · saved on this device' }}</span>
            </div>
          </div>
          <dl class="profile-stats">
            <div><dt>Links</dt><dd>{{ links.length }}</dd></div>
            <div><dt>Folders</dt><dd>{{ folders.length }}</dd></div>
          </dl>
          <button type="button" class="btn secondary" @click="emit('open-account')">Manage account</button>
        </section>

        <DataBackup
          v-else-if="section === 'data'"
          :links="links"
          :profile="profile"
          :folders="folders"
          :appearance="appearance"
          :color-scheme="colorScheme"
          @import-request="emit('import-request', $event)"
          @show-toast="emit('show-toast', $event)"
        />

        <About v-else :version="version" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-dialog { display: flex; align-items: stretch; height: 100%; min-height: 0; }
/* Dedicated settings sidebar: an inset step of the raised modal surface (never
   the page canvas), so the whole dialog reads as one layer above the dimmed
   application. Width 256px (8 × --space-6), matching the reference proportions. */
.settings-nav {
  width: calc(var(--space-6) * 8);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-5);
  background: var(--muted-bg);
  border-inline-end: 1px solid var(--border);
}
.settings-nav-item {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 40px;
  padding: 10px var(--space-3);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--muted);
  font-size: var(--text-sm);
  font-weight: 400;
  text-align: start;
  cursor: pointer;
  /* Leaving the active state must clear in the same frame the new section
     renders (never two visually-selected items); entering fades in over the
     reference 300ms. */
  transition: color 0s, background-color 0s, transform var(--transition-fast);
}
.settings-nav-item svg { transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
@media (hover: hover) and (pointer: fine) {
  .settings-nav-item:hover {
    background: var(--muted-bg);
    color: var(--text-h);
    transition: color 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform var(--transition-fast);
  }
  .settings-nav-item:hover svg { transform: scale(1.1); }
}
/* Subtle press feedback (no bounce). */
.settings-nav-item:active { transform: scale(0.985); }
/* Restrained active treatment: soft accent fill + accent text + a small
   leading accent indicator (same idea as the reference, SaveLink tokens).
   The outgoing indicator clears immediately while the incoming one fades in,
   so the active item can never look stale during a section switch. */
.settings-nav-item::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 3px;
  background: var(--accent);
  border-radius: 0 var(--radius-full) var(--radius-full) 0;
  opacity: 0;
  transition: opacity 0s;
}
.settings-nav-item.active::before { opacity: 1; transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.settings-nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: var(--weight-medium);
  transition: color 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform var(--transition-fast);
}
.settings-nav-item:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 1px; }

.settings-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  /* reference content padding (p-10) */
  padding: 40px;
}

/* Section switching: the reference tab motion exactly — 400ms with a strongly
   decelerating curve and forwards fill. Enter-only: the old section is simply
   replaced, and the shell/header/sidebar never move. */
.settings-section {
  min-width: 0;
  animation: settings-section-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes settings-section-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Shared section heading (each pane's own title uses the same rhythm). */
.section-head { margin-bottom: 40px; }
.section-head h4 { margin: 0 0 var(--space-1); font-size: var(--text-2xl); font-weight: var(--weight-semibold); line-height: 1.2; color: var(--text-h); }
.section-desc { margin: 0; font-size: var(--text-sm); color: var(--muted); line-height: var(--leading-normal); }

/* Profile: identity card + statistics + the existing account entry — the
   reference's gap/padding/margin rhythm with SaveLink surfaces. */
.profile-card {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  margin-bottom: 40px;
  padding: var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg);
}
.profile-avatar {
  width: calc(var(--control-height) * 2);
  height: calc(var(--control-height) * 2);
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent-strong);
  color: var(--accent-text-on-strong);
  font-size: var(--text-2xl);
  font-weight: var(--weight-bold);
  flex-shrink: 0;
}
.profile-id { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.profile-id strong { color: var(--text-h); font-size: var(--text-xl); font-weight: var(--weight-semibold); }
.profile-id span { color: var(--muted); font-size: var(--text-sm); }
.profile-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0 0 40px;
}
.profile-stats > div {
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  min-width: 120px;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}
.profile-stats dt { color: var(--muted); font-size: 10px; font-weight: var(--weight-bold); text-transform: uppercase; letter-spacing: .1em; }
.profile-stats dd { margin: 0; color: var(--text-h); font-size: var(--text-2xl); font-weight: var(--weight-bold); line-height: 1; }

/* Profile action: reference geometry (px-6 py-3, 12px radius) with the
   reference's hover/press scaling on SaveLink's button recipe. */
.profile-pane .btn {
  min-height: calc(var(--control-height) + var(--space-1));
  padding: 0 var(--space-5);
  border-radius: var(--radius);
  transition: background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s cubic-bezier(0.4, 0, 0.2, 1), color 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
@media (hover: hover) and (pointer: fine) {
  .profile-pane .btn:hover { transform: scale(1.02); }
}
.profile-pane .btn:active { transform: scale(0.98); }

/* Mobile: the section nav becomes a horizontal row above the pane. It owns its
   own horizontal scroll (min-width: 0) so it can never widen the shell. */
@media (max-width: 767px) {
  .settings-dialog { flex-direction: column; }
  .settings-nav {
    width: auto;
    max-width: 100%;
    min-width: 0;
    flex-direction: row;
    gap: var(--space-1);
    padding: var(--space-2);
    overflow-x: auto;
    border-inline-end: none;
    border-bottom: 1px solid var(--border);
    scrollbar-width: none;
  }
  .settings-nav::-webkit-scrollbar { display: none; }
  .settings-nav-item { flex-shrink: 0; }
  .settings-pane { padding: var(--space-4); }
}

/* Reduced motion: no section rise, no icon/nav/button movement. */
@media (prefers-reduced-motion: reduce) {
  .settings-section { animation: none; }
  .settings-nav-item svg,
  .settings-nav-item:hover svg,
  .settings-nav-item:active,
  .profile-pane .btn:hover,
  .profile-pane .btn:active { transform: none; }
}
</style>
