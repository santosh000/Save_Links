<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, toRaw } from 'vue'
import { sortLinks, SORT_OPTIONS, DEFAULT_SORT } from './utils/sort.js'
import { CATEGORIES } from './utils/categorize.js'
import { paginationLabel } from './utils/pagination.js'
import { pickImportSlices } from './utils/backup.js'
import { getStorageKey } from './utils/environment.js'
import { detectPlatform } from './utils/device.js'
import { useAnchoredPopover } from './utils/anchoredPopover.js'
import { useLinks, DuplicateLinkError } from './composables/useLinks.js'
import { useProfile } from './composables/useProfile.js'
import { useFolders } from './composables/useFolders.js'
import { useSettings } from './composables/useSettings.js'
import { session } from './auth/session.js'
import { repository } from './storage/repository.js'
import AppDialog from './components/AppDialog.vue'
import AddLink from './components/AddLink.vue'
import About from './components/About.vue'
import DataBackup from './components/DataBackup.vue'
import AccountPanel from './components/AccountPanel.vue'
import LocalProfilePanel from './components/LocalProfilePanel.vue'
import FolderManager from './components/FolderManager.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import LinkCard from './components/LinkCard.vue'
import LinkRow from './components/LinkRow.vue'
import AppSelect from './components/AppSelect.vue'
import pkg from '../package.json'

const appVersion = pkg.version

const { links, total, importantCount, mustHaveCount, favoriteCount, byCategory, storageError, addLink, replaceLink, toggleImportant, toggleMustHave, toggleFavorite, setStatus, removeLink, updateLink, setLinks, moveLinksFromFolder, mergeLinks, getAnonymousLinksCount, getAnonymousLinks } = useLinks()
const { profile, updateProfile } = useProfile()
const { folders, createFolder, renameFolder, deleteFolder, setFolders, mergeFolders, getAnonymousFoldersCount, getAnonymousFolders } = useFolders()
const { appearance, colorScheme, setAppearance, setColorScheme } = useSettings()

const search = ref('')
const searchQuery = ref('')
let searchTimer = null
watch(search, (val) => {
  clearTimeout(searchTimer)
  if (!val) { searchQuery.value = ''; return }
  searchTimer = setTimeout(() => { searchQuery.value = val }, 150)
})

// Mobile search presentation: below the shell breakpoint the field is collapsed
// behind its affordance. This is presentation state ONLY — `search`/`searchQuery`
// above stay the single source of truth for the query and the filtering.
const searchOpen = ref(false)
const searchInputEl = ref(null)
const searchToggleEl = ref(null)

async function openSearch() {
  searchOpen.value = true
  await nextTick()
  searchInputEl.value?.focus()
}

async function closeSearch(restoreFocus = false) {
  searchOpen.value = false
  if (!restoreFocus) return
  // Let the collapsed bar render first — the affordance is display:none while
  // the field is open, so focusing it before the update would be a no-op.
  await nextTick()
  searchToggleEl.value?.focus()
}

// Collapse an untouched field when focus leaves it, so the bar never stays stuck
// in the search state. The query is never cleared here.
function onSearchBlur() {
  if (!search.value) closeSearch()
}

// Search keyboard shortcut (Ctrl+K / ⌘K): discoverability + a fast path into the
// existing search. The keycap label follows the platform; the handler accepts
// either modifier and reuses openSearch() (the one search-opening path). Events
// from editable controls are ignored so native editing is never intercepted.
const searchShortcutLabel = detectPlatform() === 'macOS' ? '⌘ K' : 'Ctrl K'

function isEditableTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return el.isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function onSearchShortcutKeydown(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
  if (e.key !== 'k' && e.key !== 'K') return
  if (isEditableTarget(e.target)) return
  e.preventDefault()
  openSearch()
}

onMounted(() => document.addEventListener('keydown', onSearchShortcutKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onSearchShortcutKeydown))
const filterCategory = ref('')
const filterStatus = ref('')
const filterFolder = ref('')
const sortBy = ref(DEFAULT_SORT)

// Saved Links presentation: 'card' | 'list' | 'compact'.
// Persisted to plain localStorage (NOT the synced settings blob).
const VIEW_MODES = ['card', 'list', 'compact']
const VIEW_MODE_LABELS = { card: 'Card', list: 'List', compact: 'Compact' }
function readViewMode() {
  try {
    const raw = localStorage.getItem(getStorageKey('viewMode'))
    if (raw && VIEW_MODES.includes(raw)) return raw
  } catch { /* storage unavailable (tests/private mode): default is fine */ }
  return 'card'
}
const viewMode = ref(readViewMode())
function setViewMode(m) {
  if (!VIEW_MODES.includes(m)) return
  viewMode.value = m
  try { localStorage.setItem(getStorageKey('viewMode'), m) } catch { /* non-fatal */ }
}

// Navigation
const currentView = ref('links')
const sidebarOpen = ref(false)

// Mobile bottom navigation: "More" is a menu of the secondary destinations the
// desktop sidebar keeps under "Tools" — not a fifth destination of its own.
const MORE_VIEWS = ['settings', 'backup', 'about']
const moreOpen = ref(false)
const moreTriggerEl = ref(null)
const moreMenuEl = ref(null)
const moreActive = computed(() => MORE_VIEWS.includes(currentView.value))

function toggleMore() { moreOpen.value = !moreOpen.value }
function closeMore() { moreOpen.value = false }
function closeMoreFromKey() {
  moreOpen.value = false
  moreTriggerEl.value?.focus()
}

useAnchoredPopover({
  trigger: moreTriggerEl,
  popover: moreMenuEl,
  isOpen: moreOpen,
  onOutside: closeMore,
})

function go(view) { currentView.value = view; sidebarOpen.value = false; moreOpen.value = false }

// Desktop sidebar minimize + fullscreen toggle
const sidebarMinimized = ref(false)
function toggleSidebarMinimized() {
  sidebarMinimized.value = !sidebarMinimized.value
  document.body.classList.toggle('sidebar-minimized', sidebarMinimized.value)
}
function toggleFullscreen() {
  if (document.fullscreenElement) { document.exitFullscreen?.().catch?.(() => {}) }
  else { document.documentElement.requestFullscreen?.().catch?.(() => {}) }
}

// AddLink ref + toggle handler (opens the same anchored popover from the page
// header "+ Add link" button; the toolbar toggle opens it from inside AddLink).
const addLinkEl = ref(null)
async function openAddLink(triggerEl) {
  currentView.value = 'links'
  await nextTick()
  await nextTick()
  const exposed = addLinkEl.value
  if (!exposed) return
  const opened = exposed.toggleFrom(triggerEl)
  if (opened) {
    await nextTick()
    document.getElementById('save-url')?.focus()
  }
}

// Profile UI: Account panel and Edit-profile panel (sidebar profile card opens Account)
const accountOpen = ref(false)
const localProfileOpen = ref(false)

