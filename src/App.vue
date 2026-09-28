<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, toRaw } from 'vue'
import { sortLinks, SORT_OPTIONS, DEFAULT_SORT } from './utils/sort.js'
import { CATEGORIES } from './utils/categorize.js'
import { LINK_TYPES, LINK_TYPE_LABELS } from './domain/link.js'
import { descendantIds, folderPath, folderSelectOptions as buildFolderSelectOptions } from './utils/folderTree.js'
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
import BulkActionBar from './components/BulkActionBar.vue'
import CommandPalette from './components/CommandPalette.vue'
import LinkDetailPanel from './components/LinkDetailPanel.vue'
import pkg from '../package.json'

const appVersion = pkg.version

const { links, total, importantCount, mustHaveCount, favoriteCount, byCategory, storageError, addLink, replaceLink, toggleImportant, toggleMustHave, toggleFavorite, togglePin, setStatus, removeLink, updateLink, setLinks, moveLinksFromFolder, mergeLinks, getAnonymousLinksCount, getAnonymousLinks } = useLinks()
const { profile, updateProfile } = useProfile()
const { folders, createFolder, renameFolder, moveFolder, deleteFolder, setFolders, mergeFolders, getAnonymousFoldersCount, getAnonymousFolders } = useFolders()
const { appearance, colorScheme, resolvedAppearance, setAppearance, setColorScheme } = useSettings()

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

// Keyboard shortcut (Ctrl+K / ⌘K): opens the command palette — a keyboard
// layer over real actions. The palette's first command focuses the existing
// search field, so search stays one keypress away. The keycap label follows
// the platform; events from editable controls are ignored so native editing is
// never intercepted.
const searchShortcutLabel = detectPlatform() === 'macOS' ? '⌘ K' : 'Ctrl K'

function isEditableTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return el.isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function onCommandShortcutKeydown(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
  if (e.key !== 'k' && e.key !== 'K') return
  if (isEditableTarget(e.target)) return
  e.preventDefault()
  commandOpen.value = true
}

// Escape closes the inspected link (desktop rail + mobile/tablet sheet). The
// command palette and AppDialog swallow their own Escape before it reaches the
// document, and the guards below keep those layers authoritative.
function onGlobalEscapeKeydown(e) {
  if (e.key !== 'Escape') return
  if (commandOpen.value || dialog.value) return
  if (detailOpen.value) closeDetail()
}

// P5: the detail presentation follows the approved shell boundary (>=1200 is
// the desktop shell with the permanent sidebar; below that the sidebar is a
// drawer and the detail opens as a mockup sheet). CSS owns the visuals; this
// flag only selects the sheet/rail behaviour (role, backdrop, drag, focus).
const isDesktopShell = ref(false)
let shellMq = null
function onShellMqChange(e) { isDesktopShell.value = e.matches }

onMounted(() => {
  document.addEventListener('keydown', onCommandShortcutKeydown)
  document.addEventListener('keydown', onGlobalEscapeKeydown)
  if (typeof window.matchMedia === 'function') {
    shellMq = window.matchMedia('(min-width: 1024px)')
    isDesktopShell.value = shellMq.matches
    shellMq.addEventListener('change', onShellMqChange)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onCommandShortcutKeydown)
  document.removeEventListener('keydown', onGlobalEscapeKeydown)
  if (shellMq) shellMq.removeEventListener('change', onShellMqChange)
})
const filterCategory = ref('')
const filterStatus = ref('')
const filterFolder = ref('')
const filterType = ref('')
const filterPinned = ref(false)
const sortBy = ref(DEFAULT_SORT)

// Links presentation: 'card' | 'list' | 'compact'.
// Persisted to plain localStorage (NOT the synced settings blob).
const VIEW_MODES = ['card', 'list', 'compact']
const VIEW_MODE_LABELS = { card: 'Card', list: 'List', compact: 'Compact' }
function readViewMode() {
  try {
    const raw = localStorage.getItem(getStorageKey('viewMode'))
    if (raw && VIEW_MODES.includes(raw)) return raw
  } catch { /* storage unavailable (tests/private mode): default is fine */ }
  // P8 (mockup default): the library opens in the dense Compact presentation.
  return 'compact'
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

// P8: the drawer carries the secondary destinations the mockup keeps behind
// the topbar menu / "More" item (the sidebar's Tools group).
const MORE_VIEWS = ['settings', 'backup', 'about']
const drawerActive = computed(() => sidebarOpen.value || MORE_VIEWS.includes(currentView.value))
function openDrawer() { sidebarOpen.value = true }

function go(view) { currentView.value = view; sidebarOpen.value = false }

// P8 bottom navigation: real SaveLink destinations/filters only. All/Favorites
// drive the existing filter state (no new filtering model); Folders is the real
// Folders view; More opens the real navigation drawer.
function showAllLinks() { filterStatus.value = ''; filterFolder.value = ''; go('links') }
function showFavorites() { filterStatus.value = 'favorite'; filterFolder.value = ''; go('links') }
const allLinksActive = computed(() => currentView.value === 'links' && filterStatus.value !== 'favorite')
const favoritesActive = computed(() => currentView.value === 'links' && filterStatus.value === 'favorite')

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
  links: 'Links',
  folders: 'Folders',
  backup: 'Backup & restore',
  settings: 'Settings',
  about: 'About',
}[currentView.value] || 'Links'))

