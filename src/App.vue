<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useLinks } from './composables/useLinks.js'
import { useProfile } from './composables/useProfile.js'
import { useFolders } from './composables/useFolders.js'
import { useSettings } from './composables/useSettings.js'
import Profile from './components/Profile.vue'
import AddLink from './components/AddLink.vue'
import LinkCard from './components/LinkCard.vue'
import StatsPanel from './components/StatsPanel.vue'
import SearchFilter from './components/SearchFilter.vue'
import About from './components/About.vue'
import DataBackup from './components/DataBackup.vue'
import FolderManager from './components/FolderManager.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import pkg from '../package.json'

const appVersion = pkg.version

const { links, total, importantCount, mustHaveCount, favoriteCount, byCategory, storageError, addLink, toggleImportant, toggleMustHave, toggleFavorite, setStatus, removeLink, updateLink, setLinks, moveLinksFromFolder } = useLinks()
const { profile, updateProfile, setProfile } = useProfile()
const { folders, createFolder, renameFolder, deleteFolder, setFolders } = useFolders()
const { appearance, colorScheme, setAppearance, setColorScheme, setSettings } = useSettings()

const search = ref('')
const filterCategory = ref('')
const filterStatus = ref('')
const filterFolder = ref('')
const navOpen = ref(false)
const utilitiesOpen = ref(false)

const navView = computed(() => {
  if (filterFolder.value) return filterFolder.value
  if (filterStatus.value === 'favorite') return '__favorites'
  return 'all'
})