function toggleAccount() {
  accountOpen.value = !accountOpen.value
  if (accountOpen.value) localProfileOpen.value = false
}

function openAccountPanel() {
  localProfileOpen.value = false
  accountOpen.value = true
}

function openLocalProfilePanel() {
  accountOpen.value = false
  localProfileOpen.value = true
}

const openLocalProfile = openLocalProfilePanel

function closeAccountPanel() { accountOpen.value = false }
function closeLocalProfile() { localProfileOpen.value = false }
function saveLocalProfile(name, bio) { updateProfile({ name, bio }) }

// Session/authentication state
const authState = ref(session.getState())
let authUnsubscribe = null
onMounted(() => {
  authUnsubscribe = session.subscribe((state) => { authState.value = state })
})
onBeforeUnmount(() => {
  authUnsubscribe?.()
  stopSyncPolling()
  clearTimeout(searchTimer)
})

// Initials for avatar fallback
const initials = computed(() =>
  (profile.name || 'L').trim().split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'L'
)

// Page header computed props
const pageTitle = computed(() => ({
  links: 'Saved links',
  folders: 'Folders',
  backup: 'Backup & restore',
  settings: 'Settings',
  about: 'About',
}[currentView.value] || 'Saved links'))

const pageSubtitle = computed(() => {
  if (currentView.value === 'links') return `${filteredLinks.value.length} of ${total.value} links shown`
  if (currentView.value === 'folders') return 'Organize your links into folders'
  if (currentView.value === 'backup') return 'Export and import your data'
  if (currentView.value === 'settings') return 'Customize how Save Links looks and behaves'
  if (currentView.value === 'about') return `Save Links v${appVersion}`
  return ''
})

// Folder name helper
function folderName(id) {
  if (!id) return 'Unfiled'
  return folders.value.find(f => f.id === id)?.name || 'Unfiled'
}

// Anonymous → Authenticated sync confirmation
const pendingAnonymousSync = ref(false)
let hasPromptedForAnonymousSync = false

async function handleAnonymousSyncChoice(choice) {
  pendingAnonymousSync.value = false
  hasPromptedForAnonymousSync = true
  if (choice === 'merge') {
    const anonLinks = getAnonymousLinks()
    const anonFolders = getAnonymousFolders()
    const accountId = session.getState().user?.id
    if (!accountId) return
    for (const link of anonLinks) {
      const plainLink = JSON.parse(JSON.stringify(toRaw(link)))
      await repository.addPendingMutation('create', plainLink.id, 'link', { ...plainLink, account_id: accountId }, accountId, 0)
    }
    for (const folder of anonFolders) {
      const plainFolder = JSON.parse(JSON.stringify(toRaw(folder)))
      await repository.addPendingMutation('create', plainFolder.id, 'folder', { ...plainFolder, account_id: accountId }, accountId, 0)
    }
    const mergedLinkIds = new Set(anonLinks.map(l => l.id))
    const mergedFolderIds = new Set(anonFolders.map(f => f.id))
    links.value = links.value.map(l => (mergedLinkIds.has(l.id) ? { ...l, account_id: accountId } : l))
    folders.value = folders.value.map(f => (mergedFolderIds.has(f.id) ? { ...f, account_id: accountId } : f))
    const { syncNowWithMutations } = await import('./composables/useSync.js')
    await syncNowWithMutations()
    showToast('Local data synced to your account')
  } else {
    const anonLinks = getAnonymousLinks()
    const anonFolders = getAnonymousFolders()
    const accountId = session.getState().user?.id
    if (accountId) {
      for (const link of anonLinks) {
        const plainLink = JSON.parse(JSON.stringify(toRaw(link)))
        await repository.addPendingMutation('update', plainLink.id, 'link', { ...plainLink, account_id: accountId, kept_local: true }, accountId, plainLink.revision).catch(() => {})
      }
      for (const folder of anonFolders) {
        const plainFolder = JSON.parse(JSON.stringify(toRaw(folder)))
        await repository.addPendingMutation('update', plainFolder.id, 'folder', { ...plainFolder, account_id: accountId, kept_local: true }, accountId, plainFolder.revision).catch(() => {})
      }
      const keptLinkIds = new Set(anonLinks.map(l => l.id))
      const keptFolderIds = new Set(anonFolders.map(f => f.id))
      links.value = links.value.map(l => (keptLinkIds.has(l.id) ? { ...l, account_id: accountId, kept_local: true } : l))
      folders.value = folders.value.map(f => (keptFolderIds.has(f.id) ? { ...f, account_id: accountId, kept_local: true } : f))
    }
    showToast('Local data kept on this device')
  }
}

function checkAndPromptAnonymousSync() {
  const state = session.getState()
  const isAuthenticated = state.status === 'authenticated' && !!state.user
  if (!isAuthenticated) return
  if (hasPromptedForAnonymousSync) return
  const anonLinkCount = getAnonymousLinksCount()
  const anonFolderCount = getAnonymousFoldersCount()
  if (anonLinkCount > 0 || anonFolderCount > 0) {
    const parts = []
    if (anonLinkCount > 0) parts.push(`${anonLinkCount} link${anonLinkCount > 1 ? 's' : ''}`)
    if (anonFolderCount > 0) parts.push(`${anonFolderCount} folder${anonFolderCount > 1 ? 's' : ''}`)
    pendingAnonymousSync.value = true
    openDialog({
      kind: 'anonymous-sync',
      title: 'Sync your local data?',
      message: `You have ${parts.join(' and ')} saved locally. Would you like to sync them to your account?`,
      buttons: [
        { label: 'Sync & Merge', variant: 'primary', value: 'merge', default: true },
        { label: 'Keep Local', variant: 'ghost', value: 'keep-local' }
      ]
    })
  } else {
    triggerAuthenticatedSync()
  }
}

let initialSyncTriggered = false
async function triggerAuthenticatedSync() {
  if (initialSyncTriggered) return
  initialSyncTriggered = true
  const { syncNow } = await import('./composables/useSync.js')
  await syncNow()
}

watch(() => authState.value.status, (newStatus, oldStatus) => {
  const wasUnauthenticated = oldStatus === 'anonymous' || oldStatus === 'unknown'
  const isNowAuthenticated = newStatus === 'authenticated'
  if (wasUnauthenticated && isNowAuthenticated) {
    hasPromptedForAnonymousSync = false
    initialSyncTriggered = false
    nextTick(() => checkAndPromptAnonymousSync())
    nextTick(() => startSyncPolling())
  } else if (isNowAuthenticated && !initialSyncTriggered) {
    nextTick(() => checkAndPromptAnonymousSync())
    nextTick(() => startSyncPolling())
  }
}, { immediate: true })

// Authenticated polling for cross-browser sync
let syncPollingInterval = null
const POLLING_INTERVAL_MS = 30000
let wasTabHidden = false

function isAuthenticatedAndOnline() {
  const state = session.getState()
  if (state.status !== 'authenticated' || !state.user) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return true
}