const pageSubtitle = computed(() => {
  if (currentView.value === 'links') return `${filteredLinks.value.length} of ${total.value} links shown`
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
  const folder = folders.value.find((f) => f.id === id)
  if (!folder) return
  // P4: delete-subtree semantics — compute the real scope for the confirmation
  // so nothing is deleted silently (descendants + every link inside them).
  const subtree = descendantIds(folders.value, id)
  const folderCount = 1 + subtree.size
  const ids = new Set([id, ...subtree])
  const linkCount = links.value.filter((l) => l.folderId && ids.has(l.folderId)).length
  const scope = folderCount > 1
    ? `${folderCount} folders`
    : 'This folder'
  openDialog({
    kind: 'delete-folder', id,
    title: subtree.size
      ? `Delete "${folder.name}" and its ${subtree.size} subfolder${subtree.size > 1 ? 's' : ''}?`
      : `Delete "${folder.name}"?`,
    message: linkCount
      ? `${scope} and ${linkCount} link${linkCount > 1 ? 's' : ''} inside will be deleted. This cannot be undone.`
      : `${scope} will be deleted. This cannot be undone.`,
    buttons: [
      { label: 'Delete', variant: 'danger', value: 'confirm' },
      { label: 'Cancel', variant: 'ghost', value: 'cancel', default: true }
    ]
  })
}

// P4: delete the folder, all descendant folders, and the links assigned to any
// of them (already confirmed through AppDialog before this runs).
async function deleteFolderSubtree(id) {
  const ids = new Set([id, ...descendantIds(folders.value, id)])
  const linkIds = links.value.filter((l) => l.folderId && ids.has(l.folderId)).map((l) => l.id)
  for (const linkId of linkIds) await removeLink(linkId)
  for (const folderId of ids) deleteFolder(folderId)
  if (ids.has(filterFolder.value)) filterFolder.value = ''
  showToast(ids.size > 1 ? `${ids.size} folders deleted` : 'Folder deleted')
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
      if (value === 'confirm') deleteFolderSubtree(cfg.id)
    }
    else if (cfg.kind === 'delete-selected') { if (value === 'confirm') bulkDeleteConfirmed() }
    else if (cfg.kind === 'anonymous-sync') handleAnonymousSyncChoice(value)
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

// Folder errors the forms surface inline instead of throwing through the event
// system (P4 adds the nesting/depth validation messages).
const FOLDER_ERRORS = new Set([
  'Folder already exists',
  'Folder name required',
  'Parent folder not found',
  'A folder cannot contain itself',
  'A folder cannot be moved into its own subfolder',
  'Maximum folder depth is 4',
])

function handleCreateFolder(name, parentId, done) {
  try { createFolder(name, parentId); showToast('Folder created'); done({ ok: true }) }
  catch (e) { showToast(e.message || 'Failed'); if (FOLDER_ERRORS.has(e.message)) done({ ok: false, error: e.message }); else throw e }
}
function handleRenameFolder({ id, name }, done) {
  try { renameFolder(id, name); showToast('Folder renamed'); done({ ok: true }) }
  catch (e) { showToast(e.message || 'Failed'); if (FOLDER_ERRORS.has(e.message)) done({ ok: false, error: e.message }); else throw e }
}
// P4: reparent a folder (null = root). Invalid destinations are already
// excluded from the picker; this is the runtime guard.
function handleMoveFolder({ id, parentId }, done) {
  try { moveFolder(id, parentId); showToast('Folder moved'); done({ ok: true }) }
  catch (e) { showToast(e.message || 'Failed'); if (FOLDER_ERRORS.has(e.message)) done({ ok: false, error: e.message }); else throw e }
}

// ---- Filtering / sorting ----
// P4: selecting a folder includes its whole subtree (derived, never stored).
const folderFilterIds = computed(() => {
  const ids = new Set()
  if (!filterFolder.value || filterFolder.value === '__unfiled') return ids
  ids.add(filterFolder.value)
  for (const id of descendantIds(folders.value, filterFolder.value)) ids.add(id)
  return ids
})
// Indented options for the link forms' folder selectors (values stay folder ids).
const folderSelectOptions = computed(() => buildFolderSelectOptions(folders.value))
// P3: pinned links surface first, then the existing selected sort order. A
// stable partition (not a second comparator) keeps every existing sort
// (newest / oldest / A-Z / Z-A) exactly as it was within each group.
const sortedLinks = computed(() => {
  const sorted = sortLinks(links.value, sortBy.value)
  if (!sorted.some((l) => l.pinned)) return sorted
  const pinned = []
  const rest = []
  for (const l of sorted) (l.pinned ? pinned : rest).push(l)
  return [...pinned, ...rest]
})

const filteredLinks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const folderNameById = new Map(folders.value.map(f => [f.id, f.name]))
  return sortedLinks.value.filter(l => {
    if (filterFolder.value) {
      if (filterFolder.value === '__unfiled') { if (l.folderId) return false }
      else if (!folderFilterIds.value.has(l.folderId)) return false
    }
    if (filterCategory.value && l.category !== filterCategory.value) return false
    if (filterType.value && (l.type || 'other') !== filterType.value) return false
    if (filterPinned.value && !l.pinned) return false
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

function clearFilters() { search.value = ''; filterCategory.value = ''; filterStatus.value = ''; filterFolder.value = ''; filterType.value = ''; filterPinned.value = false }

// Pagination
const ITEMS_PER_PAGE = 10
const currentPage = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(filteredLinks.value.length / ITEMS_PER_PAGE)))
const paginatedLinks = computed(() => {
  const start = (currentPage.value - 1) * ITEMS_PER_PAGE
  return filteredLinks.value.slice(start, start + ITEMS_PER_PAGE)
})
// Result-count label for the results bar. Uses the filtered result set
// (pagination operates on filtered links) and the existing ITEMS_PER_PAGE.
const paginationText = computed(() => paginationLabel(filteredLinks.value.length, currentPage.value, ITEMS_PER_PAGE))
watch([search, filterCategory, filterStatus, filterFolder, filterType, filterPinned, sortBy], () => { currentPage.value = 1 })

// Windowed page links: large collections (1,000 links = 100 pages) must not
// render one link per page in the DOM. First/last plus a window around the
// current page, with ellipsis markers between.
const pageItems = computed(() => {
  const total = totalPages.value
  const cur = currentPage.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const items = [1]
  const start = Math.max(2, cur - 1)
  const end = Math.min(total - 1, cur + 1)
  if (start > 2) items.push('…')
  for (let p = start; p <= end; p++) items.push(p)
  if (end < total - 1) items.push('…')
  items.push(total)
  return items
})

// ---- Derived time groups (presentation only) ----
// Group headers are derived deterministically from createdAt; no stored field,
// no domain/persistence change. They are meaningful only for the newest-first
// date sort and only in the row views; card view stays flat.
function startOfLocalDay(t) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
function timeGroupLabel(iso, now = Date.now()) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'Earlier'
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(t)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This Week'
  return 'Earlier'
}
const groupHeadersEnabled = computed(() => viewMode.value !== 'card' && sortBy.value === 'newest')
function groupLabelAt(index) {
  if (!groupHeadersEnabled.value) return ''
  const links = paginatedLinks.value
  const link = links[index]
  if (!link) return ''
  const label = timeGroupLabel(link.createdAt)
  if (index === 0) return label
  return timeGroupLabel(links[index - 1].createdAt) === label ? '' : label
}

