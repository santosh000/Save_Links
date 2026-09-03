import { ref, watch, computed } from 'vue'
import { repository } from '../storage/repository.js'
import { bootState } from '../storage/migration.js'
import { session } from '../auth/session.js'
import { generateId } from '../domain/link.js'

function sanitizeFolder(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 50) : ''
  if (!id || !name) return null
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  return { id, name, createdAt }
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

  watch(folders, (val) => {
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
      repository.addPendingMutation(
        'create',
        folder.id,
        'folder',
        folder,
        accountId,
        folder.revision // base_revision = 0 for new objects
      ).catch(err => console.warn('Failed to queue mutation:', err))
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
      repository.addPendingMutation(
        'update',
        updated.id,
        'folder',
        updated,
        accountId,
        updated.revision
      ).catch(err => console.warn('Failed to queue mutation:', err))
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
      repository.addPendingMutation(
        'delete',
        id,
        'folder',
        { id },
        accountId,
        removed.revision
      ).catch(err => console.warn('Failed to queue mutation:', err))
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

  return { folders, folderMap, createFolder, renameFolder, deleteFolder, setFolders, mergeFolders, sanitizeFolders }
}