async function backgroundSync() {
  try {
    const { syncNow } = await import('./composables/useSync.js')
    await syncNow()
  } catch (err) { console.warn('Background sync failed:', err) }
}

function startSyncPolling() {
  if (syncPollingInterval) return
  const state = session.getState()
  if (state.status !== 'authenticated' || !state.user) return
  syncPollingInterval = setInterval(async () => {
    if (document.visibilityState !== 'visible') return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    await backgroundSync()
  }, POLLING_INTERVAL_MS)
}

function stopSyncPolling() {
  if (syncPollingInterval) { clearInterval(syncPollingInterval); syncPollingInterval = null }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    const resumingFromHidden = wasTabHidden
    wasTabHidden = false
    startSyncPolling()
    if (resumingFromHidden && isAuthenticatedAndOnline()) {
      session.refreshSession()
      backgroundSync()
    }
  } else {
    wasTabHidden = true
    stopSyncPolling()
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  const state = session.getState()
  if (state.status === 'authenticated' && state.user) startSyncPolling()
})

// FolderManager navigation (sidebar → links view with folder filter)
const navView = computed(() => {
  if (filterFolder.value) return filterFolder.value
  if (filterStatus.value === 'favorite') return '__favorites'
  return 'all'
})

function handleSelectFolder(value) {
  if (value === '__all') { filterFolder.value = ''; filterStatus.value = '' }
  else if (value === '__favorites') { filterFolder.value = ''; filterStatus.value = 'favorite' }
  else { filterFolder.value = value; filterStatus.value = '' }
  currentView.value = 'links'
}

const toast = ref('')
function showToast(msg) { toast.value = msg; setTimeout(() => toast.value = '', 2500) }
watch(storageError, (msg) => { if (msg) showToast(msg) })

// Link add/duplicate
async function handleAdd(payload) {
  try {
    await addLink(payload)
    showToast('Link saved')
  } catch (e) {
    if (e instanceof DuplicateLinkError) {
      pendingDuplicate.value = { payload, existing: e.existing }
      openDialog({
        kind: 'duplicate',
        title: 'Link already saved',
        message: 'This link is already in your saved links. Do you want to replace the existing link or save another copy?',
        buttons: [
          { label: 'Replace existing', variant: 'primary', value: 'replace', default: true },
          { label: 'Add another', variant: 'ghost', value: 'add-another' },
          { label: 'Cancel', variant: 'ghost', value: 'cancel' }
        ]
      })
    } else { showToast(e.message || 'Failed to save') }
  }
}

async function handleDuplicateChoice(value) {
  const { payload, existing } = pendingDuplicate.value
  pendingDuplicate.value = null
  if (value === 'replace') {
    try { await replaceLink(existing.id, payload); showToast('Link updated') } catch (e) { showToast(e.message || 'Failed to update') }
  } else if (value === 'add-another') {
    try { await addLink(payload, { allowDuplicate: true }); showToast('Link saved') } catch (e) { showToast(e.message || 'Failed to save') }
  }
}

function requestDeleteLink(id) {
  openDialog({
    kind: 'delete-link', id,
    title: 'Delete this link?',
    message: 'This will remove it from your device and your synced account.',
    buttons: [
      { label: 'Delete', variant: 'danger', value: 'confirm' },
      { label: 'Cancel', variant: 'ghost', value: 'cancel', default: true }
    ]
  })
}

function requestDeleteFolder(id) {
  openDialog({
    kind: 'delete-folder', id,
    title: 'Delete this folder?',
    message: 'This will remove it from your device and your synced account. Links will move to Unfiled.',
    buttons: [
      { label: 'Delete', variant: 'danger', value: 'confirm' },
      { label: 'Cancel', variant: 'ghost', value: 'cancel', default: true }
    ]
  })
}

function requestImport(payload) { handleImportBackup(payload) }

const dialog = ref(null)
const pendingDuplicate = ref(null)
const lastTrigger = ref(null)

function openDialog(cfg) { lastTrigger.value = document.activeElement; dialog.value = cfg }

function closeDialog() {
  dialog.value = null
  const el = lastTrigger.value
  lastTrigger.value = null
  nextTick(() => { if (el && document.body.contains(el)) el.focus() })
}

function onDialogChoose(value) {
  const cfg = dialog.value
  if (cfg) {
    if (cfg.kind === 'duplicate') handleDuplicateChoice(value)
    else if (cfg.kind === 'delete-link') { if (value === 'confirm') { removeLink(cfg.id); showToast('Link deleted') } }
    else if (cfg.kind === 'delete-folder') {
      if (value === 'confirm') {
        deleteFolder(cfg.id)
        moveLinksFromFolder(cfg.id)
        if (filterFolder.value === cfg.id) filterFolder.value = ''
        showToast('Folder deleted')
      }
    } else if (cfg.kind === 'anonymous-sync') handleAnonymousSyncChoice(value)
  }
  closeDialog()
}

function handleEdit(id, patch) { updateLink(id, patch); showToast('Link updated') }

function handleSetFolder(id, folderId) {
  updateLink(id, { folderId })
  showToast('Folder updated')
}

// Quick-action menu: Copy link and Share reuse one clipboard path (no second
// clipboard abstraction). Share prefers the native share sheet when the
// environment provides it, and falls back to copying the link.
function linkUrl(id) {
  const link = links.value.find((l) => l.id === id)
  if (!link) return null
  return { url: link.normalizedUrl || link.url, title: link.title || '' }
}

async function handleCopyLink(id) {
  const target = linkUrl(id)
  if (!target) return
  try {
    await navigator.clipboard.writeText(target.url)
    showToast('Link copied')
  } catch {
    showToast('Could not copy the link')
  }
}

async function handleShareLink(id) {
  const target = linkUrl(id)
  if (!target) return
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: target.title, url: target.url })
      return
    } catch (e) {
      if (e && e.name === 'AbortError') return
      // fall through to the copy fallback when sharing is unavailable
    }
  }
  await handleCopyLink(id)
}

async function handleImportBackup(payload) {
  const { data, strategy = 'skip' } = payload
  const { links: importedLinks, folders: importedFolders } = pickImportSlices(data)
  const linkResult = await mergeLinks(importedLinks, strategy)
  const folderResult = await mergeFolders(importedFolders, strategy)
  const parts = []
  if (linkResult.newCount) parts.push(`${linkResult.newCount} link${linkResult.newCount > 1 ? 's' : ''} added`)
  if (folderResult.newCount) parts.push(`${folderResult.newCount} folder${folderResult.newCount > 1 ? 's' : ''} added`)
  if (linkResult.replacedCount) parts.push(`${linkResult.replacedCount} link${linkResult.replacedCount > 1 ? 's' : ''} replaced`)
  if (folderResult.replacedCount) parts.push(`${folderResult.replacedCount} folder${folderResult.replacedCount > 1 ? 's' : ''} replaced`)
  showToast(parts.length ? `Import complete: ${parts.join(', ')}` : 'Import complete: no changes')
}

