<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, toRaw, unref } from 'vue'
import { sortLinks, DEFAULT_SORT } from './utils/sort.js'
import { CATEGORIES } from './utils/categorize.js'
import { LINK_TYPES, LINK_TYPE_LABELS } from './domain/link.js'
import { descendantIds, folderPath, folderSelectOptions as buildFolderSelectOptions, childrenMap, flattenFolders, validParentIds, MAX_FOLDER_DEPTH, folderDepth } from './utils/folderTree.js'
import { matchesLinkFilters, calendarDaysSince, isRecentlyAdded } from './utils/linkFilters.js'
import { folderSubtreeCounts, collectTags, estimateMetadataBytes, formatBytes } from './utils/sidebarData.js'
import { paginationLabel } from './utils/pagination.js'
import { pickImportSlices, prepareImport, downloadBackupFile } from './utils/backup.js'
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
import DataBackup from './components/DataBackup.vue'
import AccountPanel from './components/AccountPanel.vue'
import LocalProfilePanel from './components/LocalProfilePanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import TagCloud from './components/TagCloud.vue'
import LinkCard from './components/LinkCard.vue'
import LinkRow from './components/LinkRow.vue'
import AppSelect from './components/AppSelect.vue'
import BulkActionBar from './components/BulkActionBar.vue'
import CommandPalette from './components/CommandPalette.vue'
import LinkDetailPanel from './components/LinkDetailPanel.vue'
import Icon from './components/Icon.vue'
import pkg from '../package.json'

const appVersion = pkg.version

const { links, total, importantCount, mustHaveCount, favoriteCount, byCategory, storageError, addLink, replaceLink, toggleFavorite, togglePin, setStatus, removeLink, updateLink, setLinks, moveLinksFromFolder, mergeLinks, getAnonymousLinksCount, getAnonymousLinks } = useLinks()
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

// Search presentation (P15 Group 2): the field is inline at every width (the
// mockup's .search), so there is no collapsed mode to track. `searchOpen` only
// tracks the in-field close affordance after the palette's Search command.
// `search`/`searchQuery` above stay the single source of truth for filtering.
const searchOpen = ref(false)
const searchInputEl = ref(null)

async function openSearch() {
  searchOpen.value = true
  await nextTick()
  searchInputEl.value?.focus()
}

async function closeSearch(restoreFocus = false) {
  searchOpen.value = false
  if (!restoreFocus) return
  // P15 Group 2: the collapsed affordance is gone - restore focus to the
  // always-visible field itself.
  await nextTick()
  searchInputEl.value?.focus()
}

// Drop the in-field close affordance when an untouched field loses focus; the
// field itself is always visible. The query is never cleared here.
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
  if (folderMenuId.value) { closeFolderMenu(); return }
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
    shellMq = window.matchMedia('(min-width: 1200px)')
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
// P15.2: tag + date-window are bar filters (they combine with the others);
// Recently Added is a destination (exclusive with folder/status), matching the
// mockup's Library navigation.
const filterTag = ref('')
// P15.10: one date surface — { preset: 'all'|'today'|'yesterday'|'week'|'custom',
// from?, to? } with inclusive local date keys for a custom range. The predicate
// lives in utils/linkFilters.js; the UI is a Date chip plus the custom dialog.
const filterDate = ref({ preset: 'all', from: '', to: '' })
const filterRecent = ref(false)
const sortBy = ref(DEFAULT_SORT)

// Links presentation: 'card' | 'list' | 'compact'.
// Persisted to plain localStorage (NOT the synced settings blob).
// P15.3: mockup order (compact -> list -> card) with the mockup's icon per mode.
const VIEW_MODES = ['compact', 'list', 'card']
const VIEW_MODE_LABELS = { card: 'Card', list: 'List', compact: 'Compact' }
const VIEW_MODE_ICONS = { compact: 'align-justify', list: 'list', card: 'layout-grid' }
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
// drive the existing filter state (no new filtering model); Tags opens the
// shared dialog; More opens the navigation drawer (folder tree lives there).
function showAllLinks() { filterStatus.value = ''; filterFolder.value = ''; filterRecent.value = false; go('links') }
function showFavorites() { filterStatus.value = 'favorite'; filterFolder.value = ''; filterRecent.value = false; go('links') }
// P15.2: "Recently Added" destination (mockup Library item) — Today + Yesterday
// derived from createdAt; exclusive with the folder/status destinations.
function showRecentlyAdded() { filterRecent.value = true; filterStatus.value = ''; filterFolder.value = ''; go('links') }
// P12: one destination, one active state. Links/All is the complete unfiltered
// collection; while a folder, status or Recently-Added destination is applied
// the destination owns the active state (bar filters do not).
const allLinksActive = computed(() => currentView.value === 'links' && !filterFolder.value && !filterStatus.value && !filterRecent.value)
const favoritesActive = computed(() => currentView.value === 'links' && filterStatus.value === 'favorite' && !filterFolder.value)
// P15.4: the Library's Recently-Added destination — real count derived from the
// P15.2 predicate (local calendar Today + Yesterday), no fake numbers.
const recentCount = computed(() => links.value.filter((l) => isRecentlyAdded(l)).length)
const recentActive = computed(() => currentView.value === 'links' && filterRecent.value)

// P15.6: real sidebar derivations — the tag cloud comes from the P15.2
// collectTags utility (unique, most-used first, ties alphabetical), and the
// storage meter shows the UTF-8 size of the actually persisted records.
const allTags = computed(() => collectTags(links.value))
const storageLabel = computed(() =>
  `${total.value} link${total.value === 1 ? '' : 's'} · ${formatBytes(estimateMetadataBytes(links.value, folders.value))} metadata`
)
// Tag pill = the existing P15.2 bar filter: clicking toggles it (mockup pills
// toggle) and lands on the Links view through the existing navigation model.
function selectTag(tag) {
  filterTag.value = filterTag.value === tag ? '' : tag
  go('links')
}

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

// ---- P15.3: mockup topbar (theme switch, import/export) ----
// The topbar theme switch drives the EXISTING appearance state (useSettings).
// It has two explicit states: the resolved System default is shown on load and
// toggling persists an explicit light/dark value through the same repository-
// backed settings blob - no second theme state and no second storage path.
const isDark = computed(() => resolvedAppearance.value === 'dark')
function toggleTheme() { setAppearance(isDark.value ? 'light' : 'dark') }

// Topbar import/export bind to the SAME real backup pipeline the Backup view
// uses (utils/backup.js): export downloads the real payload, import runs the
// shared parse/validate/normalize/preview helper and then the existing
// requestImport. Duplicates use the existing AppDialog to choose the strategy.
const topbarImportInput = ref(null)
const pendingTopbarImport = ref(null)
function triggerTopbarExport() {
  try {
    downloadBackupFile({ links: links.value, profile: unref(profile), folders: folders.value, appearance: appearance.value, colorScheme: colorScheme.value })
    showToast('Backup exported')
  } catch (e) {
    showToast(e?.message || 'Export failed')
  }
}
function triggerTopbarImport() { topbarImportInput.value?.click() }
async function onTopbarImportChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  let text = ''
  try {
    text = await file.text()
  } catch {
    showToast('Invalid backup file: not valid JSON')
    return
  }
  const result = prepareImport(text, { links: links.value, folders: folders.value })
  if (result.error) { showToast(result.error); return }
  const { data, preview } = result
  const linkDups = preview.counts.links.duplicate
  const folderDups = preview.counts.folders.duplicate
  if (!linkDups && !folderDups) { requestImport({ data, strategy: 'skip' }); return }
  pendingTopbarImport.value = data
  const parts = []
  if (linkDups) parts.push(`${linkDups} link${linkDups === 1 ? '' : 's'}`)
  if (folderDups) parts.push(`${folderDups} folder${folderDups === 1 ? '' : 's'}`)
  openDialog({
    kind: 'import-strategy',
    title: 'Import backup',
    message: `${parts.join(' and ')} already exist${linkDups + folderDups === 1 ? 's' : ''} on your device. Keep the existing items or replace them with the backup?`,
    buttons: [
      { label: 'Keep existing', variant: 'primary', value: 'skip', default: true },
      { label: 'Replace existing', variant: 'ghost', value: 'replace' },
      { label: 'Cancel', variant: 'ghost', value: 'cancel' },
    ],
  })
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

// Initials for avatar fallback (unref: works for the composable's ref and for
// plain-object test doubles).
const initials = computed(() =>
  (unref(profile).name || 'L').trim().split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'L'
)

// Page header computed props
const pageTitle = computed(() => ({
  links: 'Links',
  backup: 'Backup & restore',
}[currentView.value] || 'Links'))

