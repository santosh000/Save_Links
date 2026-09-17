<script setup>
import { ref, watch, computed, nextTick } from 'vue'
import { CATEGORIES } from '../utils/categorize.js'
import { useAnchoredPopover } from '../utils/anchoredPopover.js'
import EditLinkForm from './EditLinkForm.vue'
import AppSelect from './AppSelect.vue'

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
const emit = defineEmits(['toggle-important', 'toggle-must-have', 'toggle-favorite', 'set-status', 'delete', 'edit', 'set-folder', 'copy', 'share'])

// Quick-action menu (Open / Copy link / Share / Category / Folder / Delete):
// the same anchored-popover infrastructure and neutral menu surface as LinkCard
// and the app's mobile "More" menu. Category/Folder apply through the existing
// App.vue handlers and close the menu immediately.
const moreOpen = ref(false)
const moreTriggerEl = ref(null)
const morePopoverEl = ref(null)
useAnchoredPopover({
  trigger: moreTriggerEl,
  popover: morePopoverEl,
  isOpen: moreOpen,
  onOutside: () => { moreOpen.value = false },
  // The Category/Folder selects render their own teleported menu; picking an
  // option there must not tear this menu down before the change is applied.
  ignoreSelector: '.asel-menu'
})
function toggleMore() { moreOpen.value = !moreOpen.value }
async function closeMore(restoreFocus = false) {
  moreOpen.value = false
  if (restoreFocus) {
    await nextTick()
    moreTriggerEl.value?.focus()
  }
}
function changeCategory(value) { emit('edit', props.link.id, { category: value }); closeMore() }
function changeFolder(value) { emit('set-folder', props.link.id, value); closeMore() }
function copyLink() { emit('copy', props.link.id); closeMore() }
function shareLink() { emit('share', props.link.id); closeMore() }
async function deleteLink() {
  // Close first (restoring focus to the trigger) so the existing confirmation
  // dialog can restore focus to something that still exists afterwards.
  await closeMore(true)
  emit('delete', props.link.id)
}

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

// Inline edit is presented as an anchored popover (same helper + shared form
// as Card mode) so the row never expands or pushes surrounding rows. Below the
// mobile shell breakpoint it is presented centred, like the Add form.
const editing = ref(false)
const editTriggerEl = ref(null)
const editPopoverEl = ref(null)
useAnchoredPopover({
  trigger: editTriggerEl,
  popover: editPopoverEl,
  isOpen: editing,
  onOutside: () => { editing.value = false },
  mode: 'auto'
})

function startEdit() { editing.value = true }
function cancelEdit() { editing.value = false }
function toggleEdit() {
  if (editing.value) cancelEdit()
  else startEdit()
}
function saveEdit(patch) {
  emit('edit', props.link.id, patch)
  editing.value = false
}

watch(() => props.link.title, () => { if (editing.value) editing.value = false })
</script>

<template>
  <article class="link-row" :class="[mode, { editing }]">
    <a :href="navUrl()" target="_blank" rel="noopener noreferrer" class="row-main" :title="link.title">
      <span class="row-favicon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z"/></svg>
      </span>
      <span class="row-text">
        <span class="row-title">{{ link.title }}</span>
        <span class="row-meta">
          <span class="row-domain">{{ domainText }}</span>
          <span v-if="mode === 'list'" class="row-chips" aria-hidden="false">
            <span v-if="savedDate()" class="chip chip-date">{{ savedDate() }}</span>
            <span v-if="link.tags && link.tags.length" class="chip chip-tags">#{{ link.tags.slice(0, 3).join(' · #') }}</span>
          </span>
        </span>
      </span>
    </a>

    <div class="row-actions">
      <button
        class="row-toggle"
        :class="{ active: link.important }"
        :aria-pressed="String(!!link.important)"
        aria-label="Toggle Important"
        title="Important"
        @click="emit('toggle-important', link.id)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v4.5"/><path d="M12 15.5v.2"/></svg>
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
      <button ref="editTriggerEl" class="icon-btn" @click="toggleEdit" aria-label="Edit link" title="Edit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button
        ref="moreTriggerEl"
        class="icon-btn"
        :aria-expanded="String(moreOpen)"
        :aria-controls="'row-menu-' + link.id"
        aria-label="More actions"
        @click="toggleMore"
        @keydown.esc="closeMore(true)"
      >
        <svg class="more-dots" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
      </button>
    </div>

    <Teleport to="body">
      <Transition name="fade-down">
        <div
          v-if="moreOpen"
          :id="'row-menu-' + link.id"
          ref="morePopoverEl"
          class="more-menu anchored-popover"
          @keydown.esc="closeMore(true)"
        >
          <a class="more-item" :href="navUrl()" target="_blank" rel="noopener noreferrer" @click="closeMore()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
            <span>Open</span>
          </a>
          <button type="button" class="more-item" @click="copyLink">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy link</span>
          </button>
          <button type="button" class="more-item" @click="shareLink">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            <span>Share</span>
          </button>
          <div class="more-field">
            <span class="more-field-label">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              Category
            </span>
            <AppSelect :id="'row-cat-' + link.id" :model-value="link.category" variant="inline" :options="CATEGORIES" aria-label="Change category" @change="changeCategory" />
          </div>
          <div class="more-field">
            <span class="more-field-label">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Folder
            </span>
            <AppSelect
              :id="'row-folder-' + link.id"
              :model-value="link.folderId || ''"
              variant="inline"
              :options="[{ value: '', label: 'Unfiled' }, ...folders]"
              aria-label="Move to folder"
              @change="changeFolder"
            />
          </div>
          <button
            type="button"
            class="more-item"
            :class="{ active: link.mustHave }"
            :aria-pressed="String(!!link.mustHave)"
            aria-label="Toggle Must Have"
            @click="emit('toggle-must-have', link.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 20.8 12 12 20.8 3.2 12z" /></svg>
            <span>Must Have</span>
          </button>
          <button type="button" class="more-item danger" @click="deleteLink">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            <span>Delete</span>
          </button>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="fade-down">
        <div v-if="editing" ref="editPopoverEl" class="edit-popover anchored-popover">
          <EditLinkForm :link="link" :folders="folders" @save="saveEdit" @cancel="cancelEdit" />
        </div>
      </Transition>
    </Teleport>
  </article>