function handleCreateFolder(name, done) {
  try { createFolder(name); showToast('Folder created'); done({ ok: true }) }
  catch (e) { showToast(e.message || 'Failed'); if (e.message === 'Folder already exists' || e.message === 'Folder name required') done({ ok: false, error: e.message }); else throw e }
}
function handleRenameFolder({ id, name }, done) {
  try { renameFolder(id, name); showToast('Folder renamed'); done({ ok: true }) }
  catch (e) { showToast(e.message || 'Failed'); if (e.message === 'Folder already exists' || e.message === 'Folder name required') done({ ok: false, error: e.message }); else throw e }
}

// ---- Filtering / sorting ----
const sortedLinks = computed(() => sortLinks(links.value, sortBy.value))

const filteredLinks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const folderNameById = new Map(folders.value.map(f => [f.id, f.name]))
  return sortedLinks.value.filter(l => {
    if (filterFolder.value) {
      if (filterFolder.value === '__unfiled') { if (l.folderId) return false }
      else if (l.folderId !== filterFolder.value) return false
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
      const fN = l.folderId ? (folderNameById.get(l.folderId) || '') : 'Unfiled'
      const hay = [l.title, l.normalizedUrl || l.url, l.originalUrl, l.domain, l.description, l.category, fN, ...(l.tags || [])].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

const hasLinks = computed(() => links.value.length > 0)
const hasSearch = computed(() => search.value.trim().length > 0)
const hasFilters = computed(() => !!(filterCategory.value || filterStatus.value || filterFolder.value))
const favoritesOnly = computed(() => filterStatus.value === 'favorite' && !hasSearch.value && !filterCategory.value && !filterFolder.value)

function clearFilters() { search.value = ''; filterCategory.value = ''; filterStatus.value = ''; filterFolder.value = '' }

// Pagination
const ITEMS_PER_PAGE = 10
const currentPage = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(filteredLinks.value.length / ITEMS_PER_PAGE)))
const paginatedLinks = computed(() => {
  const start = (currentPage.value - 1) * ITEMS_PER_PAGE
  return filteredLinks.value.slice(start, start + ITEMS_PER_PAGE)
})
// Result-count label for the pagination footer. Uses the filtered result set
// (pagination operates on filtered links) and the existing ITEMS_PER_PAGE.
const paginationText = computed(() => paginationLabel(filteredLinks.value.length, currentPage.value, ITEMS_PER_PAGE))
watch([search, filterCategory, filterStatus, filterFolder, sortBy], () => { currentPage.value = 1 })

// Open link safely
function openLink(link) {
  const url = link.normalizedUrl || link.url
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

const STATUS_OPTION_LABELS = { important: 'Important', 'must-have': 'Must Have', none: 'No status', favorite: 'Favorites', 'not-favorite': 'No favorite' }

// Option lists for the shared dropdown (neutral menu; no native popup).
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }))
const CATEGORY_FILTER_OPTIONS = [{ value: '', label: 'Categories' }, ...CATEGORY_OPTIONS]
const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Status' },
  { value: 'important', label: 'Important' },
  { value: 'must-have', label: 'Must Have' },
  { value: 'none', label: 'No status' },
  { value: 'favorite', label: 'Favorites' },
  { value: 'not-favorite', label: 'No favorite' },
]
const activeFilterChips = computed(() => {
  const chips = []
  const q = search.value.trim()
  if (q) chips.push({ key: 'search', label: `Search: "${q}"`, clear: () => { search.value = '' } })
  if (filterStatus.value) chips.push({ key: 'status', label: `Status: ${STATUS_OPTION_LABELS[filterStatus.value] || filterStatus.value}`, clear: () => { filterStatus.value = '' } })
  if (filterCategory.value) chips.push({ key: 'category', label: `Category: ${filterCategory.value}`, clear: () => { filterCategory.value = '' } })
  if (filterFolder.value) {
    const name = filterFolder.value === '__unfiled' ? 'Unfiled' : (folders.value.find(f => f.id === filterFolder.value)?.name || filterFolder.value)
    chips.push({ key: 'folder', label: `Folder: ${name}`, clear: () => { filterFolder.value = '' } })
  }
  return chips
})

// Mobile progressive disclosure for the secondary sort/filter controls. The
// three existing AppSelects (and their state above) stay the single source of
// these values — this only controls when the toolbar surfaces them: inline on
// desktop/tablet, behind one compact trigger below the breakpoint.
const sortFilterOpen = ref(false)
const sortFilterTriggerEl = ref(null)
const sortFilterEl = ref(null)
// Derived from the existing state (no new filtering model): a non-default sort
// or any active filter chip marks the trigger.
const hasActiveSortFilter = computed(() => activeFilterChips.value.length > 0 || sortBy.value !== DEFAULT_SORT)

function closeSortFilter(restoreFocus = false) {
  sortFilterOpen.value = false
  if (restoreFocus) sortFilterTriggerEl.value?.focus()
}

useAnchoredPopover({
  trigger: sortFilterTriggerEl,
  popover: sortFilterEl,
  isOpen: sortFilterOpen,
  onOutside: () => { sortFilterOpen.value = false },
})

