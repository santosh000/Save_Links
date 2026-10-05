<script setup>
import { ref, watch, nextTick, computed } from 'vue'
import { CATEGORIES } from '../utils/categorize.js'
import { linkTypeIcon } from '../utils/linkTypeIcon.js'
import { useAnchoredPopover } from '../utils/anchoredPopover.js'
import EditLinkForm from './EditLinkForm.vue'
import AppSelect from './AppSelect.vue'
import Icon from './Icon.vue'

// Intl.DateTimeFormat construction is costly; build both formatters once per
// page load instead of once per card per render (matters at 500–1000 links).
const LONG_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const SHORT_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const props = defineProps({
  link: { type: Object, required: true },
  folders: { type: Array, default: () => [] },
  selected: { type: Boolean, default: false }
})
const emit = defineEmits(['toggle-favorite', 'toggle-pin', 'delete', 'edit', 'set-folder', 'copy', 'share', 'select', 'inspect'])

const imageFailed = ref(false)
watch(() => props.link.image, () => { imageFailed.value = false })
watch(() => props.link.normalizedUrl, () => { imageFailed.value = false })

// Category is applied through the existing edit path (App.updateLink) and the
// menu closes immediately, so the change happens in the current context.
function changeCategory(value) {
  emit('edit', props.link.id, { category: value })
  closeMore()
}
function changeFolder(value) {
  emit('set-folder', props.link.id, value)
  closeMore()
}
function copyLink() { emit('copy', props.link.id); closeMore() }
function shareLink() { emit('share', props.link.id); closeMore() }

// P5/P15.10: clicking the card body (anywhere that is not a control) opens the
// detail panel — the mockup's .link-card click -> openDetail contract. The card
// is not an external link; opening the site happens from the detail panel
// (Open link) or the ⋮ menu (Open).
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

// Quick-action menu (Open / Details / Edit / Copy link / Share / Category /
// Folder / Delete). Same anchored-popover infrastructure and the same neutral
// menu surface the row menu uses — no separate positioning system.
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

// Inline edit: the shared form anchored to this card's menu trigger, opened
// from the ⋮ menu — the mockup banner keeps a quiet action cluster, so the form
// is one explicit menu action away instead of a permanent extra control.
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
  imageFailed.value = false
}

function navUrl() {
  return props.link.normalizedUrl || props.link.url
}

// Mockup .card-domain: the real link domain (fallback: the URL's host — never
// a fabricated value).
const domainText = computed(() => {
  if (props.link.domain) return props.link.domain
  try { return new URL(navUrl()).host } catch { return '' }
})

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

// The mockup's per-type glyph (shared mapping with the row + detail panel).
const typeIcon = computed(() => linkTypeIcon(props.link.type))
</script>

<template>
  <article class="card" :class="{ selected }" @click="onInspectClick">
    <!-- Mockup card: banner with the selection box (top-left) and the quiet
         action circles (top-right: favourite, pin, item menu). -->
    <span class="thumb-wrap" :class="{ 'thumb-empty': !(link.image && !imageFailed) }">
      <img v-if="link.image && !imageFailed" :src="link.image" :alt="link.title" class="thumb" @error="imageFailed = true" loading="lazy" />
      <Icon v-else class="thumb-glyph" :name="typeIcon" size="lg" />

      <label class="item-check item-check--lg card-check">
        <input
          type="checkbox"
          :checked="selected"
          :aria-label="'Select ' + (link.title || 'link')"
          @change="emit('select', link.id, $event.target.checked)"
        />
        <span class="item-check-box" aria-hidden="true"><Icon name="check" size="xs" /></span>
      </label>

      <div class="banner-actions">
        <button
          class="banner-action favorite-toggle"
          :class="{ on: link.favorite }"
          :aria-pressed="String(!!link.favorite)"
          aria-label="Toggle Favorite"
          title="Favorite"
          @click="emit('toggle-favorite', link.id)"
        >
          <Icon name="star" size="sm" />
        </button>
        <button
          class="banner-action pin-toggle"
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
          class="banner-action"
          :aria-expanded="String(moreOpen)"
          :aria-controls="'card-menu-' + link.id"
          aria-label="More actions"
          @click="toggleMore"
          @keydown.esc="closeMore(true)"
        >
          <Icon name="more-vertical" size="sm" />
        </button>
      </div>
    </span>

    <!-- Mockup .card-body order: domain, title, description, footer. -->
    <div class="body">
      <span class="card-domain">
        <Icon class="card-domain-icon" :name="typeIcon" size="xs" />
        <span class="card-domain-text" :title="domainText">{{ domainText }}</span>
      </span>
      <span class="title">{{ link.title }}</span>
      <p class="desc">{{ link.description }}</p>
      <div class="card-foot">
        <span class="card-tags">
          <!-- Mockup .card-foot: at most two tags, so the footer stays one line
               and the card surface keeps a uniform height. -->
          <span v-for="t in (link.tags || []).slice(0, 2)" :key="t" class="tag">#{{ t }}</span>
        </span>
        <span v-if="savedDateOf()" class="card-date">
          <time class="js-full" :datetime="link.createdAt">{{ longDate() }}</time>
          <time class="js-short" :datetime="link.createdAt">{{ shortDate() }}</time>
        </span>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="fade-down">
        <div
          v-if="moreOpen"
          :id="'card-menu-' + link.id"
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
            <AppSelect :id="'cat-' + link.id" :model-value="link.category" variant="inline" :options="CATEGORIES" aria-label="Change category" @change="changeCategory" />
          </div>
          <div class="more-field">
            <span class="more-field-label">
              <Icon name="folder-input" size="sm" />
              Folder
            </span>
            <AppSelect
              :id="'move-folder-' + link.id"
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
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  animation: rise-in .22s ease both;
  padding: 0;
  margin: 0;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}
