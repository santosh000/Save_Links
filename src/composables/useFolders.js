import { ref, watch, computed } from 'vue'
import { repository } from '../storage/repository.js'
import { bootState } from '../storage/migration.js'

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
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const folder = { id, name: trimmed, createdAt: new Date().toISOString() }
    folders.value.push(folder)
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
    folders.value.splice(idx, 1, { ...folders.value[idx], name: trimmed })
  }

  function deleteFolder(id) {
    const idx = folders.value.findIndex(f => f.id === id)
    if (idx === -1) return null
    const removed = folders.value[idx]
    folders.value.splice(idx, 1)
    return removed
  }

  function setFolders(newFolders) {
    folders.value = sanitizeFolders(Array.isArray(newFolders) ? newFolders : [])
  }

  return { folders, folderMap, createFolder, renameFolder, deleteFolder, setFolders, sanitizeFolders }
}