onBeforeUnmount(() => {
  authUnsubscribe?.()
  document.body.classList.remove('sidebar-minimized')
  stopSyncPolling()
  clearTimeout(searchTimer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="app">
<!-- Mobile sidebar overlay -->
    <div
      class="sidebar-overlay"
      :class="{ show: sidebarOpen }"
      @click="sidebarOpen = false"
      aria-hidden="true"
    />

    <!-- Sidebar -->
    <aside class="sidebar-wrapper" id="sidebar" :class="{ show: sidebarOpen }">
      <a href="#" class="sidebar-brand" @click.prevent="go('links')">
        <img src="/logo.png" alt="Save Links logo" width="30" height="30" />
        <span>Save Links</span>
      </a>

      <div class="flex-grow-1 overflow-y-auto">
        <!-- Group: Menu -->
        <div class="sidebar-menu-section">
          <div class="sidebar-menu-title">Menu</div>
          <ul class="sidebar-menu-list">
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: currentView === 'links' }" @click.prevent="go('links')">
                <i class="bi bi-bookmarks"></i>
                <span>Saved links</span>
                <span class="sidebar-menu-badge">{{ total }}</span>
              </a>
            </li>
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: currentView === 'folders' }" @click.prevent="go('folders')">
                <i class="bi bi-folder2"></i>
                <span>Folders</span>
                <span v-if="folders.length" class="sidebar-menu-badge">{{ folders.length }}</span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Group: Tools -->
        <div class="sidebar-menu-section">
          <div class="sidebar-menu-title">Tools</div>
          <ul class="sidebar-menu-list">
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: currentView === 'backup' }" @click.prevent="go('backup')">
                <i class="bi bi-arrow-repeat"></i>
                <span>Backup & restore</span>
              </a>
            </li>
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: currentView === 'settings' }" @click.prevent="go('settings')">
                <i class="bi bi-gear"></i>
                <span>Settings</span>
              </a>
            </li>
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: currentView === 'about' }" @click.prevent="go('about')">
                <i class="bi bi-info-circle"></i>
                <span>About</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

    </aside>

    <!-- Main wrapper -->
    <div class="main-wrapper">
      <!-- Navbar -->
      <nav class="navbar-custom" :class="{ 'is-searching': searchOpen }">
        <div class="navbar-left">
          <a href="#" class="mobile-brand" @click.prevent="go('links')">
            <img src="/logo.png" alt="" width="26" height="26" />
            <span>Save Links</span>
          </a>
          <button type="button" class="btn-desktop-toggle d-none d-xl-flex align-items-center justify-content-center me-3" id="desktop-sidebar-toggle" aria-label="Minimize sidebar" @click="toggleSidebarMinimized">
            <i class="bi bi-chevron-bar-left" :class="{ 'bi-chevron-bar-right': sidebarMinimized }"></i>
          </button>
          <button type="button" class="sidebar-toggle-btn me-2" id="sidebar-toggle" aria-label="Toggle navigation" @click="sidebarOpen = !sidebarOpen">
            <i class="bi bi-list"></i>
          </button>
        </div>

        <!-- Mid navbar: search pill -->
        <div class="navbar-search-wrapper" id="main-search">
          <input ref="searchInputEl" type="search" class="navbar-search-input" placeholder="Search links…" aria-label="Search links" aria-keyshortcuts="Control+K Meta+K" :value="search" @input="search = $event.target.value" @keydown.esc.prevent="closeSearch(true)" @blur="onSearchBlur" />
          <button v-if="search" type="button" class="navbar-search-btn" aria-label="Clear search" @click="search = ''"><i class="bi bi-x-lg"></i></button>
          <button v-else type="button" class="navbar-search-btn" :aria-label="searchOpen ? 'Close search' : null" :aria-hidden="searchOpen ? null : 'true'" :tabindex="searchOpen ? null : '-1'" @click="searchOpen && closeSearch(true)"><i class="bi" :class="searchOpen ? 'bi-x-lg' : 'bi-search'"></i></button>
          <kbd class="navbar-search-kbd" aria-hidden="true">{{ searchShortcutLabel }}</kbd>
        </div>

        <!-- Right actions -->
        <div class="navbar-actions">
          <button ref="searchToggleEl" type="button" class="navbar-search-toggle" aria-label="Search" aria-controls="main-search" :aria-expanded="String(searchOpen)" @click="openSearch">
            <i class="bi bi-search"></i>
          </button>
          <button type="button" class="navbar-action-btn me-1" id="btn-fullscreen" aria-label="Toggle Fullscreen" @click="toggleFullscreen">
            <i class="bi bi-arrows-fullscreen"></i>
          </button>
          <button
            type="button"
            class="identity-btn"
            :aria-expanded="accountOpen"
            :aria-label="authState.status === 'authenticated' ? 'Account menu, signed in as ' + profile.name : 'Account menu, sign in'"
            @click="toggleAccount"
          >
            <div class="identity-avatar">{{ initials }}</div>
            <div class="identity-info">
              <div class="identity-name">{{ profile.name }}</div>
              <div class="identity-status">
                <span v-if="authState.status === 'authenticated'" class="status-dot" aria-hidden="true"></span>
                <span>{{ authState.status === 'authenticated' ? 'Signed in' : 'Sign in' }}</span>
              </div>
            </div>
          </button>
        </div>
      </nav>

      <!-- Page Header -->
      <div class="page-header">
        <div>
          <h1 class="page-title">{{ pageTitle }}</h1>
          <p class="page-subtitle">{{ pageSubtitle }}</p>
        </div>
        <button type="button" class="btn-date-picker" @click="openAddLink($event.currentTarget)">
          <i class="bi bi-plus-lg"></i>
          <span>Add link</span>
        </button>
      </div>

      <!-- Main Content -->
      <main class="flex-grow-1">

        <!-- ===== VIEW: Saved Links ===== -->
        <section v-if="currentView === 'links'" class="links-view">
          <!-- One unified panel: toolbar header, link content, pagination footer -->
          <div class="links-panel">
          <!-- Toolbar: "Save a Link" on the left, view/sort/filter/export on the right -->
          <div class="content-head">
            <AddLink ref="addLinkEl" :folders="folders" @add="handleAdd" />
            <template v-if="hasLinks">
              <div class="toolbar-controls">
                <div class="view-switch" role="group" aria-label="View mode">
                  <button
                    v-for="m in VIEW_MODES"
                    :key="m"
                    type="button"
                    class="view-btn"
                    :class="{ active: viewMode === m }"
                    :aria-pressed="String(viewMode === m)"
                    :title="VIEW_MODE_LABELS[m] + ' view'"
                    @click="setViewMode(m)"
                  >
                    <svg class="view-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <g v-if="m === 'card'">
                        <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
                        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
                        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
                        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
                      </g>
                      <g v-else-if="m === 'list'">
                        <rect x="3" y="5" width="18" height="4" rx="1.5" />
                        <rect x="3" y="10" width="18" height="4" rx="1.5" />
                        <rect x="3" y="15" width="18" height="4" rx="1.5" />
                      </g>
                      <g v-else>
                        <path d="M5 6.5h14M5 12h14M5 17.5h14" />
                      </g>
                    </svg>
                    <span class="view-label">{{ VIEW_MODE_LABELS[m] }}</span>
                  </button>
                </div>
                <button
                  ref="sortFilterTriggerEl"
                  type="button"
                  class="sort-filter-toggle"
                  :class="{ active: hasActiveSortFilter }"
                  aria-controls="sort-filter-panel"
                  :aria-expanded="String(sortFilterOpen)"
                  @click="sortFilterOpen = !sortFilterOpen"
                  @keydown.esc="closeSortFilter(true)"
                >
                  <i class="bi bi-sliders" aria-hidden="true"></i>
                  <span>Sort &amp; Filter</span>
                </button>
                <div
                  id="sort-filter-panel"
                  ref="sortFilterEl"
                  class="toolbar-filters anchored-popover"
                  :class="{ open: sortFilterOpen }"
                  @keydown.esc="closeSortFilter(true)"
                >
                  <div class="filter-field">
                    <span class="filter-field-label">Sort</span>
                    <AppSelect
                      id="filter-sort"
                      variant="header"
                      aria-label="Sort by"
                      :model-value="sortBy"
                      :options="SORT_OPTIONS"
                      @update:model-value="sortBy = $event"
                    />
                  </div>
                  <div class="filter-field">
                    <span class="filter-field-label">Category</span>
                    <AppSelect
                      id="filter-category"
                      variant="header"
                      aria-label="Filter by category"
                      :model-value="filterCategory"
                      :options="CATEGORY_FILTER_OPTIONS"
                      @update:model-value="filterCategory = $event"
                    />
                  </div>
                  <div class="filter-field">
                    <span class="filter-field-label">Status</span>
                    <label for="filter-status" class="sr-only">Filter by status</label>
                    <AppSelect
                      id="filter-status"
                      variant="header"
                      aria-label="Filter by status"
                      :model-value="filterStatus"
                      :options="STATUS_FILTER_OPTIONS"
                      @update:model-value="filterStatus = $event"
                    />
                  </div>
                </div>
                <button type="button" class="toolbar-add toolbar-export" aria-label="Export links" @click="go('backup')">
                  <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
                  <span>Export</span>
                </button>
              </div>
              <div v-if="activeFilterChips.length" class="filter-chips" role="group" aria-label="Active filters">
                <span v-for="chip in activeFilterChips" :key="chip.key" class="filter-chip">
                  {{ chip.label }}
                  <button type="button" class="chip-clear" :aria-label="'Clear ' + chip.key + ' filter'" title="Remove this filter" @click="chip.clear()">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
                  </button>
                </span>
                <button v-if="activeFilterChips.length > 1" type="button" class="chip-clear-all" @click="clearFilters">Clear all</button>
              </div>
            </template>
          </div>

          <!-- Link content -->
          <div class="links-content">
          <!-- Old Saved Links content section (hybrid: old link presentation + current pagination) -->
          <template v-if="hasLinks">
            <!-- Empty state: no matches -->
            <div v-if="filteredLinks.length === 0" class="empty-state">
              <div class="empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
              </div>
              <h3>{{ favoritesOnly ? 'No favorites yet' : hasSearch ? 'No results' : 'No matches' }}</h3>
              <p v-if="favoritesOnly">Star any link to pin it here as a favorite.</p>
              <p v-else-if="hasSearch">Nothing matches "{{ search.trim() }}" in the current view. Try a different search{{ hasFilters ? ' or loosen your filters' : '' }}.</p>
              <p v-else>No links match the current filters. Try widening them.</p>
              <button v-if="favoritesOnly" class="btn ghost" @click="filterStatus = ''">Show all links</button>
              <button v-else-if="hasSearch" class="btn ghost" @click="clearFilters">Clear search{{ hasFilters ? ' and filters' : '' }}</button>
              <button v-else class="btn ghost" @click="clearFilters">Clear filters</button>
            </div>

            <!-- Old link list -->
            <template v-else>
              <div v-if="viewMode === 'card'" class="grid">
                <LinkCard
                  v-for="link in paginatedLinks"
                  :key="link.id"
                  :link="link"
                  :folders="folders"
                  @toggle-important="toggleImportant"
                  @toggle-must-have="toggleMustHave"
                  @toggle-favorite="toggleFavorite"
                  @set-status="setStatus"
                  @delete="requestDeleteLink"
                  @edit="handleEdit"
                  @set-folder="handleSetFolder"
                  @copy="handleCopyLink"
                  @share="handleShareLink"
                />
              </div>
              <div v-else class="row-list" :class="{ compact: viewMode === 'compact' }">
                <LinkRow
                  v-for="link in paginatedLinks"
                  :key="link.id"
                  :link="link"
                  :folders="folders"
                  :mode="viewMode"
                  @toggle-important="toggleImportant"
                  @toggle-must-have="toggleMustHave"
                  @toggle-favorite="toggleFavorite"
                  @set-status="setStatus"
                  @delete="requestDeleteLink"
                  @edit="handleEdit"
                  @set-folder="handleSetFolder"
                  @copy="handleCopyLink"
                  @share="handleShareLink"
                />
              </div>
            </template>
          </template>

          <!-- Empty state: no links at all -->
          <div v-else class="empty-state">
            <div class="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 5c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V3c-3 0-6 .5-8 2z"/><path d="M12 5v14"/></svg>
            </div>
            <h3>No links yet</h3>
            <p>Paste a URL above to save your first bookmark. Metadata is auto-detected and fully editable.</p>
            <div class="example-tags">Try: youtube.com, github.com, instagram.com, amazon.com</div>
          </div>
          </div>

          <!-- Pagination footer -->
          <div class="table-footer-control">
            <span class="table-pagination-info">{{ paginationText }}</span>
            <nav v-if="totalPages > 1" aria-label="Page navigation">
              <ul class="pagination mb-0 gap-1">
                <li class="page-item" :class="{ disabled: currentPage === 1 }">
                  <a class="page-link border-0" href="#" aria-label="Previous page" @click.prevent="currentPage = Math.max(1, currentPage - 1)"><i class="bi bi-chevron-left"></i></a>
                </li>
                <li v-for="p in totalPages" :key="p" class="page-item" :class="{ active: p === currentPage }">
                  <a class="page-link border-0" href="#" :aria-label="'Page ' + p" :aria-current="p === currentPage ? 'page' : undefined" @click.prevent="currentPage = p">{{ p }}</a>
                </li>
                <li class="page-item" :class="{ disabled: currentPage === totalPages }">
                  <a class="page-link border-0" href="#" aria-label="Next page" @click.prevent="currentPage = Math.min(totalPages, currentPage + 1)"><i class="bi bi-chevron-right"></i></a>
                </li>
              </ul>
            </nav>
          </div>
          </div>
        </section>

        <!-- ===== VIEW: Folders ===== -->
        <section v-else-if="currentView === 'folders'" class="card">
          <FolderManager
            :folders="folders"
            :links="links"
            :active-view="navView"
            @create="handleCreateFolder"
            @rename="handleRenameFolder"
            @delete="requestDeleteFolder"
            @select="handleSelectFolder"
          />
        </section>

        <!-- ===== VIEW: Backup ===== -->
        <section v-else-if="currentView === 'backup'" class="card">
          <DataBackup :links="links" :profile="profile" :folders="folders" :appearance="appearance" :color-scheme="colorScheme" @import-request="requestImport" @show-toast="showToast" />
        </section>

        <!-- ===== VIEW: Settings ===== -->
        <section v-else-if="currentView === 'settings'" class="card">
          <SettingsPanel :appearance="appearance" :color-scheme="colorScheme" @update:appearance="setAppearance" @update:color-scheme="setColorScheme" />
        </section>

        <!-- ===== VIEW: About ===== -->
        <section v-else-if="currentView === 'about'" class="card">
          <About />
        </section>

      </main>

      <footer class="footer">
        <span class="footer-tagline">Local-first bookmark manager</span>
        <span class="footer-meta">Sign in to sync across devices &middot; v{{ appVersion }}</span>
      </footer>
    </div>

    <!-- Mobile bottom navigation: the primary destinations of the mobile shell
         (Links · Folders · Add · More), hidden above the mobile breakpoint by CSS.
         Every item routes through the existing go() / openAddLink() state — the
         bar is another entry point, not a second navigation system. -->
    <nav class="bottom-nav" aria-label="Primary">
      <button
        type="button"
        class="bottom-nav-item"
        :class="{ active: currentView === 'links' }"
        :aria-current="currentView === 'links' ? 'page' : null"
        @click="go('links')"
      >
        <i class="bi bi-bookmarks" aria-hidden="true"></i>
        <span>Links</span>
      </button>
      <button
        type="button"
        class="bottom-nav-item"
        :class="{ active: currentView === 'folders' }"
        :aria-current="currentView === 'folders' ? 'page' : null"
        @click="go('folders')"
      >
        <i class="bi bi-folder2" aria-hidden="true"></i>
        <span>Folders</span>
      </button>
      <button type="button" class="bottom-nav-item" @click="openAddLink($event.currentTarget)">
        <i class="bi bi-plus-lg" aria-hidden="true"></i>
        <span>Add</span>
      </button>
      <button
        type="button"
        ref="moreTriggerEl"
        class="bottom-nav-item"
        :class="{ active: moreActive }"
        aria-controls="more-menu"
        :aria-expanded="String(moreOpen)"
        @click="toggleMore"
        @keydown.esc="closeMoreFromKey"
      >
        <i class="bi bi-three-dots" aria-hidden="true"></i>
        <span>More</span>
      </button>
    </nav>

    <!-- More menu: the secondary destinations (the sidebar's "Tools" group),
         anchored to the More item by src/utils/anchoredPopover.js. -->
    <Teleport to="body">
      <Transition name="fade-down">
        <div v-if="moreOpen" id="more-menu" ref="moreMenuEl" class="more-menu anchored-popover" @keydown.esc="closeMoreFromKey">
          <button type="button" class="more-item" :class="{ active: currentView === 'settings' }" @click="go('settings')">
            <i class="bi bi-gear" aria-hidden="true"></i>
            <span>Settings</span>
          </button>
          <button type="button" class="more-item" :class="{ active: currentView === 'backup' }" @click="go('backup')">
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
            <span>Backup &amp; restore</span>
          </button>
          <button type="button" class="more-item" :class="{ active: currentView === 'about' }" @click="go('about')">
            <i class="bi bi-info-circle" aria-hidden="true"></i>
            <span>About</span>
          </button>
        </div>
      </Transition>
    </Teleport>

    <!-- ===== Panels & Dialog ===== -->
    <AccountPanel
      :open="accountOpen"
      :local-profile="profile"
      @close="closeAccountPanel"
      @edit-local-profile="openLocalProfile"
    />
    <LocalProfilePanel
      :open="localProfileOpen"
      :name="profile.name"
      :bio="profile.bio"
      @save="saveLocalProfile"
      @close="closeLocalProfile"
    />
    <AppDialog
      :open="!!dialog"
      :title="dialog?.title || ''"
      :message="dialog?.message || ''"
      :buttons="dialog?.buttons || []"
      @choose="onDialogChoose"
      @close="closeDialog"
    />

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast" class="sl-toast" role="status" aria-live="polite">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  min-height: 100dvh;
}