// P15.10: the header carries the view title only — the result count lives in
// the results bar (the mockup's information hierarchy) so the two counters can
// never disagree.
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

function handleSelectFolder(value) {
  if (value === '__all') { filterFolder.value = ''; filterStatus.value = '' }
  else if (value === '__favorites') { filterFolder.value = ''; filterStatus.value = 'favorite' }
  else { filterFolder.value = value; filterStatus.value = '' }
  // P15.2: folder selection is a destination — it clears the Recently-Added one.
  filterRecent.value = false
  currentView.value = 'links'
  // P11: keep the sidebar tree's active row visible — selecting a nested folder
  // (from either surface) expands its ancestors. Presentation-only state.
  if (value && value !== '__all' && value !== '__favorites' && value !== '__unfiled') revealSidebarFolder(value)
}

// ---- P11: sidebar folder navigation (the folder management surface) ----
// Presentation-only: it renders the SAME `folders` ref and calls the SAME
// handleSelectFolder path (subtree filtering via folderFilterIds). No folder
// data, mutation or filtering logic is duplicated here; expansion is local UI
// state.
const sidebarExpandedIds = ref(new Set())
const sidebarChildren = computed(() => childrenMap(folders.value))
function sidebarHasChildren(id) { return (sidebarChildren.value.get(id) || []).length > 0 }
const sidebarFolderRows = computed(() => {
  const flat = flattenFolders(folders.value, { isExpanded: (f) => sidebarExpandedIds.value.has(f.id) })
  // Presentation only: mark the final child of each parent so the CSS tree
  // connectors can draw a proper elbow instead of a full-height guide. A row
  // is final when no later row at the same depth appears before the tree
  // ascends (pre-order flattening).
  const isLast = flat.map((row, i) => {
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].depth < row.depth) break
      if (flat[j].depth === row.depth) return false
    }
    return true
  })
  const stack = []
  return flat.map((row, i) => {
    stack.length = row.depth - 1
    stack[row.depth - 1] = { last: isLast[i] }
    // Ancestor guide positions (chevron centres): 2 -> 18, 3 -> 32. A guide
    // continues through this row only while that ancestor branch still has a
    // following sibling below it.
    const guidePositions = []
    for (let k = 2; k < row.depth; k++) {
      const ancestor = stack[k - 1]
      if (ancestor && !ancestor.last) guidePositions.push(k === 2 ? 18 : 32)
    }
    return { ...row, guidePositions, elbow: isLast[i] }
  })
})
function toggleSidebarFolder(id) {
  const next = new Set(sidebarExpandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  sidebarExpandedIds.value = next
}
function isSidebarFolderActive(id) { return filterFolder.value === id }
function revealSidebarFolder(id) {
  const byId = new Map(folders.value.map((f) => [f.id, f]))
  const next = new Set(sidebarExpandedIds.value)
  const seen = new Set()
  let current = byId.get(id)
  while (current && current.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId)
    next.add(current.parentId)
    current = byId.get(current.parentId)
  }
  sidebarExpandedIds.value = next
}
function selectSidebarFolder(id) {
  // Mockup: clicking the active folder deselects it (back to the complete
  // collection) instead of re-applying the same filter.
  handleSelectFolder(filterFolder.value === id ? '__all' : id)
  // P11: below 1200 the sidebar is the drawer - selecting a folder closes it.
  sidebarOpen.value = false
}

// Expand one folder without toggling (used after add-subfolder/move so the
// affected branch is visible in the tree).
function expandSidebarFolder(id) {
  const next = new Set(sidebarExpandedIds.value)
  next.add(id)
  sidebarExpandedIds.value = next
}

// ---- P15.5: sidebar folder management (mockup rows + ⋮ menu) ----
// The sidebar tree is the app's folder management surface. Every mutation goes
// through the SAME App.vue handlers (useFolders validation + FOLDER_ERRORS +
// delete-subtree semantics), so validation and data rules live in one place.
const sidebarRenamingId = ref(null)
const sidebarRenameName = ref('')
const sidebarMovingId = ref(null)
const sidebarFolderError = ref('')

// Function refs: the editors live inside the tree's v-for, where a plain
// template ref would be collected into an array instead of the element.
const sidebarRenameInputEl = ref(null)
const sidebarMoveSelectEl = ref(null)
function setSidebarRenameInput(el) { sidebarRenameInputEl.value = el }
function setSidebarMoveSelect(el) { sidebarMoveSelectEl.value = el }

// Real subtree counts (P15.2 sidebarData.folderSubtreeCounts): a folder counts
// its own links plus every descendant's — never a mock number.
const sidebarFolderCounts = computed(() => folderSubtreeCounts(folders.value, links.value))

// Expand/collapse-all (mockup chevrons-down-up): any expanded -> collapse all,
// otherwise expand all. Operates on the existing presentation set only.
const sidebarAnyExpanded = computed(() => folders.value.some((f) => sidebarExpandedIds.value.has(f.id)))
function toggleAllSidebarFolders() {
  const any = sidebarAnyExpanded.value
  sidebarExpandedIds.value = any ? new Set() : new Set(folders.value.map((f) => f.id))
  showToast(any ? 'All folders collapsed' : 'All folders expanded')
}

// P15 (folder pass): the mockup creates a folder with a generated default name
// and then puts that row into inline rename, so naming is the rename editor.
// The default comes from the real sibling names (never a hardcoded tree).
function nextSidebarFolderName(parentId) {
  const siblings = folders.value.filter((f) => (f.parentId ?? null) === (parentId ?? null))
  const taken = new Set(siblings.map((f) => f.name.trim().toLowerCase()))
  let name = 'New Folder'
  let i = 1
  while (taken.has(name.toLowerCase())) { i += 1; name = `New Folder ${i}` }
  return name
}
function createSidebarFolder(parentId) {
  sidebarFolderError.value = ''
  const name = nextSidebarFolderName(parentId)
  handleCreateFolder(name, parentId, (result) => {
    if (!(result && result.ok)) {
      sidebarFolderError.value = (result && result.error) || 'Failed'
      return
    }
    const created = folders.value.find((f) => f.name === name && (f.parentId ?? null) === (parentId ?? null))
    if (parentId) expandSidebarFolder(parentId)
    if (created) {
      startSidebarRename(created)
      showToast('Type a name, press Enter')
    }
  })
}

