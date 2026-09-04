import { ref, watch, computed, onScopeDispose, getCurrentScope } from 'vue'
import { repository } from '../storage/repository.js'
import { bootState } from '../storage/migration.js'
import { onDataChanged } from '../storage/dataChanges.js'
import { session } from '../auth/session.js'
import { generateId } from '../domain/link.js'
import { syncNow } from './useSync.js'

// Internal flag to prevent watch from overwriting remote pull data
let isReloadingFromRemote = false

function sanitizeFolder(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 50) : ''
  if (!id || !name) return null
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  return {
    id,
    name,
    createdAt,
    // v2 sync fields — preserve if present (matches the IndexedDB adapter's
    // sanitizeFolder so reloaded folders keep their server revision)
    revision: typeof raw.revision === 'number' ? raw.revision : 0,
    account_id: typeof raw.account_id === 'string' ? raw.account_id.trim() : null,
  }
}

function sanitizeFolders(arr) {
  if (!Array.isArray(arr)) return []
  const seen = new Set()
  const out = []
  for (const raw of arr) {
    const f = sanitizeFolder(raw)
    if (!f) continue
    if (seen.has(f.id)) continue
    // also prevent duplicate names case-insensitive? allow but deduplicate ids only
    seen.add(f.id)
    out.push(f)
  }
  return out
}

export function useFolders() {
  const folders = ref(bootState.ready ? sanitizeFolders(bootState.folders) : [])

  // Reload the reactive list when authoritative data changes in IndexedDB from
  // OUTSIDE this composable (a cloud pull/reconcile writes through the
  // repository directly). Same refs local CRUD uses, so pulled folders appear
  // immediately without a page refresh; one source of truth, no duplication.
  const unsubscribeDataChanged = onDataChanged(async () => {
    try {
      isReloadingFromRemote = true
      folders.value = sanitizeFolders(await repository.getAllFolders())
    } catch (err) {
      console.warn('reload folders from storage failed', err)
    } finally {
      isReloadingFromRemote = false
    }
  })
  // Release the subscription when this composable's scope is torn down, so a
  // remount/HMR cannot leave a stale listener holding the old ref. Only bind to
  // a scope when one is active (component setup / effectScope); standalone
  // invocations have no scope to dispose.
  if (getCurrentScope()) onScopeDispose(unsubscribeDataChanged)

  watch(folders, (val) => {
    if (isReloadingFromRemote) return
    repository.setAllFolders(val).catch((err) => console.warn('setAllFolders failed', err))
  }, { deep: true })

  const folderMap = computed(() => {
    const m = new Map()
    for (const f of folders.value) m.set(f.id, f)
    return m
  })

  function createFolder(name) {
    const trimmed = (name || '').trim().slice(0, 50)
    if (!trimmed) throw new Error('Folder name required')
    // prevent duplicate name case-insensitive
    const exists = folders.value.some(f => f.name.toLowerCase() === trimmed.toLowerCase())
    if (exists) throw new Error('Folder already exists')
    const folder = { id: generateId(), name: trimmed, createdAt: new Date().toISOString(), revision: 0 }
    folders.value.push(folder)

    // Create pending mutation for sync (if authenticated)
    const accountId = session.getState().user?.id
    if (accountId) {
      // Use queueMicrotask to ensure addPendingMutation completes before syncNow,
      // while keeping the function synchronous for the public API.
      queueMicrotask(async () => {
        await repository.addPendingMutation(
          'create',
          folder.id,
          'folder',
          folder,
          accountId,
          folder.revision // base_revision = 0 for new objects
        ).catch(err => console.warn('Failed to queue mutation:', err))
        // Automatic push for authenticated users
        syncNow().catch(err => console.warn('Auto-sync failed:', err))
      })
    }

    return folder
  }

  function renameFolder(id, newName) {
    const trimmed = (newName || '').trim().slice(0, 50)
    if (!trimmed) throw new Error('Folder name required')
    const idx = folders.value.findIndex(f => f.id === id)
    if (idx === -1) throw new Error('Folder not found')
    // duplicate check excluding self
    const dup = folders.value.some(f => f.id !== id && f.name.toLowerCase() === trimmed.toLowerCase())
    if (dup) throw new Error('Folder already exists')
    const updated = { ...folders.value[idx], name: trimmed }
    folders.value.splice(idx, 1, updated)

    // Create pending mutation for sync (if authenticated)
    const accountId = session.getState().user?.id
    if (accountId) {
      queueMicrotask(async () => {
        await repository.addPendingMutation(
          'update',
          updated.id,
          'folder',
          updated,
          accountId,
          updated.revision
        ).catch(err => console.warn('Failed to queue mutation:', err))
        // Automatic push for authenticated users
        syncNow().catch(err => console.warn('Auto-sync failed:', err))
      })
    }
  }

  function deleteFolder(id) {
    const idx = folders.value.findIndex(f => f.id === id)
    if (idx === -1) return null
    const removed = folders.value[idx]
    folders.value.splice(idx, 1)

    // Create pending mutation for sync (if authenticated)
    const accountId = session.getState().user?.id
    if (accountId) {
      queueMicrotask(async () => {
        await repository.addPendingMutation(
          'delete',
          id,
          'folder',
          { id },
          accountId,
          removed.revision
        ).catch(err => console.warn('Failed to queue mutation:', err))
        // Automatic push for authenticated users
        syncNow().catch(err => console.warn('Auto-sync failed:', err))
      })
    }
    return removed
  }

  function mergeFolders(importedFolders, strategy = 'skip') {
    const existing = folders.value
    const existingById = new Map()
    const existingByName = new Map()
    for (const f of existing) {
      if (f.id) existingById.set(f.id, f)
      if (f.name) existingByName.set(f.name.toLowerCase(), f)
    }

    const newFolders = []
    const merged = [...existing]

    for (const imported of importedFolders) {
      if (!imported.id && !imported.name) continue
      const existingByIdVal = imported.id ? existingById.get(imported.id) : null
      const existingByNameVal = imported.name ? existingByName.get(imported.name.toLowerCase()) : null
      const existing = existingByIdVal || existingByNameVal

      if (existing) {
        if (strategy === 'replace') {
          const idx = merged.findIndex(f => f.id === existing.id)
          if (idx !== -1) {
            merged[idx] = { ...existing, name: imported.name }
          }
        }
      } else {
        const newFolder = { ...imported, id: imported.id || generateId() }
        merged.push(newFolder)
        newFolders.push(newFolder)
      }
    }

    folders.value = merged
    return { newCount: newFolders.length, replacedCount: strategy === 'replace' ? (importedFolders.length - newFolders.length) : 0 }
  }

  function setFolders(newFolders) {
    folders.value = sanitizeFolders(Array.isArray(newFolders) ? newFolders : [])
  }

  // Count folders that are local/anonymous (no account_id or account_id is null/empty)
  // Exclude folders that have been explicitly marked as "kept_local" after a Keep Local choice
  function getAnonymousFoldersCount() {
    return folders.value.filter(f => !f.account_id && !f.kept_local).length
  }

  // Get all anonymous folders for sync conversion
  // Exclude folders that have been explicitly marked as kept_local
  function getAnonymousFolders() {
    return folders.value.filter(f => !f.account_id && !f.kept_local)
  }

  return { folders, folderMap, createFolder, renameFolder, deleteFolder, setFolders, mergeFolders, sanitizeFolders, getAnonymousFoldersCount, getAnonymousFolders }
}