/* Intentional reading width: page header, content and footer stay centered on
   very wide monitors instead of stretching edge to edge. */
.main-wrapper > .page-header,
.main-wrapper > main,
.main-wrapper > .footer {
  width: 100%;
  max-width: 1560px;
  margin-left: auto;
  margin-right: auto;
}

/* Footer: subtle shell chrome (not a floating card) */
.footer {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  color: var(--muted);
}
.footer-tagline { font-size: 12.5px; font-weight: var(--weight-semibold); color: var(--text-h); }
.footer-meta { color: var(--muted); }

/* Header profile control (from db93ded) */
.identity-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  color: var(--text-h);
}
.identity-btn:hover { background: var(--muted-bg); }
.identity-btn:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
.identity-avatar {
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border-radius: var(--radius-full);
  background: var(--muted-bg);
  color: var(--text-h);
  display: grid;
  place-items: center;
  font-weight: var(--weight-bold);
  font-size: var(--text-xs);
  flex-shrink: 0;
}
.identity-info { display: flex; flex-direction: column; min-width: 0; }
.identity-name { font-weight: var(--weight-bold); font-size: var(--text-sm); color: var(--text-h); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.identity-status { display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--muted); }
.identity-status .status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--success);
  flex-shrink: 0;
}

/* Unified Saved Links panel: toolbar header + link content + pagination footer
   in ONE surface. The items inside carry the only chrome, so the panel itself
   stays a flat bordered surface (no second elevation layer to nest with). */
