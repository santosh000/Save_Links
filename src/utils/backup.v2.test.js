import { describe, it, expect, beforeEach } from 'vitest'
import { createBackupPayload, validateBackupPayload, normalizeBackupData, BACKUP_VERSION, pickImportSlices, mergeImportData } from './backup.js'
import { getStorageKey } from '../utils/environment.js'

describe('backup v2', () => {
  beforeEach(() => {
    const ls = () => {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
      if (globalThis.localStorage) return globalThis.localStorage
      if (!globalThis._mockLS) {
        const store = {}
        globalThis._mockLS = {
          getItem(k){return store[k]??null}, setItem(k,v){store[k]=String(v)}, removeItem(k){delete store[k]}, clear(){for(const k in store) delete store[k]}
        }
      }
      return globalThis._mockLS
    }
    const mock = ls()
    if (!globalThis.localStorage) globalThis.localStorage = mock
    try { if (typeof localStorage==='undefined') global.localStorage=mock }catch{}
    ls().clear()
  })

  it('v2 export contains folders, appearance, colorScheme', () => {
    const folders = [{ id:'f1', name:'Work', createdAt:new Date().toISOString()}]
    const links = [{ id:'1', originalUrl:'https://example.com', normalizedUrl:'https://example.com', url:'https://example.com', title:'T', description:'', image:'', tags:[], category:'Other', important:false, mustHave:false, favorite:false, folderId:'f1', domain:'example.com', createdAt:new Date().toISOString(), savedFrom:'Windows'}]
    const payload = createBackupPayload({ links, profile:{}, folders, appearance:'dark', colorScheme:'forest'})
    expect(payload.version).toBe(2)
    expect(payload.folders).toEqual(folders)
    expect(payload.settings).toEqual({ appearance:'dark', colorScheme:'forest'})
    expect(payload.links[0].folderId).toBe('f1')
    expect(payload.links[0].savedFrom).toBe('Windows')
  })

  it('defaults when not provided', () => {
    const payload = createBackupPayload({ links:[], profile:{} })
    expect(payload.settings).toEqual({ appearance:'system', colorScheme:'ocean'})
    expect(payload.folders).toEqual([])
  })

  it('v1 import migrates safely with defaults', () => {
    const v1 = { app:'Save_Link', version:1, exportedAt:new Date().toISOString(), profile:{}, links:[{ id:'1', originalUrl:'https://example.com', normalizedUrl:'https://example.com', title:'T', domain:'example.com'}]}
    const v = validateBackupPayload(v1)
    expect(v.valid).toBe(true)
    const norm = normalizeBackupData(v1)
    expect(norm.folders).toEqual([])
    expect(norm.settings).toEqual({ appearance:'system', colorScheme:'ocean'})
    expect(norm.links[0].folderId).toBeNull()
  })

  it('v2 import restores folders and settings', () => {
    const v2 = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{name:'A'}, settings:{appearance:'light', colorScheme:'amber'}, folders:[{id:'f1', name:'My Folder', createdAt:new Date().toISOString()}], links:[{ id:'1', originalUrl:'https://example.com', normalizedUrl:'https://example.com', folderId:'f1', title:'T'}]}
    expect(validateBackupPayload(v2).valid).toBe(true)
    const norm = normalizeBackupData(v2)
    expect(norm.folders.length).toBe(1)
    expect(norm.folders[0].name).toBe('My Folder')
    expect(norm.settings.appearance).toBe('light')
    expect(norm.settings.colorScheme).toBe('amber')
    expect(norm.links[0].folderId).toBe('f1')
  })

  it('invalid backup rejected', () => {
    expect(validateBackupPayload({ app:'Save_Link', version:999, links:[] }).valid).toBe(false)
    expect(validateBackupPayload({ app:'Wrong', version:2, links:[] }).valid).toBe(false)
    expect(validateBackupPayload({ app:'Save_Link', version:2 }).valid).toBe(false)
  })

  it('sanitizes folders and appearance', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{}, settings:{appearance:'invalid', colorScheme:'neon'}, folders:[{id:'', name:''}, {id:'f1', name:'Good'}, {id:'f1', name:'Duplicate'}], links:[]}
    const norm = normalizeBackupData(data)
    expect(norm.settings.appearance).toBe('system')
    expect(norm.settings.colorScheme).toBe('ocean')
    expect(norm.folders.length).toBe(1)
  })

  it('link with invalid folderId becomes null', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{}, folders:[{id:'f1', name:'F'}], links:[{ originalUrl:'https://example.com', folderId:'nonexistent', title:'T'}]}
    const norm = normalizeBackupData(data)
    expect(norm.links[0].folderId).toBeNull()
  })

  it('link folderId preserved when valid', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{}, folders:[{id:'f1', name:'F'}], links:[{ originalUrl:'https://example.com', folderId:'f1', title:'T'}]}
    const norm = normalizeBackupData(data)
    expect(norm.links[0].folderId).toBe('f1')
  })

  it('export -> import round-trips savedFrom and createdAt', () => {
    const links = [{ id:'1', originalUrl:'https://example.com', normalizedUrl:'https://example.com', url:'https://example.com', title:'T', description:'', image:'', tags:[], category:'Other', important:false, mustHave:false, favorite:false, folderId:null, domain:'example.com', createdAt:'2026-01-01T00:00:00.000Z', savedFrom:'Android'}]
    const payload = createBackupPayload({ links, profile:{} })
    expect(validateBackupPayload(payload).valid).toBe(true)
    const norm = normalizeBackupData(payload)
    expect(norm.links[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(norm.links[0].savedFrom).toBe('Android')
  })

  it('old backup without savedFrom imports safely as Unknown', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{}, links:[{ id:'1', originalUrl:'https://example.com', normalizedUrl:'https://example.com', title:'T', createdAt:'2025-05-05T00:00:00.000Z'}]}
    expect(validateBackupPayload(data).valid).toBe(true)
    const norm = normalizeBackupData(data)
    expect(norm.links[0].createdAt).toBe('2025-05-05T00:00:00.000Z')
    expect(norm.links[0].savedFrom).toBe('Unknown')
  })
})

