<script setup>
import { ref, watch } from 'vue'
import { CATEGORIES, categorizeUrl, normalizeUrl, getDomain } from '../utils/categorize.js'
import { fetchMetadata } from '../utils/metadata.js'
import { useAnchoredPopover } from '../utils/anchoredPopover.js'
import AppSelect from './AppSelect.vue'

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

// Anchored, content-sized popover (no page expansion). The form is teleported
// to <body>; this helper flips it above/below the trigger based on viewport
// space and closes it on an outside click.
const toolbarTriggerEl = ref(null)
const anchorEl = ref(null)
const popoverEl = ref(null)
useAnchoredPopover({
  trigger: anchorEl,
  popover: popoverEl,
  isOpen: open,
  onOutside: () => { open.value = false },
  // Mobile presentation: viewport-centred below the shell breakpoint so the
  // form keeps equal margins instead of hanging off the bottom bar.
  mode: 'auto'
})

// Opens/toggles the popover anchored to the trigger that was used. Both the
// toolbar "Save a link" toggle and the header "+ Add link" button call this,
// so there is one form/state and only the anchor element differs.
function toggleFrom(el) {
  const anchor = el || anchorEl.value || toolbarTriggerEl.value
  if (open.value && anchorEl.value === anchor) {
    open.value = false
    return false
  }
  anchorEl.value = anchor
  open.value = true
  return true
}
function close() { open.value = false }

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
// Expose open/toggle so both triggers (toolbar toggle and header "+ Add link")
// reveal this one form without duplicating any state or logic.
defineExpose({ open, toggleFrom, close })
</script>

<template>
  <section class="add-card">
    <button ref="toolbarTriggerEl" type="button" class="add-toggle" :aria-expanded="open" aria-controls="add-form" @click="toggleFrom($event.currentTarget)">
      <span class="add-toggle-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </span>
      <span class="add-toggle-label">Save a link</span>
      <span class="add-toggle-hint" aria-hidden="true">Paste any URL — title, domain and preview auto-detect</span>
      <span class="add-toggle-caret" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ flipped: open }"><path d="m6 9 6 6 6-6"/></svg>
      </span>
    </button>

    <Teleport to="body">
      <Transition name="fade-down">
        <div v-if="open" id="add-form" ref="popoverEl" class="add-popover anchored-popover">
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
                <AppSelect id="save-category" v-model="category" variant="field" :options="CATEGORIES" aria-label="Category" />
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
              <AppSelect id="save-folder" v-model="folderId" variant="field" :options="[{ value: '', label: 'Unfiled' }, ...folders]" aria-label="Select folder" />
            </label>

            <p v-if="error" class="error">{{ error }}</p>

            <div class="form-actions">
              <button type="button" class="btn ghost" @click="cancelForm">Cancel</button>
              <button type="submit" class="btn primary">Save link</button>
            </div>
          </form>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.add-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px;
}
/* Toolbar "Save a link": the panel's primary action (solid primary button,
   same token as .btn.primary so it stays consistent in both themes). */
.add-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: auto;
  min-height: var(--control-height);
  background: var(--accent);
  color: var(--on-accent);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 0 var(--space-3);
  font-size: var(--text-md);
  text-align: left;
  transition: background-color var(--transition-fast), transform .1s ease;
}
.add-toggle:hover { background: var(--accent-hover); }
.add-toggle:active { transform: scale(0.98); }
.add-toggle:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
.add-toggle-icon {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--on-accent) 18%, transparent);
  border: none;
  color: var(--on-accent);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast), transform .1s ease;
}
.add-toggle-icon svg { width: 12px; height: 12px; }
.add-toggle:hover .add-toggle-icon { background: color-mix(in srgb, var(--on-accent) 28%, transparent); color: var(--on-accent); }
.add-toggle-label { font-weight: var(--weight-semibold); font-size: var(--text-md); }
.add-toggle-hint { font-size: 12.5px; color: var(--muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add-toggle-caret { color: currentColor; opacity: .8; display: inline-flex; }
.add-toggle-caret svg { width: 14px; height: 14px; transition: transform var(--transition-fast); }
.add-toggle-caret svg.flipped, .caret svg.flipped { transform: rotate(180deg); }
.add-title { margin: 0 0 10px; font-size: var(--text-lg); color: var(--text-h); }
.row { display: grid; gap: 10px; margin-bottom: 10px; }
.row-3 { grid-template-columns: 2fr 1.2fr 1fr; }
.row-2 { grid-template-columns: 1fr 1fr; }
.grow { min-width: 0; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field span:first-child { font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--text-h); }
/* Field visuals come from the shared .input base (src/app-overrides.css §11);
   the mobile tap-size override below still applies. */
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
  font-weight: var(--weight-semibold);
  color: var(--text-h);
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
}
.more-toggle:hover { background: var(--muted-bg); }
.more-toggle .caret { color: var(--muted); display: inline-flex; }
.more-toggle .caret svg { width: 13px; height: 13px; transition: transform var(--transition-fast); }
.more-toggle[aria-expanded="true"] { color: var(--accent); }
.more-toggle[aria-expanded="true"] .caret { color: var(--accent); }
.more-body { background: var(--muted-bg); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 10px; }
.meta-hint { font-size: var(--text-xs); color: var(--muted); }
.error { color: var(--error); font-size: var(--text-sm); margin: 0 0 10px; }
.btn.block { width: 100%; margin-top: 2px; }
.form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 14px; }
.checks { display: flex; gap: 14px; align-items: center; padding-top: 9px; flex-wrap: wrap; }
.check { font-size: var(--text-sm); color: var(--text-h); display: flex; gap: 6px; align-items: center; cursor: pointer; }
.check input { accent-color: var(--accent); }
@media (max-width: 640px) {
  .row-3 { grid-template-columns: 1fr; }
  .row-2 { grid-template-columns: 1fr; }
}

/* Mobile form presentation: comfortable tap targets — 44px, expressed with the
   existing control-height token plus the smallest space step — and 16px control
   text, which also stops iOS zooming the page when a field is focused. Desktop
   and tablet keep the compact sizing. The select fields are styled globally
   (.asel--field) alongside the popover itself. */
@media (max-width: 768px) {
  .input,
  .form-actions .btn {
    min-height: calc(var(--control-height) + var(--space-1));
    font-size: var(--text-lg);
  }
  .more-toggle {
    min-height: calc(var(--control-height) + var(--space-1));
  }
}
</style>