.links-panel {
  margin-top: 4px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
/* Toolbar = panel header (no card chrome of its own) */
.content-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  padding: 10px 14px;
}
.content-head > * {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
/* Link content inside the panel */
.links-content { padding: 14px; }
/* Pagination = panel footer (no separate card/background) */
.links-panel .table-footer-control {
  background: transparent;
  border-top: 1px solid var(--border);
  padding: 10px 14px;
  margin: 0;
}
/* Toolbar layout: Save a Link on the left, view/sort/filter/export on the right.
   The AddLink root inherits this component's scope, so drop its own card chrome
   and keep only the compact toggle inside the toolbar. Inner nodes need :deep(). */
.content-head :deep(.add-card) {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}
.content-head :deep(.add-toggle-hint) { display: none; }
.toolbar-controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  /* Share the toolbar row with the Add control instead of dropping to a line of
     its own when the controls are wider than the space next to it: the group
     takes the remaining row width (so it never wraps as a block) and its own
     controls wrap internally, aligned to the right. */
  flex: 1 1 0;
  justify-content: flex-end;
  min-width: 0;
}
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

/* Sorting/filter controls: quiet, borderless — hierarchy from typography + hover */

/* View switch: a compact control group, not a segmented Bootstrap track */
/* View mode (Card / List / Compact): one segmented group on a quiet inset
   track using the shared surface/border/radius tokens, so the three modes read
   as a single control. The track carries the grouping (no outer border and no
   separators between segments); the accent marks the active mode. */
.view-switch {
  display: inline-flex;
  align-items: stretch;
  flex-shrink: 0;
  background: var(--muted-bg);
  border: none;
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-right: var(--space-1);
}
.view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: var(--control-height-sm);
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast), transform .1s ease;
}
/* No separators between segments: the inset track groups them, and only the
   active mode carries a fill (a separator line is what makes a segmented
   control look like a framework button group). */
.view-btn:hover { color: var(--text-h); }
.view-btn:active { transform: scale(0.97); }
.view-btn:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: -2px; }
.view-btn.active { background: var(--accent-bg); color: var(--accent); font-weight: var(--weight-semibold); }
.view-icon { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.view-btn.active .view-icon { stroke: var(--accent); }
.view-label { white-space: nowrap; }

/* Secondary sort/filter controls: on desktop/tablet they stay inline in the
   toolbar (display: contents keeps the existing AppSelects direct flex items of
   the control row, exactly as before); below the breakpoint they are
   progressively disclosed behind one compact trigger. */
.sort-filter-toggle {
  display: none;
}
.toolbar-filters {
  display: contents;
}
.filter-field {
  display: contents;
}
.filter-field-label {
  display: none;
}

/* Toolbar utility actions (Export): secondary, quiet */
.toolbar-add {
  width: var(--control-height);
  height: var(--control-height);
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast), transform .1s ease;
}
.toolbar-add:hover { color: var(--text-h); background: var(--muted-bg); }
.toolbar-add:active { transform: scale(0.94); }
.toolbar-add svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
/* Export is a labelled control (outgoing icon + text), not a download-only icon button */
.toolbar-export {
  width: auto;
  height: var(--control-height);
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--muted);
}
.toolbar-export i { font-size: var(--text-lg); line-height: 1; }

