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
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d)
}
function shortDate() {
  const d = savedDateOf()
  if (!d) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d)
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
            >★ Important</button>
            <button
              class="pill"
              :class="{ active: link.mustHave }"
              :aria-pressed="String(!!link.mustHave)"
              aria-label="Toggle Must Have"
              @click="emit('toggle-must-have', link.id)"
              title="Toggle Must Have"
            >◆ Must Have</button>
            <button
              class="pill"
              :class="{ active: link.favorite }"
              :aria-pressed="String(!!link.favorite)"
              aria-label="Toggle Favorite"
              @click="emit('toggle-favorite', link.id)"
              title="Toggle Favorite"
            >{{ link.favorite ? '♥ Favorite' : '☆ Favorite' }}</button>
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
            <button class="icon-btn" @click="startEdit" aria-label="Edit link" title="Edit">✎</button>
            <button class="icon-btn delete" @click="emit('delete', link.id)" aria-label="Delete link" title="Delete">✕</button>
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
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: box-shadow .15s, transform .15s;
}
.card:hover { box-shadow: var(--shadow); transform: translateY(-1px); }
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
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
  cursor: pointer;
}
.pill.active { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.cat-select {
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
}
.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.icon-btn.delete:hover { background: #fee2e2; border-color: #fecaca; color: #dc2626; }
.right-actions { display: flex; gap: 6px; align-items: center; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.edit-form { display: flex; flex-direction: column; gap: 8px; }
.edit-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-h); }
.edit-input { font-weight: 400; }
.input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
  font-size: 13px;
  outline: none;
}
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.edit-actions { display: flex; gap: 8px; margin-top: 6px; }
.btn.sm { padding: 6px 10px; font-size: 13px; }

@media (max-width: 520px) {
  .js-full { display: none; }
  .js-short { display: inline; }
}
</style>
