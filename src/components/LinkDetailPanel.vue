<script setup>
// P5 — Link detail panel (LinkVault mockup: styles.css `.detail` + script.js
// openDetail/closeDetail/drag-to-close). Presentation only: App.vue owns the
// inspected-link state and performs every mutation through the existing
// handlers (edit/copy/share/delete/pin/important/must-have/move).
//
// One component serves both mockup presentations:
//   · overlay (mobile/tablet, mockup <1024): bottom sheet <768, centred sheet
//     >=768 — slide-in transform + backdrop + drag handle
//   · rail    (desktop >=1200, mockup grid column 3): fixed right rail, no
//     backdrop, no handle
import { ref, computed, watch, nextTick } from 'vue'
import { folderPath } from '../utils/folderTree.js'
import { LINK_TYPE_LABELS } from '../domain/link.js'
import AppSelect from './AppSelect.vue'
import EditLinkForm from './EditLinkForm.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  link: { type: Object, default: null },
  // Raw folder records (for the "Work / Engineering" path line).
  folders: { type: Array, default: () => [] },
  // Indented { value, label } options for the Move picker.
  folderOptions: { type: Array, default: () => [] },
  // true below the desktop shell breakpoint: sheet + backdrop + handle.
  overlay: { type: Boolean, default: true },
})

const emit = defineEmits(['close', 'edit', 'copy', 'share', 'delete', 'pin', 'favorite', 'important', 'must-have', 'move'])

const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

const editing = ref(false)
const moving = ref(false)
const imageFailed = ref(false)
const closeBtn = ref(null)
const panelEl = ref(null)

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
const folderLabel = computed(() => {
  if (!props.link || !props.link.folderId) return 'Unfiled'
  return folderPath(props.folders, props.link.folderId) || 'Unfiled'
})
const showImage = computed(() => !!(props.link && props.link.image) && !imageFailed.value)

watch(() => props.link?.image, () => { imageFailed.value = false })
watch(() => props.link?.normalizedUrl, () => { imageFailed.value = false })
// Switching the inspected link must never carry a draft form or an open picker.
watch(() => props.link?.id, () => { editing.value = false; moving.value = false; resetDrag() })