</template>

<style scoped>
.link-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 8px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.link-row:hover { border-color: var(--accent-border); box-shadow: var(--shadow-sm); }
.link-row.editing { border-color: var(--accent-border); }
.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  text-decoration: none;
  color: inherit;
}
/* List rows carry chips + the full action set; when the row is narrow the
   actions drop to their own line instead of squeezing the metadata column.
   Compact rows stay single-line (scoped out). */
.link-row:not(.compact) .row-main { flex: 1 1 280px; }
.row-favicon {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-full);
  background: var(--muted-bg);
  color: var(--muted);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.row-favicon svg { width: 16px; height: 16px; }
.row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.row-title {
  font-weight: var(--weight-semibold);
  font-size: var(--text-md);
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
  font-size: var(--text-xs);
  color: var(--muted);
  min-width: 0;
}
.row-domain { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-chips { display: inline-flex; gap: 4px var(--space-2); align-items: center; min-width: 0; flex-wrap: wrap; }
/* Metadata reads as quiet text, not as stacked pills (the row stays one object) */
.chip {
  color: var(--text);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.chip-date, .chip-tags { color: var(--muted); }
/* Quick-action trigger: three round dots in the shared stroke-icon language. */
svg.more-dots { fill: currentColor; stroke: none; }
.row-actions { display: flex; align-items: center; gap: 5px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
/* Status toggles and item actions (.row-toggle / .icon-btn, incl. the accent
   active state and the destructive hover) are defined once in the global
   control language (src/app-overrides.css), so List/Compact rows and Card items
   share one action treatment. Compact keeps only its density overrides below. */
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

/* COMPACT: denser scanning rows, meta chips off, smaller chrome */
.link-row.compact {
  padding: 4px 8px;
  gap: 3px 8px;
  border-radius: var(--radius-sm);
}
.compact .row-favicon { width: 24px; height: 24px; }
.compact .row-favicon svg { width: 12px; height: 12px; }
.compact .row-title { font-size: var(--text-xs); }
.compact .row-meta { font-size: 10px; }
.compact .row-chips { display: none; }
.compact .row-toggle { width: 24px; height: 24px; }
.compact .row-toggle svg { width: 12px; height: 12px; }
.compact .icon-btn { width: 24px; height: 24px; }
.compact .icon-btn svg { width: 12px; height: 12px; }

@media (max-width: 768px) {
  .compact .row-toggle, .compact .icon-btn { width: 26px; height: 26px; }
}
@media (max-width: 480px) {
  .row-favicon { display: none; }
  /* Mobile List: full-width title/domain line, then ONE action line of
     status toggles + edit + the quick-action menu. Category and Folder are
     changed from that menu (the same fields, one tap away), so the row keeps
     a single glanceable metadata line. Compact (scan mode) is untouched. */
  .link-row:not(.compact) .chip-date,
  .link-row:not(.compact) .chip-tags { display: none; }
}
@media (max-width: 400px) {
  /* Very narrow compact rows: keep the action row inside the card. */
  .compact .row-actions { gap: 3px; }
  .compact .row-toggle,
  .compact .icon-btn { width: 22px; height: 22px; }
  .compact .row-toggle svg,
  .compact .icon-btn svg { width: 11px; height: 11px; }
}
</style>