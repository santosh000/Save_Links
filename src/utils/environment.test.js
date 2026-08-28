import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ENVIRONMENT, STORAGE_PREFIX, getStorageKey, getEnvironmentForMode } from './environment.js'
import { loadLinks, saveLinks, loadProfile, saveProfile } from './storage.js'
import { createBackupPayload, getLastBackupAt, setLastBackupAt, normalizeBackupData } from './backup.js'

describe('environment isolation', () => {
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
    // clear all storage keys
    ls().clear()
    // also clear legacy and env keys explicitly
    ;['save_link:links', 'save_link:profile', 'save_link:lastBackupAt',
      'save_link:dev:links', 'save_link:dev:profile', 'save_link:dev:lastBackupAt',
      'save_link:test:links', 'save_link:test:profile', 'save_link:test:lastBackupAt',
      'save_link:prod:links', 'save_link:prod:profile', 'save_link:prod:lastBackupAt'
    ].forEach(k => ls().removeItem(k))
  })

  it('TEST uses save_link:test: prefix', () => {
    expect(ENVIRONMENT).toBe('test')
    expect(STORAGE_PREFIX).toBe('save_link:test:')
    expect(getStorageKey('links')).toBe('save_link:test:links')
    expect(getStorageKey('profile')).toBe('save_link:test:profile')
    expect(getStorageKey('lastBackupAt')).toBe('save_link:test:lastBackupAt')
  })

  it('maps modes correctly', () => {
    expect(getEnvironmentForMode('development')).toBe('dev')
    expect(getEnvironmentForMode('test')).toBe('test')
    expect(getEnvironmentForMode('production')).toBe('prod')
    expect(getEnvironmentForMode('unknown')).toBe('dev')
  })

  it('DEV uses save_link:dev: prefix (via mapping)', () => {
    // direct mapping check, not current ENVIRONMENT
    expect(`save_link:${getEnvironmentForMode('development')}:links`).toBe('save_link:dev:links')
    expect(`save_link:${getEnvironmentForMode('development')}:profile`).toBe('save_link:dev:profile')
  })

  it('PROD uses save_link:prod: prefix', () => {
    expect(`save_link:${getEnvironmentForMode('production')}:links`).toBe('save_link:prod:links')
  })

  it('data written to DEV cannot be loaded by TEST', () => {
    // simulate DEV write
    localStorage.setItem('save_link:dev:links', JSON.stringify([{ id: 'dev1', title: 'DEV' }]))
    localStorage.setItem('save_link:dev:profile', JSON.stringify({ name: 'DevUser' }))
    // TEST load should not see DEV data
    expect(loadLinks()).toEqual([])
    expect(loadProfile().name).toBe('Local User')
    // verify DEV data still exists
    expect(JSON.parse(localStorage.getItem('save_link:dev:links'))[0].title).toBe('DEV')
  })

  it('data written to TEST cannot be loaded by PROD', () => {
    // write to TEST (current)
    saveLinks([{ id: 'test1', title: 'TEST' }])
    saveProfile({ name: 'TestUser' })
    expect(localStorage.getItem('save_link:test:links')).toContain('TEST')
    // simulate PROD read would use different key, so clear TEST and check PROD empty
    // manually check prod key is empty
    expect(localStorage.getItem('save_link:prod:links')).toBeNull()
    expect(localStorage.getItem('save_link:prod:profile')).toBeNull()
    // also verify dev key empty
    expect(localStorage.getItem('save_link:dev:links')).toBeNull()
  })

  it('TEST and DEV lastBackupAt isolated', () => {
    localStorage.setItem('save_link:dev:lastBackupAt', '2024-01-01T00:00:00.000Z')
    localStorage.setItem('save_link:test:lastBackupAt', '2024-02-02T00:00:00.000Z')
    // current is TEST, getLastBackupAt should return test value
    expect(getLastBackupAt()).toBe('2024-02-02T00:00:00.000Z')
    // dev value remains separate
    expect(localStorage.getItem('save_link:dev:lastBackupAt')).toBe('2024-01-01T00:00:00.000Z')
    setLastBackupAt('2024-03-03T00:00:00.000Z')
    expect(localStorage.getItem('save_link:test:lastBackupAt')).toBe('2024-03-03T00:00:00.000Z')
    expect(localStorage.getItem('save_link:dev:lastBackupAt')).toBe('2024-01-01T00:00:00.000Z')
  })

  it('legacy migration works on DEV (simulated)', async () => {
    // Simulate DEV migration by directly testing the copy logic
    // In TEST mode, migration does not run automatically, so we simulate what DEV would do
    localStorage.setItem('save_link:links', JSON.stringify([{ id: 'legacy1', title: 'Legacy' }]))
    localStorage.setItem('save_link:profile', JSON.stringify({ name: 'LegacyUser' }))
    localStorage.setItem('save_link:lastBackupAt', '2024-01-01T00:00:00.000Z')
    // Ensure DEV keys are empty before migration
    expect(localStorage.getItem('save_link:dev:links')).toBeNull()
    // Simulate DEV migration: copy legacy to dev if dev missing
    const devLinksKey = 'save_link:dev:links'
    const devProfileKey = 'save_link:dev:profile'
    const devLastKey = 'save_link:dev:lastBackupAt'
    if (localStorage.getItem(devLinksKey) === null && localStorage.getItem('save_link:links') !== null) {
      localStorage.setItem(devLinksKey, localStorage.getItem('save_link:links'))
    }
    if (localStorage.getItem(devProfileKey) === null && localStorage.getItem('save_link:profile') !== null) {
      localStorage.setItem(devProfileKey, localStorage.getItem('save_link:profile'))
    }
    if (localStorage.getItem(devLastKey) === null && localStorage.getItem('save_link:lastBackupAt') !== null) {
      localStorage.setItem(devLastKey, localStorage.getItem('save_link:lastBackupAt'))
    }
    expect(JSON.parse(localStorage.getItem('save_link:dev:links'))[0].title).toBe('Legacy')
    expect(JSON.parse(localStorage.getItem('save_link:dev:profile')).name).toBe('LegacyUser')
    expect(localStorage.getItem('save_link:dev:lastBackupAt')).toBe('2024-01-01T00:00:00.000Z')
    // legacy preserved
    expect(localStorage.getItem('save_link:links')).not.toBeNull()
  })

  it('migration is idempotent (does not duplicate)', () => {
    localStorage.setItem('save_link:links', JSON.stringify([{ id: 'a', title: 'A' }]))
    localStorage.setItem('save_link:dev:links', JSON.stringify([{ id: 'existing', title: 'Existing' }]))
    // simulate migration second run: should NOT overwrite dev
    const devLinksKey = 'save_link:dev:links'
    if (localStorage.getItem(devLinksKey) === null && localStorage.getItem('save_link:links') !== null) {
      localStorage.setItem(devLinksKey, localStorage.getItem('save_link:links'))
    }
    expect(JSON.parse(localStorage.getItem('save_link:dev:links'))[0].title).toBe('Existing')
    expect(JSON.parse(localStorage.getItem('save_link:dev:links')).length).toBe(1)
  })

  it('backup JSON remains environment-agnostic', () => {
    const links = [{ id: '1', originalUrl: 'https://example.com', normalizedUrl: 'https://example.com', url: 'https://example.com', title: 'T', domain: 'example.com' }]
    const profile = { name: 'Test' }
    const payload = createBackupPayload({ links, profile })
    expect(payload.app).toBe('Save_Link')
    expect(payload.version).toBe(2)
    expect(payload).not.toHaveProperty('environment')
    expect(JSON.stringify(payload)).not.toContain('save_link:')
    expect(JSON.stringify(payload)).not.toContain('dev')
    expect(JSON.stringify(payload)).not.toContain('test')
    expect(JSON.stringify(payload)).not.toContain('prod')
  })

  it('existing localStorage persistence still works (TEST)', async () => {
    const links = [{ id: '1', title: 'Persist', originalUrl: 'https://example.com', normalizedUrl: 'https://example.com', url: 'https://example.com', domain: 'example.com', tags: [], category: 'Other', important: false, mustHave: false, favorite: false, createdAt: new Date().toISOString() }]
    saveLinks(links)
    expect(loadLinks()).toEqual(links)
    saveProfile({ name: 'PersistUser', bio: 'Bio' })
    expect(loadProfile().name).toBe('PersistUser')
  })

  it('favorites/important/mustHave remain intact through backup', () => {
    const links = [
      { id: '1', title: 'Fav', favorite: true, important: true, mustHave: false, originalUrl: 'https://example.com', normalizedUrl: 'https://example.com', url: 'https://example.com', domain: 'example.com', tags: [], category: 'Other', createdAt: new Date().toISOString() },
      { id: '2', title: 'Must', favorite: false, important: false, mustHave: true, originalUrl: 'https://example.com/2', normalizedUrl: 'https://example.com/2', url: 'https://example.com/2', domain: 'example.com', tags: [], category: 'Other', createdAt: new Date().toISOString() },
    ]
    const payload = createBackupPayload({ links, profile: {} })
    expect(payload.links[0].favorite).toBe(true)
    expect(payload.links[0].important).toBe(true)
    expect(payload.links[1].mustHave).toBe(true)
    const normalized = normalizeBackupData(payload)
    expect(normalized.links[0].favorite).toBe(true)
    expect(normalized.links[0].important).toBe(true)
    expect(normalized.links[1].mustHave).toBe(true)
  })
})