// ---- Selection (bulk actions) ----
// Selection is owned here and stored as a Set of link IDs (never object
// references). It is presentation state: it never mutates link records.
const selectedIds = ref(new Set())
const selectedCount = computed(() => selectedIds.value.size)
const visibleIds = computed(() => paginatedLinks.value.map((l) => l.id))
const allVisibleSelected = computed(() => visibleIds.value.length > 0 && visibleIds.value.every((id) => selectedIds.value.has(id)))
const someVisibleSelected = computed(() => !allVisibleSelected.value && visibleIds.value.some((id) => selectedIds.value.has(id)))

function isSelected(id) { return selectedIds.value.has(id) }
function setSelected(id, checked) { if (checked) selectedIds.value.add(id); else selectedIds.value.delete(id) }
function selectVisible() { for (const id of visibleIds.value) selectedIds.value.add(id) }
function deselectVisible() { for (const id of visibleIds.value) selectedIds.value.delete(id) }
function clearSelection() { selectedIds.value.clear() }
function onSelectAllVisibleChange(e) { if (e.target.checked) selectVisible(); else deselectVisible() }

// Keep the tri-state checkbox's indeterminate flag in sync (a DOM property,
// not an attribute Vue can bind).
const selectAllRef = ref(null)
watch([allVisibleSelected, someVisibleSelected], async () => {
  await nextTick()
  if (selectAllRef.value) selectAllRef.value.indeterminate = someVisibleSelected.value
})

// Drop selected IDs that no longer exist (single delete, cloud reconcile).
watch(links, (list) => {
  if (!selectedIds.value.size) return
  const ids = new Set(list.map((l) => l.id))
  for (const id of [...selectedIds.value]) if (!ids.has(id)) selectedIds.value.delete(id)
})

function selectedLinks() { return links.value.filter((l) => selectedIds.value.has(l.id)) }

// ---- Link detail panel (P5) ----
// Inspection state is deliberately separate from bulk selection: a link can be
// checked for bulk actions without becoming the inspected link, selecting a
// different link replaces the inspected one, and neither Set represents the
// other. The panel renders exactly one record; the library stays paginated.
const detailId = ref(null)
const detailLink = computed(() => (detailId.value ? links.value.find((l) => l.id === detailId.value) || null : null))
const detailOpen = computed(() => !!detailLink.value)
function openDetail(id) { detailId.value = id }
function closeDetail() { detailId.value = null }
// Drop the inspected link when it no longer exists (delete, import, reconcile).
watch(links, (list) => {
  if (detailId.value && !list.some((l) => l.id === detailId.value)) detailId.value = null
})

function bulkToggleFavorite() {
  const sel = selectedLinks()
  if (!sel.length) return
  const next = !sel.every((l) => l.favorite)
  for (const l of sel) updateLink(l.id, { favorite: next })
  showToast(next ? 'Added to favorites' : 'Removed from favorites')
}

// P3: uniform pin toggle for the selected links (same shape as bulk favorite).
function bulkTogglePin() {
  const sel = selectedLinks()
  if (!sel.length) return
  const next = !sel.every((l) => l.pinned)
  for (const l of sel) updateLink(l.id, { pinned: next })
  showToast(next ? 'Pinned' : 'Unpinned')
}

function bulkMove(value) {
  const folderId = value === '__unfiled' ? null : value
  const sel = selectedLinks()
  if (!sel.length) return
  for (const l of sel) handleSetFolder(l.id, folderId)
  clearSelection()
}