// Per-folder ⋮ menu: one teleported popover anchored to the clicked trigger,
// reusing the app's existing useAnchoredPopover layer (no second popover
// system) and the existing folder handlers.
const folderMenuId = ref(null)
const folderMenuTriggerEl = ref(null)
const folderMenuEl = ref(null)
// The mockup's delete step lives inside the menu (a second confirmation view);
// the sidebar never opens a separate dialog for it.
const folderMenuConfirming = ref(false)
const folderMenuOpen = computed(() => !!folderMenuId.value)
const folderMenuFolder = computed(() => (folderMenuId.value ? folders.value.find((f) => f.id === folderMenuId.value) || null : null))
const folderMenuDepth = computed(() => (folderMenuId.value ? folderDepth(folders.value, folderMenuId.value) : 0))
function openFolderMenu(folder, event) {
  folderMenuTriggerEl.value = event.currentTarget
  folderMenuConfirming.value = false
  folderMenuId.value = folder.id
}
function closeFolderMenu() {
  folderMenuId.value = null
  folderMenuConfirming.value = false
}
function runFolderMenuAction(action, folder) {
  if (action === 'delete') {
    // mockup: the menu flips into its own confirmation view
    folderMenuConfirming.value = true
    return
  }
  closeFolderMenu()
  if (action === 'subfolder') createSidebarFolder(folder.id)
  else if (action === 'rename') startSidebarRename(folder)
  else if (action === 'move') startSidebarMove(folder)
}
function confirmFolderMenuDelete(folder) {
  closeFolderMenu()
  deleteFolderSubtree(folder.id)
}
useAnchoredPopover({
  trigger: folderMenuTriggerEl,
  popover: folderMenuEl,
  isOpen: folderMenuOpen,
  onOutside: closeFolderMenu,
})
// Inline rename (mockup .rename-input): one input in the row, focused and
// selected; Enter commits, Escape cancels, blur commits. A duplicate sibling
// name is auto-suffixed like the mockup; a real backend failure keeps the
// editor open with the inline error.
let sidebarRenameCommitLock = false
async function startSidebarRename(f) {
  sidebarFolderError.value = ''
  sidebarRenamingId.value = f.id
  sidebarRenameName.value = f.name
  sidebarMovingId.value = null
  await nextTick()
  sidebarRenameInputEl.value?.focus()
  sidebarRenameInputEl.value?.select?.()
}
function cancelSidebarRename() {
  sidebarRenameCommitLock = true
  sidebarRenamingId.value = null
  sidebarRenameName.value = ''
  sidebarFolderError.value = ''
  nextTick(() => { sidebarRenameCommitLock = false })
}
function sidebarUniqueName(parentId, baseName, selfId) {
  const siblings = folders.value.filter((f) => (f.parentId ?? null) === (parentId ?? null) && f.id !== selfId)
  const taken = new Set(siblings.map((f) => f.name.trim().toLowerCase()))
  let name = baseName
  let i = 1
  while (taken.has(name.toLowerCase())) { i += 1; name = `${baseName} ${i}` }
  return name
}
function saveSidebarRename(f) {
  if (sidebarRenameCommitLock) return
  sidebarRenameCommitLock = true
  sidebarFolderError.value = ''
  const name = sidebarRenameName.value.trim()
  if (!name || name === f.name) { cancelSidebarRename(); return }
  const unique = sidebarUniqueName(f.parentId, name, f.id)
  handleRenameFolder({ id: f.id, name: unique }, (result) => {
    sidebarRenameCommitLock = false
    if (result && result.ok) cancelSidebarRename()
    else {
      sidebarFolderError.value = (result && result.error) || 'Failed'
      nextTick(() => sidebarRenameInputEl.value?.focus())
    }
  })
}
function onSidebarRenameBlur(f) {
  if (sidebarRenameCommitLock) return
  saveSidebarRename(f)
}
// Valid move destinations only — the canonical folderTree helper (self,
// descendants and depth-exceeding parents are excluded); useFolders.moveFolder
// re-validates at runtime, exactly like the Folders view.
function sidebarMoveOptions(id) {
  const valid = new Set(validParentIds(folders.value, id))
  const opts = [{ value: '__root', label: 'Root (top level)' }]
  for (const { folder, depth } of flattenFolders(folders.value)) {
    if (folder.id === id || !valid.has(folder.id)) continue
    opts.push({ value: folder.id, label: '\u00A0\u00A0'.repeat(Math.max(0, depth - 1)) + folder.name })
  }
  return opts
}
async function startSidebarMove(f) {
  sidebarFolderError.value = ''
  sidebarMovingId.value = f.id
  sidebarRenamingId.value = null
  await nextTick()
  sidebarMoveSelectEl.value?.$el?.querySelector('.asel-trigger')?.focus()
}
function cancelSidebarMove() { sidebarMovingId.value = null }
function moveSidebarFolder(id, value) {
  if (!value) return
  const parentId = value === '__root' ? null : value
  sidebarFolderError.value = ''
  handleMoveFolder({ id, parentId }, (result) => {
    if (result && result.ok) {
      cancelSidebarMove()
      if (parentId) expandSidebarFolder(parentId)
    } else {
      sidebarFolderError.value = (result && result.error) || 'Failed'
    }
  })
}

const toast = ref('')
let toastTimer = null
// P15.9: one shared toast slot — a new message replaces the old one (no queue,
// no stacking). The auto-dismiss is the existing 2500ms; the handle is cleared
// before re-arming so a replacing message gets its own full window instead of
// being cut short by the previous message's still-pending timer.
function showToast(msg) {
  clearTimeout(toastTimer)
  toast.value = msg
  toastTimer = setTimeout(() => { toast.value = '' }, 2500)
}
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

// P4/P15 folder pass: delete the folder and all descendant folders. The mockup
// keeps the links inside the deleted subtree - they are re-assigned to the
// deleted folder's parent (or Unfiled for a root folder) through the existing
// per-link update path, so no link data is destroyed.
async function deleteFolderSubtree(id) {
  const folder = folders.value.find((f) => f.id === id)
  const parentId = folder ? (folder.parentId ?? null) : null
  const ids = new Set([id, ...descendantIds(folders.value, id)])
  const affected = links.value.filter((l) => l.folderId && ids.has(l.folderId))
  for (const l of affected) await updateLink(l.id, { folderId: parentId })
  for (const folderId of ids) deleteFolder(folderId)
  if (ids.has(filterFolder.value)) filterFolder.value = parentId || ''
  showToast(ids.size > 1 ? `${ids.size} folders deleted` : 'Folder deleted')
}

function requestImport(payload) { handleImportBackup(payload) }

const dialog = ref(null)
const pendingDuplicate = ref(null)
const lastTrigger = ref(null)

// P15.12 — Settings/About live in the shared modal (no separate page): one
// dialog with the section nav inside it. The title follows the open section so
// the About entry point still reads as About.
const settingsSection = ref('general')
const dialogTitle = computed(() => {
  const d = dialog.value
  if (!d) return ''
  if (d.kind === 'settings') return settingsSection.value === 'about' ? 'About' : 'Settings'
  return d.title || ''
})
function openSettings(section = 'general') {
  settingsSection.value = section
  // The nav item lives in the drawer below 1200: close it behind the modal
  // exactly like any other destination.
  sidebarOpen.value = false
  openDialog({ kind: 'settings', title: 'Settings', buttons: [] })
}
function openTagsDialog() {
  sidebarOpen.value = false
  openDialog({ kind: 'tags', title: 'Tags', buttons: [] })
}
function onTagDialogSelect(tag) {
  selectTag(tag)
  closeDialog()
}
// The Settings modal's Profile section hands off to the existing account panel.
function openAccountFromSettings() {
  closeDialog()
  openAccountPanel()
}

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
    else if (cfg.kind === 'delete-selected') { if (value === 'confirm') bulkDeleteConfirmed() }
    else if (cfg.kind === 'import-strategy') {
      if ((value === 'skip' || value === 'replace') && pendingTopbarImport.value) {
        requestImport({ data: pendingTopbarImport.value, strategy: value })
      }
      pendingTopbarImport.value = null
    }
    else if (cfg.kind === 'anonymous-sync') handleAnonymousSyncChoice(value)
    else if (cfg.kind === 'date-range') { if (value === 'apply') applyDateRange() }
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
  return sortedLinks.value.filter(l => matchesLinkFilters(l, {
    query: q,
    category: filterCategory.value,
    status: filterStatus.value,
    type: filterType.value,
    pinned: filterPinned.value,
    tag: filterTag.value,
    date: filterDate.value,
    recent: filterRecent.value,
    folderId: filterFolder.value,
    folderIds: folderFilterIds.value,
    folderNameById,
  }))
})

const hasLinks = computed(() => links.value.length > 0)
const hasSearch = computed(() => search.value.trim().length > 0)
const hasFilters = computed(() => !!(filterCategory.value || filterStatus.value || filterFolder.value || filterTag.value || filterDate.value.preset !== 'all' || filterRecent.value || filterType.value || filterPinned.value))
const favoritesOnly = computed(() => filterStatus.value === 'favorite' && !hasSearch.value && !filterCategory.value && !filterFolder.value && !filterTag.value && !filterType.value && !filterPinned.value && filterDate.value.preset === 'all' && !filterRecent.value)

// Everything (search included): the nav/destination resets and the
// search-aware empty-state action.
function clearFilters() { search.value = ''; clearAllFilters() }
// P15.12 "Clear all filters": every filter dimension, never the search box
// (search is its own topbar control, not a filter chip).
function clearAllFilters() {
  filterCategory.value = ''
  filterStatus.value = ''
  filterFolder.value = ''
  filterType.value = ''
  filterPinned.value = false
  filterTag.value = ''
  filterDate.value = { preset: 'all', from: '', to: '' }
  filterRecent.value = false
}

// Pagination
const ITEMS_PER_PAGE = 10
const currentPage = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(filteredLinks.value.length / ITEMS_PER_PAGE)))
const paginatedLinks = computed(() => {
  const start = (currentPage.value - 1) * ITEMS_PER_PAGE
  return filteredLinks.value.slice(start, start + ITEMS_PER_PAGE)
})
// Result-count label for the results bar — the single truthful counter (the
// page header no longer repeats it). Three states, no invented pagination:
//   - one page:        "13 links"          (everything is visible)
//   - one page, filtered: "4 of 13 links"  (matching of all links)
//   - several pages:   "Showing 1–10 of 13 links" (window of matching)
const paginationText = computed(() => {
  const shown = filteredLinks.value.length
  const all = total.value
  if (totalPages.value > 1) return paginationLabel(shown, currentPage.value, ITEMS_PER_PAGE)
  if (shown === all) return `${shown} ${shown === 1 ? 'link' : 'links'}`
  return `${shown} of ${all} links`
})
watch([search, filterCategory, filterStatus, filterFolder, filterType, filterPinned, filterTag, filterDate, filterRecent, sortBy], () => { currentPage.value = 1 })

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
function timeGroupLabel(iso, now = Date.now()) {
  const days = calendarDaysSince(iso, now)
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
  { id: 'view-card', label: 'Switch to Card view', group: 'View', keywords: 'grid' },
  { id: 'view-list', label: 'Switch to List view', group: 'View', keywords: 'rows' },
  { id: 'view-compact', label: 'Switch to Compact view', group: 'View', keywords: 'dense scan' },
  { id: 'theme', label: 'Toggle theme', group: 'View', keywords: 'dark light appearance' },
  { id: 'settings', label: 'Open settings', group: 'View', keywords: 'appearance theme preferences' },
  { id: 'about', label: 'About Save Links', group: 'View', keywords: 'version info legal' },
]

