<script setup>
import { computed } from 'vue'

const props = defineProps({
  total: Number,
  byCategory: Object,
  importantCount: Number,
  mustHaveCount: Number,
  favoriteCount: Number
})

const sortedCategories = computed(() => {
  return Object.entries(props.byCategory || {}).sort((a,b) => b[1]-a[1])
})

const maxCount = computed(() => {
  const vals = Object.values(props.byCategory || {})
  return Math.max(1, ...vals)
})
</script>

<template>
  <aside class="stats">
    <h3>Statistics</h3>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="num">{{ total }}</div>
        <div class="label">Total saved</div>
      </div>
      <div class="stat-card accent">
        <div class="num">{{ importantCount }}</div>
        <div class="label">Important</div>
      </div>
      <div class="stat-card dark">
        <div class="num">{{ mustHaveCount }}</div>
        <div class="label">Must Have</div>
      </div>
      <div class="stat-card" style="background: var(--muted-bg);">
        <div class="num">{{ favoriteCount }}</div>
        <div class="label">Favorites</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">By category</div>
      <div v-if="sortedCategories.length === 0" class="empty">No links yet.</div>
      <ul v-else class="cat-list">
        <li v-for="[cat, count] in sortedCategories" :key="cat" class="cat-row">
          <span class="cat-name">{{ cat }}</span>
          <div class="bar-wrap">
            <div class="bar" :style="{ width: (count / maxCount * 100) + '%' }"></div>
          </div>
          <span class="cat-count">{{ count }}</span>
        </li>
      </ul>
    </div>

    <div class="foot">Updates automatically • Local storage</div>
  </aside>
</template>

<style scoped>
.stats {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px;
}
h3 { margin: 0 0 12px; font-size: 14px; color: var(--text-h); }
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
.stat-card {
  background: var(--bg);
  border-radius: 10px;
  padding: 10px 6px;
  text-align: center;
}
.stat-card.accent { background: var(--accent-bg); }
.stat-card.dark { background: var(--text-h); color: var(--bg); }
.stat-card.dark .label { color: var(--bg); opacity: .7; }
.stat-card.dark .num { color: var(--bg); }
.num { font-size: 17px; font-weight: 800; color: var(--text-h); line-height: 1; }
.label { font-size: 10px; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: .05em; }
.section { margin-top: 6px; }
.section-title { font-size: 11px; font-weight: 700; color: var(--text-h); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .06em; }
.cat-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.cat-row { display: grid; grid-template-columns: 80px 1fr 22px; align-items: center; gap: 8px; font-size: 12.5px; }
.cat-name { color: var(--text-h); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-wrap { height: 5px; background: var(--muted-bg); border-radius: 999px; overflow: hidden; }
.bar { height: 100%; background: var(--accent); border-radius: 999px; transition: width .3s; }
.cat-count { text-align: right; color: var(--muted); font-weight: 600; }
.empty { font-size: 13px; color: var(--muted); }
.foot { margin-top: 12px; font-size: 11px; color: var(--muted); text-align: center; }
</style>
