<script setup>
import { computed } from 'vue'
import AppSelect from './AppSelect.vue'

// Bulk action bar — presentation only. App.vue owns the selection state and
// performs every action; this component renders the current state and emits
// intent events. Uses the existing AppSelect for the folder picker (same
// component the per-item menus use) — no new dropdown implementation.
const props = defineProps({
  selectedCount: { type: Number, default: 0 },
  visibleCount: { type: Number, default: 0 },
  allVisibleSelected: { type: Boolean, default: false },
  someVisibleSelected: { type: Boolean, default: false },
  folders: { type: Array, default: () => [] },
})

const emit = defineEmits(['select-all', 'clear', 'move', 'favorite', 'pin', 'delete'])

// Action-shaped options: '' = the trigger label, '__unfiled' maps to null in
// App.vue (the same "Unfiled" convention the per-item folder menus use).
const moveOptions = computed(() => [
  { value: '', label: 'Move to…' },
  { value: '__unfiled', label: 'Unfiled' },
  ...props.folders.map((f) => ({ value: f.id, label: f.name })),
])

function onMove(value) {
  if (!value) return
  emit('move', value)
}
</script>

<template>
  <div class="bulk-bar" role="region" aria-label="Bulk actions">
    <span class="bulk-count" aria-live="polite">{{ selectedCount }} selected</span>

    <button
      type="button"
      class="bulk-btn"
      :class="{ disabled: allVisibleSelected }"
      :aria-disabled="String(allVisibleSelected)"
      aria-label="Select all visible links"
      @click="!allVisibleSelected && emit('select-all')"
    >
      <svg class="bulk-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <span class="bulk-label">Select all {{ visibleCount }} visible</span>
    </button>

    <div class="bulk-move">
      <AppSelect
        id="bulk-move"
        :model-value="''"
        variant="header"
        :options="moveOptions"
        aria-label="Move selected links to a folder"
        @change="onMove"
      />
    </div>

    <button type="button" class="bulk-btn" aria-label="Toggle favorite for selected links" @click="emit('favorite')">
      <svg class="bulk-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C7 16.8 3 13.6 3 9.6 3 7 5 5 7.4 5c1.8 0 3.4 1 4.6 2.6C13.2 6 14.8 5 16.6 5 19 5 21 7 21 9.6c0 4-4 7.2-9 11.4z"/></svg>
      <span class="bulk-label">Favorite</span>
    </button>

    <button type="button" class="bulk-btn" aria-label="Toggle pin for selected links" @click="emit('pin')">
      <svg class="bulk-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6"/><path d="M10 4v6l-2 3h8l-2-3V4"/><path d="M12 13v7"/></svg>
      <span class="bulk-label">Pin</span>
    </button>

    <button type="button" class="bulk-btn danger" aria-label="Delete selected links" @click="emit('delete')">
      <svg class="bulk-icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      <span class="bulk-label">Delete</span>
    </button>

    <button type="button" class="bulk-clear" aria-label="Clear selection" @click="emit('clear')">
      <svg class="bulk-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
</template>

<style scoped>
.bulk-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding: 8px 14px;
  background: var(--accent-bg);
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
  min-width: 0;
}
.bulk-count {
  font-weight: var(--weight-semibold);
  color: var(--accent);
  white-space: nowrap;
}
.bulk-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--control-height-sm);
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-h);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
}
.bulk-btn.disabled { color: var(--muted); cursor: default; }
@media (hover: hover) and (pointer: fine) {
  .bulk-btn:not(.disabled):hover { background: var(--muted-bg); }
}
.bulk-btn:active { transform: scale(0.98); }
.bulk-btn.danger { color: var(--error, var(--danger, #b91c1c)); }
.bulk-btn:focus-visible,
.bulk-clear:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: 1px;
}
.bulk-icon { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.bulk-move { display: flex; align-items: center; min-width: 0; }
.bulk-clear {
  margin-left: auto;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .bulk-clear:hover { background: var(--muted-bg); color: var(--text-h); }
}

/* Narrow screens: labels collapse to icons, controls stay tappable (≥32px)
   and the bar wraps instead of overflowing. */
@media (max-width: 560px) {
  .bulk-bar { gap: 4px; padding: 6px 10px; }
  .bulk-label { display: none; }
  .bulk-btn { padding: 6px 8px; }
  .bulk-clear { width: 32px; height: 32px; }
}
</style>