function runCommand(id) {
  commandOpen.value = false
  switch (id) {
    case 'search': openSearch(); break
    case 'add': openAddLink(document.querySelector('.content-head .add-toggle') || document.querySelector('.fab')); break
    case 'show-links': go('links'); clearFilters(); break
    case 'favorites': go('links'); clearFilters(); filterStatus.value = 'favorite'; break
    case 'view-card': go('links'); setViewMode('card'); break
    case 'view-list': go('links'); setViewMode('list'); break
    case 'view-compact': go('links'); setViewMode('compact'); break
    case 'theme': toggleTheme(); break
    case 'settings': openSettings('general'); break
    case 'about': openSettings('about'); break
  }
}

// Open link safely
function openLink(link) {
  const url = link.normalizedUrl || link.url
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

// Option lists for the shared dropdown (neutral menu; no native popup).
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }))
const CATEGORY_FILTER_OPTIONS = [{ value: '', label: 'Categories' }, ...CATEGORY_OPTIONS]
// P3: real link-type filter (values are the persisted enum; labels for humans).
const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'Types' },
  ...LINK_TYPES.map((t) => ({ value: t, label: LINK_TYPE_LABELS[t] })),
]
// P15.10 date surface: the mockup's Date chip — presets plus a custom range.
const DATE_PRESET_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'older', label: 'Older' },
  { value: 'custom', label: 'Custom…' },
]
const RANGE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
function rangeKeyLabel(key) {
  const [y, m, d] = String(key).split('-').map(Number)
  const t = new Date(y, m - 1, d)
  return Number.isNaN(t.getTime()) ? '' : RANGE_FMT.format(t)
}
// The chip shows the range it actually applies (like the mockup's value chips).
const customRangeLabel = computed(() => {
  const { from, to } = filterDate.value
  if (from && to) return `${rangeKeyLabel(from)} – ${rangeKeyLabel(to)}`
  if (from) return `From ${rangeKeyLabel(from)}`
  if (to) return `Until ${rangeKeyLabel(to)}`
  return 'Custom…'
})
const datePresetOptions = computed(() => DATE_PRESET_OPTIONS.map((o) =>
  (o.value === 'custom' && filterDate.value.preset === 'custom') ? { ...o, label: customRangeLabel.value } : o))

// A custom range is a draft until Apply: the dialog edits the draft, Apply
// commits it, Cancel (or backdrop/Escape) leaves the active filter untouched.
const dateRangeDraft = ref({ from: '', to: '' })

function changeDatePreset(value) {
  if (value === 'custom') {
    dateRangeDraft.value = { from: filterDate.value.from || '', to: filterDate.value.to || '' }
    openDialog({
      kind: 'date-range',
      title: 'Custom date range',
      buttons: [
        { label: 'Cancel', value: 'cancel', variant: 'ghost', default: true },
        { label: 'Apply', value: 'apply', variant: 'primary' },
      ],
    })
    return
  }
  filterDate.value = { preset: value, from: '', to: '' }
}

function applyDateRange() {
  // The native date inputs constrain the pair (min/max), so a reversed range
  // can only arrive programmatically; normalise instead of dropping the filter.
  let { from, to } = dateRangeDraft.value
  if (from && to && from > to) [from, to] = [to, from]
  filterDate.value = { preset: 'custom', from, to }
}

// The filter bar (mockup .filterbar): one chip per real filter dimension. The
// three select dimensions plus the pinned toggle are always present (the app has
// a small, fixed filter set - every filter stays one tap away); contextual
// filters driven by the sidebar/navigation (search, folder, tag, Recently
// added) arrive as clearable value chips (@see activeFilterChips).
const FILTER_DIM_KEYS = ['date', 'category', 'type', 'pinned']
function filterDimActive(key) {
  if (key === 'date') return filterDate.value.preset !== 'all'
  if (key === 'category') return !!filterCategory.value
  if (key === 'type') return !!filterType.value
  if (key === 'pinned') return filterPinned.value
  return false
}
const activeFilterCount = computed(() =>
  FILTER_DIM_KEYS.filter((k) => filterDimActive(k)).length +
  activeFilterChips.value.filter((c) => c.key !== 'search').length)

const activeFilterChips = computed(() => {
  const chips = []
  const q = search.value.trim()
  if (q) chips.push({ key: 'search', label: `Search: "${q}"`, clear: () => { search.value = '' } })
  if (filterFolder.value) {
    const name = filterFolder.value === '__unfiled' ? 'Unfiled' : (folderPath(folders.value, filterFolder.value) || filterFolder.value)
    chips.push({ key: 'folder', label: `Folder: ${name}`, clear: () => { filterFolder.value = '' } })
  }
  if (filterTag.value) chips.push({ key: 'tag', label: `Tag: #${filterTag.value}`, clear: () => { filterTag.value = '' } })
  if (filterRecent.value) chips.push({ key: 'recent', label: 'Recently added', clear: () => { filterRecent.value = false } })
  return chips
})

