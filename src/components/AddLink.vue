<script setup>
import { ref, watch } from 'vue'
import { CATEGORIES, categorizeUrl, normalizeUrl, getDomain } from '../utils/categorize.js'
import { fetchMetadata } from '../utils/metadata.js'

const props = defineProps({
  folders: { type: Array, default: () => [] }
})
const emit = defineEmits(['add'])

const open = ref(false)
const moreOpen = ref(false)
const url = ref('')
const title = ref('')
const description = ref('')
const image = ref('')
const category = ref('Other')
const tagsInput = ref('')
const important = ref(false)
const mustHave = ref(false)
const folderId = ref('')
const loadingMeta = ref(false)
const error = ref('')

let debounceTimer = null
let lastMeta = null
let lastMetaUrl = ''
let currentController = null
let currentRequestId = 0

watch(url, (v) => {
  clearTimeout(debounceTimer)
  if (!v.trim()) return
  debounceTimer = setTimeout(() => autoFill(v), 500)
})

async function autoFill(raw) {
  const normalized = normalizeUrl(raw)
  if (!normalized) return
  try { new URL(normalized) } catch { return }
  category.value = categorizeUrl(normalized)
  // Abort previous metadata request so stale response cannot overwrite current URL
  if (currentController) currentController.abort()
  currentController = new AbortController()
  const signal = currentController.signal
  const myId = ++currentRequestId
  loadingMeta.value = true
  error.value = ''
  try {
    const meta = await fetchMetadata(normalized, signal)
    // Ignore if aborted or superseded by a newer request
    if (signal.aborted || myId !== currentRequestId) return
    lastMeta = meta
    lastMetaUrl = normalized
    if (!title.value.trim() && meta.title) title.value = meta.title
    if (!description.value.trim() && meta.description) description.value = meta.description
    if (!image.value.trim() && meta.image) image.value = meta.image
  } catch (e) {
    if (signal.aborted || e?.name === 'AbortError') return
  } finally {
    if (myId === currentRequestId) loadingMeta.value = false
  }
}

function onSubmit() {
  error.value = ''
  const raw = url.value.trim()
  if (!raw) { error.value = 'Please paste a URL.'; return }
  const normalized = normalizeUrl(raw)
  try { new URL(normalized) } catch { error.value = 'Invalid URL.'; return }

  const tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean)
  const normalizedForCheck = normalizeUrl(raw)
  const usePrefetched = lastMeta && lastMetaUrl === normalizedForCheck
  emit('add', {
    originalUrl: raw,
    url: normalized,
    title: title.value.trim(),
    description: description.value.trim(),
    image: image.value.trim(),
    category: category.value,
    tags,
    important: important.value,
    mustHave: mustHave.value,
    folderId: folderId.value || null,
    _prefetchedMeta: usePrefetched ? lastMeta : null,
    _prefetchedUrl: usePrefetched ? lastMetaUrl : null
  })
  resetForm()
  // compact form: collapse after a successful save so cards stay dominant
  open.value = false
}

function resetForm() {
  url.value = ''
  title.value = ''
  description.value = ''
  image.value = ''
  tagsInput.value = ''
  important.value = false
  mustHave.value = false
  category.value = 'Other'
  folderId.value = ''
  lastMeta = null
  lastMetaUrl = ''
  moreOpen.value = false
  error.value = ''
}

function cancelForm() {
  resetForm()
  open.value = false
}

function handlePaste(e) {
  // let v-model handle, autoFill will trigger
}
// Expose the existing open state so the sticky-toolbar Add (+) can reveal
// this form and focus #save-url without duplicating any state or logic.
defineExpose({ open })
</script>

