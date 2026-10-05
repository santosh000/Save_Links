<script setup>
// P5 — Link detail panel (LinkVault mockup: styles.css `.detail` + script.js
// openDetail/closeDetail/drag-to-close). Presentation only: App.vue owns the
// inspected-link state and performs every mutation through the existing
// handlers (edit/copy/share/delete/pin/important/must-have/move).
//
// One component serves both mockup presentations:
//   · overlay (mobile/tablet, mockup <1200): bottom sheet <768, centred sheet
//     >=768 — slide-in transform + backdrop + drag handle
//   · rail    (desktop >=1200, mockup grid column 3): fixed right rail, no
//     backdrop, no handle
import { ref, computed, watch, nextTick } from 'vue'
import { folderPath } from '../utils/folderTree.js'
import { linkTypeIcon } from '../utils/linkTypeIcon.js'
import { LINK_TYPE_LABELS } from '../domain/link.js'
import AppSelect from './AppSelect.vue'
import EditLinkForm from './EditLinkForm.vue'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  link: { type: Object, default: null },
  // Raw folder records (for the "Work / Engineering" path line).
  folders: { type: Array, default: () => [] },
  // Indented { value, label } options for the Move picker.
  folderOptions: { type: Array, default: () => [] },
  // Unique library tags (App's collectTags order) for the inline tag editor.
  availableTags: { type: Array, default: () => [] },
  // true below the desktop shell breakpoint: sheet + backdrop + handle.
  overlay: { type: Boolean, default: true },
})

const emit = defineEmits(['close', 'edit', 'copy', 'share', 'delete', 'pin', 'favorite', 'move'])

const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

// One panel mode drives the body: 'detail' | 'edit' | 'move'. Edit and Move
// toggle from their own action (clicking the action again returns to detail and
// discards the open editor/picker), so the two modes can never be open at once.
const mode = ref('detail')
const editing = computed(() => mode.value === 'edit')
const moving = computed(() => mode.value === 'move')
const modeTitle = computed(() => (mode.value === 'edit' ? 'Edit Link' : 'Move Link'))
// Move-mode draft: the picker only changes this; the existing `move` emit runs
// on confirm, so an unconfirmed selection is discarded by Cancel/toggle.
const moveDraft = ref('')
// Inline tag editor inside detail mode: expanding it never hides the rest of
// the detail content. Tag changes commit immediately through the existing
// `edit` emit (App.handleEdit -> useLinks.updateLink), so the visible list and
// the stored record stay in sync.
const isAddingTag = ref(false)
const tagInput = ref('')
const imageFailed = ref(false)
const closeBtn = ref(null)
const panelEl = ref(null)
const scrollEl = ref(null)

const href = computed(() => props.link ? (props.link.normalizedUrl || props.link.url || '') : '')
const displayUrl = computed(() => props.link ? (props.link.originalUrl || props.link.url || '') : '')
const domainText = computed(() => {
  if (!props.link) return ''
  if (props.link.domain) return props.link.domain
  try { return new URL(href.value).host } catch { return '' }
})
const savedLabel = computed(() => {
  const c = props.link && props.link.createdAt
  if (!c) return '—'
  const d = new Date(c)
  return isNaN(d.getTime()) ? '—' : DATE_FMT.format(d)
})
const typeValue = computed(() => (props.link && props.link.type) || 'other')
const typeLabel = computed(() => LINK_TYPE_LABELS[typeValue.value] || LINK_TYPE_LABELS.other)
// Type -> registry glyph, via the mapping shared with the item surfaces.
const previewGlyph = computed(() => linkTypeIcon(typeValue.value))
const folderLabel = computed(() => {
  if (!props.link || !props.link.folderId) return 'Unfiled'
  return folderPath(props.folders, props.link.folderId) || 'Unfiled'
})
const showImage = computed(() => !!(props.link && props.link.image) && !imageFailed.value)

watch(() => props.link?.image, () => { imageFailed.value = false })
watch(() => props.link?.normalizedUrl, () => { imageFailed.value = false })
// Switching the inspected link must never carry a draft form or an open picker.
watch(() => props.link?.id, () => { mode.value = 'detail'; isAddingTag.value = false; tagInput.value = ''; resetDrag() })

