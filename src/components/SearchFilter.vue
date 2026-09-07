<script setup>
import { CATEGORIES } from '../utils/categorize.js'

defineProps({
  category: String,
  folder: String,
  sort: String,
  folders: { type: Array, default: () => [] },
  sortOptions: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:category', 'update:folder', 'update:sort'])
</script>

<template>
  <div class="filters">
    <div class="filter-group">
      <span class="filter-label" id="filter-group-label">
        <svg class="filter-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16l-6.5 8.2v5.6l-3 2V12.2z"/></svg>
        Filter by
      </span>
      <div class="selects">
        <label for="filter-category" class="sr-only">Filter by category</label>
        <select id="filter-category" :value="category" @change="emit('update:category', $event.target.value)" class="select" aria-label="Filter by category">
          <option value="">All categories</option>
          <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
        </select>
        <label for="filter-folder" class="sr-only">Filter by folder</label>
        <select id="filter-folder" :value="folder" @change="emit('update:folder', $event.target.value)" class="select" aria-label="Filter by folder">
          <option value="">All folders</option>
          <option value="__unfiled">Unfiled</option>
          <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
      </div>
    </div>
    <div class="sort">
      <label for="filter-sort" class="sort-label">Sort by</label>
      <select id="filter-sort" :value="sort" @change="emit('update:sort', $event.target.value)" class="select" aria-label="Sort by">
        <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--card);
  border-radius: var(--radius);
  padding: 14px;
}
.filter-group { display: flex; flex-direction: column; gap: 8px; }
.filter-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.filter-icon {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
}
/* single-column so each native select gets full width (no cramped popups/closures) */
.selects { display: grid; grid-template-columns: 1fr; gap: 8px; width: 100%; }
.sort {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.sort-label { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.sort .select { flex: 1; min-width: 0; }
.select {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
  font-size: 13px;
  width: 100%;
  min-width: 0;
  transition: border-color .15s, box-shadow .15s;
}
.select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
}
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