function requestBulkDelete() {
  const n = selectedIds.value.size
  if (!n) return
  openDialog({
    kind: 'delete-selected',
    title: `Delete ${n} link${n === 1 ? '' : 's'}?`,
    message: 'This cannot be undone.',
    buttons: [
      { label: 'Delete', variant: 'danger', value: 'confirm' },
      { label: 'Cancel', variant: 'ghost', value: 'cancel', default: true },
    ],
  })
}

async function bulkDeleteConfirmed() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  for (const id of ids) await removeLink(id)
  clearSelection()
  await nextTick()
  if (currentPage.value > totalPages.value) currentPage.value = totalPages.value
  showToast(ids.length === 1 ? 'Link deleted' : `${ids.length} links deleted`)
}

// ---- Command palette ----
// Real actions only: every command maps to an existing SaveLink path. Search
// is delegated to the existing navbar field (no second search implementation).
const commandOpen = ref(false)
const paletteCommands = [
  { id: 'search', label: 'Search links', group: 'Actions', keywords: 'find query filter' },
  { id: 'add', label: 'Add link', group: 'Actions', keywords: 'new save create' },
  { id: 'show-links', label: 'Show all links', group: 'Navigate', keywords: 'clear filters home' },
  { id: 'favorites', label: 'Show favorites', group: 'Navigate', keywords: 'starred' },
  { id: 'folders', label: 'Show folders', group: 'Navigate', keywords: 'organize' },
  { id: 'view-card', label: 'Switch to Card view', group: 'View', keywords: 'grid' },
  { id: 'view-list', label: 'Switch to List view', group: 'View', keywords: 'rows' },
  { id: 'view-compact', label: 'Switch to Compact view', group: 'View', keywords: 'dense scan' },
  { id: 'theme', label: 'Toggle theme', group: 'View', keywords: 'dark light appearance' },
]

