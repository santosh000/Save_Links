<script setup>
import { ref, watch } from 'vue'
import { CATEGORIES, categorizeUrl, normalizeUrl, getDomain } from '../utils/categorize.js'
import { LINK_TYPES, LINK_TYPE_LABELS } from '../domain/link.js'
import { fetchMetadata } from '../utils/metadata.js'
import AppSelect from './AppSelect.vue'
import AppDialog from './AppDialog.vue'

// '' = Auto (detect): the submitted payload omits `type`, so buildLinkSpec
// applies the conservative creation-time heuristic (or 'other'). Choosing an
// explicit type always wins. The pills keep every LINK_TYPES value + Auto.
const TYPE_OPTIONS = [
  { value: '', label: 'Auto' },
  ...LINK_TYPES.map((t) => ({ value: t, label: LINK_TYPE_LABELS[t] })),
]

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
const pinned = ref(false)
const favorite = ref(false)
const type = ref('')
const folderId = ref('')
const loadingMeta = ref(false)
const error = ref('')

// Mockup modal model (P15 Group 3): the same AppDialog shell used across the
// app renders the form as a bottom sheet <768 and a centred panel >=768. The
// dialog owns Escape/backdrop/focus; this component owns only the draft fields.
function toggleFrom() {
  if (open.value) { open.value = false; return false }
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
    // Never clobber text the user already typed: metadata only fills blanks.
    if (!title.value.trim() && meta.title) title.value = meta.title
    if (!description.value.trim() && meta.description) description.value = meta.description
    if (!image.value.trim() && meta.image) image.value = meta.image
  } catch (e) {
    if (signal.aborted || e?.name === 'AbortError') return
  } finally {
    if (myId === currentRequestId) loadingMeta.value = false
  }
}

// Explicit Fetch control (mockup .fetch-btn): the same metadata path as the
// automatic paste/blur fill. The pending debounce is cancelled so one user
// gesture never starts two requests; autoFill itself aborts any in-flight one.
function fetchNow() {
  clearTimeout(debounceTimer)
  if (!url.value.trim()) return
  autoFill(url.value)
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
    pinned: pinned.value,
    favorite: favorite.value,
    type: type.value || undefined,
    folderId: folderId.value || null,
    _prefetchedMeta: usePrefetched ? lastMeta : null,
    _prefetchedUrl: usePrefetched ? lastMetaUrl : null
  })
  resetForm()
  // The dialog closes after a successful save so the library stays dominant.
  open.value = false
}

function resetForm() {
  url.value = ''
  title.value = ''
  description.value = ''
  image.value = ''
  tagsInput.value = ''
  pinned.value = false
  favorite.value = false
  type.value = ''
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

// Expose open/toggle so both triggers (toolbar toggle and header "+ Add link")
// reveal this one form without duplicating any state or logic.
defineExpose({ open, toggleFrom, close })
</script>

<template>
  <section class="add-card">
    <button type="button" class="add-toggle" :aria-expanded="open" aria-controls="add-form" @click="toggleFrom">
      <span class="add-toggle-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </span>
      <span class="add-toggle-label">Add link</span>
      <span class="add-toggle-hint" aria-hidden="true">Paste any URL — title, domain and preview auto-detect</span>
      <span class="add-toggle-caret" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ flipped: open }"><path d="m6 9 6 6 6-6"/></svg>
      </span>
    </button>

    <AppDialog :open="open" title="Save new link" :buttons="[]" initial-focus="#save-url" @close="close">
      <form id="add-form" novalidate @submit.prevent="onSubmit">
        <div class="field">
          <label for="save-url">URL *</label>
          <div class="url-row">
            <input id="save-url" v-model="url" type="url" inputmode="url" autocapitalize="none" autocorrect="off" enterkeyhint="done" placeholder="https://example.com/article" class="input" />
            <button type="button" class="fetch-btn" :disabled="loadingMeta || !url.trim()" @click="fetchNow">
              <span v-if="loadingMeta" class="fetch-spinner" aria-hidden="true"></span>
              <span>{{ loadingMeta ? 'Fetching…' : 'Fetch' }}</span>
            </button>
          </div>
          <span v-if="loadingMeta" class="meta-hint">Detecting metadata…</span>
          <span v-else-if="url && getDomain(normalizeUrl(url))" class="meta-hint">{{ getDomain(normalizeUrl(url)) }} → {{ category }}</span>
        </div>

        <label class="field" for="save-title">
          <span>Title</span>
          <input id="save-title" v-model="title" placeholder="Auto or custom" class="input" />
        </label>

        <label class="field" for="save-desc">
          <span>Description</span>
          <textarea id="save-desc" v-model="description" rows="2" placeholder="Auto when available" class="input"></textarea>
        </label>

        <div class="field">
          <span>Type</span>
          <div class="type-pills" role="radiogroup" aria-label="Type">
            <button
              v-for="o in TYPE_OPTIONS"
              :key="o.value"
              type="button"
              class="type-pill"
              :class="{ active: type === o.value }"
              role="radio"
              :aria-checked="String(type === o.value)"
              @click="type = o.value"
            >{{ o.label }}</button>
          </div>
        </div>

        <label class="field" for="save-folder">
          <span>Folder</span>
          <AppSelect id="save-folder" v-model="folderId" variant="field" :options="[{ value: '', label: 'Unfiled' }, ...folders]" aria-label="Select folder" />
        </label>

        <label class="field" for="save-tags">
          <span>Tags (comma separated)</span>
          <input id="save-tags" v-model="tagsInput" autocapitalize="none" autocorrect="off" placeholder="reading, inspiration" class="input" />
        </label>

        <!-- Compact action row: the two state toggles plus the subordinate
             More options disclosure, all on one deliberate line. -->
        <div class="quick-row">
          <label class="switch">
            <input type="checkbox" v-model="favorite" />
            <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
            <span class="switch-label">Favorite</span>
          </label>

          <label class="switch">
            <input type="checkbox" v-model="pinned" />
            <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
            <span class="switch-label">Pinned</span>
          </label>

          <button type="button" class="more-toggle" :aria-expanded="moreOpen" aria-controls="add-more" @click="moreOpen = !moreOpen">
            <span>More options</span>
            <span class="caret" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ flipped: moreOpen }"><path d="m6 9 6 6 6-6"/></svg>
            </span>
          </button>
        </div>

        <Transition name="fade-down">
          <div v-if="moreOpen" id="add-more" class="more-body">
            <label class="field" for="save-category">
              <span>Category</span>
              <AppSelect id="save-category" v-model="category" variant="field" :options="CATEGORIES" aria-label="Category" />
            </label>
            <label class="field" for="save-image">
              <span>Image URL (optional)</span>
              <input id="save-image" v-model="image" type="url" inputmode="url" autocapitalize="none" autocorrect="off" placeholder="https://..." class="input" />
            </label>
          </div>
        </Transition>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="form-actions">
          <button type="button" class="btn ghost" @click="cancelForm">Cancel</button>
          <button type="submit" class="btn primary">Save link</button>
        </div>
      </form>
    </AppDialog>
  </section>
