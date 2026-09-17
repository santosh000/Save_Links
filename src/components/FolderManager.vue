<script setup>
import { ref } from 'vue'

const props = defineProps({
  folders: { type: Array, required: true },
  links: { type: Array, required: true },
  activeView: { type: String, default: 'all' }
})

const emit = defineEmits(['create', 'rename', 'delete', 'select'])

const newFolderName = ref('')
const error = ref('')
const editingId = ref(null)
const editingName = ref('')

function counts(folderId) {
  return props.links.filter(l => l.folderId === folderId).length
}
const unfiledCount = () => props.links.filter(l => !l.folderId).length

function handleCreate() {
  error.value = ''
  const name = newFolderName.value.trim()
  if (!name) { error.value = 'Folder name required'; return }
  // App reports the result synchronously through a done callback carried on the
  // event, so expected business errors (duplicate name) stay an explicit
  // result instead of being thrown through Vue's event system, where dev and
  // production behave differently. The defensive catch only covers unexpected
  // exceptions, never normal duplicate detection.
  try {
    emit('create', name, (result) => {
      if (result && result.ok) {
        newFolderName.value = ''
      } else {
        error.value = (result && result.error) || 'Failed'
      }
    })
  } catch (e) {
    error.value = e.message || 'Failed'
  }
}

function startEdit(folder) {
  editingId.value = folder.id
  editingName.value = folder.name
  error.value = ''
}
function cancelEdit() {
  editingId.value = null
  editingName.value = ''
}
function saveEdit(id) {
  error.value = ''
  const name = editingName.value.trim()
  if (!name) { error.value = 'Folder name required'; return }
  // App reports the result synchronously through a done callback carried on the
  // event; on failure we keep the input and stay in edit mode, on success we
  // leave edit mode. Defensive catch only for unexpected exceptions.
  try {
    emit('rename', { id, name }, (result) => {
      if (result && result.ok) {
        editingId.value = null
        editingName.value = ''
      } else {
        error.value = (result && result.error) || 'Failed'
      }
    })
  } catch (e) {
    error.value = e.message || 'Failed'
  }
}
function handleDelete(id) {
  emit('delete', id) // App opens the confirmation dialog
}
</script>

<template>
  <section class="folder-sidebar">
    <!-- System views (All Links / Favorites) intentionally live outside this
         folder-management surface; this card manages user folders only. -->
    <div class="create-row">
      <label for="new-folder-input" class="sr-only">New folder name</label>
      <input id="new-folder-input" v-model="newFolderName" placeholder="New folder name" class="input" aria-label="New folder name" @keydown.enter="handleCreate" />
          <button class="btn ghost sm" @click="handleCreate" aria-label="Create folder">Create</button>
    </div>
    <p v-if="error" class="error small">{{ error }}</p>

    <ul class="folder-list" aria-label="Folder list">
      <li class="folder-group-label" aria-hidden="true">My folders</li>
      <li class="folder-item" :class="{ active: activeView === '__unfiled' }">
        <button type="button" class="folder-row" @click="emit('select', '__unfiled')" :aria-label="`Show Unfiled links`" :aria-current="activeView === '__unfiled' ? 'true' : undefined">
          <span class="folder-name">Unfiled</span>
          <span class="folder-count" :aria-label="`Unfiled ${unfiledCount()} links`">{{ unfiledCount() }}</span>
        </button>
      </li>
      <li v-for="f in folders" :key="f.id" class="folder-item" :class="{ active: activeView === f.id, editing: editingId === f.id }">
        <button v-if="editingId !== f.id" type="button" class="folder-row" @click="emit('select', f.id)" :aria-label="`Show folder ${f.name}`" :aria-current="activeView === f.id ? 'true' : undefined">
          <span class="folder-name">{{ f.name }}</span>
          <span class="folder-count">{{ counts(f.id) }}</span>
        </button>
        <template v-if="editingId === f.id">
          <input v-model="editingName" class="input sm" :aria-label="`Rename folder ${f.name}`" @keydown.enter="saveEdit(f.id)" @keydown.escape="cancelEdit" />
          <button class="btn primary sm" @click="saveEdit(f.id)" aria-label="Save folder name">Save</button>
          <button class="btn ghost sm" @click="cancelEdit" aria-label="Cancel rename">Cancel</button>
        </template>
        <template v-else>
          <button class="icon-btn" @click="startEdit(f)" :aria-label="`Rename folder ${f.name}`">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn delete" @click="handleDelete(f.id)" :aria-label="`Delete folder ${f.name}`">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </template>
      </li>
    </ul>
    <!-- Empty state: same recipe as the Saved Links empty state, sized for the panel -->
    <div v-if="folders.length===0" class="empty-state">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      </div>
      <h3>No folders yet</h3>
      <p>Create one above to group your saved links.</p>
    </div>
  </section>