// P15.10: the sort control left the user-facing surface. The library keeps its
// deterministic newest-first order (sortBy stays the internal default; the
// pinned-first partition and the derived group headers depend on it).

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
          <Icon name="x" size="sm" />
        </button>
      </div>

      <div class="sidebar-menu-scroll">
        <!-- Group: Library (P15.4 mockup: All Links / Favorites / Recently
             Added — Unread and Broken are explicitly excluded). -->
        <div class="sidebar-menu-section">
          <div class="sidebar-menu-title">Library</div>
          <ul class="sidebar-menu-list">
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: allLinksActive }" :aria-current="allLinksActive ? 'page' : undefined" @click.prevent="showAllLinks">
                <Icon name="clipboard-list" size="sm" />
                <span>All Links</span>
                <span class="sidebar-menu-badge">{{ total }}</span>
              </a>
            </li>
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: favoritesActive }" :aria-current="favoritesActive ? 'page' : undefined" @click.prevent="showFavorites">
                <Icon name="star" size="sm" />
                <span>Favorites</span>
                <span class="sidebar-menu-badge">{{ favoriteCount }}</span>
              </a>
            </li>
            <li class="sidebar-menu-item">
              <a href="#" class="sidebar-menu-link" :class="{ active: recentActive }" :aria-current="recentActive ? 'page' : undefined" @click.prevent="showRecentlyAdded">
                <Icon name="clock" size="sm" />
                <span>Recently Added</span>
                <span class="sidebar-menu-badge">{{ recentCount }}</span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Group: Folders (P15.5 mockup rows + per-row ⋮ menu over the real
             folders ref — the app's folder management surface. Mutations reuse
             the existing App.vue folder handlers.) -->
        <div class="sidebar-menu-section">
          <div class="sidebar-menu-title sidebar-section-head">
            <span>Folders</span>
            <span class="sidebar-section-tools">
              <button
                type="button"
                class="sidebar-section-action"
                data-testid="sidebar-folder-toggle-all"
                :aria-label="sidebarAnyExpanded ? 'Collapse all folders' : 'Expand all folders'"
                title="Toggle all folders"
                @click="toggleAllSidebarFolders"
              >
                <Icon name="chevrons-down-up" size="sm" />
              </button>
              <button
                type="button"
                class="sidebar-section-action"
                data-testid="sidebar-folder-new"
                aria-label="New folder"
                title="New folder"
                @click="createSidebarFolder(null)"
              >
                <Icon name="folder-plus" size="sm" />
              </button>
            </span>
          </div>
          <ul class="sidebar-folder-tree" data-testid="sidebar-folder-tree" aria-label="Folder navigation">
            <li v-for="{ folder: f, depth, guidePositions, elbow } in sidebarFolderRows" :key="f.id" class="sidebar-folder-node" :data-depth="depth" :data-guides="guidePositions.join(' ')" :data-own="elbow ? 'elbow' : null">
              <div
                class="sidebar-folder-line"
                :class="{ active: isSidebarFolderActive(f.id) }"
                :style="{ paddingInlineStart: (8 + (depth - 1) * 14) + 'px' }"
              >
                <button
                  v-if="sidebarHasChildren(f.id)"
                  type="button"
                  class="sidebar-folder-toggle"
                  data-testid="sidebar-folder-toggle"
                  :aria-expanded="String(sidebarExpandedIds.has(f.id))"
                  :aria-label="(sidebarExpandedIds.has(f.id) ? 'Collapse sidebar folder ' : 'Expand sidebar folder ') + f.name"
                  @click="toggleSidebarFolder(f.id)"
                >
                  <Icon name="chevron-right" size="xs" />
                </button>
                <span v-else class="sidebar-folder-spacer" aria-hidden="true"></span>

                <!-- Mockup .rename-input: Enter commits, Escape cancels, blur
                     commits (empty name cancels). -->
                <input
                  v-if="sidebarRenamingId === f.id"
                  :ref="setSidebarRenameInput"
                  v-model="sidebarRenameName"
                  class="sidebar-folder-rename"
                  :aria-label="`Rename sidebar folder ${f.name}`"
                  @keydown.enter.prevent="saveSidebarRename(f)"
                  @keydown.escape.prevent="cancelSidebarRename"
                  @blur="onSidebarRenameBlur(f)"
                />
                <button
                  v-else
                  type="button"
                  class="sidebar-folder-row"
                  data-testid="sidebar-folder-row"
                  :aria-current="isSidebarFolderActive(f.id) ? 'true' : undefined"
                  @click="selectSidebarFolder(f.id)"
                  @dblclick="startSidebarRename(f)"
                >
                  <Icon :name="(sidebarExpandedIds.has(f.id) && sidebarHasChildren(f.id)) ? 'folder-open' : 'folder'" size="sm" class="sidebar-folder-icon" />
                  <span class="sidebar-folder-label">{{ f.name }}</span>
                </button>

                <span
                  v-if="sidebarRenamingId !== f.id"
                  class="sidebar-folder-count"
                  :aria-label="`${sidebarFolderCounts.get(f.id) || 0} links`"
                >{{ sidebarFolderCounts.get(f.id) || 0 }}</span>
                <button
                  v-if="sidebarRenamingId !== f.id"
                  type="button"
                  class="sidebar-folder-more"
                  data-testid="sidebar-folder-menu"
                  :aria-expanded="String(folderMenuId === f.id)"
                  :aria-label="`Folder options for ${f.name}`"
                  @click.stop="openFolderMenu(f, $event)"
                >
                  <Icon name="more-vertical" size="xs" />
                </button>
              </div>

              <!-- Inline editor: the rename failure surface (the mockup's rename
                   input lives in the row above). Move keeps SaveLink's real
                   folder-move capability, which the mockup does not have. -->
              <div
                v-if="sidebarRenamingId === f.id && sidebarFolderError"
                class="sidebar-folder-editor"
                :style="{ paddingInlineStart: (8 + (depth - 1) * 14) + 'px' }"
              >
                <p class="sidebar-folder-error" role="alert">{{ sidebarFolderError }}</p>
              </div>
              <div
                v-if="sidebarMovingId === f.id"
                class="sidebar-folder-editor"
                data-testid="sidebar-folder-move"
                :style="{ paddingInlineStart: (8 + (depth - 1) * 14) + 'px' }"
              >
                <AppSelect
                  :ref="setSidebarMoveSelect"
                  :id="`sidebar-move-${f.id}`"
                  :model-value="''"
                  variant="field"
                  :options="sidebarMoveOptions(f.id)"
                  :aria-label="`Move sidebar folder ${f.name} to`"
                  @change="(v) => moveSidebarFolder(f.id, v)"
                />
                <button type="button" class="btn ghost sm" aria-label="Cancel sidebar move" @click="cancelSidebarMove">Cancel</button>
                <p v-if="sidebarFolderError" class="sidebar-folder-error" role="alert">{{ sidebarFolderError }}</p>
              </div>
            </li>
          </ul>
        </div>

        <!-- Group: Tags (P15.6 mockup cloud over the real aggregated tags; the
             mockup's inert "manage tags" gear is intentionally not rendered —
             tag CRUD would be a domain change outside this phase). -->
      <div v-if="allTags.length" class="sidebar-menu-section">
        <div class="sidebar-menu-title">Tags</div>
        <TagCloud :tags="allTags" :active="filterTag" data-testid="sidebar-tag-cloud" @select="selectTag" />
      </div>
      </div>

      <!-- Storage meter (P15.6 mockup position, bottom of the sidebar). The
           value is the REAL UTF-8 metadata size from P15.2's
           estimateMetadataBytes; the mockup's progress bar is intentionally
           omitted because SaveLink has no authoritative quota (no fabricated
           percentage). -->
      <div class="storage-meter" data-testid="sidebar-storage-meter">
        <div class="storage-text" data-testid="sidebar-storage-text">{{ storageLabel }}</div>
      </div>

      <!-- Bottom-anchored application item: the Tools section left the sidebar,
           so Settings stays as the single app-level destination. The menu
           scroller above owns the scroll; the flex shell pins this footer to
           the bottom edge in every state (expanded, 80px rail, drawer). -->
      <div class="sidebar-settings">
        <a href="#" class="sidebar-menu-link" @click.prevent="openSettings('general')">
          <Icon name="settings" size="sm" />
          <span>Settings</span>
        </a>
      </div>

    </aside>

    <!-- Per-folder ⋮ menu (P15.5): teleported onto the app's popover layer so
         it is never clipped by the sidebar; anchored by useAnchoredPopover.
         No enter/leave transition: the mockup popmenu appears/disappears
         immediately, and an instant unmount avoids transient duplicate
         accessible names with the inline rename input. -->
    <Teleport to="body">
      <div v-if="folderMenuFolder" ref="folderMenuEl" class="sidebar-folder-menu" role="menu" aria-label="Folder options">
        <template v-if="!folderMenuConfirming">
          <button
            v-if="folderMenuDepth < MAX_FOLDER_DEPTH"
            type="button"
            role="menuitem"
            :aria-label="`New subfolder in ${folderMenuFolder.name}`"
            @click="runFolderMenuAction('subfolder', folderMenuFolder)"
          >
            <Icon name="folder-plus" size="sm" />
            <span>New subfolder</span>
          </button>
          <button
            type="button"
            role="menuitem"
            :aria-label="`Rename sidebar folder ${folderMenuFolder.name}`"
            @click="runFolderMenuAction('rename', folderMenuFolder)"
          >
            <Icon name="pencil" size="sm" />
            <span>Rename</span>
          </button>
          <button
            type="button"
            role="menuitem"
            :aria-label="`Move sidebar folder ${folderMenuFolder.name}`"
            @click="runFolderMenuAction('move', folderMenuFolder)"
          >
            <Icon name="folder-input" size="sm" />
            <span>Move to…</span>
          </button>
          <div class="sidebar-folder-menu-sep" aria-hidden="true"></div>
          <button
            type="button"
            role="menuitem"
            class="danger"
            :aria-label="`Delete sidebar folder ${folderMenuFolder.name}`"
            @click="runFolderMenuAction('delete', folderMenuFolder)"
          >
            <Icon name="trash-2" size="sm" />
            <span>Delete folder</span>
          </button>
        </template>
        <!-- Mockup: the delete step confirms inside the menu (no dialog). -->
        <div v-else class="sidebar-folder-confirm">
          <p class="sidebar-folder-confirm-text">Delete this folder and its subfolders?</p>
          <div class="sidebar-folder-confirm-actions">
            <button type="button" :aria-label="`Cancel delete sidebar folder ${folderMenuFolder.name}`" @click="folderMenuConfirming = false">Cancel</button>
            <button type="button" class="danger" :aria-label="`Confirm delete sidebar folder ${folderMenuFolder.name}`" @click="confirmFolderMenuDelete(folderMenuFolder)">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Navbar (P8: the shell's full-width top row, outside the content scroller) -->
      <!-- Navbar -->
      <nav class="navbar-custom">
        <div class="navbar-left">
          <button type="button" class="sidebar-toggle-btn" id="sidebar-toggle" aria-label="Toggle navigation" @click="sidebarOpen = !sidebarOpen">
            <Icon :name="sidebarOpen ? 'panel-left' : 'panel-right'" size="md" />
          </button>
          <button type="button" class="btn-desktop-toggle" id="desktop-sidebar-toggle" :aria-label="sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'" @click="toggleSidebarMinimized">
            <Icon :name="sidebarMinimized ? 'panel-right' : 'panel-left'" size="md" />
          </button>
          <a href="#" class="mobile-brand" @click.prevent="go('links')">
            <img src="/logo.png" alt="" width="26" height="26" />
            <span>Save <span class="brand-accent">Links</span></span>
          </a>
        </div>

        <!-- Mid navbar: search pill (mockup .search; real search behaviour kept) -->
        <div class="navbar-search-wrapper" id="main-search">
          <Icon name="search" size="sm" class="navbar-search-icon" />
          <input ref="searchInputEl" type="search" class="navbar-search-input" placeholder="Search links…" aria-label="Search links" enterkeyhint="search" :value="search" @input="search = $event.target.value" @keydown.esc.prevent="closeSearch(true)" @blur="onSearchBlur" />
          <button v-if="search" type="button" class="navbar-search-btn" aria-label="Clear search" @click="search = ''"><Icon name="x" size="sm" /></button>
          <button v-else type="button" class="navbar-search-btn" :aria-label="searchOpen ? 'Close search' : null" :aria-hidden="searchOpen ? null : 'true'" :tabindex="searchOpen ? null : '-1'" @click="searchOpen && closeSearch(true)">
            <Icon v-if="searchOpen" name="x" size="sm" />
            <Icon v-else name="search" size="sm" />
          </button>
          <kbd class="navbar-search-kbd" aria-hidden="true">{{ searchShortcutLabel }}</kbd>
        </div>

        <!-- Mockup .views: the one view switcher, in the topbar -->
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
            <Icon :name="VIEW_MODE_ICONS[m]" size="sm" />
            <span class="view-label sr-only">{{ VIEW_MODE_LABELS[m] }}</span>
          </button>
        </div>

        <!-- Mockup theme control: a compact Light <-> Dark switch bound to the
             existing appearance state (Settings keeps the full 3-way control,
             including System). -->
        <div class="theme-wrap">
          <button
            type="button"
            class="theme-switch"
            :class="{ 'is-dark': isDark }"
            role="switch"
            :aria-checked="String(isDark)"
            :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleTheme"
          >
            <span class="theme-switch-track" aria-hidden="true">
              <span class="theme-switch-thumb">
                <Icon name="sun" size="xs" class="theme-icon theme-icon--sun" />
                <Icon name="moon" size="xs" class="theme-icon theme-icon--moon" />
              </span>
            </span>
          </button>
        </div>

        <!-- Right actions: mockup import/export + the existing account control -->
        <div class="navbar-actions">
          <button type="button" class="navbar-action-btn topbar-import" aria-label="Import JSON" title="Import" @click="triggerTopbarImport">
            <Icon name="download" size="sm" />
          </button>
          <button type="button" class="navbar-action-btn topbar-export" aria-label="Export JSON" title="Export" @click="triggerTopbarExport">
            <Icon name="upload" size="sm" />
          </button>
          <button type="button" class="navbar-action-btn" id="btn-fullscreen" aria-label="Toggle Fullscreen" @click="toggleFullscreen">
            <Icon name="maximize" size="md" />
          </button>
          <button
            type="button"
            class="identity-btn"
            :aria-expanded="accountOpen"
            :aria-label="authState.status === 'authenticated' ? 'Account menu, signed in as ' + profile.name : 'Account menu, sign in'"
            @click="toggleAccount"
          >
            <div class="identity-avatar">{{ initials }}</div>
            <div class="identity-info sr-only">
              <div class="identity-name">{{ profile.name }}</div>
              <div class="identity-status">
                <span v-if="authState.status === 'authenticated'" class="status-dot" aria-hidden="true"></span>
                <span>{{ authState.status === 'authenticated' ? 'Signed in' : 'Sign in' }}</span>
              </div>
            </div>
          </button>
        </div>

        <!-- Real import entry point for the topbar (same pipeline as Backup) -->
        <input ref="topbarImportInput" type="file" accept=".json,application/json" class="sr-only" tabindex="-1" aria-hidden="true" @change="onTopbarImportChange" />
      </nav>

    <!-- Main wrapper (P8: the content column; its own scroll container) -->
    <div class="main-wrapper" :class="{ 'has-detail': detailOpen, 'main-wrapper--links': currentView === 'links' }">
      <!-- Page Header: the view title. The single Add entry point lives in the
           library toolbar (>=1200) / FAB (below), so the header carries no
           competing action. -->
      <div class="page-header" :class="{ 'page-header--links': currentView === 'links' }">
        <div>
          <h1 class="page-title">{{ pageTitle }}</h1>
        </div>
      </div>

      <!-- Main Content -->
      <main>

        <!-- ===== VIEW: Links ===== -->
        <section v-if="currentView === 'links'" class="links-view">
          <!-- One unified panel: library controls, link content, pagination -->
          <div class="links-panel">
          <!-- One Library Controls region: the Add entry and the filters share a
               single band with one hairline boundary. -->
          <div class="library-controls">
            <div class="content-head" :class="{ 'content-head--links': currentView === 'links' }">
              <AddLink ref="addLinkEl" :folders="folderSelectOptions" @add="handleAdd" />
            </div>

            <!-- P15.10 filter bar (mockup .filterbar): one chip per real filter.
                 Dimension chips carry their current value (accent when set),
                 contextual filters arrive as clearable chips. -->
            <div v-if="hasLinks" class="filterbar" role="group" aria-label="Filters">
            <AppSelect
              id="filter-date"
              variant="header"
              :class="{ 'is-active': filterDate.preset !== 'all' }"
              aria-label="Filter by date"
              :model-value="filterDate.preset"
              :options="datePresetOptions"
              @change="changeDatePreset"
            />
            <AppSelect
              id="filter-category"
              variant="header"
              :class="{ 'is-active': !!filterCategory }"
              aria-label="Filter by category"
              :model-value="filterCategory"
              :options="CATEGORY_FILTER_OPTIONS"
              @update:model-value="filterCategory = $event"
            />
            <AppSelect
              id="filter-type"
              variant="header"
              :class="{ 'is-active': !!filterType }"
              aria-label="Filter by type"
              :model-value="filterType"
              :options="TYPE_FILTER_OPTIONS"
              @update:model-value="filterType = $event"
            />
            <button
              type="button"
              class="chip pinned-toggle"
              :class="{ active: filterPinned }"
              :aria-pressed="String(filterPinned)"
              aria-label="Show pinned links only"
              @click="filterPinned = !filterPinned"
            >
              <Icon name="pin" size="xs" />
              <span>Pinned</span>
            </button>
            <span v-for="chip in activeFilterChips" :key="chip.key" class="filter-chip chip">
              {{ chip.label }}
              <button type="button" class="chip-clear" :aria-label="'Clear ' + chip.key + ' filter'" title="Remove this filter" @click="chip.clear()">
                <Icon name="x" size="xs" />
              </button>
            </span>
            <button v-if="activeFilterCount > 0" type="button" class="chip-clear-all" @click="clearAllFilters">Clear all filters</button>
            </div>
          </div>

          <!-- Results row: lightweight list metadata (the count; the selection
               entry stays real but is no longer a separate toolbar band). -->
          <div v-if="hasLinks" class="library-results">
            <label v-if="visibleIds.length" class="select-visible">
              <input
                ref="selectAllRef"
                type="checkbox"
                :checked="allVisibleSelected"
                aria-label="Select all visible links"
                @change="onSelectAllVisibleChange"
              />
              <span class="select-visible-label">Select all</span>
            </label>
            <span class="library-results-count" aria-live="polite">{{ paginationText }}</span>
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
            <button v-else class="btn ghost" @click="clearAllFilters">Clear filters</button>
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
                  @toggle-favorite="toggleFavorite"
                  @toggle-pin="togglePin"
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
                    :inspected="detailId === link.id"
                    @select="setSelected"
                    @inspect="openDetail"
                    @toggle-favorite="toggleFavorite"
                    @toggle-pin="togglePin"
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

        <!-- ===== VIEW: Backup ===== -->
        <section v-else-if="currentView === 'backup'" class="card">
          <DataBackup :links="links" :profile="profile" :folders="folders" :appearance="appearance" :color-scheme="colorScheme" @import-request="requestImport" @show-toast="showToast" />
        </section>

        <!-- P15.12: Settings and About are sections of the shared modal (opened
             from the sidebar / command palette); they are not pages. -->

      </main>

    </div>

    <!-- Bottom navigation (P8 mockup shell: bound to the real <1200 layout).
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
          <Icon name="clipboard-list" size="lg" />
          <span>All</span>
      </button>
      <button
        type="button"
        class="bottom-nav-item"
        :class="{ active: favoritesActive }"
        :aria-current="favoritesActive ? 'page' : null"
        @click="showFavorites"
      >
          <Icon name="star" size="lg" />
          <span>Favorites</span>
      </button>
      <!-- P15.12 (mockup): Tags is a first-class mobile destination; it opens
           the shared Tags dialog over the current page. -->
      <button
        type="button"
        class="bottom-nav-item"
        :aria-current="filterTag ? 'page' : null"
        @click="openTagsDialog"
      >
          <Icon name="tag" size="lg" />
          <span>Tags</span>
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
          <Icon name="ellipsis" size="lg" />
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
      <Icon name="plus" size="lg" />
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
      :available-tags="allTags"
      :overlay="!isDesktopShell"
      @close="closeDetail"
      @edit="handleEdit"
      @copy="handleCopyLink"
      @share="handleShareLink"
      @delete="requestDeleteLink"
              @pin="togglePin"
              @favorite="toggleFavorite"
              @move="handleSetFolder"
    />
      <AppDialog
        :open="!!dialog"
        :title="dialogTitle"
        :message="dialog?.message || ''"
        :buttons="dialog?.buttons || []"
        :size="dialog?.kind === 'settings' ? 'wide' : 'default'"
        @choose="onDialogChoose"
        @close="closeDialog"
      >
        <!-- P15.10: the custom date range is a draft edited in the shared
             dialog; Apply commits it, Cancel/Escape leaves the filter as-is. -->
        <div v-if="dialog?.kind === 'date-range'" class="date-range">
          <label class="date-range-field">
            <span>From</span>
            <input v-model="dateRangeDraft.from" type="date" class="input" :max="dateRangeDraft.to || undefined" />
          </label>
          <label class="date-range-field">
            <span>To</span>
            <input v-model="dateRangeDraft.to" type="date" class="input" :min="dateRangeDraft.from || undefined" />
          </label>
        </div>

        <!-- P15.12: Settings/About — one modal, section nav inside it. -->
        <SettingsDialog
          v-else-if="dialog?.kind === 'settings'"
          v-model:section="settingsSection"
          :appearance="appearance"
          :color-scheme="colorScheme"
          :profile="profile"
          :initials="initials"
          :signed-in="authState.status === 'authenticated'"
          :links="links"
          :folders="folders"
          :version="appVersion"
          @update:appearance="setAppearance"
          @update:color-scheme="setColorScheme"
          @import-request="requestImport"
          @show-toast="showToast"
          @open-account="openAccountFromSettings"
        />

        <!-- P15.12: the mobile Tags destination (mockup bottom nav) reuses the
             real tag filters in the shared sheet/dialog. -->
        <TagCloud
          v-else-if="dialog?.kind === 'tags'"
          :tags="allTags"
          :active="filterTag"
          data-testid="tags-dialog-cloud"
          @select="onTagDialogSelect"
        />
      </AppDialog>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast" class="sl-toast" role="status" aria-live="polite">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
/* ---------------------------------------------------------------------
   P8 shell — the mockup's single-application-viewport model.
   Below 1200: flex column (topbar · content · bottom bar); at >=1200 the
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
   so sticky group headers can park flush at its top edge). Below 1200 the
   wrapper keeps its own horizontal padding; on the grid the header supplies
   the horizontal inset too. */
.page-header { padding-top: 1.5rem; }
/* Saved Links: the workspace opens with its toolbar/filter bar, so the view
   title leaves the layout flow (kept as the page's accessible heading). */
.main-wrapper > .page-header.page-header--links {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

@media (min-width: 1200px) {
  .app {
    display: grid;
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--detail-width);
    grid-template-rows: var(--navbar-height) minmax(0, 1fr);
  }
  /* P9 (G6): the desktop content column is full-bleed like the mockup — rows,
     cards, toolbar and results carry their own spacing; only the page header
     keeps a small outer inset. */
  .main-wrapper {
    grid-column: 2;
    grid-row: 2;
    margin-left: 0;
    /* The Links pagination footer is the column's bottom band: no inset below
       it, so its top border aligns with the sidebar Settings footer's border. */
    padding: 0;
  }
  .page-header { padding: 1.25rem 1.25rem 0; }
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
@media (min-width: 1200px) {
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
  background: var(--accent-strong);
  color: var(--accent-text-on-strong);
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
@media (max-width: 1199px) {
  .fab { display: flex; }
}

/* Intentional reading width: page header and content stay centered on very
   wide monitors instead of stretching edge to edge. */
  .main-wrapper > .page-header,
  .main-wrapper > main {
    width: 100%;
    max-width: 1560px;
    margin-left: auto;
    margin-right: auto;
  }

  /* The content column takes the remaining shell height. */
  .main-wrapper > main {
    flex: 1 1 auto;
  }

/* Header profile control (from db93ded) */
.identity-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  /* Same control height as every other topbar control: the avatar can never
     inflate the header row, so all topbar controls share one vertical center. */
  min-height: var(--control-height);
  padding: 0 var(--space-3) 0 var(--space-1);
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
/* P15.3: mockup avatar treatment — a 32px gradient circle with initials; the
   profile name/status stay in the DOM as the button's sr-only detail. */
.identity-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--accent), #a855f7);
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: var(--weight-semibold);
  font-size: 12px;
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

/* Unified Links workspace: toolbar header + filter bar + results + list +
   pagination. The workspace itself is chrome-free - it runs edge-to-edge inside
   the content area, and its inner bands/items carry the only surfaces. */
.links-panel {
  /* Visible, not hidden: the sticky group headers must stick to the list
     scroller (.links-content), and overflow:hidden would become their scrollport. */
  overflow: visible;
  /* Part of the Links height chain: the panel consumes the height main gives it
     so the list below can shrink and scroll (min-height:0 at every level). */
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
/* One Library Controls region: the Add entry and the filters share a single
   band with one hairline boundary (fewer stacked toolbars). */
.library-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  min-width: 0;
  flex-shrink: 0;
}
.library-controls > .content-head {
  flex: 0 0 auto;
  padding: 0;
  border-bottom: none;
  background: transparent;
}
.library-controls > .filterbar {
  flex: 0 1 auto;
  min-width: 0;
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
/* Scroll batch (approved F-a): Links is the only view with list-only scrolling.
   The page wrapper stops scrolling; the flex chain hands the leftover height to
   .links-content, which becomes the single vertical scrollport. Toolbar, filter
   bar, results bar and pagination are flex-shrink:0 bands around it. */
.main-wrapper--links { overflow-y: hidden; }
.main-wrapper--links > main {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.main-wrapper--links .links-view {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.main-wrapper--links .library-controls,
.main-wrapper--links .content-head,
.main-wrapper--links .library-results,
.main-wrapper--links .table-footer-control {
  flex-shrink: 0;
}
.main-wrapper--links .links-content {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}
/* Results bar: the mockup's "Showing X of N" line between toolbar and list. */
.library-results {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 7px 14px;
  font-size: 12px;
  color: var(--muted);
}
.library-results-count { color: var(--text-h); font-weight: var(--weight-semibold); }
/* Select-all-visible control: native checkbox (tri-state via .indeterminate). */
.select-visible { display: inline-flex; align-items: center; gap: 6px; }
/* P15.13 (mockup .link-btn): the visible Select all control is an accent-soft
   pill that labels the real checkbox — one accessible control, not two. */
.select-visible-label {
  color: var(--accent);
  font-size: 11.5px;
  font-weight: var(--weight-medium);
  background: var(--accent-soft);
  border-radius: 6px;
  padding: 3px 9px;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
@media (hover: hover) and (pointer: fine) {
  /* Border token is never a background: hover deepens the label's text hue. */
  .select-visible-label:hover { color: var(--accent-text-hover); }
}
.select-visible input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--accent-strong);
  cursor: pointer;
}
.select-visible input:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
/* Pagination = panel footer (no separate card/background). Same shared
   --footer-height band as the sidebar's Settings footer: the page controls
   stay 32px and are centered inside the 64px region. */
.links-panel .table-footer-control {
  background: transparent;
  border-top: 1px solid var(--border);
  height: var(--footer-height);
  padding: 0 14px;
  margin: 0;
}
/* With a single page there are no page controls, so the footer collapses. */
.links-panel .table-footer-control.is-empty {
  border-top: none;
  padding: 0;
  height: 0;
}
/* Toolbar: Add link on the left (the filters live in the shared Library
   Controls band). The AddLink root inherits this component's scope, so drop its
   own card chrome and keep only the compact toggle. Inner nodes need :deep(). */
.content-head :deep(.add-card) {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}
.content-head :deep(.add-toggle-hint) { display: none; }

/* Sorting/filter controls: quiet, borderless — hierarchy from typography + hover */

/* P15.3: mockup topbar view tabs (.views). The container is layout-only (no
   track/border/background): the segments group by proximity and the ACTIVE
   mode carries a NEUTRAL toolbar fill (shared muted surface + strong text),
   never the brand accent, so it cannot compete with the Save Links identity,
   primary actions or the profile control. Its height matches the system
   small-control height so it reads the same weight as the secondary topbar
   icon actions. */
.view-switch {
  display: inline-flex;
  align-items: stretch;
  flex-shrink: 0;
  gap: 2px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  height: var(--control-height-sm);
  padding: var(--space-1);
}
.view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Square segment, proportional to the reduced track height. */
  width: calc(var(--control-height-sm) - 2 * var(--space-1));
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
@media (hover: hover) and (pointer: fine){
.view-btn:hover { color: var(--text-h); }
}
.view-btn:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: -2px; }
.view-btn.active {
  background: var(--muted-bg);
  color: var(--text-h);
}
.view-label { white-space: nowrap; }

/* P15 (theme batch): compact Light <-> Dark switch in the topbar. The thumb
   slides and the sun/moon icons cross-fade; the track/thumb stay token-neutral
   so the control never dominates the bar. */
.theme-wrap { display: flex; align-items: center; flex-shrink: 0; }
.theme-switch {
  display: block;
  width: 44px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.theme-switch:focus-visible { outline: none; }
.theme-switch-track {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-full);
  background-color: var(--muted-bg);
  border: 1px solid var(--border);
  transition: background-color var(--transition-normal), border-color var(--transition-normal);
}
.theme-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: var(--card);
  color: var(--muted);
  box-shadow: var(--shadow-sm);
  display: grid;
  place-items: center;
  transition: transform var(--transition-normal), background-color var(--transition-normal), color var(--transition-normal);
}
.theme-switch.is-dark .theme-switch-thumb { transform: translateX(20px); }
.theme-switch .theme-icon {
  position: absolute;
  transition: opacity var(--transition-normal), transform var(--transition-normal);
}
.theme-switch .theme-icon--moon { opacity: 0; transform: rotate(-90deg) scale(.6); }
.theme-switch.is-dark .theme-icon--sun { opacity: 0; transform: rotate(90deg) scale(.6); }
.theme-switch.is-dark .theme-icon--moon { opacity: 1; transform: rotate(0) scale(1); }
.theme-switch:focus-visible .theme-switch-track {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: 2px;
}

/* P15.3: mockup .topbar-actions — import/export exist on the desktop shell;
   below 1200 the Backup view keeps the real entry points. */
.navbar-action-btn.topbar-import,
.navbar-action-btn.topbar-export { display: none; }
@media (min-width: 1200px) {
  .navbar-action-btn.topbar-import,
  .navbar-action-btn.topbar-export { display: flex; }
}

/* P15 Group 2 (mockup topbar): the topbar brand exists from 768 up - below it
   the drawer header carries the brand and the inline search owns the row. */
@media (max-width: 767.98px) {
  .mobile-brand { display: none; }
}

/* P15.10 filter bar (mockup .filterbar): one horizontally scrollable row of
   chip controls between the toolbar and the results line. Dimension chips use
   the shared AppSelect header variant; contextual filters (pinned/folder/tag/
   Recently added) arrive as clearable chips; "+ Filter" surfaces dimensions. */
.filterbar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.filterbar::-webkit-scrollbar { display: none; }
/* One chip language (mockup .chip): a 30px pill on the quiet surface. */
.filterbar .chip,
.filterbar .filter-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--muted-bg);
  color: var(--muted);
  font-size: 12.5px;
  font-weight: var(--weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}
@media (hover: hover) and (pointer: fine) {
  .filterbar .chip:hover,
  .filterbar .filter-chip:hover { border-color: var(--border-strong); color: var(--text-h); }
}
/* The pinned toggle's icon + label stack renders 2px taller than the AppSelect
   chips; cap it so the bar keeps the mockup's 46px height. */
.filterbar .chip.pinned-toggle {
  height: 30px;
  padding-top: 0;
  padding-bottom: 0;
}
/* Active chip = accent-tinted (mockup .chip.active); "+ Filter" marks itself
   when any filter is on so the control reads as state, not decoration. */
.filterbar .chip.active,
.filterbar .filter-chip {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent);
}
.filterbar .chip:focus-visible,
.filterbar .filter-chip:focus-visible,
.filterbar .chip-clear:focus-visible,
.filterbar .chip-clear-all:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 1px; }