<template>
  <section class="add-card">
    <button type="button" class="add-toggle" :aria-expanded="open" aria-controls="add-form" @click="open = !open">
      <span class="add-toggle-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </span>
      <span class="add-toggle-label">Save a link</span>
      <span class="add-toggle-hint" aria-hidden="true">Paste any URL — title, domain and preview auto-detect</span>
      <span class="add-toggle-caret" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ flipped: open }"><path d="m6 9 6 6 6-6"/></svg>
      </span>
    </button>

    <Transition name="fade-down">
      <div v-if="open" id="add-form" class="add-body">
        <h3 class="add-title">Save a link</h3>
      <form @submit.prevent="onSubmit">
        <div class="row row-3">
          <label class="field grow" for="save-url">
            <span>URL *</span>
            <input id="save-url" v-model="url" @paste="handlePaste" placeholder="https://example.com/article" class="input" />
            <span v-if="loadingMeta" class="meta-hint">Detecting metadata…</span>
            <span v-else-if="url && getDomain(normalizeUrl(url))" class="meta-hint">{{ getDomain(normalizeUrl(url)) }} → {{ category }}</span>
          </label>
          <label class="field" for="save-title">
            <span>Title</span>
            <input id="save-title" v-model="title" placeholder="Auto or custom" class="input" />
          </label>
          <label class="field" for="save-category">
            <span>Category</span>
            <select id="save-category" v-model="category" class="input">
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </label>
        </div>

        <button type="button" class="more-toggle" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
          <span>More options</span>
          <span class="caret" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ flipped: moreOpen }"><path d="m6 9 6 6 6-6"/></svg>
          </span>
        </button>

        <Transition name="fade-down">
          <div v-if="moreOpen" class="more-body">
          <div class="row row-2">
            <label class="field" for="save-desc">
              <span>Description (preview)</span>
              <textarea id="save-desc" v-model="description" rows="2" placeholder="Auto when available" class="input"></textarea>
            </label>
            <label class="field" for="save-image">
              <span>Preview image URL (optional)</span>
              <input id="save-image" v-model="image" placeholder="https://..." class="input" />
            </label>
          </div>
          <div class="row row-2">
            <label class="field" for="save-tags">
              <span>Tags (comma separated)</span>
              <input id="save-tags" v-model="tagsInput" placeholder="reading, inspiration" class="input" />
            </label>
            <div class="field">
              <span>Status</span>
              <div class="checks">
                <label class="check"><input type="checkbox" v-model="important" /> Important</label>
                <label class="check"><input type="checkbox" v-model="mustHave" /> Must Have</label>
              </div>
            </div>
          </div>
        </div>
        </Transition>

        <label class="field" for="save-folder">
          <span>Folder</span>
          <select id="save-folder" v-model="folderId" class="input" aria-label="Select folder">
            <option value="">Unfiled</option>
            <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="form-actions">
          <button type="button" class="btn ghost" @click="cancelForm">Cancel</button>
          <button type="submit" class="btn primary">Save link</button>
        </div>
      </form>
    </div>
    </Transition>
  </section>
</template>

<style scoped>
.add-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px;
  /* keep the form clear of the sticky topbar + Saved links toolbar when the
     toolbar + button scrolls it into view */
  scroll-margin-top: 76px;
}
.add-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px 4px;
  text-align: left;
  color: var(--text-h);
}
.add-toggle:hover .add-toggle-label { color: var(--accent); }
.add-toggle-icon {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: var(--accent-bg);
  border: 1px solid var(--accent-border);
  color: var(--accent);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: background .15s, color .15s, border-color .15s, transform .1s ease;
}
.add-toggle-icon svg { width: 14px; height: 14px; }
.add-toggle:active .add-toggle-icon { transform: scale(0.92); }
.add-toggle:hover .add-toggle-icon { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.add-toggle-label { font-weight: 700; font-size: 14px; }
.add-toggle-hint { font-size: 12.5px; color: var(--muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add-toggle-caret { color: var(--muted); display: inline-flex; }
.add-toggle-caret svg { width: 14px; height: 14px; transition: transform .18s ease; }
.add-toggle-caret svg.flipped, .caret svg.flipped { transform: rotate(180deg); }
.add-body { margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--border); }
.add-title { margin: 0 0 10px; font-size: 15px; color: var(--text-h); }
.row { display: grid; gap: 10px; margin-bottom: 10px; }
.row-3 { grid-template-columns: 2fr 1.2fr 1fr; }
.row-2 { grid-template-columns: 1fr 1fr; }
.grow { min-width: 0; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field span:first-child { font-size: 12px; font-weight: 600; color: var(--text-h); }
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
textarea.input { resize: vertical; }
.more-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  margin: 0 0 10px -8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-h);
  cursor: pointer;
  transition: color .15s, background .15s;
}
.more-toggle:hover { background: var(--muted-bg); }
.more-toggle .caret { color: var(--muted); display: inline-flex; }
.more-toggle .caret svg { width: 13px; height: 13px; transition: transform .18s ease; }
.more-toggle[aria-expanded="true"] { color: var(--accent); }
.more-toggle[aria-expanded="true"] .caret { color: var(--accent); }
.more-body { border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 10px; }
.fade-down-enter-active, .fade-down-leave-active { transition: opacity .18s ease, transform .18s ease; }
.fade-down-enter-from, .fade-down-leave-to { opacity: 0; transform: translateY(4px); }
.meta-hint { font-size: 11px; color: var(--muted); }
.error { color: var(--error); font-size: 13px; margin: 0 0 10px; }
.btn.block { width: 100%; margin-top: 2px; }
.form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 14px; }
.checks { display: flex; gap: 14px; align-items: center; padding-top: 9px; flex-wrap: wrap; }
.check { font-size: 13px; color: var(--text-h); display: flex; gap: 6px; align-items: center; cursor: pointer; }
.check input { accent-color: var(--accent); }
@media (max-width: 640px) {
  .row-3 { grid-template-columns: 1fr; }
  .row-2 { grid-template-columns: 1fr; }
}
</style>