// Top-bar Edit / Move toggle their own mode; all three share this one mode ref.
function toggleEdit() { mode.value = mode.value === 'edit' ? 'detail' : 'edit' }
function cancelEdit() { mode.value = 'detail' }
function saveEdit(patch) {
  mode.value = 'detail'
  if (props.link) emit('edit', props.link.id, patch)
}
function toggleMove() {
  if (mode.value === 'move') { mode.value = 'detail'; return }
  moveDraft.value = props.link?.folderId || ''
  mode.value = 'move'
}
function cancelMove() { mode.value = 'detail' }
function confirmMove() {
  const value = moveDraft.value
  mode.value = 'detail'
  if (props.link) emit('move', props.link.id, value)
}
// The "+ Add" control toggles the inline editor; Done collapses it without
// leaving detail mode. Neither opens the full Edit Link form.
function toggleTags() { isAddingTag.value = !isAddingTag.value }
function doneTags() { isAddingTag.value = false }
function currentTags() { return props.link?.tags || [] }
function addTag(tag) {
  if (!tag || !props.link || currentTags().includes(tag)) return
  emit('edit', props.link.id, { tags: [...currentTags(), tag] })
}
function addTagFromInput() {
  const tag = tagInput.value.trim()
  if (!tag || currentTags().includes(tag)) return
  tagInput.value = ''
  addTag(tag)
}
function removeTag(tag) {
  if (!props.link) return
  emit('edit', props.link.id, { tags: currentTags().filter((t) => t !== tag) })
}
function toggleTag(tag) {
  if (currentTags().includes(tag)) removeTag(tag)
  else addTag(tag)
}
// A mode owns the panel from the top: never inherit the previous scroll offset.
watch(mode, async () => { await nextTick(); if (scrollEl.value) scrollEl.value.scrollTop = 0 })

// ---- Overlay focus management (mockup sheet: focus in, restore on close) ----
let previouslyFocused = null
watch(() => [props.open, props.link?.id], async ([isOpen, id]) => {
  if (!isOpen || !id || !props.overlay) return
  if (previouslyFocused === null) previouslyFocused = document.activeElement
  await nextTick()
  closeBtn.value?.focus()
}, { immediate: true })
watch(() => props.open, (isOpen) => {
  if (isOpen) return
  const el = previouslyFocused
  previouslyFocused = null
  if (el && document.contains(el)) el.focus()
})

// ---- Drag-to-close (mockup: handle drag >100px closes; overlay only) ----
const dragY = ref(0)
const dragging = ref(false)
let dragStartY = 0
function onDragStart(e) {
  if (!props.overlay) return
  dragging.value = true
  dragStartY = e.clientY
  dragY.value = 0
}
function onDragMove(e) {
  if (!dragging.value) return
  dragY.value = Math.max(0, e.clientY - dragStartY)
}
function onDragEnd() {
  if (!dragging.value) return
  dragging.value = false
  if (dragY.value > 100) emit('close')
  dragY.value = 0
}
function resetDrag() { dragY.value = 0; dragging.value = false }
// CSS composes the drag offset so the centred sheet keeps its translate(-50%).
const panelStyle = computed(() => (dragY.value ? { '--drag-y': `${dragY.value}px` } : {}))

