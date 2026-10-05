<script setup>
import { ref, computed, nextTick } from 'vue'
import { CATEGORIES } from '../utils/categorize.js'
import { linkTypeIcon } from '../utils/linkTypeIcon.js'
import { useAnchoredPopover } from '../utils/anchoredPopover.js'
import EditLinkForm from './EditLinkForm.vue'
import AppSelect from './AppSelect.vue'
import Icon from './Icon.vue'

// Intl.DateTimeFormat construction is costly; build once per page load
// instead of once per row per render (matters at 500–1000 links).
const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

// LIST (scanning) and COMPACT (dense) share one row presentation; the mode
// prop only changes density and meta visibility. All actions are identical to
// LinkCard and route through the same App.vue handlers.
const props = defineProps({
  link: { type: Object, required: true },
  folders: { type: Array, default: () => [] },
  mode: { type: String, default: 'list' }, // 'list' | 'compact'
  selected: { type: Boolean, default: false },
  // Detail-panel inspection (separate from bulk selection): the row whose
  // record is currently open in the right-hand panel.
  inspected: { type: Boolean, default: false }
})
const emit = defineEmits(['toggle-favorite', 'toggle-pin', 'delete', 'edit', 'set-folder', 'copy', 'share', 'select', 'inspect'])

// Quick-action menu (Open / Details / Edit / Copy link / Share / Category /
// Folder / Delete): the same anchored-popover infrastructure and neutral menu
// surface as LinkCard. Edit opens the shared edit form anchored to this menu's
// trigger, so inline editing stays one explicit action away.
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

// P5/P15.10: clicking the row body opens the detail panel. The body is not an
// external link — opening the site happens from the detail panel (Open link)
// or this menu (Open), so a stray click can never navigate away.
function onInspectClick(e) {
  if (e.target.closest('a, button, input, select, label')) return
  emit('inspect', props.link.id)
}
function inspectFromMenu() {
  closeMore()
  emit('inspect', props.link.id)
}
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

// The mockup's per-type glyph (shared mapping with the detail panel/cards).
const typeIcon = computed(() => linkTypeIcon(props.link.type))

function savedDate() {
  const c = props.link.createdAt
  if (!c) return ''
  const d = new Date(c)
  if (isNaN(d.getTime())) return ''
  return DATE_FMT.format(d)
}

// Inline edit: the shared form anchored to this row's menu trigger, opened from
// the ⋮ menu (the mockup row keeps a quiet action cluster, so the form is one
// explicit menu action away instead of a fifth permanent control).
const editing = ref(false)
const editPopoverEl = ref(null)
useAnchoredPopover({
  trigger: moreTriggerEl,
  popover: editPopoverEl,
  isOpen: editing,
  onOutside: () => { editing.value = false },
  // The form's AppSelects render their own teleported menu; a pointerdown there
  // belongs to this form, not outside it (same rule as the quick-action menu).
  ignoreSelector: '.asel-menu',
  mode: 'auto'
})
function startEdit() {
  closeMore()
  editing.value = true
}
function cancelEdit() { editing.value = false }
function saveEdit(patch) {
  emit('edit', props.link.id, patch)
  editing.value = false
}
</script>

