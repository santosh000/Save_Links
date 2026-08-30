<script setup>
import { CATEGORIES } from '../utils/categorize.js'

defineProps({
  category: String,
  folder: String,
  folders: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:category', 'update:folder'])
</script>

<template>
  <div class="filters">
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
</template>

<style scoped>
.filters {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 16px;
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
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