function runCommand(id) {
  commandOpen.value = false
  switch (id) {
    case 'search': openSearch(); break
    case 'add': openAddLink(document.querySelector('.content-head .add-toggle') || document.querySelector('.btn-date-picker')); break
    case 'show-links': go('links'); clearFilters(); break
    case 'favorites': go('links'); clearFilters(); filterStatus.value = 'favorite'; break
    case 'folders': go('folders'); break
    case 'view-card': go('links'); setViewMode('card'); break
    case 'view-list': go('links'); setViewMode('list'); break
    case 'view-compact': go('links'); setViewMode('compact'); break
    case 'theme': setAppearance(resolvedAppearance.value === 'dark' ? 'light' : 'dark'); break
  }
}

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
// P3: real link-type filter (values are the persisted enum; labels for humans).
const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'Types' },
  ...LINK_TYPES.map((t) => ({ value: t, label: LINK_TYPE_LABELS[t] })),
]
const activeFilterChips = computed(() => {
  const chips = []
  const q = search.value.trim()
  if (q) chips.push({ key: 'search', label: `Search: "${q}"`, clear: () => { search.value = '' } })
  if (filterStatus.value) chips.push({ key: 'status', label: `Status: ${STATUS_OPTION_LABELS[filterStatus.value] || filterStatus.value}`, clear: () => { filterStatus.value = '' } })
  if (filterType.value) chips.push({ key: 'type', label: `Type: ${LINK_TYPE_LABELS[filterType.value] || filterType.value}`, clear: () => { filterType.value = '' } })
  if (filterPinned.value) chips.push({ key: 'pinned', label: 'Pinned', clear: () => { filterPinned.value = false } })
  if (filterCategory.value) chips.push({ key: 'category', label: `Category: ${filterCategory.value}`, clear: () => { filterCategory.value = '' } })
  if (filterFolder.value) {
    const name = filterFolder.value === '__unfiled' ? 'Unfiled' : (folderPath(folders.value, filterFolder.value) || filterFolder.value)
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
      <div class="sidebar-head">
        <a href="#" class="sidebar-brand" @click.prevent="go('links')">
          <img src="/logo.png" alt="Save Links logo" width="30" height="30" />
          <span>Save <span class="brand-accent">Links</span></span>
        </a>
        <button type="button" class="sidebar-close" aria-label="Close navigation" @click="sidebarOpen = false">
          <svg class="ui-icon ui-icon-lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <div class="sidebar-menu-scroll">
        <!-- Group: Menu -->
        <div class="sidebar-menu-section">
          <div class="sidebar-menu-title">Menu</div>
          <ul class="sidebar-menu-list">
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: currentView === 'links' }" @click.prevent="go('links')">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>
                <span>Links</span>
                <span class="sidebar-menu-badge">{{ total }}</span>
              </a>
            </li>
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: currentView === 'folders' }" @click.prevent="go('folders')">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
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
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                <span>Backup & restore</span>
              </a>
            </li>
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: currentView === 'settings' }" @click.prevent="go('settings')">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>Settings</span>
              </a>
            </li>
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: currentView === 'about' }" @click.prevent="go('about')">
                <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                <span>About</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

    </aside>

    <!-- Navbar (P8: the shell's full-width top row, outside the content scroller) -->
      <!-- Navbar -->
      <nav class="navbar-custom" :class="{ 'is-searching': searchOpen }">
        <div class="navbar-left">
          <a href="#" class="mobile-brand" @click.prevent="go('links')">
            <img src="/logo.png" alt="" width="26" height="26" />
            <span>Save <span class="brand-accent">Links</span></span>
          </a>
          <button type="button" class="btn-desktop-toggle" id="desktop-sidebar-toggle" aria-label="Minimize sidebar" @click="toggleSidebarMinimized">
            <svg class="ui-icon ui-icon-lg" viewBox="0 0 24 24" aria-hidden="true">
              <template v-if="sidebarMinimized"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></template>
              <template v-else><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></template>
            </svg>
          </button>
          <button type="button" class="sidebar-toggle-btn" id="sidebar-toggle" aria-label="Toggle navigation" @click="sidebarOpen = !sidebarOpen">
            <svg class="ui-icon ui-icon-lg" viewBox="0 0 24 24" aria-hidden="true"><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Mid navbar: search pill -->
        <div class="navbar-search-wrapper" id="main-search">
          <input ref="searchInputEl" type="search" class="navbar-search-input" placeholder="Search links…" aria-label="Search links" enterkeyhint="search" :value="search" @input="search = $event.target.value" @keydown.esc.prevent="closeSearch(true)" @blur="onSearchBlur" />
          <button v-if="search" type="button" class="navbar-search-btn" aria-label="Clear search" @click="search = ''"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
          <button v-else type="button" class="navbar-search-btn" :aria-label="searchOpen ? 'Close search' : null" :aria-hidden="searchOpen ? null : 'true'" :tabindex="searchOpen ? null : '-1'" @click="searchOpen && closeSearch(true)">
            <svg v-if="searchOpen" class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            <svg v-else class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </button>
          <kbd class="navbar-search-kbd" aria-hidden="true">{{ searchShortcutLabel }}</kbd>
        </div>

        <!-- Right actions -->
        <div class="navbar-actions">
          <button ref="searchToggleEl" type="button" class="navbar-search-toggle" aria-label="Search" aria-controls="main-search" :aria-expanded="String(searchOpen)" @click="openSearch">
            <svg class="ui-icon ui-icon-lg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </button>
          <button type="button" class="navbar-action-btn" id="btn-fullscreen" aria-label="Toggle Fullscreen" @click="toggleFullscreen">
            <svg class="ui-icon ui-icon-lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
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

    <!-- Main wrapper (P8: the content column; its own scroll container) -->
    <div class="main-wrapper" :class="{ 'has-detail': detailOpen }">
      <!-- Page Header -->
      <div class="page-header">
        <div>
          <h1 class="page-title">{{ pageTitle }}</h1>
          <p v-if="pageSubtitle" class="page-subtitle">{{ pageSubtitle }}</p>
        </div>
        <button type="button" class="btn-date-picker" @click="openAddLink($event.currentTarget)">
          <svg class="ui-icon ui-icon-lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          <span>Add link</span>
        </button>
      </div>

      <!-- Main Content -->
      <main>

        <!-- ===== VIEW: Links ===== -->
        <section v-if="currentView === 'links'" class="links-view">
          <!-- One unified panel: toolbar header, link content, pagination footer -->
          <div class="links-panel">
          <!-- Toolbar: "Add link" on the left, view/sort/filter/export on the right -->
          <div class="content-head">
            <AddLink ref="addLinkEl" :folders="folderSelectOptions" @add="handleAdd" />
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
                    <span class="view-label sr-only">{{ VIEW_MODE_LABELS[m] }}</span>
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
          <svg class="ui-icon ui-icon-lg" viewBox="0 0 24 24" aria-hidden="true"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>
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
                      :class="{ 'is-active': !!filterCategory }"
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
                      :class="{ 'is-active': !!filterStatus }"
                      aria-label="Filter by status"
                      :model-value="filterStatus"
                      :options="STATUS_FILTER_OPTIONS"
                      @update:model-value="filterStatus = $event"
                    />
                  </div>
                  <div class="filter-field">
                    <span class="filter-field-label">Type</span>
                    <AppSelect
                      id="filter-type"
                      variant="header"
                      :class="{ 'is-active': !!filterType }"
                      aria-label="Filter by type"
                      :model-value="filterType"
                      :options="TYPE_FILTER_OPTIONS"
                      @update:model-value="filterType = $event"
                    />
                  </div>
                  <div class="filter-field">
                    <span class="filter-field-label">Pinned</span>
                    <button
                      type="button"
                      class="pinned-toggle"
                      :class="{ active: filterPinned }"
                      :aria-pressed="String(filterPinned)"
                      aria-label="Show pinned links only"
                      @click="filterPinned = !filterPinned"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6"/><path d="M10 4v6l-2 3h8l-2-3V4"/><path d="M12 13v7"/></svg>
                      <span>Pinned</span>
                    </button>
                  </div>
                </div>
                <button type="button" class="toolbar-add toolbar-export" aria-label="Export links" @click="go('backup')">
          <svg class="ui-icon ui-icon-lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
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

          <!-- Results bar: real window + filter context (no invented counts) -->
          <div v-if="hasLinks" class="library-results">
            <label v-if="visibleIds.length" class="select-visible">
              <input
                ref="selectAllRef"
                type="checkbox"
                :checked="allVisibleSelected"
                aria-label="Select all visible links"
                @change="onSelectAllVisibleChange"
              />
            </label>
            <span class="library-results-count" aria-live="polite">{{ paginationText }}</span>
            <span v-if="hasSearch || hasFilters" class="library-results-context">Filtered</span>
          </div>

          <!-- Bulk actions: appears only when something is selected -->
          <BulkActionBar
            v-if="hasLinks && selectedCount > 0"
            :selected-count="selectedCount"
            :visible-count="visibleIds.length"
            :all-visible-selected="allVisibleSelected"
            :some-visible-selected="someVisibleSelected"
            :folders="folderSelectOptions"
            @select-all="selectVisible"
            @clear="clearSelection"
            @move="bulkMove"
            @favorite="bulkToggleFavorite"
            @pin="bulkTogglePin"
            @delete="requestBulkDelete"
          />

          <!-- Link content -->
          <div class="links-content">
          <!-- Old Links content section (hybrid: old link presentation + current pagination) -->
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
                  :folders="folderSelectOptions"
                  :selected="isSelected(link.id)"
                  @select="setSelected"
                  @inspect="openDetail"
                  @toggle-important="toggleImportant"
                  @toggle-must-have="toggleMustHave"
                  @toggle-favorite="toggleFavorite"
                  @toggle-pin="togglePin"
                  @set-status="setStatus"
                  @delete="requestDeleteLink"
                  @edit="handleEdit"
                  @set-folder="handleSetFolder"
                  @copy="handleCopyLink"
                  @share="handleShareLink"
                />
              </div>
              <div v-else class="row-list" :class="{ compact: viewMode === 'compact' }">
                <template v-for="(link, i) in paginatedLinks" :key="link.id">
                  <div v-if="groupLabelAt(i)" class="group-h">{{ groupLabelAt(i) }}</div>
                  <LinkRow
                    :link="link"
                    :folders="folderSelectOptions"
                    :mode="viewMode"
                    :selected="isSelected(link.id)"
                    @select="setSelected"
                    @inspect="openDetail"
                    @toggle-important="toggleImportant"
                    @toggle-must-have="toggleMustHave"
                    @toggle-favorite="toggleFavorite"
                    @toggle-pin="togglePin"
                    @set-status="setStatus"
                    @delete="requestDeleteLink"
                    @edit="handleEdit"
                    @set-folder="handleSetFolder"
                    @copy="handleCopyLink"
                    @share="handleShareLink"
                  />
                </template>
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

          <!-- Pagination footer: page controls only (the results bar owns the label) -->
          <div class="table-footer-control" :class="{ 'is-empty': totalPages <= 1 }">
            <nav v-if="totalPages > 1" aria-label="Page navigation">
              <ul class="pagination">
                <li class="page-item" :class="{ disabled: currentPage === 1 }">
                  <a class="page-link" href="#" aria-label="Previous page" @click.prevent="currentPage = Math.max(1, currentPage - 1)"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></a>
                </li>
                <li v-for="(p, idx) in pageItems" :key="idx" class="page-item" :class="{ active: p === currentPage, ellipsis: p === '…' }">
                  <span v-if="p === '…'" class="page-link page-ellipsis" aria-hidden="true">…</span>
                  <a v-else class="page-link" href="#" :aria-label="'Page ' + p" :aria-current="p === currentPage ? 'page' : undefined" @click.prevent="currentPage = p">{{ p }}</a>
                </li>
                <li class="page-item" :class="{ disabled: currentPage === totalPages }">
                  <a class="page-link" href="#" aria-label="Next page" @click.prevent="currentPage = Math.min(totalPages, currentPage + 1)"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></a>
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
                          @move="handleMoveFolder"
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
        <About :version="appVersion" />
      </section>

      </main>

      <footer class="footer">
        <span class="footer-tagline">Local-first bookmark manager</span>
        <span class="footer-meta">Sign in to sync across devices &middot; v{{ appVersion }}</span>
      </footer>
    </div>

    <!-- Bottom navigation (P8 mockup shell: bound to the real <1024 layout).
         Every item is a real SaveLink destination or the existing filter state;
         Add is the single floating action (no duplicate Add control). -->
    <nav class="bottom-nav" aria-label="Primary">
      <button
        type="button"
        class="bottom-nav-item"
        :class="{ active: allLinksActive }"
        :aria-current="allLinksActive ? 'page' : null"
        @click="showAllLinks"
      >
          <svg class="ui-icon ui-icon-xl" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>
          <span>All</span>
      </button>
      <button
        type="button"
        class="bottom-nav-item"
        :class="{ active: favoritesActive }"
        :aria-current="favoritesActive ? 'page' : null"
        @click="showFavorites"
      >
          <svg class="ui-icon ui-icon-xl" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C7 16.8 3 13.6 3 9.6 3 7 5 5 7.4 5c1.8 0 3.4 1 4.6 2.6C13.2 6 14.8 5 16.6 5 19 5 21 7 21 9.6c0 4-4 7.2-9 11.4z"/></svg>
          <span>Favorites</span>
      </button>
      <button
        type="button"
        class="bottom-nav-item"
        :class="{ active: currentView === 'folders' }"
        :aria-current="currentView === 'folders' ? 'page' : null"
        @click="go('folders')"
      >
          <svg class="ui-icon ui-icon-xl" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
          <span>Folders</span>
      </button>
      <button
        type="button"
        class="bottom-nav-item"
        :class="{ active: drawerActive }"
        :aria-current="drawerActive ? 'page' : null"
        aria-controls="sidebar"
        :aria-expanded="String(sidebarOpen)"
        @click="openDrawer"
      >
          <svg class="ui-icon ui-icon-xl" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          <span>More</span>
      </button>
    </nav>

    <!-- Floating Add action (P8 mockup shell): the single Add entry point
         below the desktop grid; opens the one shared add-link form. -->
    <button
      type="button"
      class="fab"
      aria-label="Add link"
      @click="openAddLink($event.currentTarget)"
    >
      <svg class="ui-icon ui-icon-xl" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
    </button>

      <!-- ===== Panels & Dialog ===== -->
      <CommandPalette
        :open="commandOpen"
        :commands="paletteCommands"
        @close="commandOpen = false"
        @execute="runCommand"
      />

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

    <!-- P5: inspection surface — fixed rail >=1200, sheet below (mockup) -->
    <LinkDetailPanel
      :open="detailOpen"
      :link="detailLink"
      :folders="folders"
      :folder-options="folderSelectOptions"
      :overlay="!isDesktopShell"
      @close="closeDetail"
      @edit="handleEdit"
      @copy="handleCopyLink"
      @share="handleShareLink"
      @delete="requestDeleteLink"
      @pin="togglePin"
      @favorite="toggleFavorite"
      @important="toggleImportant"
      @must-have="toggleMustHave"
      @move="handleSetFolder"
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
/* ---------------------------------------------------------------------
   P8 shell — the mockup's single-application-viewport model.
   Below 1024: flex column (topbar · content · bottom bar); at >=1024 the
   mockup's three-column grid (static sidebar · content · static detail rail)
   with the topbar spanning every column. The window never scrolls; each
   column owns its own scroller (sidebar, .main-wrapper, detail scroll).
--------------------------------------------------------------------- */
.app {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.main-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  /* P9: no top padding on the scroller itself — sticky group headers must park
     flush at the scrollport edge (the mockup's list has no top inset). The
     page header supplies its own top spacing instead. */
  padding-top: 0;
}

/* The page header carries the content's top inset (P9: the scroller has none,
   so sticky group headers can park flush at its top edge). Below 1024 the
   wrapper keeps its own horizontal padding; on the grid the header supplies
   the horizontal inset too. */
.page-header { padding-top: 1.5rem; }

@media (min-width: 1024px) {
  .app {
    display: grid;
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--detail-width);
    grid-template-rows: var(--navbar-height) minmax(0, 1fr);
  }
  /* P9 (G6): the desktop content column is full-bleed like the mockup — rows,
     cards, toolbar and results carry their own spacing; only the page header
     and footer keep a small outer inset. */
  .main-wrapper {
    grid-column: 2;
    grid-row: 2;
    margin-left: 0;
    padding: 0 0 1.25rem;
  }
  .page-header { padding: 1.25rem 1.25rem 0; }
  .footer { padding-inline: 1.25rem; }
}

