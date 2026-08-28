import { describe, it, expect, beforeEach } from 'vitest'
import { getStorageKey } from './environment.js'
import { loadAppearance, loadColorScheme, saveAppearance, saveColorScheme, DEFAULT_APPEARANCE, DEFAULT_COLOR_SCHEME } from './storage.js'

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

describe('appearance & colorScheme persistence', () => {
  beforeEach(() => {
    const mock = getLS()
    if (!globalThis.localStorage) globalThis.localStorage = mock
    if (typeof window !== 'undefined' && !window.localStorage) window.localStorage = mock
    try { if (typeof localStorage === 'undefined') global.localStorage = mock } catch {}
    getLS().clear()
  })

  it('defaults to system and ocean when no saved preference', () => {
    expect(loadAppearance()).toBe(DEFAULT_APPEARANCE)
    expect(loadAppearance()).toBe('system')
    expect(loadColorScheme()).toBe(DEFAULT_COLOR_SCHEME)
    expect(loadColorScheme()).toBe('ocean')
  })

  it('persists appearance values isolated', () => {
    saveAppearance('dark')
    expect(loadAppearance()).toBe('dark')
    expect(getLS().getItem(getStorageKey('appearance'))).toContain('dark')
    saveAppearance('light')
    expect(loadAppearance()).toBe('light')
    saveAppearance('system')
    expect(loadAppearance()).toBe('system')
  })

  it('rejects invalid appearance -> defaults', () => {
    saveAppearance('invalid')
    expect(loadAppearance()).toBe('system')
  })

  it('persists colorScheme', () => {
    for (const c of ['ocean','forest','lavender','amber']) {
      saveColorScheme(c)
      expect(loadColorScheme()).toBe(c)
    }
  })

  it('rejects invalid colorScheme -> defaults', () => {
    saveColorScheme('neon')
    expect(loadColorScheme()).toBe('ocean')
  })

  it('appearance and colorScheme independent', () => {
    saveAppearance('dark')
    saveColorScheme('forest')
    expect(loadAppearance()).toBe('dark')
    expect(loadColorScheme()).toBe('forest')
    saveAppearance('light')
    expect(loadColorScheme()).toBe('forest')
    saveColorScheme('amber')
    expect(loadAppearance()).toBe('light')
  })

  it('storage keys are environment isolated', () => {
    saveAppearance('dark')
    expect(getLS().getItem(getStorageKey('appearance'))).not.toBeNull()
    expect(getLS().getItem('save_link:dev:appearance')).toBeNull()
    expect(getLS().getItem('save_link:prod:appearance')).toBeNull()
  })
})