/* Mockup .link-card:hover — a stronger edge and one elevation step. */
@media (hover: hover) and (pointer: fine){
.card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); }
}
/* Selection: accent border + soft ring on the mockup's elevated shadow. */
.card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow-md);
}
/* Banner: the mockup's fixed-height media surface (100 / 120 / 130px), type
   glyph on a soft accent wash when the link has no real image. */
.thumb-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  overflow: hidden;
  background: var(--muted-bg);
}
.thumb-wrap.thumb-empty {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--card)), var(--card));
  color: var(--text-subtle);
}
.thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
/* Mockup .card-glyph: 34px below 560, 40px above, a light 1.5 stroke. */
.thumb-glyph { width: 34px; height: 34px; stroke-width: 1.5; opacity: .85; }
@media (min-width: 560px) {
  .thumb-wrap { height: 120px; }
  .thumb-glyph { width: 40px; height: 40px; }
}
@media (min-width: 1024px) {
  .thumb-wrap { height: 130px; }
}
/* Banner controls (mockup .card-check / .card-star positions). */
.card-check { position: absolute; top: 8px; left: 8px; }
.banner-actions { position: absolute; top: 8px; right: 8px; display: flex; align-items: center; gap: 6px; }

/* Mockup .card-body: padding 10/12/12, 6px gap. */
.body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 auto; }
/* Mockup .card-domain: favicon + domain, one quiet faint line. */
.card-domain {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 16px;
  font-size: 11.5px;
  color: var(--text-subtle);
  min-width: 0;
}
.card-domain-icon { flex-shrink: 0; }
.card-domain-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title {
  font-weight: var(--weight-medium);
  color: var(--text-h);
  line-height: 1.35;
  font-size: 14px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-width: 0;
  /* Reserve both clamped lines so short titles cannot shrink the surface. */
  min-height: 38px;
}
.desc {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
  /* Reserve the two clamped lines so cards without a description match. */
  min-height: 35px;
}
/* Mockup .card-foot: tags on the left, the real saved date pushed right.
   One line, like the mockup (flex default) — the tags clip rather than wrap,
   so the footer height never varies. */
.card-foot {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  margin-top: auto;
  padding-top: 8px;
  min-height: 26px;
  font-size: 11px;
  color: var(--text-subtle);
  min-width: 0;
}
.card-tags { display: flex; flex-wrap: nowrap; gap: 6px; min-width: 0; overflow: hidden; }
.tag {
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 2px 7px;
  border-radius: 8px;
}
.card-date { margin-left: auto; flex-shrink: 0; white-space: nowrap; }
/* Responsive date form: the long value on wide cards, the short one on narrow
   cards — the same two <time> values the card has always rendered. */
.js-full { display: inline; }
.js-short { display: none; }
@media (max-width: 520px) {
  .js-full { display: none; }
  .js-short { display: inline; }
}

/* Uniform card surface (mockup .link-card): the banner is fixed and the
   title/description/footer rows are bounded, so real content can never produce
   ragged card heights. */
.card { min-height: 220px; }
@media (min-width: 560px) {
  .card { min-height: 240px; }
}
@media (min-width: 1024px) {
  .card { min-height: 260px; }
}
</style>