</template>

<style scoped>
.folder-sidebar {
  display: flex;
  flex-direction: column;
  background: transparent;
  padding: 0;
}
.muted { color: var(--muted); font-size: var(--text-sm); margin:0; }
.muted.small { font-size: var(--text-xs); margin:10px 0 0; }
.create-row { display:flex; gap:var(--space-2); align-items: stretch; flex-wrap: wrap; }
.create-row .btn { align-self: stretch; white-space: nowrap; height: auto; }
/* Field visuals come from the shared .input base and the dense size from the
   shared .btn.sm (src/app-overrides.css §11-§12); this component supplies only
   the layout of its create row. */
.create-row .input { flex: 1; min-width: 0; }
.folder-group-label { font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--muted); padding:2px 4px 0; }
.folder-list { list-style:none; padding:0; margin:12px 0 0; display:flex; flex-direction:column; gap:6px; }
.folder-item {
  display:flex; align-items:center; gap:6px;
  /* Reserved inline-start rail: the active accent indicator appears without
     shifting the row (the same navigation state language as the sidebar). */
  border-inline-start: 2px solid transparent;
  border-start-end-radius: var(--radius-sm);
  border-end-end-radius: var(--radius-sm);
  padding:6px 8px;
}
.folder-item:hover { background: var(--muted-bg); }
.folder-item.active { border-inline-start-color: var(--accent); }
.folder-item.active .folder-name { color: var(--accent); }
/* editing: the name row is hidden, so the input owns the line; Save/Cancel wrap
   to their own row when the edit controls cannot all share one line */
.folder-item.editing { flex-wrap: wrap; }
.folder-item.editing .input { flex: 1 1 150px; min-width: 0; }
.folder-item.editing .btn { flex: 0 0 auto; white-space: nowrap; }
.folder-row {
  display:flex; align-items:center; gap:var(--space-2); flex:1; min-width:0;
  background:none; border:none; padding:2px 2px; cursor:pointer; text-align:left;
}
.folder-name { flex:1; font-size: var(--text-sm); color:var(--text-h); font-weight:var(--weight-semibold); word-break:break-word; }
.folder-count { font-size: var(--text-xs); color:var(--muted); padding:2px 4px; }
/* Item actions use the shared .icon-btn treatment (src/app-overrides.css), so a
   folder row and a link item look like the same product. */
.error { color: var(--error); font-size: var(--text-xs); margin-top:8px; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
/* Empty state mirrors the Saved Links recipe (icon + heading + supporting text)
   with compact spacing for this panel. */
.empty-state { padding: var(--space-4) var(--space-2); text-align: center; }
.empty-icon {
  width: 36px; height: 36px; margin: 0 auto var(--space-2);
  color: var(--accent); background: var(--accent-bg); border-radius: var(--radius-full);
  display: grid; place-items: center;
}
.empty-icon svg { width: 18px; height: 18px; }
.empty-state h3 { margin: 0 0 4px; font-size: var(--text-sm); color: var(--text-h); }
.empty-state p { margin: 0; font-size: var(--text-xs); color: var(--muted); line-height: var(--leading-normal); }

/* Folder rows keep their own comfortable tap size on mobile (unchanged). */
@media (max-width: 768px) {
  .folder-item .icon-btn { width: 36px; height: 36px; }
}
</style>