.filterbar .filter-chip { padding: 4px 4px 4px 12px; }
.chip-clear {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}
@media (hover: hover) and (pointer: fine){
.chip-clear:hover { background: var(--accent-strong); color: var(--accent-text-on-strong); }
}
.chip-clear-all {
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: var(--weight-medium);
  color: var(--muted);
  background: transparent;
  border: none;
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--transition-fast);
}
@media (hover: hover) and (pointer: fine){
.chip-clear-all:hover { color: var(--text-h); }
}

/* Custom date range (shared AppDialog body): two native date fields. */
.date-range { display: flex; flex-direction: column; gap: var(--space-3); }
.date-range-field { display: flex; flex-direction: column; gap: 6px; }
.date-range-field > span { font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--muted); }
.date-range-field .input { font-size: var(--text-md); }

/* Active-filter chips: the shared chip language above covers their surface;
   this block keeps only the trailing clear-all affordance. */

/* Link content layout: the card grid and the List/Compact row list. */
/* P15.11: the list sits on the page canvas (like the mockup) so rows/cards
   lift to the surface on hover; the mockup's spacing steps + bottom breathing
   room (mobile/FAB navigation) are reserved here, not by the pagination. */
.grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 12px;
  padding: 12px 12px 80px;
  background: var(--bg);
}
.row-list {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 0;
  padding-bottom: 80px;
  background: var(--bg);
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
  color: var(--text-subtle);
  background: var(--bg);
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
  background: var(--accent-soft);
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

/* Card view columns + spacing (P8 mockup contract: 2-col from 560, 3-col from
   1024, maximum 3 per row — the old 4-up >=1280 rule is gone; P15.11 adds the
   mockup's gap/padding steps and desktop bottom breathing room). */
@media (min-width: 560px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding: 14px 14px 80px; }
}
@media (min-width: 1024px) {
  .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 16px 16px 40px; }
  .row-list { padding-bottom: 40px; }
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