/* Sidebar head (drawer): brand + close. Hidden on the desktop grid where the
   sidebar is permanent and the topbar carries the brand (mockup .sidebar-head). */
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}
@media (min-width: 1024px) {
  .sidebar-head { display: none; }
}
.sidebar-close {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine){
.sidebar-close:hover { background: var(--muted-bg); color: var(--text-h); }
}
.sidebar-close:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 1px; }

/* Floating Add (mockup .fab): the single Add entry point below the desktop
   grid; sits above the bottom bar and clears the safe area. */
.fab {
  position: fixed;
  right: 16px;
  bottom: calc(var(--bottom-nav-height) + var(--safe-area-bottom) + 16px);
  width: 54px;
  height: 54px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--accent);
  color: var(--on-accent);
  display: none;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg);
  z-index: calc(var(--z-sticky) + 1);
  cursor: pointer;
  transition: background var(--transition-fast), transform var(--transition-fast);
}
.fab svg { width: 22px; height: 22px; }
@media (hover: hover) and (pointer: fine){
.fab:hover { background: var(--accent-hover); }
}
.fab:active { transform: scale(.94); }
.fab:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
@media (max-width: 1023px) {
  .fab { display: flex; }
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

  /* The content column takes the remaining shell height so the footer stays
     at the bottom of short pages. */
  .main-wrapper > main {
    flex: 1 1 auto;
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
@media (hover: hover) and (pointer: fine){
.identity-btn:hover { background: var(--muted-bg); }
}
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

/* Unified Links panel: toolbar header + link content + pagination footer
   in ONE surface. The items inside carry the only chrome, so the panel itself
   stays a flat bordered surface (no second elevation layer to nest with). */
.links-panel {
  margin-top: 4px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  /* Visible, not hidden: the sticky group headers must stick to the content
     scroller (.main-wrapper), and overflow:hidden would become their scrollport. */
  overflow: visible;
}
/* P9 (G6): on the full-bleed desktop grid the panel drops its side chrome and
   merges with the shell column edges (the mockup has no panel). Declared after
   the base rule so the shorthand above cannot win the cascade. */
@media (min-width: 1024px) {
  .links-panel {
    border-inline: none;
    border-radius: 0;
    margin-top: 0;
  }
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
/* Link content inside the panel (rows carry their own padding, like the
   mockup list; the card grid carries the mockup's container padding). */
.links-content { padding: 0; }
/* Results bar: the mockup's "Showing X of N" line between toolbar and list. */
.library-results {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 7px 14px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
}
.library-results-count { color: var(--text-h); font-weight: var(--weight-semibold); }
/* Select-all-visible control: native checkbox (tri-state via .indeterminate). */
.select-visible { display: inline-flex; align-items: center; }
.select-visible input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.select-visible input:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
.library-results-context {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: var(--weight-semibold);
}
/* Pagination = panel footer (no separate card/background) */
.links-panel .table-footer-control {
  background: transparent;
  border-top: 1px solid var(--border);
  padding: 10px 14px;
  margin: 0;
}
/* With a single page there are no page controls, so the footer collapses. */
.links-panel .table-footer-control.is-empty {
  border-top: none;
  padding: 0;
}
/* Toolbar layout: Add link on the left, view/sort/filter/export on the right.
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
  gap: 2px;
  background: var(--muted-bg);
  border: none;
  border-radius: var(--radius-sm);
  overflow: hidden;
  padding: 3px;
  margin-right: var(--space-1);
}
.view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  min-height: 30px;
  padding: 0;
  border: none;
  border-radius: 5px;
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
@media (hover: hover) and (pointer: fine){
.view-btn:hover { color: var(--text-h); }
}
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

/* P3 Pinned filter toggle: quiet inline control on desktop/tablet; stacked in
   the mobile disclosure like the other filter fields. */
.pinned-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--control-height-sm);
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: var(--weight-medium);
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--transition-fast), background var(--transition-fast);
}
.pinned-toggle svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
@media (hover: hover) and (pointer: fine) {
  .pinned-toggle:hover { color: var(--text-h); background: var(--muted-bg); }
}
.pinned-toggle.active { color: var(--accent); background: var(--accent-bg); font-weight: var(--weight-semibold); }
.pinned-toggle:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 1px; }

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
@media (hover: hover) and (pointer: fine){
.toolbar-add:hover { color: var(--text-h); background: var(--muted-bg); }
}
.toolbar-add:active { transform: scale(0.94); }
  .toolbar-add svg:not(.bi) { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
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
  .toolbar-export .bi { font-size: var(--text-lg); line-height: 1; }

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
@media (hover: hover) and (pointer: fine){
.chip-clear:hover { background: var(--accent); color: var(--on-accent); }
}
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
@media (hover: hover) and (pointer: fine){
.chip-clear-all:hover { color: var(--text-h); }
}

/* Old link list layouts */
.grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
}
.row-list {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 0;
}
.row-list.compact { gap: 0; }