function handleSelectFolder(value) {
  if (value === '__all') {
    filterFolder.value = ''
    filterStatus.value = ''
  } else if (value === '__favorites') {
    filterFolder.value = ''
    filterStatus.value = 'favorite'
  } else {
    filterFolder.value = value
    filterStatus.value = ''
  }
  navOpen.value = false
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    navOpen.value = false
    utilitiesOpen.value = false
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

function handleSetFolder(id, folderId) {
  updateLink(id, { folderId })
  showToast('Folder updated')
}

const toast = ref('')

function showToast(msg) {
  toast.value = msg
  setTimeout(() => toast.value = '', 2500)
}

watch(storageError, (msg) => {
  if (msg) showToast(msg)
})

async function handleAdd(payload) {
  try {
    await addLink(payload)
    showToast('Link saved')
  } catch (e) {
    showToast(e.message || 'Failed to save')
  }
}

function handleDelete(id) {
  if (confirm('Delete this link?')) {
    removeLink(id)
    showToast('Link deleted')
  }
}

function handleEdit(id, patch) {
  updateLink(id, patch)
  showToast('Link updated')
}

function handleImportBackup(data) {
  // data from normalizeBackupData may contain profile, links, folders, settings
  const importedProfile = data.profile
  const importedLinks = data.links
  const importedFolders = data.folders || []
  const importedSettings = data.settings || data
  setLinks(importedLinks)
  setProfile(importedProfile)
  setFolders(importedFolders)
  if (importedSettings) {
    const a = importedSettings.appearance || data.appearance
    const c = importedSettings.colorScheme || data.colorScheme
    if (a || c) setSettings({ appearance: a, colorScheme: c })
  }
  showToast('Backup imported')
}

function handleCreateFolder(name) {
  try {
    createFolder(name)
    showToast('Folder created')
  } catch (e) {
    showToast(e.message || 'Failed')
    throw e
  }
}
function handleRenameFolder({ id, name }) {
  try {
    renameFolder(id, name)
    showToast('Folder renamed')
  } catch (e) {
    showToast(e.message || 'Failed')
    throw e
  }
}
function handleDeleteFolder(id) {
  deleteFolder(id)
  moveLinksFromFolder(id)
  // if filtered folder was deleted, reset filter
  if (filterFolder.value === id) filterFolder.value = ''
  showToast('Folder deleted')
}

const filteredLinks = computed(() => {
  const q = search.value.trim().toLowerCase()
  // build folder name map for search
  const folderNameById = new Map(folders.value.map(f=>[f.id, f.name]))
  return links.value.filter(l => {
    if (filterFolder.value) {
      if (filterFolder.value === '__unfiled') {
        if (l.folderId) return false
      } else if (l.folderId !== filterFolder.value) return false
    }
    if (filterCategory.value && l.category !== filterCategory.value) return false
    if (filterStatus.value) {
      if (filterStatus.value === 'none' && (l.important || l.mustHave)) return false
      if (filterStatus.value === 'important' && !l.important) return false
      if (filterStatus.value === 'must-have' && !l.mustHave) return false
      if (filterStatus.value === 'favorite' && !l.favorite) return false
      if (filterStatus.value === 'not-favorite' && l.favorite) return false
    }
    if (q) {
      const folderName = l.folderId ? (folderNameById.get(l.folderId) || '') : 'Unfiled'
      const hay = [l.title, l.normalizedUrl || l.url, l.originalUrl, l.domain, l.description, l.category, folderName, ...(l.tags || [])].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

const hasLinks = computed(() => links.value.length > 0)
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="logo">🔖</div>
          <div>
            <div class="brand-title">Save Links</div>
            <div class="brand-sub">Local-first bookmark manager</div>
          </div>
        </div>
        <div class="top-actions">
          <span class="pill-count">{{ total }} links</span>
          <button type="button" class="nav-toggle" :aria-expanded="navOpen" aria-controls="nav-col" aria-label="Toggle folders navigation" @click="navOpen = !navOpen">☰ Folders</button>
          <button type="button" class="util-toggle" :aria-expanded="utilitiesOpen" aria-controls="side-col" aria-label="Toggle filters and tools" @click="utilitiesOpen = !utilitiesOpen">⚙<span class="util-toggle-name">Filters &amp; tools</span></button>
          <Profile :profile="profile" compact @update="updateProfile" />
        </div>
      </div>
    </header>

    <div class="layout" :class="{ 'nav-open': navOpen, 'util-open': utilitiesOpen }">
      <div v-if="navOpen" class="nav-backdrop" @click="navOpen = false" aria-hidden="true"></div>
      <div v-if="utilitiesOpen" class="util-backdrop" @click="utilitiesOpen = false" aria-hidden="true"></div>

      <div id="nav-col" class="nav-col">
        <FolderManager :folders="folders" :links="links" :active-view="navView" @create="handleCreateFolder" @rename="handleRenameFolder" @delete="handleDeleteFolder" @select="handleSelectFolder" />
        <div class="nav-divider" role="separator" aria-hidden="true"></div>
        <SettingsPanel :appearance="appearance" :color-scheme="colorScheme" @update:appearance="setAppearance" @update:color-scheme="setColorScheme" />
      </div>

      <div class="main-col">
        <AddLink :folders="folders" @add="handleAdd" />

        <div class="content-head">
          <h2>Saved links</h2>
          <span class="muted">{{ filteredLinks.length }} shown</span>
        </div>

        <div v-if="!hasLinks" class="empty-state">
          <div class="empty-icon">📚</div>
          <h3>No links yet</h3>
          <p>Paste a URL above to save your first bookmark. Metadata is auto-detected and fully editable.</p>
          <div class="example-tags">Try: youtube.com, github.com, instagram.com, amazon.com</div>
        </div>

        <div v-else-if="filteredLinks.length === 0" class="empty-state">
          <h3>No results</h3>
          <p>Try adjusting search or filters.</p>
          <button class="btn ghost" @click="search=''; filterCategory=''; filterStatus=''; filterFolder=''">Clear filters</button>
        </div>

        <div v-else class="grid">
          <LinkCard
            v-for="link in filteredLinks"
            :key="link.id"
            :link="link"
            :folders="folders"
            @toggle-important="toggleImportant"
            @toggle-must-have="toggleMustHave"
            @toggle-favorite="toggleFavorite"
            @set-status="setStatus"
            @delete="handleDelete"
            @edit="handleEdit"
            @set-folder="handleSetFolder"
          />
        </div>
      </div>

      <div id="side-col" class="side-col">
        <DataBackup :links="links" :profile="profile" :folders="folders" :appearance="appearance" :color-scheme="colorScheme" @imported="handleImportBackup" @show-toast="showToast" />
        <SearchFilter
          v-model:search="search"
          v-model:category="filterCategory"
          v-model:status="filterStatus"
          v-model:folder="filterFolder"
          :folders="folders"
        />
        <StatsPanel
          :total="total"
          :by-category="byCategory"
          :important-count="importantCount"
          :must-have-count="mustHaveCount"
          :favorite-count="favoriteCount"
        />
        <About />
      </div>
    </div>

    <div v-if="toast" class="toast" role="status" aria-live="polite">{{ toast }}</div>

    <footer class="footer">Local storage only • No backend • No auth • Data stays in this browser • v{{ appVersion }}</footer>
  </div>
</template>

<style scoped>
.app { min-height: 100vh; display: flex; flex-direction: column; }
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--card);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}
.topbar-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand { display: flex; gap: 12px; align-items: center; }
.logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--text-h);
  color: var(--bg);
  display: grid;
  place-items: center;
  font-size: 18px;
}
.brand-title { font-weight: 800; color: var(--text-h); line-height: 1; }
.brand-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.top-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.pill-count {
  font-size: 12px;
  font-weight: 700;
  background: var(--muted-bg);
  border: 1px solid var(--border);
  padding: 6px 10px;
  border-radius: 999px;
  color: var(--text-h);
}
.layout {
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 20px;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 300px;
  gap: 20px;
  flex: 1;
  align-items: start;
}
.nav-col {
  min-width: 0;
  position: sticky;
  top: 76px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.nav-divider { border-top: 1px solid var(--border); margin: 4px 0; }
.side-col {
  min-width: 0;
  position: sticky;
  top: 76px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.nav-toggle, .util-toggle {
  display: none;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-h);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
}
.nav-toggle:hover, .util-toggle:hover { border-color: var(--accent-border); }
.nav-toggle[aria-expanded="true"], .util-toggle[aria-expanded="true"] { background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent); }
.nav-backdrop, .util-backdrop {
  position: fixed; inset: 0; z-index: 9;
  background: rgba(15, 23, 42, 0.4);
}
.main-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.content-head { display: flex; align-items: baseline; justify-content: space-between; margin-top: 4px; }
.content-head h2 { margin: 0; font-size: 18px; color: var(--text-h); }
.muted { color: var(--muted); font-size: 13px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.empty-state {
  background: var(--card);
  border: 1px dashed var(--border);
  border-radius: 16px;
  padding: 32px 20px;
  text-align: center;
}
.empty-icon { font-size: 28px; margin-bottom: 8px; }
.empty-state h3 { margin: 0 0 6px; color: var(--text-h); }
.empty-state p { margin: 0 auto; max-width: 520px; font-size: 14px; line-height: 1.5; }
.example-tags { margin-top: 12px; font-size: 12px; color: var(--muted); }
.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--text-h);
  color: var(--bg);
  padding: 10px 16px;
  border-radius: 999px;
  font-size: 13px;
  box-shadow: var(--shadow);
  z-index: 50;
}
.footer {
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  padding: 14px 20px 20px;
  border-top: 1px solid var(--border);
  margin-top: 12px;
}
@media (min-width: 1200px) {
  .nav-backdrop, .util-backdrop { display: none; }
}
@media (max-width: 1199px) {
  .layout { grid-template-columns: 1fr; }
  .nav-toggle, .util-toggle { display: inline-flex; }
  .nav-col, .side-col {
    position: fixed;
    top: 70px; /* below the sticky header so the drawer toggles stay clickable */
    bottom: 0;
    z-index: 30;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 16px;
    visibility: hidden;
    transition: transform .22s ease, visibility 0s linear .22s;
  }
  .nav-col {
    left: 0;
    width: 280px;
    max-width: 85vw;
    border-right: 1px solid var(--border);
    transform: translateX(-105%);
  }
  .side-col {
    right: 0;
    width: 300px;
    max-width: 85vw;
    border-left: 1px solid var(--border);
    transform: translateX(105%);
  }
  .layout.nav-open .nav-col {
    transform: translateX(0);
    visibility: visible;
    transition: transform .22s ease, visibility 0s;
  }
  .layout.util-open .side-col {
    transform: translateX(0);
    visibility: visible;
    transition: transform .22s ease, visibility 0s;
  }
}
@media (max-width: 767px) {
  .grid { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .topbar-inner { padding: 10px 14px; }
  .layout { padding: 14px; }
  .brand-sub { display: none; }
  .pill-count { display: none; }
  .util-toggle-name { display: none; }
}
</style>
