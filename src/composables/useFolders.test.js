import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { getStorageKey } from '../utils/environment.js'

function getLS() {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (globalThis.localStorage) return globalThis.localStorage
  if (!globalThis._mockLS) {
    const store = {}
    globalThis._mockLS = {
      getItem(k) { return store[k] ?? null },
      setItem(k, v) { store[k] = String(v) },
      removeItem(k) { delete store[k] },
      clear() { for (const k in store) delete store[k] },
    }
  }
  return globalThis._mockLS
}

describe('useFolders', () => {
  beforeEach(() => {
    const mock = getLS()
    if (!globalThis.localStorage) globalThis.localStorage = mock
    if (typeof window !== 'undefined' && !window.localStorage) window.localStorage = mock
    try { if (typeof localStorage === 'undefined') global.localStorage = mock } catch {}
    getLS().clear()
  })

  it('creates folder and persists', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { folders, createFolder } = useFolders()
    expect(folders.value.length).toBe(0)
    const f = createFolder('Work')
    expect(f.name).toBe('Work')
    expect(f.id).toBeTruthy()
    expect(folders.value.length).toBe(1)
    await nextTick()
    await new Promise(r=>setTimeout(r,0))
    // check persistence via storage key
    const stored = JSON.parse(getLS().getItem(getStorageKey('folders')))
    expect(stored.length).toBe(1)
    expect(stored[0].name).toBe('Work')
  })

  it('prevents duplicate names case-insensitive', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { createFolder } = useFolders()
    createFolder('Personal')
    expect(() => createFolder('personal')).toThrow('Folder already exists')
  })

  it('rename folder', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { folders, createFolder, renameFolder } = useFolders()
    const f = createFolder('Old')
    renameFolder(f.id, 'New')
    expect(folders.value[0].name).toBe('New')
  })

  it('rename prevents duplicate', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { createFolder, renameFolder } = useFolders()
    const a = createFolder('Alpha')
    createFolder('Beta')
    expect(() => renameFolder(a.id, 'Beta')).toThrow()
  })

  it('delete folder', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { folders, createFolder, deleteFolder } = useFolders()
    const f = createFolder('Temp')
    expect(folders.value.length).toBe(1)
    deleteFolder(f.id)
    expect(folders.value.length).toBe(0)
  })

  it('sanitizes invalid folders on load', async () => {
    getLS().setItem(getStorageKey('folders'), JSON.stringify([{ id: '', name: '' }, { id: '1', name: 'Valid' }, null, 'string']))
    const { useFolders } = await import('./useFolders.js')
    const { folders } = useFolders()
    expect(folders.value.length).toBe(1)
    expect(folders.value[0].name).toBe('Valid')
  })

  it('trims folder name to 50', async () => {
    const { useFolders } = await import('./useFolders.js')
    const { createFolder } = useFolders()
    const long = 'a'.repeat(100)
    const f = createFolder(long)
    expect(f.name.length).toBe(50)
  })
})