function startEdit() { editing.value = true; moving.value = false }
function saveEdit(patch) {
  editing.value = false
  if (props.link) emit('edit', props.link.id, patch)
}
function startMove() { moving.value = true; editing.value = false }
function onMove(value) {
  moving.value = false
  if (props.link) emit('move', props.link.id, value)
}

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
      v-if="link"
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

      <div class="detail-scroll">
        <div class="detail-preview" :class="{ 'has-image': showImage }">
          <img
            v-if="showImage"
            :src="link.image"
            :alt="link.title"
            class="detail-image"
            loading="lazy"
            @error="imageFailed = true"
          />
          <svg v-else class="preview-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <template v-if="typeValue === 'video'">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </template>
            <template v-else-if="typeValue === 'docs'">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </template>
            <template v-else-if="typeValue === 'repo'">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </template>
            <template v-else-if="typeValue === 'tutorial'">
              <path d="M22 10 12 5 2 10l10 5 10-5z" />
              <path d="M6 12v5c3 3 9 3 12 0v-5" />
            </template>
            <template v-else>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </template>
          </svg>
          <span class="detail-badge">{{ typeLabel }}</span>
          <a v-if="href" class="detail-open" :href="href" target="_blank" rel="noopener noreferrer" aria-label="Open link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
            <span>Open</span>
          </a>
        </div>

        <div class="detail-body">
          <div class="detail-head">
            <h2 class="detail-title">{{ link.title }}</h2>
            <button ref="closeBtn" type="button" class="detail-close" aria-label="Close details" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>

          <a v-if="href" class="detail-url" :href="href" target="_blank" rel="noopener noreferrer">{{ displayUrl }}</a>
          <span v-else class="detail-url">{{ displayUrl }}</span>

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
              <button type="button" class="detail-tag-add" aria-label="Edit tags" @click="startEdit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                <span>Add</span>
              </button>
            </div>
          </div>

          <div class="detail-section">
            <h4>Description</h4>
            <p class="detail-desc">{{ link.description || '—' }}</p>
          </div>

          <div class="detail-section">
            <h4>Actions</h4>
            <div class="detail-actions">
              <button type="button" aria-label="Edit link" @click="startEdit">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Edit</span>
              </button>
              <button type="button" aria-label="Copy link" @click="emit('copy', link.id)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy</span>
              </button>
              <button type="button" aria-label="Share link" @click="emit('share', link.id)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                <span>Share</span>
              </button>
              <button type="button" aria-label="Move to folder" :aria-expanded="String(moving)" @click="startMove">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span>Move</span>
              </button>
              <button type="button" :class="{ 'is-on': link.pinned }" :aria-pressed="String(!!link.pinned)" aria-label="Toggle Pin" @click="emit('pin', link.id)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6"/><path d="M10 4v6l-2 3h8l-2-3V4"/><path d="M12 13v7"/></svg>
                <span>Pin</span>
              </button>
              <button type="button" :class="{ 'is-on': link.favorite }" :aria-pressed="String(!!link.favorite)" aria-label="Toggle Favorite" @click="emit('favorite', link.id)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C7 16.8 3 13.6 3 9.6 3 7 5 5 7.4 5c1.8 0 3.4 1 4.6 2.6C13.2 6 14.8 5 16.6 5 19 5 21 7 21 9.6c0 4-4 7.2-9 11.4z"/></svg>
                <span>Favorite</span>
              </button>
              <button type="button" :class="{ 'is-on': link.important }" :aria-pressed="String(!!link.important)" aria-label="Toggle Important" @click="emit('important', link.id)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v4.5"/><path d="M12 15.5v.2"/></svg>
                <span>Important</span>
              </button>
              <button type="button" :class="{ 'is-on': link.mustHave }" :aria-pressed="String(!!link.mustHave)" aria-label="Toggle Must Have" @click="emit('must-have', link.id)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 20.8 12 12 20.8 3.2 12z"/></svg>
                <span>Must Have</span>
              </button>
              <button type="button" class="danger" aria-label="Delete link" @click="emit('delete', link.id)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                <span>Delete</span>
              </button>
            </div>

            <div v-if="moving" class="detail-move">
              <AppSelect
                :id="'detail-move-folder'"
                :model-value="link.folderId || ''"
                variant="field"
                :options="[{ value: '', label: 'Unfiled' }, ...folderOptions]"
                aria-label="Move link to folder"
                @change="onMove"
              />
            </div>
          </div>

          <div v-if="editing" class="detail-edit">
            <EditLinkForm :link="link" :folders="folderOptions" @save="saveEdit" @cancel="editing = false" />
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
/* Sheet (<1200): bottom sheet <768, centred sheet >=768 (mockup .detail). */
.detail--sheet {
  left: 0;
  right: 0;
  bottom: 0;
  height: 88dvh;
  max-height: 88dvh;
  border-bottom: none;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  padding-bottom: var(--safe-area-bottom);
  box-shadow: var(--shadow-lg);
  will-change: transform;
  /* --drag-y carries the live drag offset so the transform composition stays
     in CSS (the centred sheet must keep its translateX(-50%)). */
  transform: translateY(var(--drag-y, 0px));
  transition: transform .3s cubic-bezier(.4, 0, .2, 1);
}
/* Rail (>=1200): the mockup's static third grid column. */
.detail--rail {
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--detail-width);
  border-right: none;
  border-top: none;
  border-bottom: none;
  box-shadow: none;
  transition: opacity var(--transition-normal);
}

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

