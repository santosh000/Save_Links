<script setup>
import { ref } from 'vue'
import { CATEGORIES } from '../utils/categorize.js'
import AppSelect from './AppSelect.vue'

// Shared edit form for LinkCard (Card) and LinkRow (List/Compact). The parent
// renders it inside an anchored popover and owns the open/close state; this
// component owns only the draft fields and emits the trimmed patch on save.
const props = defineProps({
  link: { type: Object, required: true },
  folders: { type: Array, default: () => [] }
})
const emit = defineEmits(['save', 'cancel'])

// Initialized from the link on mount; the popover mounts a fresh instance each
// time it opens, so the draft always starts from the current link.
const draftTitle = ref(props.link.title)
const draftDesc = ref(props.link.description || '')
const draftImage = ref(props.link.image || '')
const draftTags = ref((props.link.tags || []).join(', '))
const draftCategory = ref(props.link.category)
const draftFolderId = ref(props.link.folderId || '')

function save() {
  const tags = draftTags.value.split(',').map(t => t.trim()).filter(Boolean)
  emit('save', {
    title: draftTitle.value.trim().slice(0, 200) || props.link.title,
    description: draftDesc.value.trim().slice(0, 400),
    image: draftImage.value.trim(),
    tags,
    category: draftCategory.value,
    folderId: draftFolderId.value || null
  })
}
</script>

<template>
  <div class="edit-form">
    <label class="edit-field"><span>Title</span><input v-model="draftTitle" class="input edit-input" /></label>
    <label class="edit-field"><span>Description</span><textarea v-model="draftDesc" rows="2" class="input edit-input"></textarea></label>
    <label class="edit-field"><span>Image URL</span><input v-model="draftImage" placeholder="https://..." class="input edit-input" /></label>
    <label class="edit-field"><span>Tags (comma separated)</span><input v-model="draftTags" class="input edit-input" /></label>
    <label class="edit-field"><span>Category</span>
      <AppSelect v-model="draftCategory" variant="field" :options="CATEGORIES" aria-label="Edit category" />
    </label>
    <label class="edit-field"><span>Folder</span>
      <AppSelect v-model="draftFolderId" variant="field" :options="[{ value: '', label: 'Unfiled' }, ...folders]" aria-label="Edit folder" />
    </label>
    <div class="edit-actions">
      <button class="btn primary sm" @click="save">Save</button>
      <button class="btn ghost sm" @click="emit('cancel')">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.edit-form { display: flex; flex-direction: column; gap: var(--space-2); }
.edit-field { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--text-h); }
.edit-input { font-weight: 400; }
/* Field visuals and the dense button size come from the shared control language
   (src/app-overrides.css §11-§12); the mobile tap-size override below still
   applies. */
.edit-actions { display: flex; gap: var(--space-2); margin-top: 6px; justify-content: flex-end; }

/* Mobile form presentation (same treatment as the Add form): comfortable 44px
   tap targets, 16px control text (no iOS zoom-on-focus) and a little more air
   above Save/Cancel. Desktop and tablet are unchanged. */
@media (max-width: 768px) {
  .input,
  .edit-actions .btn {
    min-height: calc(var(--control-height) + var(--space-1));
    font-size: var(--text-lg);
  }
  .edit-actions {
    margin-top: var(--space-3);
  }
}
</style>
