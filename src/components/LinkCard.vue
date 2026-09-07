<script setup>
import { ref, watch } from 'vue'
import { CATEGORIES } from '../utils/categorize.js'

// Broad platform labels -> subtle, consistent icons (muted, not a large pill).
const PLATFORM_ICONS = {
  Windows: '💻',
  macOS: '🍎',
  Linux: '🐧',
  Android: '📱',
  iOS: '📱',
  ChromeOS: '💻',
}

// Intl.DateTimeFormat construction is costly; build both formatters once per
// page load instead of once per card per render (matters at 500–1000 links).
const LONG_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const SHORT_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const props = defineProps({
  link: { type: Object, required: true },
  folders: { type: Array, default: () => [] }
})
const emit = defineEmits(['toggle-important', 'toggle-must-have', 'toggle-favorite', 'set-status', 'delete', 'edit', 'set-folder'])

const imageFailed = ref(false)
watch(() => props.link.image, () => { imageFailed.value = false })
watch(() => props.link.normalizedUrl, () => { imageFailed.value = false })

function editCategory(e) {
  emit('edit', props.link.id, { category: e.target.value })
}

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
  imageFailed.value = false
}

function navUrl() {
  return props.link.normalizedUrl || props.link.url
}

function savedDateOf() {
  const c = props.link.createdAt
  if (!c) return null
  const d = new Date(c)
  return isNaN(d.getTime()) ? null : d
}

// Desktop: "Sep 1, 2026 · 12:18 AM"  /  narrow: "Sep 1 · 12:18 AM"
function longDate() {
  const d = savedDateOf()
  if (!d) return ''
  return LONG_FMT.format(d)
}
function shortDate() {
  const d = savedDateOf()
  if (!d) return ''
  return SHORT_FMT.format(d)
}

function platformName() {
  return props.link.savedFrom && props.link.savedFrom !== 'Unknown' ? props.link.savedFrom : ''
}
function platformIcon() {
  const n = platformName()
  return n ? PLATFORM_ICONS[n] || '' : ''
}

</script>

<template>
  <article class="card">
    <a v-if="link.image && !imageFailed" :href="navUrl()" target="_blank" rel="noopener noreferrer" class="thumb-wrap">
      <img :src="link.image" :alt="link.title" class="thumb" @error="imageFailed = true" loading="lazy" />
    </a>
    <div class="body">
      <template v-if="!editing">
        <div class="top">
          <div class="meta-left">
            <span class="category">{{ link.category }}</span>
            <span class="domain">{{ link.domain }}</span>
            <span v-if="link.folderId" class="folder-badge">{{ folders.find(f=>f.id===link.folderId)?.name || 'Folder' }}</span>
            <span v-else class="folder-badge muted-badge">Unfiled</span>
          </div>
          <div class="meta-right">
            <span v-if="savedDateOf()" class="saved-when">
              <time class="js-full" :datetime="link.createdAt">{{ longDate() }}</time>
              <time class="js-short" :datetime="link.createdAt">{{ shortDate() }}</time>
            </span>
            <span v-if="platformName()" class="saved-from">{{ platformIcon() }} {{ platformName() }}</span>
          </div>
        </div>
        <a :href="navUrl()" target="_blank" rel="noopener noreferrer" class="title">{{ link.title }}</a>
        <div class="url-line">
          <a :href="navUrl()" target="_blank" rel="noopener noreferrer" class="url" :title="link.originalUrl || link.url">{{ link.originalUrl || link.url }}</a>
          <span v-if="link.originalUrl && link.normalizedUrl && link.originalUrl !== link.normalizedUrl" class="normalized-hint"> → {{ link.normalizedUrl }}</span>
        </div>
        <p v-if="link.description" class="desc">{{ link.description }}</p>
        <div v-if="link.tags && link.tags.length" class="tags">
          <span v-for="t in link.tags" :key="t" class="tag">#{{ t }}</span>
        </div>
        <div class="actions">
          <div class="status-group">
            <button
              class="pill"
              :class="{ active: link.important }"
              :aria-pressed="String(!!link.important)"
              aria-label="Toggle Important"
              @click="emit('toggle-important', link.id)"
              title="Toggle Important"
            >
              <svg class="pill-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v4.5"/><path d="M12 15.5v.2"/></svg>
              <span>Important</span>
            </button>
            <button
              class="pill"
              :class="{ active: link.mustHave }"
              :aria-pressed="String(!!link.mustHave)"
              aria-label="Toggle Must Have"
              @click="emit('toggle-must-have', link.id)"
              title="Toggle Must Have"
            >
              <svg class="pill-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 20.8 12 12 20.8 3.2 12z" /></svg>
              <span>Must Have</span>
            </button>
            <button
              class="pill"
              :class="{ active: link.favorite }"
              :aria-pressed="String(!!link.favorite)"
              aria-label="Toggle Favorite"
              @click="emit('toggle-favorite', link.id)"
              title="Toggle Favorite"
            >
              <svg class="pill-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C7 16.8 3 13.6 3 9.6 3 7 5 5 7.4 5c1.8 0 3.4 1 4.6 2.6C13.2 6 14.8 5 16.6 5 19 5 21 7 21 9.6c0 4-4 7.2-9 11.4z" /></svg>
              <span>Favorite</span>
            </button>
          </div>
          <div class="right-actions">
            <label :for="'cat-' + link.id" class="sr-only">Category</label>
            <select :id="'cat-' + link.id" :value="link.category" @change="editCategory" class="cat-select" aria-label="Change category" title="Change category">
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
            <label :for="'move-folder-' + link.id" class="sr-only">Move to folder</label>
            <select :id="'move-folder-' + link.id" :value="link.folderId || ''" @change="emit('set-folder', link.id, $event.target.value)" class="cat-select" aria-label="Move to folder" title="Move to folder">
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
        </div>
      </template>
      <template v-else>
        <div class="edit-form">
          <label class="edit-field"><span>Title</span><input v-model="draftTitle" class="input edit-input" /></label>
          <label class="edit-field"><span>Description</span><textarea v-model="draftDesc" rows="2" class="input edit-input"></textarea></label>
          <label class="edit-field"><span>Image URL</span><input v-model="draftImage" placeholder="https://..." class="input edit-input" /></label>
          <label class="edit-field"><span>Tags (comma separated)</span><input v-model="draftTags" class="input edit-input" /></label>
          <label class="edit-field"><span>Category</span>
            <select v-model="draftCategory" class="input edit-input" aria-label="Edit category">
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </label>
          <label class="edit-field"><span>Folder</span>
            <select v-model="draftFolderId" class="input edit-input" aria-label="Edit folder">
              <option value="">Unfiled</option>
              <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
          </label>
          <div class="edit-actions">
            <button class="btn primary sm" @click="saveEdit">Save</button>
            <button class="btn ghost sm" @click="cancelEdit">Cancel</button>
          </div>
        </div>
      </template>
    </div>
  </article>