// Overlay keyboard handling: Escape closes, Tab stays inside the sheet.
function onPanelKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !props.overlay || !panelEl.value) return
  const focusables = panelEl.value.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
  if (!focusables.length) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || !panelEl.value.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !panelEl.value.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <Transition name="detail-fade">
    <div v-if="open && overlay" class="detail-backdrop" @click="emit('close')" aria-hidden="true" />
  </Transition>

  <Transition name="detail">
    <aside
      v-if="overlay ? (open && link) : true"
      ref="panelEl"
      class="detail"
      :class="[overlay ? 'detail--sheet' : 'detail--rail', { open: open && !overlay, dragging }]"
      :role="overlay ? 'dialog' : 'complementary'"
      :aria-modal="overlay ? 'true' : undefined"
      aria-label="Link details"
      :style="panelStyle"
      @keydown="onPanelKeydown"
    >
      <div
        v-if="overlay"
        class="sheet-handle"
        aria-hidden="true"
        @pointerdown="onDragStart"
        @pointermove="onDragMove"
        @pointerup="onDragEnd"
        @pointercancel="onDragEnd"
      ></div>

      <!-- Desktop rail empty state: the column stays structurally present
           between inspections (mobile sheets only mount while open). -->
      <div v-if="!link" class="detail-empty">
        <div class="detail-empty-icon" aria-hidden="true">
          <Icon name="panel-right" class="detail-empty-glyph" />
        </div>
        <p class="detail-empty-title">No link selected</p>
        <p class="detail-empty-text">Select a link from the list to see its details here.</p>
      </div>

      <div v-else ref="scrollEl" class="detail-scroll">
        <!-- Preview surface: the type badge and the link actions live on the
             same surface as the image/glyph (one visual region, no header bar). -->
        <div class="detail-preview" :class="{ 'has-image': showImage && mode === 'detail', 'detail-preview--mode': mode !== 'detail' }">
          <div class="detail-preview-top">
            <span v-if="mode === 'detail'" class="detail-badge">{{ typeLabel }}</span>
            <h2 v-else class="detail-mode-title">{{ modeTitle }}</h2>
            <div class="detail-top-actions">
              <a v-if="href" class="navbar-action-btn" :href="href" target="_blank" rel="noopener noreferrer" aria-label="Open link" title="Open">
                <Icon name="external-link" size="sm" />
              </a>
              <button type="button" class="navbar-action-btn" aria-label="Copy link" title="Copy" @click="emit('copy', link.id)">
                <Icon name="copy" size="sm" />
              </button>
              <button type="button" class="navbar-action-btn" aria-label="Edit link" title="Edit" :aria-expanded="String(editing)" @click="toggleEdit">
                <Icon name="pencil" size="sm" />
              </button>
              <button type="button" class="navbar-action-btn" aria-label="Share link" title="Share" @click="emit('share', link.id)">
                <Icon name="share-2" size="sm" />
              </button>
              <button type="button" class="navbar-action-btn" aria-label="Move to folder" title="Move" :aria-expanded="String(moving)" @click="toggleMove">
                <Icon name="folder-input" size="sm" />
              </button>
              <button type="button" class="navbar-action-btn detail-danger" aria-label="Delete link" title="Delete" @click="emit('delete', link.id)">
                <Icon name="trash-2" size="sm" />
              </button>
            </div>
            <button ref="closeBtn" type="button" class="navbar-action-btn detail-close" aria-label="Close details" title="Close" @click="emit('close')">
              <Icon name="x" size="sm" />
            </button>
          </div>
          <div v-if="mode === 'detail'" class="detail-preview-media">
            <img
              v-if="showImage"
              :src="link.image"
              :alt="link.title"
              class="detail-image"
              loading="lazy"
              @error="imageFailed = true"
            />
            <Icon v-else :name="previewGlyph" class="preview-glyph" />
          </div>
        </div>

        <!-- DETAIL MODE: the normal link details. -->
        <div v-if="mode === 'detail'" class="detail-body">
          <div class="detail-head">
            <h2 class="detail-title">{{ link.title }}</h2>
          </div>

          <a v-if="href" class="detail-url" :href="href" target="_blank" rel="noopener noreferrer">{{ displayUrl }}</a>
          <span v-else class="detail-url">{{ displayUrl }}</span>

          <!-- Favorite / Pinned: dedicated state controls directly below the
               title + URL (never in the top action row). -->
          <div class="detail-state">
            <button type="button" class="type-pill" :class="{ active: link.favorite }" :aria-pressed="String(!!link.favorite)" aria-label="Toggle Favorite" @click="emit('favorite', link.id)">
              <Icon name="star" size="xs" />
              <span>Favorite</span>
            </button>
            <button type="button" class="type-pill" :class="{ active: link.pinned }" :aria-pressed="String(!!link.pinned)" aria-label="Toggle Pin" @click="emit('pin', link.id)">
              <Icon name="pin" size="xs" />
              <span>Pinned</span>
            </button>
          </div>

          <dl class="detail-meta">
            <dt>Domain</dt><dd>{{ domainText || '—' }}</dd>
            <dt>Saved</dt><dd>{{ savedLabel }}</dd>
            <dt>Type</dt><dd>{{ typeLabel }}</dd>
            <dt>Category</dt><dd>{{ link.category || 'Other' }}</dd>
            <dt>Folder</dt><dd>{{ folderLabel }}</dd>
          </dl>

          <div class="detail-section">
            <h4>Tags</h4>
            <div class="detail-tags">
              <span v-for="t in link.tags || []" :key="t" class="detail-tag">#{{ t }}</span>
              <button
                type="button"
                class="detail-tag-add"
                aria-label="Edit tags"
                aria-controls="detail-tag-editor"
                :aria-expanded="String(isAddingTag)"
                @click="toggleTags"
              >
                <Icon name="plus" size="xs" />
                <span>Add</span>
              </button>
            </div>

            <!-- Inline tag editor: expands under TAGS; the rest of the detail
                 stays visible. Height+opacity reveal, opt-out under reduced motion. -->
            <div id="detail-tag-editor" class="detail-tags-editor" :class="{ open: isAddingTag }">
              <div class="detail-tags-editor-inner">
                <div class="detail-tags-editor-body">
                  <div class="detail-tags-editor-group">
                    <h4>Current tags</h4>
                    <div class="detail-tags">
                      <span v-for="t in link.tags || []" :key="t" class="tag-pill tag-pill--current">
                        #{{ t }}
                        <button type="button" class="tag-pill-remove" :aria-label="'Remove tag ' + t" @click="removeTag(t)">
                          <Icon name="x" size="xs" />
                        </button>
                      </span>
                      <p v-if="!(link.tags || []).length" class="detail-tags-empty">No tags yet.</p>
                    </div>
                  </div>

                  <div class="detail-tags-editor-group">
                    <h4>Add tag</h4>
                    <div class="detail-tag-add-row">
                      <input
                        id="detail-tag-input"
                        v-model="tagInput"
                        class="input"
                        type="text"
                        placeholder="New tag"
                        aria-label="New tag"
                        autocapitalize="none"
                        autocorrect="off"
                        @keydown.enter.prevent="addTagFromInput"
                      />
                      <button type="button" class="btn primary sm" :disabled="!tagInput.trim()" @click="addTagFromInput">Add</button>
                    </div>
                  </div>

                  <div v-if="availableTags.length" class="detail-tags-editor-group">
                    <h4>Available tags</h4>
                    <div class="detail-tags">
                      <button
                        v-for="t in availableTags"
                        :key="t"
                        type="button"
                        class="tag-pill"
                        :class="{ active: (link.tags || []).includes(t) }"
                        :aria-pressed="String((link.tags || []).includes(t))"
                        @click="toggleTag(t)"
                      >#{{ t }}</button>
                    </div>
                  </div>

                  <div class="detail-mode-actions">
                    <button type="button" class="btn primary sm" @click="doneTags">Done</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <h4>Description</h4>
            <p class="detail-desc">{{ link.description || '—' }}</p>
          </div>
        </div>

        <!-- EDIT MODE: the shared editor owns the panel body — no details behind it. -->
        <div v-else-if="mode === 'edit'" class="detail-body">
          <EditLinkForm :link="link" :folders="folderOptions" @save="saveEdit" @cancel="cancelEdit" />
        </div>

        <!-- MOVE MODE: destination draft + confirm; nothing else. -->
        <div v-else class="detail-body detail-move">
          <div class="detail-move-row">
            <span class="detail-move-label">Current folder</span>
            <span class="detail-move-current">{{ folderLabel }}</span>
          </div>
          <label class="detail-move-field" for="detail-move-folder">
            <span>Destination</span>
            <AppSelect
              id="detail-move-folder"
              v-model="moveDraft"
              variant="field"
              :options="[{ value: '', label: 'Unfiled' }, ...folderOptions]"
              aria-label="Move link to folder"
            />
          </label>
          <div class="detail-mode-actions">
            <button type="button" class="btn ghost sm" @click="cancelMove">Cancel</button>
            <button type="button" class="btn primary sm" @click="confirmMove">Move</button>
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
/* ---------------------------------------------------------------------
   Surfaces — values follow LinkVault styles.css `.detail` (§DETAIL PANEL).
--------------------------------------------------------------------- */
.detail {
  position: fixed;
  background: var(--card);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: calc(var(--z-sidebar) + 5);
}
/* Sheet (<1200): the shared modal family's bottom sheet — full width up to the
   modal width (AppDialog max 560px), centred above it; all corners at >=768. */
