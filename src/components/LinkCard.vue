<script setup>
import { ref, watch, nextTick } from 'vue'
import { CATEGORIES } from '../utils/categorize.js'
import { useAnchoredPopover } from '../utils/anchoredPopover.js'
import EditLinkForm from './EditLinkForm.vue'
import AppSelect from './AppSelect.vue'

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
const emit = defineEmits(['toggle-important', 'toggle-must-have', 'toggle-favorite', 'set-status', 'delete', 'edit', 'set-folder', 'copy', 'share'])

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
async function deleteLink() {
  // Close first (restoring focus to the trigger) so the existing confirmation
  // dialog can restore focus to something that still exists afterwards.
  await closeMore(true)
  emit('delete', props.link.id)
}

const editing = ref(false)
function startEdit() { editing.value = true }
function cancelEdit() { editing.value = false }
function toggleEdit() {
  if (editing.value) cancelEdit()
  else startEdit()
}
function saveEdit(patch) {
  emit('edit', props.link.id, patch)
  editing.value = false
  imageFailed.value = false
}

// Anchored, content-sized edit popover (no card/page expansion). The form is
// teleported to <body>; this helper flips it above/below the Edit trigger and
// closes it on an outside click. Below the mobile shell breakpoint the whole
// form is presented centred (viewport-friendly margins + capped height).
const editTriggerEl = ref(null)
const editPopoverEl = ref(null)
useAnchoredPopover({
  trigger: editTriggerEl,
  popover: editPopoverEl,
  isOpen: editing,
  onOutside: () => { editing.value = false },
  mode: 'auto'
})

// Quick-action menu (Open / Copy link / Share / Category / Folder / Delete).
// Same anchored-popover infrastructure and the same neutral menu surface the
// app's "More" menu already uses — no separate positioning system.
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
  <article class="card" :class="{ editing }">
    <a v-if="link.image && !imageFailed" :href="navUrl()" target="_blank" rel="noopener noreferrer" class="thumb-wrap">
      <img :src="link.image" :alt="link.title" class="thumb" @error="imageFailed = true" loading="lazy" />
    </a>
    <div class="body">
      <a :href="navUrl()" target="_blank" rel="noopener noreferrer" class="title">{{ link.title }}</a>
      <div class="url-row">
        <div class="url-line">
          <a :href="navUrl()" target="_blank" rel="noopener noreferrer" class="url" :title="link.originalUrl || link.url">{{ link.originalUrl || link.url }}</a>
        </div>
        <span v-if="link.originalUrl && link.normalizedUrl && link.originalUrl !== link.normalizedUrl" class="normalized-hint">→ {{ link.normalizedUrl }}</span>
      </div>
      <div class="meta">
        <span v-if="savedDateOf()" class="meta-item">
          <time class="js-full" :datetime="link.createdAt">{{ longDate() }}</time>
          <time class="js-short" :datetime="link.createdAt">{{ shortDate() }}</time>
        </span>
        <span v-if="platformName()" class="meta-item">{{ platformIcon() }} {{ platformName() }}</span>
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
          >
            <svg class="pill-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v4.5"/><path d="M12 15.5v.2"/></svg>
            <span>Important</span>
          </button>
          <button
            class="pill"
            :class="{ active: link.favorite }"
            :aria-pressed="String(!!link.favorite)"
            aria-label="Toggle Favorite"
            @click="emit('toggle-favorite', link.id)"
          >
            <svg class="pill-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C7 16.8 3 13.6 3 9.6 3 7 5 5 7.4 5c1.8 0 3.4 1 4.6 2.6C13.2 6 14.8 5 16.6 5 19 5 21 7 21 9.6c0 4-4 7.2-9 11.4z" /></svg>
            <span>Favorite</span>
          </button>
        </div>
        <div class="right-actions">
          <button ref="editTriggerEl" class="icon-btn" @click="toggleEdit" aria-label="Edit link" title="Edit">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button
            ref="moreTriggerEl"
            class="icon-btn"
            :aria-expanded="String(moreOpen)"
            :aria-controls="'card-menu-' + link.id"
            aria-label="More actions"
            @click="toggleMore"
            @keydown.esc="closeMore(true)"
          >
            <svg class="more-dots" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
          </button>
        </div>
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
            <AppSelect :id="'cat-' + link.id" :model-value="link.category" variant="inline" :options="CATEGORIES" aria-label="Change category" @change="changeCategory" />
          </div>
          <div class="more-field">
            <span class="more-field-label">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
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
}
.card:hover { border-color: var(--accent-border); box-shadow: var(--shadow-sm); }
/* explicit editing state: accent border while the anchored edit popover is open
   (same token as LinkRow's .link-row.editing) */