</template>

<style scoped>
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: box-shadow .15s, border-color .15s;
  animation: rise-in .22s ease both;
}
.card:hover { box-shadow: var(--elev-1); border-color: var(--accent-border); }
/* explicit editing state: accent border while the inline edit form is open
   (same token as LinkRow's .link-row.editing) */
.card:has(.edit-form) { border-color: var(--accent-border); }
.thumb-wrap { display: block; aspect-ratio: 16/9; overflow: hidden; background: var(--muted-bg); }
.thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.body { padding: 12px 14px 12px; display: flex; flex-direction: column; gap: 6px; }
.top { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px 12px; font-size: 12px; }
.meta-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.meta-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.3;
  text-align: right;
  white-space: nowrap;
}
.saved-when { display: inline-flex; }
.saved-from { display: inline-flex; align-items: center; gap: 4px; }
.js-full { display: inline; }
.js-short { display: none; }
.category {
  background: var(--accent-bg);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: .02em;
}
.domain { color: var(--muted); font-size: 12px; }
.folder-badge { background: var(--muted-bg); color: var(--text-h); padding:2px 6px; border-radius:999px; font-size:11px; }
.muted-badge { opacity:.7; }
.title {
  font-weight: 700;
  color: var(--text-h);
  text-decoration: none;
  line-height: 1.3;
  font-size: 15px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.title:hover { color: var(--accent); }
.url-line { margin-top: -2px; font-size: 12px; }
.url {
  color: var(--accent);
  word-break: break-all;
  text-decoration: none;
}
.url:hover { text-decoration: underline; }
.normalized-hint { color: var(--muted); font-size: 11px; }
.desc {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 2px 0 0;
}
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.tag {
  font-size: 11px;
  background: var(--muted-bg);
  color: var(--muted);
  padding: 3px 7px;
  border-radius: 999px;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}
.status-group { display: flex; gap: 6px; flex-wrap: wrap; }
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
  cursor: pointer;
  transition: color .15s, background .15s, border-color .15s, transform .1s ease;
}
.pill:hover { border-color: var(--accent-border); color: var(--text-h); }
.pill:active { transform: scale(0.96); }
.pill-icon { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
.pill.active { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.pill.active .pill-icon { fill: currentColor; stroke: currentColor; }
.cat-select {
  font-size: 12px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
}
.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: pointer;
  display: grid;
  place-items: center;
  color: var(--muted);
  transition: color .15s, background .15s, border-color .15s, transform .1s ease;
}
.icon-btn:hover { color: var(--text-h); border-color: var(--accent-border); }
.icon-btn:active { transform: scale(0.92); }
.icon-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.icon-btn.delete:hover { background: var(--error-bg); border-color: var(--border); color: var(--error); }
.right-actions { display: flex; gap: 6px; align-items: center; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.edit-form { display: flex; flex-direction: column; gap: 8px; }
.edit-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-h); }
.edit-input { font-weight: 400; }
.input {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
  font-size: 13px;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.edit-actions { display: flex; gap: 8px; margin-top: 6px; justify-content: flex-end; }
.btn.sm { padding: 6px 10px; font-size: 13px; }

@media (max-width: 520px) {
  .js-full { display: none; }
  .js-short { display: inline; }
}
@media (max-width: 768px) {
  .icon-btn { width: 40px; height: 40px; }
}
</style>