.detail--sheet {
  left: 50%;
  right: auto;
  bottom: 0;
  width: 100%;
  max-width: 560px;
  height: 88dvh;
  max-height: 88dvh;
  border-bottom: none;
  border-top-left-radius: var(--radius-lg);
  border-top-right-radius: var(--radius-lg);
  padding-bottom: var(--safe-area-bottom);
  box-shadow: var(--shadow-lg);
  will-change: transform;
  /* --drag-y carries the live drag offset so the transform composition stays
     in CSS (the centred sheet keeps its translateX(-50%)). */
  transform: translate(-50%, var(--drag-y, 0px));
  transition: transform .3s cubic-bezier(.4, 0, .2, 1);
}
/* Rail (>=1200): the mockup's static third grid column. The column exists
   before any selection; the placeholder fills it until a link is inspected. */
@media (min-width: 1200px) {
  .detail--rail {
    position: static;
    grid-column: 3;
    grid-row: 2;
    width: auto;
    min-height: 0;
    border-right: none;
    border-top: none;
    border-bottom: none;
    box-shadow: none;
    transition: opacity var(--transition-normal);
  }
}

/* Placeholder state (real empty state, no invented data) */
.detail-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
}
.detail-empty-icon {
  width: 44px;
  height: 44px;
  margin-bottom: 6px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  background: var(--muted-bg);
  color: var(--muted);
}
.detail-empty-glyph { width: 20px; height: 20px; stroke-width: 1.5; }
.detail-empty-title { margin: 0; font-size: 14px; font-weight: var(--weight-semibold); color: var(--text-h); }
.detail-empty-text { margin: 0; max-width: 220px; font-size: 12.5px; line-height: 1.5; color: var(--muted); }

