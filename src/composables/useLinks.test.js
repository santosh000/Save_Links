import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
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

  function deleteDB(name) {
    return new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => {}
    })
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
      const { session } = await import('../auth/session.js')
      await session.login()
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
      const res = mergeLinks([importedLink('https://example.com/a', 'A (backup)', 'Android')], 'skip')

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
      mergeLinks([importedLink('https://example.com/b', 'B (backup)', 'Windows')], 'replace')

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
      const res = mergeLinks([importedLink('https://example.com/new', 'New', 'Windows')], 'skip')
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
      const res = mergeLinks([importedLink('https://example.com/nometa', 'No Meta', 'Unknown')], 'skip')
      expect(res.newCount).toBe(1)
      // not stamped with the importing device's platform
      expect(links.value[0].savedFrom).toBe('Unknown')
      await flush()
      const stored = await repository.getAllLinks()
      expect(stored[0].savedFrom).toBe('Unknown')
    })
  })
})