@media (max-width: 767.98px) {
  .identity-btn { padding: 0 6px 0 4px; gap: 0; min-height: var(--control-height-sm); }
  /* Compact mobile app bar: menu + search + views + theme + profile on ONE row
     (the >=1200 shell wraps them onto two). P15 Group 2: the field is inline at
     every width, so it takes the remaining width and the profile never shrinks.
     P9: no bottom margin - the topbar is a shell row and the page header
     supplies the content's top spacing (the old margin left a 12px seam). */
.navbar-custom {
  flex-wrap: nowrap;
  align-items: center;
  /* Mockup topbar: 10px inline inset, so the brand/controls sit on the same
     visual grid as the sidebar's 12px content inset. */
  padding: var(--space-2) 10px;
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
    /* P15 Group 2 (mockup .search): inline at every width - no collapse. */
    display: block;
  }
  .navbar-search-input {
    padding: 0.5rem 1rem;
    padding-right: 2.25rem;
    padding-left: 2.4rem;
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
}

/* P8: below the desktop grid the FAB is the single Add entry point; Export
   stays reachable through More → Backup & restore. At >=1200 the toolbar Add
   returns. */
@media (max-width: 1199px) {
  .content-head :deep(.add-card) {
    display: none;
  }
  /* Links workspace is full-bleed below the desktop grid: the shared page
     inset would otherwise frame the filter/results/list with side gaps. */
  .main-wrapper--links {
    padding-inline: 0;
  }
  /* Links toolbar is desktop-only: below the grid it is empty (Add hidden), so
     the band is removed and the filter bar tops the workspace. */
  .content-head--links {
    display: none;
  }
}

/* The filter bar keeps its chips on one scrollable row at every width. */
.filterbar .asel--header {
  flex: 0 0 auto;
}

@media (max-width: 575px) {
  .content-head { padding: 8px; gap: 6px; }
  /* The filter bar scrolls horizontally instead of stretching its chips. */
  .filterbar .asel--header { min-width: 0; }
  .filterbar .asel--header .asel-trigger { font-size: var(--text-xs); }
}
</style>
