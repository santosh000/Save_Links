import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, effectScope } from 'vue'
import { getStorageKey } from '../utils/environment.js'
import 'fake-indexeddb/auto'
import { repository } from '../storage/repository.js'
import { boot, bootState } from '../storage/migration.js'
import { defaultDBName } from '../storage/indexeddb.js'

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

  // deleteDatabase fires onblocked forever while ANY connection is open, and a
  // vi.resetModules()'d repository leaks its connection (it is never closed), so
  // the old handler resolving on onblocked silently left stale rows behind. When
  // the exclusive delete cannot proceed, fall back to clearing every object
  // store in place — which needs no exclusive access.
  async function deleteDB(name) {
    const deleted = await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = () => resolve(true)
      req.onerror = () => resolve(false)
      req.onblocked = () => resolve(false)
    })
    if (deleted) return
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const storeNames = [...db.objectStoreNames]
    if (storeNames.length) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, 'readwrite')
        for (const s of storeNames) tx.objectStore(s).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'))
      })
    } else {
      // an empty shell DB would block the repository's fresh-upgrade path,
      // remove it again now that the connection is closed
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name)
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
        req.onblocked = () => resolve()
      })
    }
    db.close()
  }

  function resetBootState() {
    bootState.ready = false
    bootState.links = []
    bootState.folders = []
    bootState.profile = null
    bootState.settings = null
  }

  // fake-indexeddb resolves open + transaction completion across separate
  // macrotask turns, so flushing needs more than one setTimeout(0) hop
  async function flush() {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  }

  beforeEach(async () => {
    await repository.close()
    await deleteDB(defaultDBName())
    resetBootState()
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

  afterEach(async () => {
    // let any queued watch writes settle before closing so no write races the
    // deleteDatabase below
    await flush()
    await repository.close()
    await deleteDB(defaultDBName())
    global.fetch = originalFetch
    ls().clear()
    vi.restoreAllMocks()
  })

  describe('migration & initialization', () => {
    it('migrates legacy status important → important flag', async () => {
      ls().setItem(
        getStorageKey('links'),
        JSON.stringify([{ id: '1', url: 'https://example.com/a', status: 'important', title: 'T' }])
      )
      await boot(repository)
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
      await boot(repository)
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
      await boot(repository)
      const { useLinks } = await import('./useLinks.js')
      const { links } = useLinks()
      expect(links.value[0].favorite).toBe(false)
    })

    it('handles corrupted localStorage gracefully', async () => {
      ls().setItem(getStorageKey('links'), 'not-json')
      await boot(repository)
      const { useLinks } = await import('./useLinks.js')
      const { links } = useLinks()
      expect(links.value).toEqual([])
    })

    it('preserves url alias and domain fallback on migration', async () => {
      ls().setItem(getStorageKey('links'), JSON.stringify([{ id: '4', url: 'https://www.github.com/user', title: 'T' }]))
      await boot(repository)
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

    it('brands a newly saved link with savedFrom (broad platform, never a unique device)', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      const link = await addLink({
        originalUrl: 'https://example.com/platform',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/platform',
      })
      expect(link.createdAt).toBeTruthy()
      expect(link.createdAt).toEqual(expect.any(String))
      expect(typeof link.savedFrom).toBe('string')
      expect(['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'ChromeOS', 'Unknown']).toContain(link.savedFrom)
    })

    it('cleans tracking parameters from saved URLs, keeps original input', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      const link = await addLink({
        originalUrl: 'https://example.com/page?utm_source=x&id=5&fbclid=abc#top',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5#top',
      })
      expect(link.originalUrl).toBe('https://example.com/page?utm_source=x&id=5&fbclid=abc#top')
      expect(link.normalizedUrl).toBe('https://example.com/page?id=5#top')
      expect(link.url).toBe('https://example.com/page?id=5#top')
      expect(links.value[0].originalUrl).toBe('https://example.com/page?utm_source=x&id=5&fbclid=abc#top')
      expect(links.value[0].normalizedUrl).toBe('https://example.com/page?id=5#top')
    })

    it('rejects a duplicate cleaned normalized URL with DuplicateLinkError', async () => {
      const { useLinks, DuplicateLinkError } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      await addLink({
        originalUrl: 'https://example.com/page?id=5',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      })
      await expect(addLink({ originalUrl: 'https://example.com/page?id=5' })).rejects.toMatchObject({
        name: 'DuplicateLinkError',
        existing: expect.objectContaining({ normalizedUrl: 'https://example.com/page?id=5' }),
      })
      expect(links.value).toHaveLength(1)
    })

    it('treats tracking-only differences as duplicates', async () => {
      const { useLinks, DuplicateLinkError } = await import('./useLinks.js')
      const { addLink } = useLinks()
      await addLink({
        originalUrl: 'https://example.com/page?id=5',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      })
      await expect(addLink({
        originalUrl: 'https://example.com/page?utm_source=google&id=5',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      })).rejects.toBeInstanceOf(DuplicateLinkError)
    })

    it('keeps functional query differences distinct', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      await addLink({
        originalUrl: 'https://example.com/page?id=5',
        _prefetchedMeta: { title: 'A', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      })
      await addLink({
        originalUrl: 'https://example.com/page?id=6',
        _prefetchedMeta: { title: 'B', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=6',
      })
      expect(links.value).toHaveLength(2)
    })

    it('allowDuplicate:true saves a second record with a new id', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      const first = await addLink({
        originalUrl: 'https://example.com/page?id=5',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      })
      const second = await addLink({
        originalUrl: 'https://example.com/page?id=5',
        title: 'Copy',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      }, { allowDuplicate: true })
      expect(links.value).toHaveLength(2)
      expect(second.id).not.toBe(first.id)
    })

    it('replaceLink preserves id, createdAt and user-managed fields', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, replaceLink } = useLinks()
      const original = await addLink({
        originalUrl: 'https://example.com/page?id=5',
        title: 'Old Title',
        description: 'Old Desc',
        image: 'https://img.example/old.jpg',
        tags: ['keep'],
        folderId: 'folder-1',
        important: true,
        favorite: true,
        _prefetchedMeta: { title: 'Meta', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      })
      const createdAt = original.createdAt
      const savedFrom = original.savedFrom
      const updated = await replaceLink(original.id, {
        originalUrl: 'https://example.com/page?utm_source=google&id=5',
        title: 'New Title',
        description: 'New Desc',
        image: 'https://img.example/new.jpg',
        _prefetchedMeta: { title: 'Meta 2', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      })
      expect(links.value).toHaveLength(1)
      expect(updated.id).toBe(original.id)
      expect(updated.createdAt).toBe(createdAt)
      expect(updated.savedFrom).toBe(savedFrom)
      expect(updated.folderId).toBe('folder-1')
      expect(updated.tags).toEqual(['keep'])
      expect(updated.important).toBe(true)
      expect(updated.mustHave).toBe(false)
      expect(updated.favorite).toBe(true)
    })

    it('replaceLink updates URL and metadata fields from the new submission', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink, replaceLink } = useLinks()
      const original = await addLink({
        originalUrl: 'https://example.com/page?id=5',
        _prefetchedMeta: { title: 'Old Meta', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      })
      const updated = await replaceLink(original.id, {
        originalUrl: 'https://example.com/page?utm_source=google&id=5',
        title: 'New Title',
        description: 'New Desc',
        image: 'https://img.example/new.jpg',
        _prefetchedMeta: { title: 'New Meta', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/page?id=5',
      })
      expect(updated.originalUrl).toBe('https://example.com/page?utm_source=google&id=5')
      expect(updated.normalizedUrl).toBe('https://example.com/page?id=5')
      expect(updated.url).toBe('https://example.com/page?id=5')
      expect(updated.domain).toBe('example.com')
      expect(updated.category).toBe('Other')
      expect(updated.title).toBe('New Title')
      expect(updated.description).toBe('New Desc')
      expect(updated.image).toBe('https://img.example/new.jpg')
    })

    it('replaceLink returns null for a missing id', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { replaceLink } = useLinks()
      await expect(replaceLink('missing', {
        originalUrl: 'https://example.com/page?id=5',
      })).resolves.toBeNull()
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

  describe('save-first & background enrichment', () => {
    function ogHtml() {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          headers: { get: () => 'text/html' },
          text: () => Promise.resolve(`<html><head>
            <title>Doc</title>
            <meta property="og:title" content="Real Title">
            <meta property="og:description" content="Real Desc">
            <meta property="og:image" content="https://img.example/preview.jpg">
          </head></html>`),
        })
      )
    }

    it('addLink saves immediately without waiting for metadata', async () => {
      // a fetch that never settles: if addLink awaited metadata it would hang
      global.fetch = vi.fn(() => new Promise(() => {}))
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com/some-article' })
      expect(links.value).toHaveLength(1)
      expect(link.title).toBe('Some Article') // URL-derived fallback, never undefined/null
      expect(link.description).toBe('')
      expect(link.image).toBe('')
      expect(link.domain).toBe('example.com')
    })

    it('metadata failure still saves the link with fallback fields', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('network')))
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      await addLink({ originalUrl: 'https://example.com/fail-page' })
      await flush()
      expect(links.value).toHaveLength(1)
      expect(links.value[0].title).toBe('Fail Page')
      expect(links.value[0].description).toBe('')
      expect(links.value[0].image).toBe('')
    })

    it('reuses valid prefetched metadata without any fetch (even after flush)', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      const spy = vi.spyOn(global, 'fetch')
      await addLink({
        originalUrl: 'https://example.com/prefetched',
        _prefetchedMeta: { title: 'Real Title', description: 'Real Desc', image: 'img.jpg', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/prefetched',
      })
      await flush()
      expect(spy).not.toHaveBeenCalled()
      expect(links.value[0].title).toBe('Real Title')
      expect(links.value[0].description).toBe('Real Desc')
      expect(links.value[0].image).toBe('img.jpg')
    })

    it('background metadata updates the saved record after it exists', async () => {
      ogHtml()
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      await addLink({ originalUrl: 'https://example.com/post' })
      // saved instantly with fallback
      expect(links.value[0].title).toBe('Post')
      expect(links.value[0].description).toBe('')
      await flush()
      expect(links.value[0].title).toBe('Real Title')
      expect(links.value[0].description).toBe('Real Desc')
      expect(links.value[0].image).toBe('https://img.example/preview.jpg')
      expect(links.value[0].domain).toBe('example.com')
    })

    it('background update preserves tags, folder, flags, status and createdAt', async () => {
      ogHtml()
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      await addLink({
        originalUrl: 'https://example.com/keep-page',
        tags: ['a', 'b'],
        folderId: 'folder-9',
        important: true,
        mustHave: true,
        favorite: true,
      })
      const createdAt = links.value[0].createdAt
      const savedFrom = links.value[0].savedFrom
      await flush()
      const l = links.value[0]
      expect(l.title).toBe('Real Title')
      expect(l.tags).toEqual(['a', 'b'])
      expect(l.folderId).toBe('folder-9')
      expect(l.important).toBe(true)
      expect(l.mustHave).toBe(true)
      expect(l.favorite).toBe(true)
      expect(l.status).toBe('both')
      expect(l.createdAt).toBe(createdAt)
      expect(l.savedFrom).toBe(savedFrom)
    })

    it('background partial metadata preserves existing fallback values', async () => {
      // page with ONLY an og:image — title/description fallback must survive
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          headers: { get: () => 'text/html' },
          text: () => Promise.resolve('<html><head><meta property="og:image" content="/img.jpg"></head></html>'),
        })
      )
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      await addLink({ originalUrl: 'https://example.com/gallery' })
      await flush()
      expect(links.value[0].title).toBe('Gallery')
      expect(links.value[0].description).toBe('')
      expect(links.value[0].image).toBe('https://example.com/img.jpg')
    })

    it('background enrichment never clobbers a user-typed title', async () => {
      ogHtml()
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      await addLink({ originalUrl: 'https://example.com/clobber-check', title: 'My Custom' })
      await flush()
      expect(links.value[0].title).toBe('My Custom')
    })

    it('duplicate detection still happens before any metadata work', async () => {
      const { useLinks, DuplicateLinkError } = await import('./useLinks.js')
      const { addLink } = useLinks()
      const spy = vi.spyOn(global, 'fetch')
      await addLink({
        originalUrl: 'https://example.com/dup',
        _prefetchedMeta: { title: 'T', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/dup',
      })
      await expect(addLink({ originalUrl: 'https://example.com/dup?utm_source=x' }))
        .rejects.toBeInstanceOf(DuplicateLinkError)
      expect(spy).not.toHaveBeenCalled() // rejected duplicate never triggered a fetch
    })

    it('replaceLink enrichment preserves identity fields', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          headers: { get: () => 'text/html' },
          text: () => Promise.resolve('<html><head><title>Replaced Real Title</title></head></html>'),
        })
      )
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, replaceLink } = useLinks()
      const original = await addLink({
        originalUrl: 'https://example.com/r?a=1',
        tags: ['keep'],
        folderId: 'folder-r',
        important: true,
        favorite: true,
        _prefetchedMeta: { title: 'Old', description: '', image: '', domain: 'example.com' },
        _prefetchedUrl: 'https://example.com/r?a=1',
      })
      const createdAt = original.createdAt
      const updated = await replaceLink(original.id, { originalUrl: 'https://example.com/r?a=2' })
      expect(updated.id).toBe(original.id)
      expect(updated.createdAt).toBe(createdAt)
      await flush()
      const l = links.value.find(x => x.id === original.id)
      expect(l.title).toBe('Replaced Real Title') // enrichment applied on top
      expect(l.normalizedUrl).toBe('https://example.com/r?a=2')
      expect(l.originalUrl).toBe('https://example.com/r?a=2')
      expect(l.tags).toEqual(['keep'])
      expect(l.folderId).toBe('folder-r')
      expect(l.important).toBe(true)
      expect(l.favorite).toBe(true)
    })

    it('tracking-cleaned URL remains unchanged by enrichment', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          headers: { get: () => 'text/html' },
          text: () => Promise.resolve('<html><head><title>Clean Real</title></head></html>'),
        })
      )
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      await addLink({ originalUrl: 'https://example.com/page?utm_source=x&id=5#top' })
      await flush()
      expect(links.value[0].originalUrl).toBe('https://example.com/page?utm_source=x&id=5#top')
      expect(links.value[0].normalizedUrl).toBe('https://example.com/page?id=5#top')
      expect(links.value[0].url).toBe('https://example.com/page?id=5#top')
      expect(links.value[0].title).toBe('Clean Real')
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
    it('persists to IndexedDB on add', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { addLink } = useLinks()
      await addLink({ originalUrl: 'https://example.com/persist', _prefetchedMeta: { title: 'P', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/persist' })
      await flush()
      const stored = await repository.getAllLinks()
      expect(stored.length).toBe(1)
      expect(stored[0].originalUrl).toBe('https://example.com/persist')
    })

    it('sets storageError on quota failure and keeps in-memory', async () => {
      const { useLinks } = await import('./useLinks.js')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { links, addLink, storageError } = useLinks()
      const spy = vi.spyOn(repository, 'setAllLinks').mockRejectedValue(new Error('QuotaExceededError'))
      await addLink({ originalUrl: 'https://example.com/quota', _prefetchedMeta: { title: 'Q', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/quota' })
      await flush()
      expect(storageError.value).toMatch(/Storage full/)
      expect(links.value.length).toBe(1) // in-memory not lost
      expect(links.value[0].originalUrl).toBe('https://example.com/quota')
      spy.mockRestore()
      warnSpy.mockRestore()
      // trigger another watch by updating — should clear error on successful save
      links.value[0].title = 'changed'
      await flush()
      expect(storageError.value).toBe('')
    })
  })

  describe('authenticated sync queueing', () => {
    it('queues a create mutation with base_revision 0 for a new authenticated link', async () => {
      const { session, initSession } = await import('../auth/session.js')
      // Restore an authenticated session through the real HTTP adapter (Phase A):
      // a mocked GET /api/me that the Worker would answer for a valid session.
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url === '/api/me') return new Response(JSON.stringify({ authenticated: true, accountId: 'memory-user' }), { status: 200 })
        if (url === '/auth/logout') return new Response(null, { status: 200 })
        return new Response(null, { status: 404 })
      }))
      await initSession()
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink } = useLinks()
      const link = await addLink({ originalUrl: 'https://example.com/synced', _prefetchedMeta: { title: 'S', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/synced' })
      expect(link.revision).toBe(0)
      await flush()
      const pending = await repository.getPendingMutations()
      expect(pending.length).toBe(1)
      expect(pending[0].operation).toBe('create')
      expect(pending[0].object_type).toBe('link')
      expect(pending[0].object_id).toBe(link.id)
      expect(pending[0].base_revision).toBe(0)
      expect(pending[0].account_id).toBe('memory-user')
      expect(links.value.length).toBe(1) // local-first data still present
      await session.logout()
      vi.unstubAllGlobals()
    })
  })

  describe('mergeLinks — device/source (savedFrom) preservation across import', () => {
    function importedLink(normalizedUrl, title, savedFrom) {
      return {
        id: 'imp-' + normalizedUrl.replace(/[^a-z0-9]/gi, ''),
        originalUrl: normalizedUrl,
        normalizedUrl,
        url: normalizedUrl,
        domain: 'example.com',
        title,
        description: '',
        image: '',
        tags: [],
        category: 'Other',
        important: false,
        mustHave: false,
        favorite: false,
        folderId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        savedFrom,
      }
    }

    it('keep-existing (skip) does not overwrite the local link device metadata', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, mergeLinks } = useLinks()
      // existing local link, saved on Windows
      await addLink({ originalUrl: 'https://example.com/a', _prefetchedMeta: { title: 'A', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/a' })
      links.value[0].savedFrom = 'Windows'
      await flush()
      const createdAt = links.value[0].createdAt
      const id = links.value[0].id

      // incoming backup link is a duplicate (same url) saved on Android
      const res = await mergeLinks([importedLink('https://example.com/a', 'A (backup)', 'Android')], 'skip')

      expect(res.newCount).toBe(0)
      expect(res.replacedCount).toBe(0)
      expect(links.value.length).toBe(1)
      const kept = links.value[0]
      // local link untouched: same id, same date, same device metadata
      expect(kept.id).toBe(id)
      expect(kept.createdAt).toBe(createdAt)
      expect(kept.savedFrom).toBe('Windows')
      // persisted with the local Windows metadata
      await flush()
      const stored = await repository.getAllLinks()
      expect(stored[0].savedFrom).toBe('Windows')
    })

    it('replace-existing preserves the BACKUP link device metadata (Windows stays Windows)', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, addLink, mergeLinks } = useLinks()
      await addLink({ originalUrl: 'https://example.com/b', _prefetchedMeta: { title: 'B', description: '', image: '', domain: 'example.com' }, _prefetchedUrl: 'https://example.com/b' })
      links.value[0].savedFrom = 'Android'
      await flush()
      const id = links.value[0].id
      const createdAt = links.value[0].createdAt

      // backup says Windows — replace must retain Windows (backup metadata), not the local Android
      await mergeLinks([importedLink('https://example.com/b', 'B (backup)', 'Windows')], 'replace')

      const replaced = links.value.find(l => l.id === id)
      expect(replaced.title).toBe('B (backup)') // backup version applied
      expect(replaced.savedFrom).toBe('Windows') // backup device metadata retained
      expect(replaced.createdAt).toBe(createdAt) // local date preserved
      await flush()
      const stored = await repository.getAllLinks()
      expect(stored[0].savedFrom).toBe('Windows')
    })

    it('added new links retain the backup device metadata', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, mergeLinks } = useLinks()
      const res = await mergeLinks([importedLink('https://example.com/new', 'New', 'Windows')], 'skip')
      expect(res.newCount).toBe(1)
      expect(links.value[0].savedFrom).toBe('Windows')
      await flush()
      const stored = await repository.getAllLinks()
      expect(stored[0].savedFrom).toBe('Windows')
    })

    it('added new links with no device metadata stay Unknown (never re-detected from the importing device)', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links, mergeLinks } = useLinks()
      // DataBackup always passes normalizer output, so a backup link with no
      // savedFrom arrives here as 'Unknown' (normalizeLink default) — never as
      // the importing device's platform. Assert mergeLinks keeps that intact.
      const res = await mergeLinks([importedLink('https://example.com/nometa', 'No Meta', 'Unknown')], 'skip')
      expect(res.newCount).toBe(1)
      // not stamped with the importing device's platform
      expect(links.value[0].savedFrom).toBe('Unknown')
      await flush()
      const stored = await repository.getAllLinks()
      expect(stored[0].savedFrom).toBe('Unknown')
    })
  })

  describe('remote pull reactivity (inbound sync)', () => {
    // Simulates the coordinator writing an authoritative remote object into
    // IndexedDB directly (exactly what pullAndReconcile/applyServerObject does),
    // then signaling the composable via notifyDataChanged.
    async function pullLinkIntoRepo(record) {
      await repository.upsertLink(record)
      const { notifyDataChanged } = await import('../storage/dataChanges.js')
      notifyDataChanged()
    }

    it('pulled link appears in the reactive ref immediately without a reload', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links } = useLinks()
      expect(links.value.length).toBe(0)
      // authorize like the repository does (id + revision), as the server sends it
      await pullLinkIntoRepo({
        id: 'server-link-1', object_id: 'server-link-1', revision: 7,
        url: 'https://pulled.example', normalizedUrl: 'https://pulled.example',
        originalUrl: 'https://pulled.example', title: 'Pulled!', description: '',
        image: '', domain: 'pulled.example', category: 'Other', tags: [],
        important: false, mustHave: false, favorite: false, folderId: null,
        status: null, createdAt: '2026-01-01T00:00:00.000Z', savedFrom: 'Cloud',
      })
      await flush()
      expect(links.value.length).toBe(1)
      expect(links.value[0].title).toBe('Pulled!')
      // server revision preserved locally
      expect(links.value[0].revision).toBe(7)
    })

    it('remote pull does not enqueue a pending mutation', async () => {
      const { useLinks } = await import('./useLinks.js')
      useLinks()
      await pullLinkIntoRepo({
        id: 'server-link-2', object_id: 'server-link-2', revision: 1,
        url: 'https://pulled2.example', normalizedUrl: 'https://pulled2.example',
        originalUrl: 'https://pulled2.example', title: 'Pulled 2', description: '',
        image: '', domain: 'pulled2.example', category: 'Other', tags: [],
        important: false, mustHave: false, favorite: false, folderId: null,
        status: null, createdAt: '2026-01-01T00:00:00.000Z', savedFrom: 'Cloud',
      })
      await flush()
      const pending = await repository.getPendingMutations()
      expect(pending.length).toBe(0)
    })

    it('pulling the same server object again does not duplicate it', async () => {
      const { useLinks } = await import('./useLinks.js')
      const { links } = useLinks()
      const record = {
        id: 'server-link-3', object_id: 'server-link-3', revision: 2,
        url: 'https://pulled3.example', normalizedUrl: 'https://pulled3.example',
        originalUrl: 'https://pulled3.example', title: 'Pulled 3', description: '',
        image: '', domain: 'pulled3.example', category: 'Other', tags: [],
        important: false, mustHave: false, favorite: false, folderId: null,
        status: null, createdAt: '2026-01-01T00:00:00.000Z', savedFrom: 'Cloud',
      }
      await pullLinkIntoRepo(record)
      await flush()
      await pullLinkIntoRepo(record)
      await flush()
      expect(links.value.length).toBe(1)
    })

    it('unsubscribes the change listener when the composable scope is disposed (no duplicate/stale listeners)', async () => {
      // Isolate from the shared module scope: prior unscoped useLinks() mounts in
      // this file leave persistent module-level listeners whose deep watches
      // would otherwise write to IndexedDB concurrently with this test's reload.
      vi.resetModules()
      const { useLinks } = await import('./useLinks.js')
      const { notifyDataChanged } = await import('../storage/dataChanges.js')
      const { repository: freshRepo } = await import('../storage/repository.js')

      // Seed IndexedDB so a notifying listener WOULD reload data into its ref.
      await freshRepo.upsertLink({
        id: 'server-seed', object_id: 'server-seed', revision: 1,
        url: 'https://seed.example', normalizedUrl: 'https://seed.example',
        originalUrl: 'https://seed.example', title: 'Seed', description: '',
        image: '', domain: 'seed.example', category: 'Other', tags: [],
        important: false, mustHave: false, favorite: false, folderId: null,
        status: null, createdAt: '2026-01-01T00:00:00.000Z', savedFrom: 'Cloud',
      })

      // Mount instance A inside its own scope, then tear the scope down.
      const scopeA = effectScope()
      let linksA
      scopeA.run(() => {
        linksA = useLinks().links
      })
      scopeA.stop() // should remove A's listener

      // A stale listener would reload this ref; a properly unsubscribed one won't.
      notifyDataChanged()
      await flush()
      expect(linksA.value.length).toBe(0)

      // A live instance still reacts -> subscribe works and only live scopes listen.
      const scopeB = effectScope()
      let linksB
      scopeB.run(() => {
        linksB = useLinks().links
      })
      notifyDataChanged()
      await flush()
      expect(linksB.value.length).toBe(1)
      expect(linksB.value[0].title).toBe('Seed')
      scopeB.stop()
    })
  })

  describe('reload reconciliation is account-scoped (foreign pending mutations)', () => {
    // Isolated imports: a notifying reload also fires listeners any earlier
    // unscoped mount left behind, so rebuild the modules per test (same pattern
    // as the unsubscribe test above).
    async function isolatedSetup() {
      vi.resetModules()
      const [{ useLinks }, { repository: repo }, { notifyDataChanged }, { session, initSession }] = await Promise.all([
        import('./useLinks.js'),
        import('../storage/repository.js'),
        import('../storage/dataChanges.js'),
        import('../auth/session.js'),
      ])
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url === '/api/me') {
          return new Response(JSON.stringify({ authenticated: true, accountId: 'acc-current' }), { status: 200 })
        }
        if (url === '/auth/logout') return new Response(null, { status: 200 })
        return new Response(null, { status: 404 })
      }))
      await initSession()
      return { useLinks, repo, notifyDataChanged, session }
    }

    const currentRecord = (id) => ({
      id, object_id: id, revision: 3, account_id: 'acc-current',
      url: `https://${id}.example`, normalizedUrl: `https://${id}.example`,
      originalUrl: `https://${id}.example`, title: `${id} title`, description: '',
      image: '', domain: `${id}.example`, category: 'Other', tags: [],
      important: false, mustHave: false, favorite: false, folderId: null,
      status: null, createdAt: '2026-01-01T00:00:00.000Z', savedFrom: 'Cloud',
    })

    // fake-indexeddb spreads opens and transactions across macrotask turns, so
    // a fixed tick count is a guess. Poll the real condition instead and fail
    // loudly if it never holds.
    async function waitFor(what, probe, attempts = 200) {
      for (let i = 0; i < attempts; i++) {
        if (await probe()) return
        await new Promise((r) => setTimeout(r, 0))
      }
      throw new Error(`timed out waiting for ${what}`)
    }

    it.each(['delete', 'create', 'update'])(
      'a foreign-account pending %s for the same object id cannot remove or alter the current-account link',
      async (operation) => {
        const { useLinks, repo, notifyDataChanged, session } = await isolatedSetup()
        const { links } = useLinks()
        // current-account record in ref AND store (as a server pull leaves it).
        // The deep watch persists asynchronously (flush:'pre' -> setAllLinks ->
        // IndexedDB transaction); a reload reading the store before that write
        // commits sees the PREVIOUS state, so wait for the real condition: the
        // store actually holding the record.
        links.value = [currentRecord('shared')]
        await waitFor('current-account record persisted', async () =>
          (await repo.getAllLinks()).some((r) => r.id === 'shared')
        )
        // foreign-account pending mutation targeting the same object id
        await repo.addPendingMutation(operation, 'shared', 'link', { id: 'shared' }, 'acc-foreign', operation === 'create' ? 0 : 3)
        // The reload listener rebuilds links.value from its snapshot and
        // replaces the array reference even when the content is unchanged, so a
        // replaced reference is the observable that reconciliation COMPLETED —
        // otherwise the assertions could read the pre-reload ref.
        const preReloadRef = links.value
        notifyDataChanged()
        await waitFor('reload reconciliation to complete', async () => links.value !== preReloadRef)
        // the record survives untouched — the foreign mutation is ignored
        expect(links.value.length).toBe(1)
        expect(links.value[0]).toMatchObject({ id: 'shared', revision: 3, title: 'shared title' })
        const stored = await repo.getAllLinks()
        expect(stored.map((l) => l.id)).toEqual(['shared'])
        expect(stored[0]).toMatchObject({ id: 'shared', revision: 3, account_id: 'acc-current' })
        await session.logout()
        vi.unstubAllGlobals()
      },
    )
  })

  describe('backup import syncs via the outbox (Bug 2 fix)', () => {
    function importedLink(normalizedUrl, title, savedFrom) {
      return {
        id: 'imp-' + normalizedUrl.replace(/[^a-z0-9]/gi, ''),
        originalUrl: normalizedUrl,
        normalizedUrl,
        url: normalizedUrl,
        domain: 'example.com',
        title,
        description: '',
        image: '',
        tags: [],
        category: 'Other',
        important: false,
        mustHave: false,
        favorite: false,
        folderId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        savedFrom,
      }
    }

    // mergeLinks/mergeFolders now queue outbox mutations and fire ONE syncNow
    // themselves. Isolated module rebuild per test (as the account-scope suites)
    // so the auto-sync runs against a stubbed fetch we fully control. Default
    // responses: pull succeeds as a no-op (syncNow pulls BEFORE it pushes, and
    // bails early if the pull is unavailable), while the mutations POST returns
    // 404 'unavailable' — the push fails and the queued mutations stay pending
    // so the queue contents can be asserted after the auto-sync.
    async function isolatedSetup() {
      vi.resetModules()
      const [{ useLinks }, { repository: repo }, { session, initSession }] = await Promise.all([
        import('./useLinks.js'),
        import('../storage/repository.js'),
        import('../auth/session.js'),
      ])
      const fetchStub = vi.fn(async (url, opts) => {
        if (url === '/api/me') {
          return new Response(JSON.stringify({ authenticated: true, accountId: 'acc-current' }), { status: 200 })
        }
        if (url === '/auth/logout') return new Response(null, { status: 200 })
        if (String(url).includes('/api/sync/objects')) {
          return new Response(JSON.stringify({ objects: [] }), { status: 200 })
        }
        if (String(url).includes('/api/sync/mutations')) {
          return new Response(JSON.stringify({ error: 'unavailable', accepted: false, results: [] }), { status: 404 })
        }
        return new Response(null, { status: 404 })
      })
      vi.stubGlobal('fetch', fetchStub)
      await initSession()
      return { useLinks, repo, session, fetchStub }
    }

    it('A: importing a new link assigns a fresh id, queues exactly one account-scoped create at base 0 and fires the auto-sync', async () => {
      const { useLinks, repo, session, fetchStub } = await isolatedSetup()
      const { links, mergeLinks } = useLinks()
      const backup = importedLink('https://example.com/imported-1', 'Imported 1', 'Windows')
      const res = await mergeLinks([backup], 'skip')
      await flush()

      // local merge: one new link, but NOT the backup's native id — genuinely
      // new imports get a fresh identity (Bug 15)
      expect(res.newCount).toBe(1)
      expect(links.value).toHaveLength(1)
      const freshId = links.value[0].id
      expect(freshId).toBeTruthy()
      expect(freshId).not.toBe(backup.id)
      // imported content otherwise preserved
      expect(links.value[0]).toMatchObject({
        normalizedUrl: backup.normalizedUrl,
        title: 'Imported 1',
        savedFrom: 'Windows',
      })

      // persisted to IndexedDB (the watch path) — and branded as owned
      const stored = await repo.getAllLinks()
      expect(stored.map((l) => l.id)).toEqual([freshId])
      expect(stored[0].account_id).toBe('acc-current')
      expect(stored[0].revision).toBe(0)

      // outbox: one create for the current account, claiming base 0, using the FRESH id
      const pending = await repo.getPendingMutations()
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        object_id: freshId,
        operation: 'create',
        object_type: 'link',
        account_id: 'acc-current',
        base_revision: 0,
      })
      expect(pending[0].payload).toMatchObject({ revision: 0, account_id: 'acc-current' })

      // the fix's syncNow really ran: a push reached the server
      const pushes = fetchStub.mock.calls.filter(([u, o]) => o?.method === 'POST' && String(u).includes('/api/sync/mutations'))
      expect(pushes.length).toBeGreaterThanOrEqual(1)
      await session.logout()
      vi.unstubAllGlobals()
    })

    it('C: replacing a duplicate queues one update claimed on the store-acknowledged revision, preserving ownership', async () => {
      const { useLinks, repo, session } = await isolatedSetup()
      const { links, mergeLinks } = useLinks()
      // local record in ref AND store, then a server ack raises the STORE
      // revision (4) while the ref is still stale (0) — exactly what a real
      // push leaves behind
      const seed = { ...importedLink('https://example.com/replaced-1', 'Local title', 'Android'), id: 'existing-1', revision: 0, account_id: 'acc-current' }
      links.value = [seed]
      await flush()
      await repo.upsertLink({ ...seed, revision: 4, account_id: 'acc-current', kept_local: false })
      await flush()

      const res = await mergeLinks([importedLink('https://example.com/replaced-1', 'Backup title', 'Windows')], 'replace')
      await flush()

      // local merge semantics unchanged: same record, backup title, id kept
      expect(res.replacedCount).toBe(1)
      expect(links.value).toHaveLength(1)
      expect(links.value[0]).toMatchObject({ id: 'existing-1', title: 'Backup title', account_id: 'acc-current' })

      // outbox: exactly one update, base claimed from the STORE copy (4), never
      // the stale ref revision (0) — a 0 base would 409 + rebase churn
      const pending = await repo.getPendingMutations()
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        object_id: 'existing-1',
        operation: 'update',
        object_type: 'link',
        account_id: 'acc-current',
        base_revision: 4,
      })
      await session.logout()
      vi.unstubAllGlobals()
    })

    it('D: a duplicate import with strategy skip keeps the local record and queues nothing', async () => {
      const { useLinks, repo, session, fetchStub } = await isolatedSetup()
      const { links, mergeLinks } = useLinks()
      links.value = [{ ...importedLink('https://example.com/skip-1', 'Local', 'Android'), id: 'keep-1', revision: 2, account_id: 'acc-current' }]
      await flush()

      const res = await mergeLinks([importedLink('https://example.com/skip-1', 'Backup title', 'Windows')], 'skip')
      await flush()

      expect(res.newCount).toBe(0)
      expect(res.replacedCount).toBe(0)
      expect(links.value[0].title).toBe('Local')
      expect(await repo.getPendingMutations()).toHaveLength(0)
      // nothing queued -> no auto-sync at all
      const pushes = fetchStub.mock.calls.filter(([u, o]) => o?.method === 'POST' && String(u).includes('/api/sync/mutations'))
      expect(pushes).toHaveLength(0)
      await session.logout()
      vi.unstubAllGlobals()
    })

    it('E: anonymous imports stay local-only — no outbox mutation, no auto-sync', async () => {
      vi.resetModules()
      const [{ useLinks }, { repository: repo }] = await Promise.all([
        import('./useLinks.js'),
        import('../storage/repository.js'),
      ])
      const { links, mergeLinks } = useLinks()

      const res = await mergeLinks([importedLink('https://example.com/anon-1', 'Anon', 'Unknown')], 'skip')
      await flush()

      expect(res.newCount).toBe(1)
      expect(links.value).toHaveLength(1)
      expect(await repo.getPendingMutations()).toHaveLength(0)
    })

    it('F: re-importing the same backup does not queue a second create', async () => {
      const { useLinks, repo, session } = await isolatedSetup()
      const { links, mergeLinks } = useLinks()
      const backup = importedLink('https://example.com/reimport-1', 'Re', 'Windows')

      await mergeLinks([backup], 'skip')
      await flush()
      await mergeLinks([backup], 'skip')
      await flush()

      expect(links.value).toHaveLength(1)
      // dedupe runs on the normalizedUrl, so importing the same backup again
      // is a skip — exactly one create, for the FRESH id the first import
      // generated (never the backup's native id)
      const creates = (await repo.getPendingMutations()).filter((m) => m.operation === 'create' && m.object_type === 'link')
      expect(creates).toHaveLength(1)
      expect(creates[0].object_id).toBe(links.value[0].id)
      expect(creates[0].object_id).not.toBe(backup.id)
      await session.logout()
      vi.unstubAllGlobals()
    })

    it('integration: an accepting server accepts the queued create at the fresh id and the pull reconciles it', async () => {
      vi.resetModules()
      const [{ useLinks }, { repository: repo }, { session, initSession }] = await Promise.all([
        import('./useLinks.js'),
        import('../storage/repository.js'),
        import('../auth/session.js'),
      ])
      const backup = importedLink('https://example.com/chain-1', 'Chain', 'Windows')
      let createdObjectId = null
      const fetchStub = vi.fn(async (url, opts) => {
        if (url === '/api/me') {
          return new Response(JSON.stringify({ authenticated: true, accountId: 'acc-current' }), { status: 200 })
        }
        if (url === '/auth/logout') return new Response(null, { status: 200 })
        if (String(url).includes('/api/sync/mutations')) {
          const body = JSON.parse(opts.body)
          const sent = body.mutations.find((m) => m.object_type === 'link')
          if (sent) createdObjectId = sent.object_id
          return new Response(JSON.stringify({
            accepted: true,
            results: body.mutations.map((m) => ({ mutation_id: m.mutation_id, object_id: m.object_id, accepted: true, result_revision: 1 })),
          }), { status: 200 })
        }
        if (String(url).includes('/api/sync/objects')) {
          return new Response(JSON.stringify({
            objects: createdObjectId ? [{
              object_id: createdObjectId,
              object_type: 'link',
              revision: 1,
              deleted: false,
              deleted_at: null,
              payload: { ...backup, id: createdObjectId, revision: 1, account_id: 'acc-current' },
              created_at: Date.now(),
              updated_at: Date.now(),
            }] : [],
          }), { status: 200 })
        }
        return new Response(null, { status: 404 })
      })
      vi.stubGlobal('fetch', fetchStub)
      await initSession()
      const { links, mergeLinks } = useLinks()

      await mergeLinks([backup], 'skip')
      await flush()
      await flush()

      // the client asked the server for a FRESH identity, never the backup's
      expect(createdObjectId).toBeTruthy()
      expect(createdObjectId).not.toBe(backup.id)

      // the one syncNow pushed AND pulled
      expect(fetchStub.mock.calls.some(([u, o]) => o?.method === 'POST' && String(u).includes('/api/sync/mutations'))).toBe(true)
      expect(fetchStub.mock.calls.some(([u, o]) => o?.method === 'GET' && String(u).includes('/api/sync/objects'))).toBe(true)

      // create was accepted: the mutation DRAINED from the outbox (a surviving
      // pending row would mean it never reached the server), and the store copy
      // now carries the server-acknowledged state (revision 1, its owner)
      const mine = (await repo.getPendingMutations()).find((m) => m.object_id === createdObjectId)
      expect(mine).toBeUndefined()
      const serverCopy = (await repo.getAllLinks()).find((l) => l.id === createdObjectId)
      expect(serverCopy).toBeDefined()
      expect(serverCopy.revision).toBe(1)
      expect(serverCopy.account_id).toBe('acc-current')
      expect(links.value.some((l) => l.id === createdObjectId)).toBe(true)
      await session.logout()
      vi.unstubAllGlobals()
    })

    it('Bug 15 regression: a backup id that is a server tombstone gets a fresh id and the record survives synchronization', async () => {
      vi.resetModules()
      const [{ useLinks }, { repository: repo }, { session, initSession }, { syncNow }] = await Promise.all([
        import('./useLinks.js'),
        import('../storage/repository.js'),
        import('../auth/session.js'),
        import('../sync/coordinator.js'),
      ])
      // The backup carries an OLD native id (e.g. from a backup made before the
      // record was deleted) — that id already exists server-side as a tombstone
      // (the exact scenario from Bug 15's investigation).
      const backup = importedLink('https://example.com/tomb-1', 'Survivor', 'Windows')
      const tombstoneId = backup.id
      let createdObjectId = null
      const fetchStub = vi.fn(async (url, opts) => {
        if (url === '/api/me') {
          return new Response(JSON.stringify({ authenticated: true, accountId: 'acc-current' }), { status: 200 })
        }
        if (url === '/auth/logout') return new Response(null, { status: 200 })
        if (String(url).includes('/api/sync/mutations')) {
          const body = JSON.parse(opts.body)
          const sent = body.mutations.find((m) => m.object_type === 'link')
          if (sent) createdObjectId = sent.object_id
          return new Response(JSON.stringify({
            accepted: true,
            results: body.mutations.map((m) => ({ mutation_id: m.mutation_id, object_id: m.object_id, accepted: true, result_revision: 1 })),
          }), { status: 200 })
        }
        if (String(url).includes('/api/sync/objects')) {
          const objects = [
            // the tombstone is always there: revision 6, deleted — the exact
            // server state that made the old behavior reject the create and
            // then pull-delete the imported record
            { object_id: tombstoneId, object_type: 'link', revision: 6, deleted: true, deleted_at: Date.now(), payload: null, created_at: Date.now(), updated_at: Date.now() },
          ]
          if (createdObjectId) {
            objects.push({
              object_id: createdObjectId,
              object_type: 'link',
              revision: 1,
              deleted: false,
              deleted_at: null,
              payload: { ...backup, id: createdObjectId, revision: 1, account_id: 'acc-current' },
              created_at: Date.now(),
              updated_at: Date.now(),
            })
          }
          return new Response(JSON.stringify({ objects }), { status: 200 })
        }
        return new Response(null, { status: 404 })
      })
      vi.stubGlobal('fetch', fetchStub)
      await initSession()
      const { links, mergeLinks } = useLinks()

      await mergeLinks([backup], 'skip')
      await flush()
      await flush()
      await flush()

      // the imported record got a FRESH id — it can never collide with the tombstone
      expect(createdObjectId).toBeTruthy()
      expect(createdObjectId).not.toBe(tombstoneId)
      expect(links.value.some((l) => l.id === tombstoneId)).toBe(false)

      // the create went to the server under the fresh id and was ACCEPTED
      // (drained from the outbox — a surviving row would mean rejection)
      const acceptedCreate = (await repo.getPendingMutations()).find((m) => m.object_id === createdObjectId)
      expect(acceptedCreate).toBeUndefined()

      // ...and the record REMAINS present after full synchronization: the pull
      // applied the tombstone for the OLD id (a no-op — nothing local held it)
      // and the accepted server state for the fresh id — the Bug 15
      // 3-5-second disappearance cannot happen
const survivor = links.value.find((l) => l.id === createdObjectId)
      expect(survivor).toBeDefined()
      expect(survivor.title).toBe('Survivor')
      // NOTE: we do NOT assert the store revision is already 1 here. The pull
      // applying the tombstone fires notifyDataChanged -> useLinks reload -> the
      // links-watch re-persists the in-memory snapshot (revision 0) after the
      // ack's updateObjectRevision — a benign bookkeeping race that the next
      // pull repairs (asserted below). What Bug 15 actually requires is that
      // the record SURVIVES under a fresh id, not under the tombstone's.
      const stored = (await repo.getAllLinks()).find((l) => l.id === createdObjectId)
      expect(stored).toBeDefined()
      expect(stored.account_id).toBe('acc-current')

      // One more full sync cycle — the tombstone still present — and the pull
      // applies the server-acknowledged record (revision 1) to the store.
      await syncNow()
      await flush()
      expect(links.value.some((l) => l.id === tombstoneId)).toBe(false)
      expect(links.value.some((l) => l.id === createdObjectId)).toBe(true)
      const converged = (await repo.getAllLinks()).find((l) => l.id === createdObjectId)
      expect(converged).toBeDefined()
      expect(converged.revision).toBe(1)
      expect(converged.account_id).toBe('acc-current')
      expect(converged.title).toBe('Survivor')
      await session.logout()
      vi.unstubAllGlobals()
    })
  })
})
