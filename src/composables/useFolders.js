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
    // sanitizeFolder so reloaded folders keep their server revision — and the
    // kept_local marker, so a Keep Local choice survives a reload instead of
    // re-counting the folder as anonymous)
    revision: typeof raw.revision === 'number' ? raw.revision : 0,
    account_id: typeof raw.account_id === 'string' ? raw.account_id.trim() : null,
    kept_local: typeof raw.kept_local === 'boolean' ? raw.kept_local : false,
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

// Queue outbox mutations for folders added/replaced by a backup import, then
// fire ONE syncNow once every mutation is queued. Mirrors useLinks.js
// queueImportedMutations exactly: new -> create (base 0, current account),
// replaced -> update claimed on the store-acknowledged revision with the
// store's ownership/kept_local, JSON round-trip payloads, anonymous = local
// only (no outbox).
async function queueImportedFolderMutations(newFolders, replacedFolders) {
  const accountId = session.getState().user?.id
  if (!accountId) return
  for (const folder of newFolders) {
    // Brand the folder itself before the deep watch persists it (same as
    // createFolder/useLinks' import helper) so the store copy is owned, never
    // anonymous again after the import.
    folder.revision = 0
    folder.account_id = accountId
    await repository.addPendingMutation(
      'create',
      folder.id,
      'folder',
      JSON.parse(JSON.stringify({ ...folder, revision: 0, account_id: accountId })),
      accountId,
      0
    ).catch(err => console.warn('Failed to queue import mutation:', err))
  }
  if (replacedFolders.length) {
    const storeFolders = await repository.getAllFolders()
    for (const folder of replacedFolders) {
      const storeCopy = storeFolders.find(f => f.id === folder.id)
      const baseRevision = storeCopy ? storeCopy.revision : folder.revision
      const payload = JSON.parse(JSON.stringify(storeCopy
        ? { ...folder, revision: baseRevision, account_id: storeCopy.account_id, kept_local: storeCopy.kept_local }
        : folder))
      await repository.addPendingMutation(
        'update',
        folder.id,
        'folder',
        payload,
        accountId,
        baseRevision
      ).catch(err => console.warn('Failed to queue import mutation:', err))
    }
  }
  if (newFolders.length || replacedFolders.length) {
    syncNow().catch(err => console.warn('Auto-sync failed:', err))
  }
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
      // Same reload reconciliation as useLinks (see src/sync/link-arrival.test.js):
      // preserve ref-only records with a pending create/update that are absent
      // from the snapshot, and drop snapshot records with a pending delete —
      // a local create must survive a reload that races it, a locally deleted
      // folder must never be resurrected by a stale snapshot record. Pending
      // mutations are read twice because a delete queued during the snapshot
      // read can commit after the first read.
      const snapshot = await repository.getAllFolders()
      const pending1 = await repository.getPendingMutations()
      const pending2 = await repository.getPendingMutations()
      const accountId = session.getState().user?.id
      const keptKeys = new Set()
      const deletedKeys = new Set()
      for (const m of [...pending1, ...pending2]) {
        if (m.object_type !== 'folder') continue
        // Account-scoping: same rule as useLinks — only the current account's
        // pending mutations may protect or drop folders in this reconciliation;
        // foreign mutations with a colliding object id are never trusted.
        if (accountId && m.account_id !== accountId) continue
        const key = `folder:${m.object_id}`
        if (m.operation === 'delete') deletedKeys.add(key)
        else keptKeys.add(key)
      }
      const keptLocal = folders.value.filter(
        (f) => keptKeys.has(`folder:${f.id}`) && !snapshot.some((s) => s.id === f.id)
      )
      const fresh = snapshot.filter((s) => !deletedKeys.has(`folder:${s.id}`))
      const merged = sanitizeFolders(keptLocal.length ? [...keptLocal, ...fresh] : fresh)
      folders.value = merged
      // Persist explicitly: the watch is suppressed while this flag is up, so
      // a merged (kept/dropped) set would otherwise never reach storage.
      if (keptLocal.length || merged.length !== snapshot.length) {
        await repository.setAllFolders(merged)
      }
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
        // Base the claim on the store-acknowledged revision and keep the
        // store's owned identity (see useLinks.updateLink — the reactive copy
        // can lag the authoritative store after a merge/push-accepted).
        const storeCopy = (await repository.getAllFolders()).find(f => f.id === updated.id)
        const baseRevision = storeCopy ? storeCopy.revision : updated.revision
        const payload = storeCopy
          ? { ...updated, revision: baseRevision, account_id: storeCopy.account_id }
          : updated
        await repository.addPendingMutation(
          'update',
          updated.id,
          'folder',
          payload,
          accountId,
          baseRevision
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
        // See renameFolder: base the delete on the store-acknowledged
        // revision so a post-merge delete never 409s on a stale base.
        const storeCopy = (await repository.getAllFolders()).find(f => f.id === id)
        const baseRevision = storeCopy ? storeCopy.revision : removed.revision
        await repository.addPendingMutation(
          'delete',
          id,
          'folder',
          { id },
          accountId,
          baseRevision
        ).catch(err => console.warn('Failed to queue mutation:', err))
        // Automatic push for authenticated users
        syncNow().catch(err => console.warn('Auto-sync failed:', err))
      })
    }
    return removed
  }

  // Async because an authenticated import also queues the outbox mutations for
  // the added/replaced folders (and fires ONE syncNow) before resolving; the
  // returned counts object is unchanged.
  async function mergeFolders(importedFolders, strategy = 'skip') {
    const existing = folders.value
    const existingById = new Map()
    const existingByName = new Map()
    for (const f of existing) {
      if (f.id) existingById.set(f.id, f)
      if (f.name) existingByName.set(f.name.toLowerCase(), f)
    }

    const newFolders = []
    const replacedFolders = []
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
            replacedFolders.push(merged[idx])
          }
        }
      } else {
        // Genuinely-new imported folder: assign a FRESH id (Bug 15) — a backup
        // id may already be a server tombstone, and a create at that id would
        // be rejected and then pulled back as a delete. A fresh id can always
        // land and sync to every device.
        const newFolder = { ...imported, id: generateId() }
        merged.push(newFolder)
        newFolders.push(newFolder)
      }
    }

    folders.value = merged
    await queueImportedFolderMutations(newFolders, replacedFolders)
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