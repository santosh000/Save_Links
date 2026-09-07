<script setup>
import { ref, watch, computed } from 'vue'
import { CATEGORIES } from '../utils/categorize.js'

// Intl.DateTimeFormat construction is costly; build once per page load
// instead of once per row per render (matters at 500–1000 links).
const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

// LIST (scanning) and COMPACT (dense) share one row presentation; the mode
// prop only changes density and meta visibility. All actions are identical to
// LinkCard and route through the same App.vue handlers.
const props = defineProps({
  link: { type: Object, required: true },
  folders: { type: Array, default: () => [] },
  mode: { type: String, default: 'list' } // 'list' | 'compact'
})
const emit = defineEmits(['toggle-important', 'toggle-must-have', 'toggle-favorite', 'set-status', 'delete', 'edit', 'set-folder'])

function navUrl() {
  return props.link.normalizedUrl || props.link.url
}

// Fallback when domain metadata is missing: derive host from the URL itself.
// Computed so the URL parse only reruns when the link really changes.
const domainText = computed(() => {
  if (props.link.domain) return props.link.domain
  try { return new URL(navUrl()).host } catch { return '' }
})

function savedDate() {
  const c = props.link.createdAt
  if (!c) return ''
  const d = new Date(c)
  if (isNaN(d.getTime())) return ''
  return DATE_FMT.format(d)
}

const folderName = () => {
  if (!props.link.folderId) return ''
  return props.folders.find(f => f.id === props.link.folderId)?.name || ''
}

// Inline edit — same fields as LinkCard's edit form (business logic stays in App).
const editing = ref(false)
const draftTitle = ref('')
const draftDesc = ref('')
const draftImage = ref('')
const draftTags = ref('')
const draftCategory = ref('Other')
const draftFolderId = ref('')

function startEdit() {
  draftTitle.value = props.link.title
  draftDesc.value = props.link.description || ''
  draftImage.value = props.link.image || ''
  draftTags.value = (props.link.tags || []).join(', ')
  draftCategory.value = props.link.category
  draftFolderId.value = props.link.folderId || ''
  editing.value = true
}
function cancelEdit() { editing.value = false }
function saveEdit() {
  const tags = draftTags.value.split(',').map(t => t.trim()).filter(Boolean)
  emit('edit', props.link.id, {
    title: draftTitle.value.trim().slice(0, 200) || props.link.title,
    description: draftDesc.value.trim().slice(0, 400),
    image: draftImage.value.trim(),
    tags,
    category: draftCategory.value,
    folderId: draftFolderId.value || null
  })
  editing.value = false
}

watch(() => props.link.title, () => { if (editing.value) editing.value = false })
</script>