.card.editing { border-color: var(--accent-border); }
.thumb-wrap { display: block; aspect-ratio: 16/7; overflow: hidden; background: var(--muted-bg); max-height: 140px; }
.thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.body { padding: 10px 12px; display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; flex: 1 1 auto; }
/* Metadata: one quiet line of supporting text. The title and URL lead the
   card; category, folder, domain, saved date and provenance follow as plain
   muted text (no badges, no chrome), wrapping only when the card is narrow. */
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--space-2);
  row-gap: var(--space-1);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
/* Each value stays on one line; a long folder name or domain truncates
   instead of widening the line beyond the card. */
.meta-item {
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Responsive date form: the long value on wide cards, the short one on narrow
   cards — the same two <time> values the card has always rendered. */
.js-full { display: inline; }
.js-short { display: none; }
/* Quick-action trigger: three round dots in the shared stroke-icon language. */
svg.more-dots { fill: currentColor; stroke: none; }
.title {
  font-weight: var(--weight-semibold);
  color: var(--text-h);
  text-decoration: none;
  line-height: var(--leading-tight);
  font-size: var(--text-md);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-width: 0;
}
.title:hover { color: var(--accent); }
/* URL: one visual line. The complete value stays in the DOM (and in the
   anchor's accessible name + title attribute); only the painted tail is masked
   so a long URL fades into the surface. The mask gradient is an alpha channel
   (black = opaque), not a painted colour, so it needs no theme value and works
   in light and dark alike. A short URL ends before the fade zone, so it is
   never softened. */
.url-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-xs);
  line-height: 1.35;
}
.url-line {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - var(--space-5)), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - var(--space-5)), transparent);
}
.url {
  display: block;
  color: var(--muted);
  white-space: nowrap;
  text-decoration: none;
}
.url:hover { color: var(--accent); text-decoration: underline; }
/* The normalized value is a secondary detail: it stays on the same line and
   truncates itself rather than crowding the URL out. */
.normalized-hint {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}
.desc {
  font-size: var(--text-xs);
  color: var(--muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
}
.tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.tag {
  font-size: var(--text-xs);
  color: var(--muted);
}
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: auto;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
  flex-wrap: wrap;
  min-width: 0;
}
.status-group { display: flex; gap: 2px; flex-wrap: wrap; min-width: 0; }
/* Status actions: lightweight icon + label, no pill chrome. Inactive is muted;
   active is the accent on the icon/label only — never a filled block. */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast), transform .1s ease;
}
.pill:hover { color: var(--text-h); background: var(--muted-bg); }
.pill:active { transform: scale(0.97); }
.pill:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 1px; }
.pill-icon { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
.pill.active { background: transparent; color: var(--accent); font-weight: var(--weight-semibold); }
.pill.active:hover { background: var(--accent-bg); }
.pill.active .pill-icon { fill: currentColor; stroke: currentColor; }
/* Item actions (.icon-btn, incl. the destructive hover) are defined once in the
   global control language (src/app-overrides.css), so Card and List items use
   the same action treatment. */
.right-actions { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

@media (max-width: 520px) {
  .js-full { display: none; }
  .js-short { display: inline; }
}
</style>