.sheet-handle {
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
}
.sheet-handle::before {
  content: "";
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
}
.detail-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }

/* Preview surface: badge + actions on top, media below — one visual region. */
.detail-preview {
  height: 140px;
  background: var(--muted-bg);
  display: flex;
  flex-direction: column;
  color: var(--muted);
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.detail-preview.has-image { background: var(--card); }
/* With an image the image fills the preview and the badge/actions overlay it
   with the shared scrim/blur tokens — one continuous surface, no header strip. */
.detail-preview.has-image { position: relative; }
.detail-preview.has-image .detail-preview-media { position: absolute; inset: 0; }
.detail-preview.has-image .detail-preview-top { position: absolute; inset: 0 0 auto 0; z-index: 1; }
.detail-preview.has-image .detail-badge {
  background: var(--overlay);
  color: var(--on-accent);
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  backdrop-filter: blur(var(--overlay-blur));
}
.detail-preview.has-image .detail-top-actions {
  background: var(--overlay);
  border-radius: var(--radius-sm);
  padding: var(--space-1);
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  backdrop-filter: blur(var(--overlay-blur));
}
.detail-preview.has-image .detail-top-actions .navbar-action-btn { color: var(--on-accent); }
.detail-preview.has-image .detail-top-actions .detail-danger { color: var(--error); }
/* The fixed close slot stays readable over an image (same scrim/blur language
   as the action group). */
.detail-preview.has-image .detail-close {
  color: var(--on-accent);
  background: var(--overlay);
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  backdrop-filter: blur(var(--overlay-blur));
}
@media (hover: hover) and (pointer: fine) {
  .detail-preview.has-image .detail-top-actions .navbar-action-btn:hover {
    background: color-mix(in srgb, var(--on-accent) 20%, transparent);
    color: var(--on-accent);
  }
  .detail-preview.has-image .detail-top-actions .detail-danger:hover {
    background: var(--error-bg);
    color: var(--error);
  }
}
/* Edit/Move mode: the preview surface becomes a compact header (mode title,
   actions, close) and the media is gone — the body below is the mode's alone. */
.detail-preview.detail-preview--mode { height: auto; }
.detail-mode-title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  color: var(--text-h);
}
/* The active mode's action reads as selected with existing tokens only. */
.detail-top-actions .navbar-action-btn[aria-expanded="true"] {
  background: var(--accent-soft);
  color: var(--accent);
}
/* Stable header grid, identical in every mode: the left slot is the only
   flexible track, so the badge/mode title can never move the fixed action and
   close slots. Same padding/gaps/button sizes everywhere => no icon jump. */