/* Preview: mockup 140px (180px on the desktop rail) */
.detail-preview {
  height: 140px;
  background: var(--muted-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  position: relative;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.detail-preview.has-image { background: var(--card); }
.detail-image { width: 100%; height: 100%; object-fit: cover; display: block; }
.preview-glyph { width: 44px; height: 44px; opacity: .5; fill: none; }
.detail-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  font-size: 10px;
  padding: 3px 9px;
  border-radius: 10px;
  background: var(--accent-bg);
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: .05em;
  font-weight: var(--weight-semibold);
}
.detail-open {
  position: absolute;
  bottom: 12px;
  right: 12px;
  background: var(--accent);
  color: var(--on-accent);
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: var(--weight-medium);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  min-height: 36px;
}
.detail-open svg { width: 13px; height: 13px; fill: none; stroke: currentColor; }
@media (hover: hover) and (pointer: fine) {
  .detail-open:hover { background: var(--accent-hover); }
}

.detail-body { padding: 16px; }
.detail-head { display: flex; align-items: flex-start; gap: var(--space-2); }
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
/* Obvious close action (P5 requirement; the mockup relies on Escape/backdrop). */
.detail-close {
  flex-shrink: 0;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.detail-close svg { width: 15px; height: 15px; }
@media (hover: hover) and (pointer: fine) {
  .detail-close:hover { background: var(--muted-bg); color: var(--text-h); }
}
.detail-close:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 1px; }

.detail-url {
  display: block;
  font-size: 12px;
  color: var(--accent);
  margin-bottom: 16px;
  word-break: break-all;
  line-height: 1.4;
  text-decoration: none;
}
@media (hover: hover) and (pointer: fine) {
  .detail-url:hover { text-decoration: underline; }
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
.detail-tag-add svg { width: 11px; height: 11px; fill: none; stroke: currentColor; }
@media (hover: hover) and (pointer: fine) {
  .detail-tag-add:hover { color: var(--text-h); border-color: var(--muted); }
}
.detail-desc { font-size: 13px; color: var(--muted); line-height: 1.6; margin: 0; overflow-wrap: anywhere; }

.detail-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.detail-actions button {
  padding: 11px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--muted-bg);
  color: var(--text-h);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}
.detail-actions button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
@media (hover: hover) and (pointer: fine) {
  .detail-actions button:hover { border-color: var(--accent-border); }
}
.detail-actions button:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 1px; }
.detail-actions button.is-on { color: var(--accent); border-color: var(--accent-border); background: var(--accent-bg); font-weight: var(--weight-semibold); }
.detail-actions button.danger { color: var(--error); border-color: var(--error-bg); }
@media (hover: hover) and (pointer: fine) {
  .detail-actions button.danger:hover { background: var(--error-bg); }
}
.detail-move { margin-top: 8px; }
.detail-edit { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }

/* ---------------------------------------------------------------------
   Responsive — mockup breakpoints (768 centred sheet, 1024 rail rules).
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
  .detail-actions { grid-template-columns: 1fr 1fr 1fr; }
}
@media (min-width: 1200px) {
  .detail-preview { height: 180px; }
  .detail-actions { grid-template-columns: 1fr 1fr; }
}

/* Slide/settle motion (mockup cubic-bezier(.4,0,.2,1) .3s). */
.detail-enter-active, .detail-leave-active { transition: transform .3s cubic-bezier(.4, 0, .2, 1), opacity var(--transition-normal); }
.detail--sheet.detail-enter-from, .detail--sheet.detail-leave-to { transform: translateY(105%); }
.detail--sheet.detail-enter-to, .detail--sheet.detail-leave-from { transform: translateY(0); }
.detail--rail.detail-enter-active, .detail--rail.detail-leave-active { transition: opacity var(--transition-normal); }
.detail--rail.detail-enter-from, .detail--rail.detail-leave-to { opacity: 0; }
@media (min-width: 768px) {
  .detail--sheet.detail-enter-from, .detail--sheet.detail-leave-to { transform: translate(-50%, 105%); }
  .detail--sheet.detail-enter-to, .detail--sheet.detail-leave-from { transform: translate(-50%, 0); }
}
/* While dragging, the inline transform owns the position. */
.detail.dragging { transition: none; }

.detail-fade-enter-active, .detail-fade-leave-active { transition: opacity .22s; }
.detail-fade-enter-from, .detail-fade-leave-to { opacity: 0; }

.detail-backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  z-index: var(--z-overlay);
}
</style>
