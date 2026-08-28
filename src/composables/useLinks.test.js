import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { getStorageKey } from '../utils/environment.js'

describe('useLinks', () => {
  let originalFetch

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
  const ls = getLS

  beforeEach(() => {
    originalFetch = global.fetch
    // ensure storage mock is installed for storage.js (which uses bare localStorage)
    const mock = getLS()
    if (!globalThis.localStorage) globalThis.localStorage = mock
    if (!global.localStorage) global.localStorage = mock
    if (typeof window !== 'undefined' && !window.localStorage) window.localStorage = mock
    // also ensure bare localStorage global is defined (for storage.js)
    try { if (typeof localStorage === 'undefined') global.localStorage = mock } catch {}
    ls().clear()
    vi.restoreAllMocks()
    // default fetch mock for addLink that doesn't use prefetched meta
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve('<html><head><title>Fetched Title</title></head></html>'),
      })
    )
  })

  afterEach(() => {
    global.fetch = originalFetch
    ls().clear()
    vi.restoreAllMocks()
  })

  async function getFreshUseLinks() {
    // dynamic import ensures fresh module but we can just call useLinks after clearing storage
    const { useLinks } = await import('./useLinks.js')
    return useLinks()
  }

  describe('migration & initialization', () => {
    it('migrates legacy status important → important flag', async () => {
      ls().setItem(
        getStorageKey('links'),
        JSON.stringify([{ id: '1', url: 'https://example.com/a', status: 'important', title: 'T' }])
      )
      const { useLinks } = await import('./useLinks.js')
      const { links } = useLinks()
      expect(links.value[0].important).toBe(true)
      expect(links.value[0].mustHave).toBe(false)
      expect(links.value[0].favorite).toBe(false)
      expect(links.value[0].status).toBe('important')
    })

    it('migrates legacy status must-have → mustHave flag', async () => {
      ls().setItem(
        getStorageKey('links'),
        JSON.stringify([{ id: '2', url: 'https://example.com/b', status: 'must-have' }])
      )
      const { useLinks } = await import('./useLinks.js')
      const { links } = useLinks()
      expect(links.value[0].mustHave).toBe(true)
      expect(links.value[0].important).toBe(false)
    })

    it('migrates favorite default false', async () => {
      ls().setItem(
        getStorageKey('links'),
        JSON.stringify([{ id: '3', url: 'https://example.com/c', title: 'C' }])
      )
      const { useLinks } = await import('./useLinks.js')
      const { links } = useLinks()
      expect(links.value[0].favorite).toBe(false)
    })

    it('handles corrupted localStorage gracefully', async () => {
      ls().setItem(getStorageKey('links'), 'not-json')
      const { useLinks } = await import('./useLinks.js')
      const { links } = useLinks()
      expect(links.value).toEqual([])
    })

    it('preserves url alias and domain fallback on migration', async () => {
      ls().setItem(getStorageKey('links'), JSON.stringify([{ id: '4', url: 'https://www.github.com/user', title: 'T' }]))
      const { useLinks } = await import('./useLinks.js')
      const { links } = useLinks()
      expect(links.value[0].normalizedUrl).toBe('https://www.github.com/user')
      expect(links.value[0].url).toBe('https://www.github.com/user')
      expect(links.value[0].domain).toBe('github.com')
    })
  })

  describe('addLink', () => {
    it('creates link with originalUrl and normalizedUrl preserved', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      const link = await addLink({
        originalUrl: 'example.com/page',
        title: 'My Title',
        _prefetchedMeta: { title: 'Meta Title', description: 'Desc', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page',
      })
      expect(link.originalUrl).toBe('example.com/page')
      expect(link.normalizedUrl).toBe('https://example.com/page')
      expect(link.url).toBe('https://example.com/page')
      expect(link.domain).toBe('example.com')
      expect(links.value[0].originalUrl).toBe('example.com/page')
    })

    it('auto-categorizes when category not provided', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      const link = await addLink({
        originalUrl: 'https://github.com/vuejs/core',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'github.com' },
        _prefetchedUrl: 'https://github.com/vuejs/core',
      })
      expect(link.category).toBe('GitHub')
    })

    it('respects manual category', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      const link = await addLink({
        originalUrl: 'https://github.com/vuejs/core',
        category: 'Other',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'github.com' },
        _prefetchedUrl: 'https://github.com/vuejs/core',
      })
      expect(link.category).toBe('Other')
    })

    it('handles tags trimming and filtering', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      const link = await addLink({
        originalUrl: 'https://example.com',
        tags: [' a ', 'b', '', '  ', 'c'],
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com',
      })
      expect(link.tags).toEqual(['a', 'b', 'c'])
    })

    it('truncates title and description', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      const longTitle = 'a'.repeat(300)
      const longDesc = 'b'.repeat(500)
      const link = await addLink({
        originalUrl: 'https://example.com',
        title: longTitle,
        description: longDesc,
        _prefetchedMeta: { title: 'Meta', description: 'MetaDesc', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com',
      })
      expect(link.title.length).toBe(200)
      expect(link.description.length).toBe(400)
    })

    it('uses prefetched meta when URLs match (avoids double fetch)', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      const spy = vi.spyOn(global, 'fetch')
      await addLink({
        originalUrl: 'https://example.com/prefetched',
        _prefetchedMeta: { title: 'Prefetched Title', description: 'Pref', image: 'img.jpg', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/prefetched',
      })
      expect(spy).not.toHaveBeenCalled()
    })

    it('fetches when prefetched URL mismatches', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      await addLink({
        originalUrl: 'https://example.com/new',
        _prefetchedMeta: { title: 'Old', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/old',
      })
      expect(global.fetch).toHaveBeenCalled()
    })

    it('throws for empty URL', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      await expect(addLink({ originalUrl: '   ' })).rejects.toThrow('URL required')
    })

    it('throws for invalid URL', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      // 'https://' is normalized as-is and new URL('https://') throws
      await expect(addLink({ originalUrl: 'https://' })).rejects.toThrow('Invalid URL')
    })

    it('sets independent flags favorite/important/mustHave', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      const link = await addLink({
        originalUrl: 'https://example.com',
        important: true,
        mustHave: true,
        favorite: true,
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com',
      })
      expect(link.important).toBe(true)
      expect(link.mustHave).toBe(true)
      expect(link.favorite).toBe(true)
      expect(link.status).toBe('both')
    })

    it('unshifts new link to start', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      await addLink({ originalUrl: 'https://example.com/1', _prefetchedMeta: { title: '1', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/1' })
      await addLink({ originalUrl: 'https://example.com/2', _prefetchedMeta: { title: '2', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/2' })
      expect(links.value[0].originalUrl).toBe('https://example.com/2')
    })
  })

  describe('updateLink & toggles', () => {
    it('updates title via patch', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, updateLink } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com', _prefetchedMeta: { title: 'Old', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com' })
      updateLink(link.id, { title: 'New Title' })
      expect(links.value[0].title).toBe('New Title')
    })

    it('uses splice for reactive update', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, updateLink } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com', _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com' })
      const before = links.value[0]
      updateLink(link.id, { title: 'Updated' })
      expect(links.value[0]).not.toBe(before) // splice creates new object reference
    })

    it('syncs important/mustHave and status', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, updateLink } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com', _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com' })
      updateLink(link.id, { important: true })
      expect(links.value[0].important).toBe(true)
      expect(links.value[0].status).toBe('important')
      updateLink(link.id, { mustHave: true })
      expect(links.value[0].important).toBe(true)
      expect(links.value[0].mustHave).toBe(true)
      expect(links.value[0].status).toBe('both')
    })

    it('toggleImportant flips independently of mustHave', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, toggleImportant } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com', mustHave: true, _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com' })
      toggleImportant(link.id)
      expect(links.value[0].important).toBe(true)
      expect(links.value[0].mustHave).toBe(true)
      toggleImportant(link.id)
      expect(links.value[0].important).toBe(false)
      expect(links.value[0].mustHave).toBe(true)
    })

    it('toggleFavorite flips independently', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, toggleFavorite, toggleImportant } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com', _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com' })
      toggleFavorite(link.id)
      expect(links.value[0].favorite).toBe(true)
      expect(links.value[0].important).toBe(false)
      toggleImportant(link.id)
      expect(links.value[0].favorite).toBe(true)
      expect(links.value[0].important).toBe(true)
      toggleFavorite(link.id)
      expect(links.value[0].favorite).toBe(false)
      expect(links.value[0].important).toBe(true)
    })

    it('toggleMustHave flips independently', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, toggleMustHave } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com', important: true, _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com' })
      toggleMustHave(link.id)
      expect(links.value[0].mustHave).toBe(true)
      expect(links.value[0].important).toBe(true)
    })

    it('keeps url alias synced', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, updateLink } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com', _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com' })
      updateLink(link.id, { normalizedUrl: 'https://new.com' })
      expect(links.value[0].normalizedUrl).toBe('https://new.com')
      expect(links.value[0].url).toBe('https://new.com')
    })

    it('does nothing for unknown id', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, updateLink } = useLinks()
      await addLink({ originalUrl: 'https://example.com', _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com' })
      const before = links.value.length
      updateLink('nonexistent', { title: 'X' })
      expect(links.value.length).toBe(before)
    })

    it('moves link to a folder via folderId patch', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, updateLink } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com/move', _prefetchedMeta: { title: 'M', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/move' })
      expect(links.value[0].folderId).toBeNull()
      updateLink(link.id, { folderId: 'folder-1' })
      expect(links.value[0].folderId).toBe('folder-1')
    })

    it('moves link back to Unfiled with empty folderId', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, updateLink } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com/back', folderId: 'folder-1', _prefetchedMeta: { title: 'B', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/back' })
      expect(links.value[0].folderId).toBe('folder-1')
      updateLink(link.id, { folderId: '' })
      expect(links.value[0].folderId).toBeNull()
    })
  })

  describe('removeLink & computed', () => {
    it('removes link by id', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, removeLink } = useLinks()
      const a = await addLink({ originalUrl: 'https://example.com/a', _prefetchedMeta: { title: 'A', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/a' })
      const b = await addLink({ originalUrl: 'https://example.com/b', _prefetchedMeta: { title: 'B', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/b' })
      removeLink(a.id)
      expect(links.value.find((l) => l.id === a.id)).toBeUndefined()
      expect(links.value.length).toBe(1)
      expect(links.value[0].id).toBe(b.id)
    })

    it('computes total, importantCount, mustHaveCount, favoriteCount, byCategory', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink, total, importantCount, mustHaveCount, favoriteCount, byCategory } = useLinks()
      await addLink({ originalUrl: 'https://github.com/a', important: true, _prefetchedMeta: { title: 'G', description: '', image: '', domain: 'github.com' }, _prefetchedUrl: 'https://github.com/a', category: 'GitHub' })
      await addLink({ originalUrl: 'https://youtube.com/watch', mustHave: true, favorite: true, _prefetchedMeta: { title: 'Y', description: '', image: '', domain: 'youtube.com' }, _prefetchedUrl: 'https://youtube.com/watch', category: 'YouTube' })
      await addLink({ originalUrl: 'https://example.com/other', favorite: true, _prefetchedMeta: { title: 'O', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/other', category: 'Other' })
      expect(total.value).toBe(3)
      expect(importantCount.value).toBe(1)
      expect(mustHaveCount.value).toBe(1)
      expect(favoriteCount.value).toBe(2)
      expect(byCategory.value).toEqual({ GitHub: 1, YouTube: 1, Other: 1 })
    })
  })

  describe('persistence & storageError', () => {
    it('persists to localStorage on add', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      await addLink({ originalUrl: 'https://example.com/persist', _prefetchedMeta: { title: 'P', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/persist' })
      await nextTick()
      const stored = JSON.parse(ls().getItem(getStorageKey('links')))
      expect(stored.length).toBe(1)
      expect(stored[0].originalUrl).toBe('https://example.com/persist')
    })

    it('sets storageError on quota failure and keeps in-memory', async () => {
      const { useLinks } = await import('./useLinks.js')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { links, addLink, storageError } = useLinks()
      // mock the actual storage instance used by saveLinks (ls() mock)
      const storage = ls()
      const spy = vi.spyOn(storage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      await addLink({ originalUrl: 'https://example.com/quota', _prefetchedMeta: { title: 'Q', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/quota' })
      await nextTick()
      // allow watch to run (deep watch is async)
      await new Promise((r) => setTimeout(r, 0))
      expect(storageError.value).toMatch(/Storage full/)
      expect(links.value.length).toBe(1) // in-memory not lost
      expect(links.value[0].originalUrl).toBe('https://example.com/quota')
      spy.mockRestore()
      warnSpy.mockRestore()
      // trigger another watch by updating – should clear error on successful save
      links.value[0].title = 'changed'
      await nextTick()
      await new Promise((r) => setTimeout(r, 0))
      expect(storageError.value).toBe('')
    })
  })
})
