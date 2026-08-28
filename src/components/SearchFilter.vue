<script setup>
import { CATEGORIES } from '../utils/categorize.js'

defineProps({
  search: String,
  category: String,
  status: String,
  folder: String,
  folders: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:search', 'update:category', 'update:status', 'update:folder'])
</script>

<template>
  <div class="filters">
    <div class="search-wrap">
      <span class="icon" aria-hidden="true">⌕</span>
      <label for="filter-search" class="sr-only">Search</label>
      <input id="filter-search" :value="search" @input="emit('update:search', $event.target.value)" placeholder="Search title, URL, domain, tags…" class="search-input" aria-label="Search links" />
      <button v-if="search" class="clear" @click="emit('update:search', '')" aria-label="Clear search">✕</button>
    </div>
    <div class="selects">
      <label for="filter-status" class="sr-only">Filter by status</label>
      <select id="filter-status" :value="status" @change="emit('update:status', $event.target.value)" class="select select-wide" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="important">Important</option>
        <option value="must-have">Must Have</option>
        <option value="none">No status</option>
        <option value="favorite">Favorites</option>
        <option value="not-favorite">No favorite</option>
      </select>
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
</template>

<style scoped>
.filters {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 16px;
}
.search-wrap {
  flex: 1;
  min-width: 240px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 12px;
}
.icon { color: var(--muted); font-size: 16px; }
.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-h);
  font-size: 14px;
}
.clear {
  background: var(--muted-bg);
  border: none;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--muted);
}
.selects { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; }
.select {
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-h);
  font-size: 13px;
  width: 100%;
  min-width: 0;
}
.select-wide { grid-column: 1 / -1; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