describe('pickImportSlices — import boundary', () => {

  it('returns links from the backup', () => {
    const links = [{ id:'1', originalUrl:'https://a.com', normalizedUrl:'https://a.com', title:'A' }]
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), links, folders:[], profile:{name:'Old'}, settings:{appearance:'dark', colorScheme:'forest'} }
    const { links: pickedLinks, folders: pickedFolders } = pickImportSlices(data)
    expect(pickedLinks).toEqual(links)
    expect(pickedFolders).toEqual([])
  })

  it('returns folders from the backup', () => {
    const folders = [{ id:'f1', name:'Work', createdAt:new Date().toISOString() }]
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), links:[], folders, profile:{name:'Old'}, settings:{appearance:'dark'} }
    const { links: pickedLinks, folders: pickedFolders } = pickImportSlices(data)
    expect(pickedLinks).toEqual([])
    expect(pickedFolders).toEqual(folders)
  })

  it('does NOT return profile (local profile preserved)', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{name:'Imported Name', bio:'Imported bio'}, links:[], folders:[] }
    const slices = pickImportSlices(data)
    expect('profile' in slices).toBe(false)
    // The returned object only has links and folders
    expect(Object.keys(slices)).toEqual(['links', 'folders'])
  })

  it('does NOT return settings/appearance/colorScheme (theme preserved)', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), settings:{appearance:'dark', colorScheme:'forest'}, links:[], folders:[] }
    const slices = pickImportSlices(data)
    expect('settings' in slices).toBe(false)
    expect('appearance' in slices).toBe(false)
    expect('colorScheme' in slices).toBe(false)
    expect(Object.keys(slices)).toEqual(['links', 'folders'])
  })

  it('handles missing/undefined arrays gracefully', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString() }
    const { links, folders } = pickImportSlices(data)
    expect(links).toEqual([])
    expect(folders).toEqual([])
  })

  it('handles null/empty arrays gracefully', () => {
    const data = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), links:null, folders:null, profile:{name:'X'}, settings:{appearance:'light'} }
    const { links, folders } = pickImportSlices(data)
    expect(links).toEqual([])
    expect(folders).toEqual([])
  })
})