/* Active-filter chips */
.filter-chips {
  flex: 1 1 100%;
  order: 99;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 7px;
  margin-top: 2px;
  border-top: 1px dashed var(--border);
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--accent);
  background: var(--accent-bg);
  border: none;
  border-radius: var(--radius-full);
  padding: 3px 4px 3px 10px;
  white-space: nowrap;
}
.chip-clear {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}
.chip-clear:hover { background: var(--accent); color: var(--on-accent); }
.chip-clear svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.chip-clear-all {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--muted);
  background: var(--muted-bg);
  border: none;
  border-radius: var(--radius-full);
  padding: 3px 10px;
  cursor: pointer;
  transition: color var(--transition-fast);
}
.chip-clear-all:hover { color: var(--text-h); }

/* Old link list layouts */
.grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 16px;
}
.row-list {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 10px;
}
.row-list.compact { gap: 6px; }

/* Empty states: plain centered content inside the panel (no nested box) */
.empty-state {
  padding: 36px 20px;
  text-align: center;
  animation: rise-in .2s ease;
}
.empty-icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 10px;
  color: var(--accent);
  background: var(--accent-bg);
  border-radius: var(--radius-full);
  display: grid;
  place-items: center;
}
.empty-icon svg { width: 24px; height: 24px; }
.empty-state h3 { margin: 0 0 6px; color: var(--text-h); }
.empty-state p { margin: 0 auto; max-width: 520px; font-size: var(--text-md); line-height: var(--leading-normal); }
.example-tags { margin-top: 12px; font-size: var(--text-xs); color: var(--muted); }

@keyframes rise-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Card view columns */
@media (min-width: 768px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1200px) {
  .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (min-width: 1280px) {
  .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

/* List/Compact view columns */
@media (min-width: 1100px) {
  .row-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 768px) {
  .identity-info { display: none; }
  .identity-btn { padding: 4px 6px 4px 4px; gap: 0; }
  .identity-avatar { width: 28px; height: 28px; }
  /* Compact mobile app bar: brand · search · profile on ONE row (the ≤1200 shell
     wraps them onto two). The search takes the remaining width, the profile never
     shrinks, and the brand yields first if the row gets very narrow. */
  .navbar-custom {
    flex-wrap: nowrap;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    margin-bottom: var(--space-3);
    gap: var(--space-2);
  }
  .navbar-left,
  .navbar-actions {
    gap: var(--space-2);
  }
  .navbar-left {
    flex: 0 1 auto;
  }
  .navbar-actions {
    flex: 0 0 auto;
  }
  .navbar-search-wrapper {
    order: 0;
    flex: 1 1 0;
    width: auto;
    min-width: 0;
    margin: 0;
    /* Collapsed by default: the bar shows the search affordance until search opens. */
    display: none;
  }
  .navbar-custom.is-searching .navbar-search-wrapper {
    display: block;
  }
  .navbar-search-toggle {
    display: flex;
  }
  /* While searching the field owns the bar: the brand and the affordance step
     aside and the profile keeps its place. The field takes whatever row space is
     left, so its width is never hardcoded. */
  .navbar-custom.is-searching .mobile-brand,
  .navbar-custom.is-searching .navbar-search-toggle {
    display: none;
  }
  .mobile-brand span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .navbar-search-input {
    padding: 0.5rem 1rem;
    padding-right: 2.25rem;
  }
  /* Compact Saved Links heading: the title and its dynamic count share one
     baseline row (title left, count ending at the content edge), with the
     surrounding rhythm tightened to a section-header spacing. The copy wraps
     gracefully when it needs the width. */
  .page-header {
    flex-direction: row;
    align-items: baseline;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .page-header > div {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    column-gap: var(--space-3);
    row-gap: var(--space-1);
  }
  .page-title {
    font-size: 1.4rem;
    margin-bottom: 0;
  }

  /* Mobile toolbar: the bottom bar's Add item is the single Add entry point
     (same AddLink form), so the panel's duplicate "Save a link" is hidden here.
     Export stays reachable through More → Backup & restore. Both controls keep
     their desktop/tablet behavior. */
  .content-head :deep(.add-card) {
    display: none;
  }
  .toolbar-export {
    display: none;
  }
  /* With the Add control hidden the control group is the only toolbar child, so
     its rows centre in the available content width instead of hugging the
     right edge. */
  .toolbar-controls {
    justify-content: center;
  }
  /* The view-mode group keeps its natural size (it is a segmented control, not a
     full-width bar): it shares the toolbar row with the sort/filter controls
     wherever the width allows and otherwise centres on its own line, because the
     control group above is centred. */

  /* Mobile: the secondary controls collapse into one compact trigger, so the
     toolbar row is the view-mode group plus this trigger. */
  .sort-filter-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-height-sm);
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);
  }
  .sort-filter-toggle:hover {
    background: var(--muted-bg);
    color: var(--text-h);
  }
  .sort-filter-toggle:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
  /* The existing state (a non-default sort or an active filter) marks the
     trigger — no new filtering model, the accent only for the active state. */
  .sort-filter-toggle.active {
    color: var(--accent);
  }

  /* Disclosure surface: the existing AppSelects, stacked with their captions.
     The anchored-popover surface + positioner are reused as-is. */
  .toolbar-filters {
    display: none;
    width: min(280px, calc(100vw - var(--space-6)));
  }
  .toolbar-filters.open {
    display: block;
  }
  .filter-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .filter-field + .filter-field {
    margin-top: var(--space-3);
  }
  .filter-field-label {
    display: block;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--text-h);
  }
  .toolbar-filters :deep(.asel-trigger) {
    min-height: var(--control-height);
  }
  /* In the stacked disclosure the selects sit on the column axis, so the
     toolbar's horizontal flex sizing must not stretch them vertically. */
  .toolbar-filters :deep(.asel--header) {
    flex: 0 0 auto;
  }
}

@media (max-width: 575px) {
  .content-head { padding: 8px; gap: 6px; }
  .toolbar-controls { gap: 6px; }
  .asel--header { min-width: 90px; flex: 1 1 110px; }
  .asel--header .asel-trigger { font-size: var(--text-xs); }
  .view-btn { padding: 5px 7px; }
  .view-label { display: none; }
  .toolbar-add { width: 34px; height: 34px; }
  .toolbar-export { width: auto; height: 34px; padding: 0 10px; }
}
</style>
