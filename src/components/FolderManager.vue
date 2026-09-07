<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  folders: { type: Array, required: true },
  links: { type: Array, required: true },
  activeView: { type: String, default: 'all' }
})

const emit = defineEmits(['create', 'rename', 'delete', 'select'])

const allCount = computed(() => props.links.length)
const favoriteCount = computed(() => props.links.filter(l => l.favorite).length)

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
    <div class="sidebar-head">
      <h4>Folders</h4>
      <span class="muted">Organize links</span>
    </div>

    <button type="button" class="nav-item" :class="{ active: activeView === 'all' }" @click="emit('select', '__all')" aria-label="All links" :aria-current="activeView === 'all' ? 'true' : undefined" title="Show all links">
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3 2 8l10 5 10-5z"/><path d="m2 12 10 5 10-5"/></svg>
      </span>
      <span class="folder-name">All Links</span>
      <span class="folder-count" :aria-label="`All ${allCount} links`">{{ allCount }}</span>
    </button>

    <button type="button" class="nav-item" :class="{ active: activeView === '__favorites' }" @click="emit('select', '__favorites')" aria-label="Show favorites" :aria-current="activeView === '__favorites' ? 'true' : undefined" title="Show favorite links">
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 21C7 16.8 3 13.6 3 9.6 3 7 5 5 7.4 5c1.8 0 3.4 1 4.6 2.6C13.2 6 14.8 5 16.6 5 19 5 21 7 21 9.6c0 4-4 7.2-9 11.4z"/></svg>
      </span>
      <span class="folder-name">Favorites</span>
      <span class="folder-count" :aria-label="`Favorites ${favoriteCount} links`">{{ favoriteCount }}</span>
    </button>

    <div class="create-row">
      <label for="new-folder-input" class="sr-only">New folder name</label>
      <input id="new-folder-input" v-model="newFolderName" placeholder="New folder name" class="input" aria-label="New folder name" @keydown.enter="handleCreate" />
      <button class="btn primary sm" @click="handleCreate" aria-label="Create folder">Create</button>
    </div>
    <p v-if="error" class="error small">{{ error }}</p>

    <ul class="folder-list" aria-label="Folder list">
      <li v-if="folders.length" class="folder-group-label" aria-hidden="true">My folders</li>
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
          <button class="icon-btn" @click="startEdit(f)" :aria-label="`Rename folder ${f.name}`" title="Rename">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn delete" @click="handleDelete(f.id)" :aria-label="`Delete folder ${f.name}`" title="Delete">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </template>
      </li>
    </ul>
    <p v-if="folders.length===0" class="muted small" style="margin-top:8px">No folders yet. Create one above.</p>
  </section>
</template>

<style scoped>
.folder-sidebar {
  display: flex;
  flex-direction: column;
  background: transparent;
  padding: 0;
}
.sidebar-head { margin-bottom: 12px; }
.sidebar-head h4 { margin:0 0 2px; font-size:13px; color:var(--text-h); }
.sidebar-head .muted { font-size:12px; }
.muted { color: var(--muted); font-size:13px; margin:0; }
.muted.small { font-size:12px; margin-top:10px; }
.create-row { display:flex; gap:8px; margin-top:10px; align-items: stretch; flex-wrap: wrap; }
.create-row .btn { align-self: stretch; white-space: nowrap; height: auto; }
.nav-item {
  position: relative;
  display:flex; align-items:center; gap:8px; width:100%;
  background:none; border:none;
  border-radius: var(--radius-sm);
  padding:8px 10px;
  cursor:pointer;
  font-size:13px; font-weight:700; color:var(--text-h);
  text-align:left;
  transition: background .15s, color .15s;
}
.nav-item:hover { background: var(--muted-bg); }
.nav-item + .nav-item { margin-top: 2px; }
.nav-item::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 999px;
  background: var(--accent);
  transform: scaleY(0);
  transform-origin: center;
  transition: transform .18s ease;
}
.nav-item.active { background: var(--accent-bg); color: var(--accent); }
.nav-item.active::before {
  transform: scaleY(1);
}
.nav-icon { display: inline-flex; flex-shrink: 0; color: var(--muted); }
.nav-icon svg { width: 15px; height: 15px; }
.nav-item.active .nav-icon { color: var(--accent); }
.input {
  flex:1;
  min-width:0;
  padding:8px 10px;
  border-radius: var(--radius-sm);
  border:1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
  font-size:13px;
  outline:none;
  transition: border-color .15s, box-shadow .15s;
}
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.btn.sm { padding:6px 10px; font-size:12px; }
.folder-group-label { font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; padding:2px 4px 0; }
.folder-list { list-style:none; padding:0; margin:12px 0 0; display:flex; flex-direction:column; gap:6px; }
.folder-item {
  display:flex; align-items:center; gap:6px;
  border-radius: var(--radius-sm);
  padding:6px 8px;
}
.folder-item:hover { background: var(--muted-bg); }
.folder-item.active { background: var(--accent-bg); }
.folder-item.active .folder-name { color: var(--accent); }
/* editing: the name row is hidden, so the input owns the line; Save/Cancel wrap
   to their own row when the edit controls cannot all share one line */
.folder-item.editing { flex-wrap: wrap; }
.folder-item.editing .input { flex: 1 1 150px; min-width: 0; }
.folder-item.editing .btn { flex: 0 0 auto; white-space: nowrap; }
.folder-row {
  display:flex; align-items:center; gap:8px; flex:1; min-width:0;
  background:none; border:none; padding:2px 2px; cursor:pointer; text-align:left;
}
.folder-name { flex:1; font-size:13px; color:var(--text-h); font-weight:600; word-break:break-word; }
.folder-count { font-size:12px; color:var(--muted); padding:2px 4px; }
.icon-btn {
  width:28px; height:28px; border-radius: var(--radius-sm); border:1px solid var(--border); background: var(--card); cursor:pointer; display:grid; place-items:center; color: var(--muted);
  transition: color .15s, border-color .15s, background .15s, transform .1s ease;
}
.icon-btn svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.icon-btn:hover { border-color: var(--accent-border); color: var(--text-h); }
.icon-btn:active { transform: scale(0.92); }
.icon-btn.delete:hover { background: var(--error-bg); border-color: var(--border); color: var(--error); }
.error { color: var(--error); font-size:12px; margin-top:8px; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@media (max-width: 768px) {
  .icon-btn { width: 36px; height: 36px; }
}
</style>