</template>

<style scoped>
.add-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px;
}
/* Toolbar "Add link": the panel's primary action, sized to the toolbar's
   control family (solid accent stays the primary affordance). */
.add-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  width: auto;
  min-height: var(--control-height-sm);
  background: var(--accent);
  color: var(--on-accent);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 0 var(--space-2);
  font-size: var(--text-sm);
  text-align: left;
  transition: background-color var(--transition-fast), transform .1s ease;
}
@media (hover: hover) and (pointer: fine){
.add-toggle:hover { background: var(--accent-hover); }
}
.add-toggle:active { transform: scale(0.98); }
.add-toggle:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
.add-toggle-icon {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--on-accent) 18%, transparent);
  border: none;
  color: var(--on-accent);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast), transform .1s ease;
}
.add-toggle-icon svg { width: 10px; height: 10px; }
@media (hover: hover) and (pointer: fine){
.add-toggle:hover .add-toggle-icon { background: color-mix(in srgb, var(--on-accent) 28%, transparent); color: var(--on-accent); }
}
.add-toggle-label { font-weight: var(--weight-semibold); font-size: var(--text-sm); }
.add-toggle-hint { font-size: 12.5px; color: var(--muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add-toggle-caret { color: currentColor; opacity: .8; display: inline-flex; }
.add-toggle-caret svg { width: 12px; height: 12px; transition: transform var(--transition-fast); }
.add-toggle-caret svg.flipped, .caret svg.flipped { transform: rotate(180deg); }

/* Mockup field stack: one label above one control, even vertical rhythm. */
.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.field > span:first-child,
.field > label:first-child { font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--text-h); }
/* URL row (mockup .field-url-wrap): the field takes the free space, the
   Fetch control keeps its own width. */
.url-row { display: flex; gap: 8px; align-items: flex-start; }
.url-row .input { flex: 1 1 auto; min-width: 0; }
/* Compact action row: Favorite + Pinned toggles and the subordinate More
   options disclosure. The row gap is the only spacing (no negative margins),
   and the row wraps deliberately on very narrow widths. */
.quick-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  row-gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.quick-row .switch { flex-shrink: 0; }
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
  padding: 6px 0;
  margin: 0;
  font-size: 12.5px;
  font-weight: var(--weight-semibold);
  color: var(--text-h);
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
}
@media (hover: hover) and (pointer: fine){
.more-toggle:hover { background: var(--muted-bg); }
}
.more-toggle:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
.more-toggle .caret { color: var(--muted); display: inline-flex; }
.more-toggle .caret svg { width: 13px; height: 13px; transition: transform var(--transition-fast); }
.more-toggle[aria-expanded="true"] { color: var(--accent); }
.more-toggle[aria-expanded="true"] .caret { color: var(--accent); }
/* Optional fields stay part of the same form: no card wrapper — the shared
   .field rhythm carries the layout, labels and control alignment. */
.more-body { margin: 0 0 10px; }
.meta-hint { font-size: var(--text-xs); color: var(--muted); }
.error { color: var(--error); font-size: var(--text-sm); margin: 0 0 10px; }
/* Actions stay reachable while a tall form scrolls internally: the row sticks
   to the bottom of the dialog body's scroll area. */
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 14px;
  position: sticky;
  bottom: 0;
  background: var(--card);
  padding-top: 10px;
  padding-bottom: 2px;
}

/* Mobile form presentation: comfortable tap targets — 44px, expressed with the
   existing control-height token plus the smallest space step — and 16px control
   text, which also stops iOS zooming the page when a field is focused. Desktop
   and tablet keep the compact sizing. The select fields are styled globally
   (.asel--field); the pills, switch and Fetch control in app-overrides. */
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