<template>
  <article class="link-row" :class="[mode, { editing }]">
    <a v-if="!editing" :href="navUrl()" target="_blank" rel="noopener noreferrer" class="row-main" :title="link.title">
      <span class="row-favicon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z"/></svg>
      </span>
      <span class="row-text">
        <span class="row-title">{{ link.title }}</span>
        <span class="row-meta">
          <span class="row-domain">{{ domainText }}</span>
          <span v-if="mode === 'list'" class="row-chips" aria-hidden="false">
            <span class="chip chip-cat">{{ link.category }}</span>
            <span class="chip">{{ link.folderId ? folderName() : 'Unfiled' }}</span>
            <span v-if="savedDate()" class="chip chip-date">{{ savedDate() }}</span>
            <span v-if="link.tags && link.tags.length" class="chip chip-tags">#{{ link.tags.slice(0, 3).join(' · #') }}</span>
          </span>
        </span>
      </span>
    </a>

    <div v-if="!editing" class="row-actions">
      <button
        class="row-toggle"
        :class="{ active: link.important }"
        :aria-pressed="String(!!link.important)"
        aria-label="Toggle Important"
        title="Important"
        @click="emit('toggle-important', link.id)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z" /></svg>
      </button>
      <button
        class="row-toggle"
        :class="{ active: link.mustHave }"
        :aria-pressed="String(!!link.mustHave)"
        aria-label="Toggle Must Have"
        title="Must Have"
        @click="emit('toggle-must-have', link.id)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 20.8 12 12 20.8 3.2 12z" /></svg>
      </button>
      <button
        class="row-toggle"
        :class="{ active: link.favorite }"
        :aria-pressed="String(!!link.favorite)"
        aria-label="Toggle Favorite"
        title="Favorite"
        @click="emit('toggle-favorite', link.id)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C7 16.8 3 13.6 3 9.6 3 7 5 5 7.4 5c1.8 0 3.4 1 4.6 2.6C13.2 6 14.8 5 16.6 5 19 5 21 7 21 9.6c0 4-4 7.2-9 11.4z" /></svg>
      </button>
      <label :for="'row-cat-' + link.id" class="sr-only">Category</label>
      <select :id="'row-cat-' + link.id" :value="link.category" @change="emit('edit', link.id, { category: $event.target.value })" class="row-select" aria-label="Change category" title="Change category">
        <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
      </select>
      <label :for="'row-folder-' + link.id" class="sr-only">Move to folder</label>
      <select :id="'row-folder-' + link.id" :value="link.folderId || ''" @change="emit('set-folder', link.id, $event.target.value)" class="row-select" aria-label="Move to folder" title="Move to folder">
        <option value="">Unfiled</option>
        <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
      </select>
      <button class="icon-btn" @click="startEdit" aria-label="Edit link" title="Edit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="icon-btn delete" @click="emit('delete', link.id)" aria-label="Delete link" title="Delete">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>

    <div v-else class="row-edit">
      <div class="edit-grid">
        <label class="edit-field grow2"><span>Title</span><input v-model="draftTitle" class="input" /></label>
        <label class="edit-field"><span>Category</span>
          <select v-model="draftCategory" class="input">
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label class="edit-field"><span>Folder</span>
          <select v-model="draftFolderId" class="input">
            <option value="">Unfiled</option>
            <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
        </label>
        <label class="edit-field grow2"><span>Description</span><textarea v-model="draftDesc" rows="2" class="input"></textarea></label>
        <label class="edit-field"><span>Image URL</span><input v-model="draftImage" placeholder="https://..." class="input" /></label>
        <label class="edit-field grow2"><span>Tags (comma separated)</span><input v-model="draftTags" class="input" /></label>
      </div>
      <div class="edit-actions">
        <button class="btn primary sm" @click="saveEdit">Save</button>
        <button class="btn ghost sm" @click="cancelEdit">Cancel</button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.link-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 10px 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: box-shadow .15s, border-color .15s;
}
.link-row:hover { box-shadow: var(--elev-1); border-color: var(--accent-border); }
.link-row.editing { align-items: stretch; }
.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  text-decoration: none;
  color: inherit;
}
.row-favicon {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: var(--muted-bg);
  color: var(--muted);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.row-favicon svg { width: 16px; height: 16px; }
.row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.row-title {
  font-weight: 700;
  font-size: 14px;
  color: var(--text-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.link-row:hover .row-title { color: var(--accent); }
.row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  min-width: 0;
}
.row-domain { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-chips { display: inline-flex; gap: 6px; align-items: center; min-width: 0; overflow: hidden; }
.chip {
  background: var(--muted-bg);
  color: var(--text-h);
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.chip-cat { background: var(--accent-bg); color: var(--accent); }
.chip-date, .chip-tags { color: var(--muted); }
.row-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.row-toggle {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: color .15s, background .15s, border-color .15s, transform .1s ease;
}
.row-toggle svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
.row-toggle:hover { color: var(--text-h); background: var(--muted-bg); border-color: var(--border); }
.row-toggle:active { transform: scale(0.92); }
/* Active states emphasize the filled icon in the accent color over a solid
   button surface; hover adds a subtle accent tint (stronger than the neutral
   hover) without a filled background. Hit area is unchanged. */
.row-toggle.active { background: transparent; border-color: transparent; color: var(--accent); }
.row-toggle.active:hover { background: var(--accent-bg); }
.row-toggle.active svg { fill: currentColor; stroke: currentColor; }
.row-select {
  font-size: 12px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
  max-width: 130px;
}
.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-items: center;
  color: var(--muted);
  transition: color .15s, background .15s, border-color .15s, transform .1s ease;
}
.icon-btn:hover { color: var(--text-h); background: var(--muted-bg); border-color: var(--border); }
.icon-btn:active { transform: scale(0.92); }
.icon-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.icon-btn.delete:hover { background: var(--error-bg); border-color: var(--border); color: var(--error); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

/* Inline edit block (same fields as LinkCard) */
.row-edit { flex: 1 1 100%; display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px dashed var(--border); }
.edit-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
.grow2 { grid-column: span 2; }
.edit-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-h); min-width: 0; }
.edit-actions { display: flex; gap: 8px; }
.input {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
  font-size: 13px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  transition: border-color .15s, box-shadow .15s;
}
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.btn.sm { padding: 6px 10px; font-size: 13px; }

/* COMPACT: denser scanning rows, meta chips off, smaller chrome */
.link-row.compact {
  padding: 5px 10px;
  gap: 4px 10px;
  border-radius: var(--radius-sm);
}
.compact .row-favicon { width: 26px; height: 26px; }
.compact .row-favicon svg { width: 13px; height: 13px; }
.compact .row-title { font-size: 13px; }
.compact .row-meta { font-size: 11px; }
.compact .row-chips { display: none; }
.compact .row-toggle { width: 28px; height: 28px; }
.compact .row-toggle svg { width: 13px; height: 13px; }
.compact .row-select { font-size: 11px; padding: 4px 6px; max-width: 110px; }
.compact .icon-btn { width: 28px; height: 28px; }
.compact .icon-btn svg { width: 13px; height: 13px; }
.compact .edit-grid { grid-template-columns: 1fr 1fr; }

@media (max-width: 768px) {
  .row-toggle, .icon-btn { width: 40px; height: 40px; }
  .compact .row-toggle, .compact .icon-btn { width: 34px; height: 34px; }
}
@media (max-width: 480px) {
  .row-favicon { display: none; }
  .grow2 { grid-column: span 1; }
  /* Mobile List: full-width title/domain line, then ONE action line of
     status toggles + edit/delete. The row-level Category/Folder selects
     step aside to the inline Edit form (same fields, one tap away via the
     always-visible Edit button); category/folder stay glanceable as chips
     right under the domain. Compact (scan mode) is untouched. */
  .link-row:not(.compact) .row-select { display: none; }
  .link-row:not(.compact) .chip-date,
  .link-row:not(.compact) .chip-tags { display: none; }
}
</style>