describe('mergeImportData — additive import with duplicate handling', () => {

  // Helper to create a minimal valid link
  function makeLink(overrides = {}) {
    return {
      id: '1',
      originalUrl: 'https://example.com',
      normalizedUrl: 'https://example.com',
      url: 'https://example.com',
      title: 'Example',
      ...overrides
    }
  }

  // Helper to create a minimal valid folder
  function makeFolder(overrides = {}) {
    return {
      id: 'f1',
      name: 'Folder 1',
      createdAt: new Date().toISOString(),
      ...overrides
    }
  }

  describe('links duplicate detection by normalizedUrl', () => {
    it('detects duplicate links by normalizedUrl', () => {
      const existing = [makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a' })]
      const imported = [makeLink({ id: 'imported-1', normalizedUrl: 'https://example.com/a' })]
      const result = mergeImportData(existing, [], imported, [])
      expect(result.counts.links.total).toBe(1)
      expect(result.counts.links.duplicate).toBe(1)
      expect(result.counts.links.new).toBe(0)
    })

    it('treats different normalizedUrls as separate links', () => {
      const existing = [makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a' })]
      const imported = [makeLink({ id: 'imported-1', normalizedUrl: 'https://example.com/b' })]
      const result = mergeImportData(existing, [], imported, [])
      expect(result.counts.links.total).toBe(1)
      expect(result.counts.links.new).toBe(1)
      expect(result.counts.links.duplicate).toBe(0)
    })

    it('treats different URL schemes as separate links', () => {
      const existing = [makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a' })]
      const imported = [makeLink({ id: 'imported-1', originalUrl: 'http://example.com/a', normalizedUrl: 'http://example.com/a' })]
      const result = mergeImportData(existing, [], imported, [])
      // Different schemes (http vs https) are treated as different URLs
      expect(result.counts.links.duplicate).toBe(0)
      expect(result.counts.links.new).toBe(1)
    })
  })

  describe('folders duplicate detection by id and name', () => {
    it('detects duplicate folders by id', () => {
      const existing = [makeFolder({ id: 'f1', name: 'Work' })]
      const imported = [makeFolder({ id: 'f1', name: 'Work' })]
      const result = mergeImportData([], existing, [], imported)
      expect(result.counts.folders.total).toBe(1)
      expect(result.counts.folders.duplicate).toBe(1)
      expect(result.counts.folders.new).toBe(0)
    })

    it('detects duplicate folders by name (case-insensitive)', () => {
      const existing = [makeFolder({ id: 'f1', name: 'Work' })]
      const imported = [makeFolder({ id: 'f2', name: 'WORK' })]
      const result = mergeImportData([], existing, [], imported)
      expect(result.counts.folders.duplicate).toBe(1)
    })

    it('treats different names as separate folders', () => {
      const existing = [makeFolder({ id: 'f1', name: 'Work' })]
      const imported = [makeFolder({ id: 'f2', name: 'Personal' })]
      const result = mergeImportData([], existing, [], imported)
      expect(result.counts.folders.new).toBe(1)
      expect(result.counts.folders.duplicate).toBe(0)
    })
  })

  describe('skip strategy (default)', () => {
    it('keeps existing links when duplicates found', () => {
      const existing = [makeLink({ id: 'local-1', title: 'Local Title', normalizedUrl: 'https://example.com/a' })]
      const imported = [makeLink({ id: 'imported-1', title: 'Imported Title', normalizedUrl: 'https://example.com/a' })]
      const result = mergeImportData(existing, [], imported, [], 'skip')
      expect(result.counts.links.skipped).toBe(1)
      expect(result.counts.links.replaced).toBe(0)
      expect(result.merged.links[0].title).toBe('Local Title') // kept existing
    })

    it('keeps existing folders when duplicates found', () => {
      const existing = [makeFolder({ id: 'f1', name: 'Work' })]
      const imported = [makeFolder({ id: 'f2', name: 'Work' })] // same name, different id
      const result = mergeImportData([], existing, [], imported, 'skip')
      expect(result.counts.folders.skipped).toBe(1)
      expect(result.counts.folders.replaced).toBe(0)
      expect(result.merged.folders[0].name).toBe('Work')
    })

    it('adds new items while skipping duplicates', () => {
      const existing = [makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a' })]
      const imported = [
        makeLink({ id: 'imported-1', normalizedUrl: 'https://example.com/a' }), // duplicate
        makeLink({ id: 'imported-2', normalizedUrl: 'https://example.com/b' }), // new
      ]
      const result = mergeImportData(existing, [], imported, [], 'skip')
      expect(result.counts.links.new).toBe(1)
      expect(result.counts.links.skipped).toBe(1)
      expect(result.merged.links.length).toBe(2) // existing + 1 new
    })
  })

  describe('replace strategy', () => {
    it('replaces existing links with imported version', () => {
      const existing = [makeLink({ id: 'local-1', title: 'Local Title', normalizedUrl: 'https://example.com/a' })]
      const imported = [makeLink({ id: 'imported-1', title: 'Imported Title', normalizedUrl: 'https://example.com/a' })]
      const result = mergeImportData(existing, [], imported, [], 'replace')
      expect(result.counts.links.replaced).toBe(1)
      expect(result.counts.links.skipped).toBe(0)
      expect(result.merged.links[0].title).toBe('Imported Title') // replaced
      expect(result.merged.links[0].id).toBe('local-1') // preserved existing id
    })

    it('preserves local fields (id, createdAt, folderId, tags, flags) on replace', () => {
      const existing = [{
        ...makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a' }),
        folderId: 'f1',
        tags: ['local-tag'],
        important: true,
        mustHave: false,
        favorite: true,
        revision: 5,
        account_id: 'acc-1',
      }]
      const imported = [makeLink({ id: 'imported-1', normalizedUrl: 'https://example.com/a', title: 'New Title', tags: ['imported-tag'] })]
      const result = mergeImportData(existing, [], imported, [], 'replace')
      const merged = result.merged.links[0]
      expect(merged.id).toBe('local-1')
      expect(merged.folderId).toBe('f1')
      expect(merged.tags).toEqual(['local-tag']) // preserved local tags
      expect(merged.important).toBe(true)
      expect(merged.mustHave).toBe(false)
      expect(merged.favorite).toBe(true)
      expect(merged.revision).toBe(5)
      expect(merged.account_id).toBe('acc-1')
      expect(merged.title).toBe('New Title') // updated from import
    })

    it('replaces existing folders with imported name', () => {
      const existing = [makeFolder({ id: 'f1', name: 'Work' })]
      const imported = [makeFolder({ id: 'f2', name: 'Work' })] // same name, different id
      const result = mergeImportData([], existing, [], imported, 'replace')
      expect(result.counts.folders.replaced).toBe(1)
      expect(result.merged.folders[0].name).toBe('Work')
      expect(result.merged.folders[0].id).toBe('f1')
    })

    it('adds new items while replacing duplicates', () => {
      const existing = [makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a' })]
      const imported = [
        makeLink({ id: 'imported-1', normalizedUrl: 'https://example.com/a' }), // duplicate
        makeLink({ id: 'imported-2', normalizedUrl: 'https://example.com/b' }), // new
      ]
      const result = mergeImportData(existing, [], imported, [], 'replace')
      expect(result.counts.links.new).toBe(1)
      expect(result.counts.links.replaced).toBe(1)
      expect(result.merged.links.length).toBe(2) // existing (replaced) + 1 new
    })
  })

  describe('edge cases', () => {
    it('handles empty existing data', () => {
      const result = mergeImportData([], [], [makeLink()], [makeFolder()])
      expect(result.counts.links.new).toBe(1)
      expect(result.counts.folders.new).toBe(1)
      expect(result.merged.links.length).toBe(1)
      expect(result.merged.folders.length).toBe(1)
    })

    it('handles empty imported data', () => {
      const existingLinks = [makeLink({ id: 'local-1' })]
      const existingFolders = [makeFolder({ id: 'f1', name: 'Test' })]
      const result = mergeImportData(existingLinks, existingFolders, [], [])
      expect(result.counts.links.total).toBe(0)
      expect(result.counts.folders.total).toBe(0)
      expect(result.merged.links.length).toBe(1)
      expect(result.merged.folders.length).toBe(1)
    })

    it('handles null/undefined arrays gracefully', () => {
      const result = mergeImportData(null, null, null, null)
      expect(result.counts.links.total).toBe(0)
      expect(result.counts.folders.total).toBe(0)
      expect(result.merged.links).toEqual([])
      expect(result.merged.folders).toEqual([])
    })

    it('skips imported links without normalizedUrl', () => {
      const existing = [makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a' })]
      const imported = [{ id: 'bad', title: 'No URL' }, makeLink({ id: 'good', normalizedUrl: 'https://example.com/b' })]
      const result = mergeImportData(existing, [], imported, [])
      // Invalid links are filtered out during normalization
      expect(result.counts.links.total).toBe(1)
      expect(result.counts.links.new).toBe(1) // only the valid one
      expect(result.counts.links.duplicate).toBe(0)
    })

    it('preserves local items unrelated to import', () => {
      const existing = [
        makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a' }),
        makeLink({ id: 'local-2', normalizedUrl: 'https://example.com/b' }),
      ]
      const imported = [makeLink({ id: 'imported-1', normalizedUrl: 'https://example.com/a' })]
      const result = mergeImportData(existing, [], imported, [], 'replace')
      expect(result.merged.links.length).toBe(2) // local-2 preserved, local-1 replaced
      expect(result.merged.links.some(l => l.id === 'local-2')).toBe(true)
    })

    it('importing same backup twice with skip does not create duplicates', () => {
      const existing = [makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a' })]
      const imported = [makeLink({ id: 'imported-1', normalizedUrl: 'https://example.com/a' })]
      // First import with skip
      const result1 = mergeImportData(existing, [], imported, [], 'skip')
      // Second import with skip (simulating re-importing same backup)
      const result2 = mergeImportData(result1.merged.links, [], imported, [], 'skip')
      expect(result2.counts.links.new).toBe(0)
      expect(result2.counts.links.skipped).toBe(1)
      expect(result2.merged.links.length).toBe(1)
    })

    it('mergeImportData carries the backup savedFrom through for new and replaced links', () => {
      const existing = [makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a', savedFrom: 'Android' })]
      const imported = [
        // duplicate of a — on replace it should use the backup Windows metadata
        makeLink({ id: 'imp-1', normalizedUrl: 'https://example.com/a', savedFrom: 'Windows' }),
        // brand-new item with macOS metadata
        makeLink({ id: 'imp-2', normalizedUrl: 'https://example.com/c', savedFrom: 'macOS' }),
      ]
      const result = mergeImportData(existing, [], imported, [], 'replace')
      const byUrl = Object.fromEntries(result.merged.links.map(l => [l.normalizedUrl, l]))
      // replaced duplicate retains the backup device metadata (Windows)
      expect(byUrl['https://example.com/a'].savedFrom).toBe('Windows')
      // new item keeps its macOS metadata
      expect(byUrl['https://example.com/c'].savedFrom).toBe('macOS')
      // unrelated local items untouched — none here past the replaced one
    })

    it('mergeImportData keep-existing preserves the LOCAL device metadata', () => {
      const existing = [makeLink({ id: 'local-1', normalizedUrl: 'https://example.com/a', savedFrom: 'Windows' })]
      const imported = [makeLink({ id: 'imp-1', normalizedUrl: 'https://example.com/a', savedFrom: 'Android' })]
      const result = mergeImportData(existing, [], imported, [], 'skip')
      const kept = result.merged.links.find(l => l.normalizedUrl === 'https://example.com/a')
      // skip: local untouched — device metadata stays Windows
      expect(kept.savedFrom).toBe('Windows')
    })

    it('a link without savedFrom in the backup is NOT stamped with the importing device', () => {
      const noMeta = makeLink({ id: 'imp-1', normalizedUrl: 'https://example.com/nometa' })
      delete noMeta.savedFrom
      const result = mergeImportData([], [], [noMeta], [])
      expect(result.merged.links[0].savedFrom).toBe('Unknown')
      expect(result.merged.links[0].savedFrom).not.toMatch(/Windows|macOS|Android/)
    })
  })
})