<template>
  <article class="link-row" :class="[mode, { selected, inspected }]" :aria-current="inspected ? 'true' : undefined" @click="onInspectClick">
    <label class="item-check row-check">
      <input
        type="checkbox"
        :checked="selected"
        :aria-label="'Select ' + (link.title || 'link')"
        @change="emit('select', link.id, $event.target.checked)"
      />
      <span class="item-check-box" aria-hidden="true"><Icon name="check" size="xs" /></span>
    </label>
    <span class="row-main" :title="link.title">
      <span class="row-favicon" aria-hidden="true"><Icon :name="typeIcon" size="xs" /></span>
      <span class="row-text">
        <span class="row-title">{{ link.title }}</span>
        <!-- Mockup .row-sub: domain · date, then up to two tags (list only). -->
        <span v-if="mode === 'list'" class="row-meta">
          <span class="row-domain">{{ domainText }}</span>
          <template v-if="savedDate()">
            <span class="row-dot" aria-hidden="true">·</span>
            <time class="row-date" :datetime="link.createdAt">{{ savedDate() }}</time>
          </template>
          <span v-for="t in (link.tags || []).slice(0, 2)" :key="t" class="row-tag">#{{ t }}</span>
        </span>
      </span>
    </span>

    <!-- P9 (G5): compact rows replace the meta line with a right-aligned,
         truncated domain column (mockup .row-domain-inline). -->
    <span class="row-domain-inline">{{ domainText }}</span>

    <!-- P15.11: the mockup's quiet action cluster — favourite (mockup --amber
         when on), pin (accent when on) and the item menu. -->
    <div class="row-actions">
      <button
        class="item-action favorite-toggle"
        :class="{ on: link.favorite }"
        :aria-pressed="String(!!link.favorite)"
        aria-label="Toggle Favorite"
        title="Favorite"
        @click="emit('toggle-favorite', link.id)"
      >
        <Icon name="star" size="sm" />
      </button>
      <button
        class="item-action pin-toggle"
        :class="{ on: link.pinned }"
        :aria-pressed="String(!!link.pinned)"
        aria-label="Toggle Pin"
        title="Pin"
        @click="emit('toggle-pin', link.id)"
      >
        <Icon name="pin" size="sm" />
      </button>
      <button
        ref="moreTriggerEl"
        class="item-action"
        :aria-expanded="String(moreOpen)"
        :aria-controls="'row-menu-' + link.id"
        aria-label="More actions"
        @click="toggleMore"
        @keydown.esc="closeMore(true)"
      >
        <Icon name="more-vertical" size="sm" />
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
            <Icon name="external-link" size="sm" />
            <span>Open</span>
          </a>
          <button type="button" class="more-item" @click="inspectFromMenu">
            <Icon name="info" size="sm" />
            <span>Details</span>
          </button>
          <button type="button" class="more-item" aria-label="Edit link" @click="startEdit">
            <Icon name="pencil" size="sm" />
            <span>Edit</span>
          </button>
          <button type="button" class="more-item" @click="copyLink">
            <Icon name="copy" size="sm" />
            <span>Copy link</span>
          </button>
          <button type="button" class="more-item" @click="shareLink">
            <Icon name="share-2" size="sm" />
            <span>Share</span>
          </button>
          <div class="more-field">
            <span class="more-field-label">
              <Icon name="tag" size="sm" />
              Category
            </span>
            <AppSelect :id="'row-cat-' + link.id" :model-value="link.category" variant="inline" :options="CATEGORIES" aria-label="Change category" @change="changeCategory" />
          </div>
          <div class="more-field">
            <span class="more-field-label">
              <Icon name="folder-input" size="sm" />
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
          <button type="button" class="more-item danger" @click="deleteLink">
            <Icon name="trash-2" size="sm" />
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
  gap: 10px;
  padding: 10px 14px;
  min-height: 52px;
  background: transparent;
  border: none;
  /* Reserved inline-start rail: the selected accent edge never shifts the row
     (the mockup marks the open row with a 3px accent edge + soft fill). */
  border-inline-start: 3px solid transparent;
  transition: background-color var(--transition-fast), border-color var(--transition-fast);
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  cursor: pointer;
}
/* Mockup hover: the row lifts to the surface colour (the list sits on the
   canvas), not a darker inset tint. */
@media (hover: hover) and (pointer: fine){
.link-row:hover { background-color: var(--card); }
}
/* Bulk-selection state: a quiet inset surface plus the reserved accent edge.
   The checkbox carries the primary selection signal, not the row fill. */
.link-row.selected {
  background-color: var(--muted-bg);
  border-inline-start-color: var(--accent);
}
/* Detail-panel inspection (not bulk selection): the mockup's open-row language
   — soft accent fill + the same reserved accent edge. Declared after .selected
   so the open row stays visible when it is also checked. */
.link-row.inspected {
  background-color: var(--accent-bg);
  border-inline-start-color: var(--accent);
}
/* Row checkbox: quiet at rest, no hover restyle, accent check when selected.
   The shared .item-check recipe keeps the size, hit area and focus ring; only
   the surface emphasis is tuned here (cards keep their banner variant). */
.row-check .item-check-box {
  border-color: var(--border);
  background-color: transparent;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}
/* Touch has no hover to reveal it, so keep it subtly visible at rest. */
@media (pointer: coarse) {
  .row-check .item-check-box { border-color: var(--border-strong); }
}
/* Checked: just the accent checkmark — no visible container, readable without
   hover. The box keeps its 18px hit area and the shared focus ring. */
.row-check input:checked + .item-check-box {
  background-color: transparent;
  border-color: transparent;
  color: var(--accent);
}
/* Selection checkbox: a sibling of the row body (never inside an anchor), so
   selecting can never navigate. The painted box is the shared .item-check
   recipe (src/app-overrides.css). */
.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  color: inherit;
}
/* List rows carry the meta line; when the row is narrow the actions drop to
   their own line instead of squeezing the metadata column. Compact rows stay
   single-line (scoped out). */
.link-row:not(.compact) .row-main { flex: 1 1 0; }
.row-favicon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--muted-bg);
  color: var(--muted);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.row-title {
  font-weight: 400;
  font-size: 14px;
  color: var(--text-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (hover: hover) and (pointer: fine){
.link-row:hover .row-title { color: var(--accent); }
}
/* Mockup .row-sub: one quiet 11.5px line — domain · date + tags. */
.row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--muted);
  min-width: 0;
}
.row-domain { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-dot { opacity: .5; }
.row-date { white-space: nowrap; }
/* Tags carry the accent, like the mockup's .row-sub .tag. */
.row-tag { color: var(--accent); white-space: nowrap; }
/* P9 (G5): mockup compact parity — a right-aligned, truncated domain column
   (max 120px, faint) shown only in compact, where the meta line is hidden. */
.row-domain-inline {
  display: none;
  flex: 0 1 auto;
  max-width: 120px;
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Mockup .row-tail: a quiet, tight action cluster (.item-action recipe). */
.row-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; justify-content: flex-end; min-width: 0; }

/* COMPACT: the mockup's dense scanning row — density only (same favicon, same
   action recipe), no second visual language. */
.link-row.compact {
  padding: 9px 14px;
  min-height: 46px;
}
.compact .row-meta { display: none; }
.compact .row-domain-inline { display: block; }
</style>