/* Derived time-group headers (row views, newest first): the mockup's uppercase
   micro-label on the page canvas, sticky at the top edge of its own scrolling
   container (.main-wrapper). The navbar is a sibling of the scroller (P8), so
   the correct offset is 0 at every width. */
.group-h {
  grid-column: 1 / -1;
  padding: 8px 14px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .06em;
  font-weight: var(--weight-semibold);
  color: var(--muted);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 2;
}
.row-list.compact .group-h { padding-top: 4px; }

/* Windowed pagination: ellipsis markers are not links. */
.page-item.ellipsis .page-link { pointer-events: none; color: var(--muted); }

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

/* Card view columns (P8 mockup contract: 2-col from 560, 3-col from 1024,
   maximum 3 per row — the old 4-up >=1280 rule is gone). */
@media (min-width: 560px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
  .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* List/Compact stay single-column like the mockup list (the desktop grid's
   content column is narrow once the sidebar and detail rail are both present). */

/* Content header: the page title and its dynamic count share one row at every
   width - title at the start, count ending at the row's right edge. */
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

@media (max-width: 768px) {
  .identity-info { display: none; }
  .identity-btn { padding: 4px 6px 4px 4px; gap: 0; }
  .identity-avatar { width: 28px; height: 28px; }
  /* Compact mobile app bar: brand · search · profile on ONE row (the ≤1200 shell
     wraps them onto two). The search takes the remaining width, the profile never
     shrinks, and the brand yields first if the row gets very narrow.
     P9: no bottom margin — the topbar is a shell row and the page header
     supplies the content's top spacing (the old margin left a 12px seam). */
  .navbar-custom {
    flex-wrap: nowrap;
    align-items: center;
    padding: var(--space-2) var(--space-4);
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
  .navbar-search-input {
    padding: 0.5rem 1rem;
    padding-right: 2.25rem;
  }
  /* Compact Links heading: the title and its dynamic count share one
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

  /* Mobile toolbar: the panel's duplicate "Add link" is hidden; the floating
     action below the desktop grid is the single Add entry point (P8). */
  .content-head :deep(.add-card) {
    display: none;
  }
  .toolbar-export {
    display: none;
  }
  /* The mobile shell's bottom navigation owns the bottom edge of the screen, so
     the desktop application footer is not shown at this breakpoint. */
  .footer {
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
  .pinned-toggle { width: 100%; justify-content: flex-start; min-height: var(--control-height); }
  .toolbar-filters :deep(.asel-trigger) {
    min-height: var(--control-height);
  }
  /* In the stacked disclosure the selects sit on the column axis, so the
     toolbar's horizontal flex sizing must not stretch them vertically. */
  .toolbar-filters :deep(.asel--header) {
    flex: 0 0 auto;
  }
}

/* P8: below the desktop grid the FAB is the single Add entry point and Export
   stays reachable through More → Backup & restore (the mockup toolbar carries
   neither control). At >=1024 both stay in the toolbar. */
@media (max-width: 1023px) {
  .content-head :deep(.add-card) {
    display: none;
  }
  .toolbar-export {
    display: none;
  }
}

/* Pointer hover for the mobile sort/filter trigger (its base styles live in
   the max-width: 768px block above). */
@media (max-width: 768px) and (hover: hover) and (pointer: fine) {  .sort-filter-toggle:hover {
    background: var(--muted-bg);
    color: var(--text-h);
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
