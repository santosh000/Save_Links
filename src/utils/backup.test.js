import { describe, it, expect, beforeEach } from 'vitest'
import {
  BACKUP_APP,
  BACKUP_VERSION,
  createBackupPayload,
  parseBackupText,
  validateBackupPayload,
  normalizeBackupData,
} from './backup.js'
import { getStorageKey } from './environment.js'

describe('backup utils', () => {
  const ls = () => {
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

  beforeEach(() => {
    const mock = ls()
    if (!globalThis.localStorage) globalThis.localStorage = mock
    if (typeof window !== 'undefined' && !window.localStorage) window.localStorage = mock
    try { if (typeof localStorage === 'undefined') global.localStorage = mock } catch {}
    ls().clear()
  })

  describe('createBackupPayload', () => {
    it('creates valid export payload structure', () => {
      const links = [
        {
          id: '1',
          originalUrl: 'example.com/page',
          normalizedUrl: 'https://example.com/page',
          url: 'https://example.com/page',
          title: 'Title',
          description: 'Desc',
          image: 'https://example.com/img.jpg',
          tags: ['a', 'b'],
          category: 'Other',
          important: true,
          mustHave: false,
          favorite: true,
          domain: 'example.com',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ]
      const profile = { name: 'Test', bio: 'Bio' }
      const payload = createBackupPayload({ links, profile })
      expect(payload.app).toBe(BACKUP_APP)
      expect(payload.version).toBe(BACKUP_VERSION)
      expect(payload.exportedAt).toBeDefined()
      expect(() => new Date(payload.exportedAt).toISOString()).not.toThrow()
      expect(payload.profile).toEqual(profile)
      // links gain folderId null via sanitization in v2
      expect(payload.links[0]).toMatchObject({ ...links[0], folderId: null })
      // ensure deep copy (mutating payload doesn't affect original)
      payload.links[0].title = 'Changed'
      expect(links[0].title).toBe('Title')
      // v2 payload contains folders and settings defaults
      expect(payload.folders).toEqual([])
      expect(payload.settings).toEqual({ appearance: 'system', colorScheme: 'none' })
    })

    it('includes backup version 2', () => {
      const payload = createBackupPayload({ links: [], profile: {} })
      expect(payload.version).toBe(2)
    })

    it('exports P3 pinned/type and sanitizes an unknown type', () => {
      const payload = createBackupPayload({
        links: [
          { id: '1', normalizedUrl: 'https://example.com/a', url: 'https://example.com/a', title: 'A', pinned: true, type: 'video' },
          { id: '2', normalizedUrl: 'https://example.com/b', url: 'https://example.com/b', title: 'B', type: 'podcast' },
        ],
        profile: {},
      })
      expect(payload.links[0].pinned).toBe(true)
      expect(payload.links[0].type).toBe('video')
      expect(payload.links[1].pinned).toBe(false)
      expect(payload.links[1].type).toBe('other')
    })

    it('exports nested folder parentIds (P4)', () => {
      const payload = createBackupPayload({
        links: [],
        folders: [
          { id: 'f1', name: 'Work', parentId: null },
          { id: 'f2', name: 'Engineering', parentId: 'f1' },
        ],
        profile: {},
      })
      expect(payload.folders[0].parentId).toBe(null)
      expect(payload.folders[1].parentId).toBe('f1')
    })

    it('exports from in-memory state (not raw localStorage)', () => {
      // put different data in localStorage (using environment-specific key)
      const ls2 = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : globalThis.localStorage
      ls2.setItem(getStorageKey('links'), JSON.stringify([{ id: 'old', url: 'https://old.com' }]))
      const links = [{ id: 'new', originalUrl: 'https://new.com', normalizedUrl: 'https://new.com', url: 'https://new.com', title: 'New' }]
      const payload = createBackupPayload({ links, profile: {} })
      expect(payload.links[0].id).toBe('new')
      expect(payload.links[0].originalUrl).toBe('https://new.com')
    })

    it('exports url compatibility field', () => {
      const links = [
        { id: '1', originalUrl: 'example.com', normalizedUrl: 'https://example.com', url: 'https://example.com', title: 'T' },
      ]
      const payload = createBackupPayload({ links, profile: {} })
      expect(payload.links[0].url).toBe('https://example.com')
      expect(payload.links[0].originalUrl).toBe('example.com')
      expect(payload.links[0].normalizedUrl).toBe('https://example.com')
    })

    it('exports all required link fields', () => {
      const link = {
        id: '1',
        originalUrl: 'example.com',
        normalizedUrl: 'https://example.com',
        url: 'https://example.com',
        title: 'T',
        description: 'D',
        image: 'I',
        tags: ['x'],
        category: 'GitHub',
        important: true,
        mustHave: true,
        favorite: false,
        domain: 'example.com',
        createdAt: '2024-01-01T00:00:00.000Z',
      }
      const payload = createBackupPayload({ links: [link], profile: {} })
      const exported = payload.links[0]
      for (const field of ['originalUrl', 'normalizedUrl', 'url', 'title', 'description', 'image', 'tags', 'category', 'important', 'mustHave', 'favorite']) {
        expect(exported).toHaveProperty(field)
      }
    })
  })

  describe('parseBackupText', () => {
    it('parses valid JSON', () => {
      const { data, error } = parseBackupText('{"a":1}')
      expect(error).toBeNull()
      expect(data).toEqual({ a: 1 })
    })

    it('returns error for invalid JSON', () => {
      const { data, error } = parseBackupText('not json {')
      expect(data).toBeNull()
      expect(error).toBe('Invalid backup file: not valid JSON')
    })
  })

  describe('validateBackupPayload', () => {
    const validBase = {
      app: 'Save_Link',
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: { name: 'A' },
      links: [],
    }

    it('validates correct backup', () => {
      expect(validateBackupPayload(validBase).valid).toBe(true)
    })

    it('rejects wrong app identifier', () => {
      const { valid, error } = validateBackupPayload({ ...validBase, app: 'OtherApp' })
      expect(valid).toBe(false)
      expect(error).toBe('Invalid backup: wrong app identifier')
    })

    it('rejects unsupported version', () => {
      const { valid, error } = validateBackupPayload({ ...validBase, version: 999 })
      expect(valid).toBe(false)
      expect(error).toBe('Unsupported backup version')
    })

    it('rejects missing links', () => {
      const { links, ...rest } = validBase
      const { valid, error } = validateBackupPayload(rest)
      expect(valid).toBe(false)
      expect(error).toBe('Invalid backup: missing links')
    })

    it('rejects links not array', () => {
      const { valid, error } = validateBackupPayload({ ...validBase, links: 'not-array' })
      expect(valid).toBe(false)
      expect(error).toBe('Invalid backup: links must be an array')
    })

    it('rejects null or non-object', () => {
      expect(validateBackupPayload(null).valid).toBe(false)
      expect(validateBackupPayload('string').valid).toBe(false)
      expect(validateBackupPayload([]).valid).toBe(false)
    })
  })

  describe('normalizeBackupData', () => {
    it('normalizes valid links and preserves fields', () => {
      const data = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: { name: 'Imported', bio: 'Bio' },
        links: [
          {
            id: '1',
            originalUrl: 'example.com/page',
            normalizedUrl: 'https://example.com/page',
            url: 'https://example.com/page',
            title: 'Title',
            description: 'Desc',
            image: 'https://example.com/img.jpg',
            tags: ['a', 'b'],
            category: 'GitHub',
            important: true,
            mustHave: false,
            favorite: true,
            domain: 'example.com',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      }
      const { profile, links } = normalizeBackupData(data)
      expect(profile).toEqual({ name: 'Imported', bio: 'Bio' })
      expect(links.length).toBe(1)
      expect(links[0].originalUrl).toBe('example.com/page')
      expect(links[0].normalizedUrl).toBe('https://example.com/page')
      expect(links[0].title).toBe('Title')
      expect(links[0].important).toBe(true)
      expect(links[0].favorite).toBe(true)
    })

    it('skips malformed records (non-object or missing url)', () => {
      const data = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: {},
        links: [
          null,
          'string',
          123,
          { id: 'bad1' }, // no url
          { id: 'bad2', url: '' }, // empty
          { id: 'good', originalUrl: 'https://example.com/good', title: 'Good' },
        ],
      }
      const { links } = normalizeBackupData(data)
      expect(links.length).toBe(1)
      expect(links[0].id).toBe('good')
    })

    it('skips records whose only URL is not http(s) (e.g. javascript:/data:)', () => {
      const data = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: {},
        links: [
          { id: 'js1', url: 'javascript:alert(1)', title: 'Bad' },
          { id: 'js2', normalizedUrl: 'data:text/html,hi', originalUrl: 'data:text/html,hi', title: 'Bad' },
          { id: 'ftp1', url: 'ftp://example.com/file', title: 'Bad' },
          { id: 'ok', originalUrl: 'example.com', normalizedUrl: 'https://example.com/ok', title: 'Good' },
        ],
      }
      const { links } = normalizeBackupData(data)
      expect(links.length).toBe(1)
      expect(links[0].id).toBe('ok')
      expect(links[0].normalizedUrl).toBe('https://example.com/ok')
      // scheme-less originalUrl stays as display text only
      expect(links[0].originalUrl).toBe('example.com')
    })

    it('generates id if missing', () => {
      const data = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: {},
        links: [{ originalUrl: 'https://example.com', title: 'No ID' }],
      }
      const { links } = normalizeBackupData(data)
      expect(links[0].id).toBeTruthy()
      expect(typeof links[0].id).toBe('string')
    })

    it('sanitizes tags and trims', () => {
      const data = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: {},
        links: [
          {
            originalUrl: 'https://example.com',
            tags: [' a ', '', 123, 'b', null],
            title: 'T',
          },
        ],
      }
      const { links } = normalizeBackupData(data)
      expect(links[0].tags).toEqual(['a', 'b'])
    })

    it('does not execute arbitrary fields', () => {
      const data = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: {},
        links: [
          {
            originalUrl: 'https://example.com',
            title: 'T',
            malicious: "<script>alert(1)</script>",
            __proto__: { polluted: true },
          },
        ],
      }
      const { links } = normalizeBackupData(data)
      expect(links[0].malicious).toBeUndefined()
      expect(links[0].polluted).toBeUndefined()
    })

    it('preserves profile and handles missing profile', () => {
      const data1 = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: { name: 'Keep', bio: 'Me' },
        links: [],
      }
      expect(normalizeBackupData(data1).profile).toEqual({ name: 'Keep', bio: 'Me' })

      const data2 = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        links: [],
      }
      expect(normalizeBackupData(data2).profile).toEqual({})

      const data3 = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: 'not-object',
        links: [],
      }
      expect(normalizeBackupData(data3).profile).toEqual({})
    })

    it('truncates title and description', () => {
      const data = {
        app: 'Save_Link',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: {},
        links: [
          {
            originalUrl: 'https://example.com',
            title: 'a'.repeat(500),
            description: 'b'.repeat(600),
          },
        ],
      }
      const { links } = normalizeBackupData(data)
      expect(links[0].title.length).toBe(200)
      expect(links[0].description.length).toBe(400)
    })

    it('imports P3-less backups with pinned false / type other (old backup compatibility)', () => {
      const data = {
        app: 'Save_Link',
        version: 2,
        exportedAt: new Date().toISOString(),
        profile: {},
        links: [{ id: '1', url: 'https://example.com/a', title: 'A' }],
      }
      const { links } = normalizeBackupData(data)
      expect(links[0].pinned).toBe(false)
      expect(links[0].type).toBe('other')
    })

    it('round-trips pinned and type through export → import', () => {
      const payload = createBackupPayload({
        links: [{ id: '1', normalizedUrl: 'https://example.com/a', url: 'https://example.com/a', title: 'A', pinned: true, type: 'tutorial' }],
        profile: {},
      })
      const { links } = normalizeBackupData(payload)
      expect(links[0].pinned).toBe(true)
      expect(links[0].type).toBe('tutorial')
    })

    it('imports old flat folder backups with parentId null (P4)', () => {
      const data = {
        app: 'Save_Link',
        version: 2,
        exportedAt: new Date().toISOString(),
        profile: {},
        folders: [{ id: 'f1', name: 'Work' }],
        links: [],
      }
      const { folders } = normalizeBackupData(data)
      expect(folders[0].parentId).toBe(null)
    })

    it('round-trips nested folders and repairs invalid relationships (P4)', () => {
      const payload = createBackupPayload({
        links: [],
        folders: [
          { id: 'f1', name: 'Work', parentId: null },
          { id: 'f2', name: 'Engineering', parentId: 'f1' },
          { id: 'f3', name: 'Ghost', parentId: 'missing' },
          { id: 'f4', name: 'CycleA', parentId: 'f5' },
          { id: 'f5', name: 'CycleB', parentId: 'f4' },
        ],
        profile: {},
      })
      const { folders } = normalizeBackupData(payload)
      const byId = new Map(folders.map((f) => [f.id, f]))
      expect(byId.get('f1').parentId).toBe(null)
      expect(byId.get('f2').parentId).toBe('f1')
      expect(byId.get('f3').parentId).toBe(null) // dangling -> root
      expect([byId.get('f4').parentId, byId.get('f5').parentId].includes(null)).toBe(true) // cycle broken
    })
  })
})