.detail-preview-top {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
}
.detail-top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.detail-top-actions .detail-danger { color: var(--error); }
@media (hover: hover) and (pointer: fine) {
  .detail-top-actions .detail-danger:hover { background: var(--error-bg); color: var(--error); }
}
.detail-preview-media {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.detail-image { width: 100%; height: 100%; object-fit: cover; display: block; }
/* Preview glyph: the mockup's 44px faint mark (CSS overrides the Icon's
   inline size/stroke attributes — no second icon recipe). */
.preview-glyph { width: 44px; height: 44px; opacity: .5; stroke-width: 1.2; }
.detail-badge {
  justify-self: start;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  padding: 3px 9px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: .05em;
  font-weight: var(--weight-semibold);
}

.detail-body { padding: 16px; }
.detail-head { display: flex; align-items: flex-start; gap: var(--space-2); }
.detail-close { flex-shrink: 0; }
.detail-title {
  flex: 1;
  min-width: 0;
  font-size: 17px;
  font-weight: var(--weight-semibold);
  line-height: 1.3;
  margin-bottom: 6px;
  color: var(--text-h);
  overflow-wrap: anywhere;
}

.detail-url {
  display: block;
  font-size: 12px;
  color: var(--accent);
  margin-bottom: var(--space-4);
  word-break: break-all;
  line-height: 1.4;
  text-decoration: none;
}
@media (hover: hover) and (pointer: fine) {
  .detail-url:hover { text-decoration: underline; }
}
/* Favorite / Pinned: dedicated state controls directly below title + URL. */
.detail-state {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
/* Weight stays constant across states so toggling cannot reflow the row; the
   accent treatment (shared .type-pill.active) carries the state. */
.detail-state .type-pill { display: inline-flex; align-items: center; gap: var(--space-1); font-weight: var(--weight-medium); }

/* Move mode: current folder + destination draft + confirm actions. */
.detail-move-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: var(--space-4);
}
.detail-move-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--muted);
}
.detail-move-current { font-size: var(--text-sm); color: var(--text-h); }
.detail-move-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-h);
}
.detail-mode-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
/* Inline tag editor under TAGS: expands in place, details stay visible.
   Height+opacity reveal only; reduced motion opts out (see below). */
.detail-tags-editor {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  visibility: hidden;
  transition: grid-template-rows 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), visibility 0s linear 0.2s;
}
.detail-tags-editor.open {
  grid-template-rows: 1fr;
  opacity: 1;
  visibility: visible;
  transition: grid-template-rows 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), visibility 0s;
}
.detail-tags-editor-inner { min-height: 0; overflow: hidden; }
/* Compact inline utility: 12px section rhythm, no card/containers. */
.detail-tags-editor-body { padding-top: var(--space-3); }
.detail-tags-editor-group + .detail-tags-editor-group { margin-top: var(--space-3); }
.detail-tags-editor .detail-mode-actions { margin-top: var(--space-3); }
/* Done sits close to the last tag group; Description follows 16px after. */
.detail-section:has(.detail-tags-editor.open) { margin-bottom: var(--space-4); }
/* Current tags carry an immediate remove control; the add row and the
   available-tag pills reuse the shared .tag-pill recipe/tokens. */
.tag-pill--current { gap: 4px; padding-right: 4px; cursor: default; }
.tag-pill-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .tag-pill-remove:hover { background: var(--muted-bg); color: var(--text-h); }
}
.detail-tags-empty { margin: 0; font-size: var(--text-sm); color: var(--muted); }
.detail-tag-add-row { display: flex; align-items: stretch; gap: var(--space-2); }
.detail-tag-add-row .input { flex: 1; min-width: 0; }
/* One height for both controls: the shared control-height token (the input's
   own height), regardless of the dense .btn.sm size. */
.detail-tag-add-row .btn { flex: 0 0 auto; min-height: var(--control-height); }
@media (max-width: 768px) {
  /* Same mobile form treatment as the Add/Edit forms: comfortable targets and
     16px control text (no iOS zoom-on-focus). Both controls stay equal. */
  .detail-tag-add-row .input,
  .detail-tag-add-row .btn {
    min-height: calc(var(--control-height) + var(--space-1));
  }
  .detail-tag-add-row .input { font-size: var(--text-lg); }
  .tag-pill-remove { width: 22px; height: 22px; }
}
@media (prefers-reduced-motion: reduce) {
  .detail-tags-editor { transition: none; }
}

.detail-meta {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 8px 12px;
  font-size: 13px;
  margin: 0 0 18px;
}
.detail-meta dt { color: var(--muted); font-size: 12px; font-weight: var(--weight-medium); }
.detail-meta dd { color: var(--text-h); margin: 0; overflow-wrap: anywhere; }

.detail-section { margin-bottom: 18px; }
.detail-section h4 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--muted);
  margin: 0 0 8px;
  font-weight: var(--weight-semibold);
}
.detail-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.detail-tag {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 12px;
  background: var(--muted-bg);
  color: var(--muted);
}
.detail-tag-add {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 12px;
  border: 1px dashed var(--border);
  background: none;
  color: var(--muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
}
@media (hover: hover) and (pointer: fine) {
  .detail-tag-add:hover { color: var(--text-h); border-color: var(--muted); }
}
.detail-desc { font-size: 13px; color: var(--muted); line-height: 1.6; margin: 0; overflow-wrap: anywhere; }

/* ---------------------------------------------------------------------
   Responsive — mockup breakpoints (768 centred sheet, 1200 rail rules).
--------------------------------------------------------------------- */
@media (min-width: 768px) {
  .detail--sheet {
    height: 80dvh;
    max-height: 80dvh;
    left: 50%;
    right: auto;
    width: 560px;
    max-width: calc(100vw - 32px);
    transform: translate(-50%, var(--drag-y, 0px));
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
}
/* Mockup: the rail's taller preview switches at the desktop shell breakpoint
   (1200), not 1024. */
@media (min-width: 1200px) {
  .detail-preview { height: 180px; }
}

/* Slide/settle motion (mockup cubic-bezier(.4,0,.2,1) .3s). */
.detail-enter-active, .detail-leave-active { transition: transform .3s cubic-bezier(.4, 0, .2, 1), opacity var(--transition-normal); }
.detail--sheet.detail-enter-from, .detail--sheet.detail-leave-to { transform: translate(-50%, 105%); }
.detail--sheet.detail-enter-to, .detail--sheet.detail-leave-from { transform: translate(-50%, 0); }
.detail--rail.detail-enter-active, .detail--rail.detail-leave-active { transition: opacity var(--transition-normal); }
.detail--rail.detail-enter-from, .detail--rail.detail-leave-to { opacity: 0; }
/* While dragging, the inline transform owns the position. */
.detail.dragging { transition: none; }

.detail-fade-enter-active, .detail-fade-leave-active { transition: opacity .22s; }
.detail-fade-enter-from, .detail-fade-leave-to { opacity: 0; }

.detail-backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  backdrop-filter: blur(var(--overlay-blur));
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  z-index: var(--z-overlay);
}
</style>
